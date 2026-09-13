/**
 * 亚庇（Kota Kinabalu）三日拍摄计划生成器 —— 一次性脚本。
 *
 * 与 plans.service.ts 的差别：人物档案不读 profile.json（那是别人的），
 * 而是用参考照片走视觉管线现场分析人设（发色发型/脸型眼型/肤色调/气质），
 * 妆造模板按 faceFit 现场匹配。其余全部复用项目能力：
 *   sharp 压缩（upload.ts 同参数）→ analyzeFace + analyzeReferenceImage（vision.ts）
 *   → open-meteo 地理编码 +日出日落 → sun.ts 黄金/蓝调窗口
 *   → chatJSON 分镜（pose 引用姿势库编号，isPoseId 校验，失败降级 shots.md）
 *   → store.ts 落盘 ~/stylist-data/plans/<id>/plan.json（App 拍照页直接可见）
 *
 * 用法：npx tsx scripts/kk-photoshoot-plan.ts <参考照片路径>
 */
import { readFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { z } from 'zod';
import { config } from '../server/config.ts';
import { absPath, ensureDir, updateJson } from '../server/store.ts';
import { sunWindows } from '../server/sun.ts';
import { chatJSON, llmAvailable } from '../server/llm.ts';
import { analyzeFace, analyzeReferenceImage } from '../server/vision.ts';
import { poseCatalog, isPoseId, makeups } from '../server/knowledge.ts';
import { defaultShots } from '../server/plans.service.ts';
import { saveCovers } from '../server/reference.ts';
import type { PhotoPlan, Shot } from '../shared/types.ts';

// ---------- 参数 ----------

const photoPath = process.argv[2];
if (!photoPath || !existsSync(photoPath)) {
  console.error('用法：npx tsx scripts/kk-photoshoot-plan.ts <参考照片路径>');
  process.exit(1);
}

const CITY = '亚庇';
// open-meteo 地理编码失败的兜底坐标（Kota Kinabalu 市中心）
const FALLBACK = { lat: 5.9804, lon: 116.0735 };
// 拍摄窗口：今天/明天/后天
const today = new Date();
const dates = [0, 1, 2].map((d) => {
  const t = new Date(today.getTime() + d * 86400000);
  return t.toISOString().slice(0, 10);
});

// ---------- 三日企划定义（一 plan 一 sceneType，主题/点位按亚庇实际地标） ----------

const PLANS = [
  {
    dateIdx: 0,
    theme: '加雅街夜市 · 蓝调初上霓虹夜',
    sceneType: '夜景' as const,
    locationName: '加雅街夜市 & 海滨广场（Jalan Gaya Night Market & Waterfront）',
    context:
      '亚庇老城夜市：骑楼霓虹招牌、小吃摊烟火气、海滨广场看晚霞余韵。热带夜晚闷热，蚊虫多。' +
      '蓝调时刻约日落后 15-40 分钟，窗口短；夜市灯光是主要人像光源。',
    makeupPref: 'mk_glossy_pure',
  },
  {
    dateIdx: 1,
    theme: '加雅街白墙老街 citywalk · 甜酷漫游',
    sceneType: '街拍' as const,
    locationName: '加雅街老城（Gaya Street Heritage）',
    context:
      '加雅街殖民时期老街：米白/鹅黄/薄荷绿彩色矮墙、百叶窗老店屋、咖啡馆门脸，街上还有老爷车。' +
      '白天顶光毒辣（紫外线极强），上午柔光窗口最好；墙面前顺光即可出片，注意找骑楼阴影。',
    makeupPref: 'mk_sweet_energy',
  },
  {
    dateIdx: 2,
    theme: '丹绒亚路海滩 · 世界三大日落火烧云',
    sceneType: '夜景' as const,
    locationName: '丹绒亚路海滩（Tanjung Aru Beach）',
    context:
      '号称世界三大日落之一：火烧云铺满天空，椰子树剪影，退潮时滩涂会镜像反射天空。' +
      '黄金时刻（日落前 55 分钟）人最多要早到占机位；海风大，短发要抓拍动感瞬间而不是硬凹造型；' +
      '落日后 15-40 分钟是蓝调+紫调，配海滩路灯最有电影感。',
    makeupPref: 'mk_glossy_pure',
  },
];

// ---------- 分镜 schema（与 plans.service.ts shotsSchema 一致） ----------

const shotsSchema = z.object({
  shots: z.array(z.object({
    no: z.number(),
    place: z.string(),
    angle: z.string(),
    framing: z.string(),
    pose: z.string(),
    expression: z.string(),
    burstTip: z.string(),
  })).min(4).max(10),
  props: z.array(z.string()),
  checklist: z.array(z.string()),
});

const SCENE_EN = { 街拍: 'citywalk', 咖啡店: 'cafe', 公园: 'park', 天台: 'rooftop', 夜景: 'night' } as const;

function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(4, '0').slice(0, 4);
}

// ---------- 主流程 ----------

async function main() {
  // 1. 压缩参考照（upload.ts 同参数：EXIF 转正 + ≤1280px JPEG）
  const raw = readFileSync(photoPath);
  const jpg = await sharp(raw, { failOn: 'none' }).rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 }).toBuffer();
  const dataUrl = `data:image/jpeg;base64,${jpg.toString('base64')}`;
  console.log(`✔ 参考照压缩完成（${(jpg.length / 1024).toFixed(0)}KB）`);

  // 2. 视觉管线：档案现场分析（不读 profile.json）
  let face = { faceShape: '圆脸', eyeShape: '圆眼', skinTone: '冷白', colorSeason: '夏' };
  let brief: { theme: string; sceneType: string; styleBrief: string; locationHint: string } | null = null;
  if (llmAvailable()) {
    try {
      face = await analyzeFace(dataUrl);
      console.log(`✔ 人脸分析：${face.faceShape} / ${face.eyeShape} / ${face.skinTone} / ${face.colorSeason}型`);
    } catch (e) { console.warn(`⚠ 人脸分析失败，用照片观察兜底：${(e as Error).message}`); }
    try {
      brief = await analyzeReferenceImage([dataUrl],
        '人物本人参考照（演唱会现场）。请提炼她的气质与人像设定，作为后续拍摄的表情基调与妆造参考，不必照搬这身衣服。',
        '甜酷混合（TWICE 元气甜 + aespa 短发酷感之间，参考 aespa Winter 短发造型）');
      console.log(`✔ 风格简报：${brief.styleBrief}`);
    } catch (e) { console.warn(`⚠ 风格简报失败：${(e as Error).message}`); }
  } else {
    console.warn('⚠ LLM key 未配置，人设用照片观察兜底，分镜走 shots.md 模板');
  }

  // 人物设定（喂给分镜 prompt；只描述照片可见特征，不臆造身材数字）
  const persona =
    `她是一个短发女生：黑色及肩锁骨发 + 空气刘海（海风/出汗易塌，分镜里多设计抓拍动态瞬间），` +
    `${face.faceShape}${face.eyeShape}，${face.skinTone}皮，妆容基调是水红色玻璃唇 + 苹果肌腮红，` +
    `整体气质甜中带酷（甜美系长相 + 酷感穿搭），笑容是最大记忆点，镜头感放松、会看镜头wink。` +
    `显高显瘦要点：低机位仰拍、高腰线构图、侧身顶胯，避免正面平拍全身。`;

  // 3. 地理编码（亚庇）
  let geo = FALLBACK;
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent('Kota Kinabalu')}&count=1&language=zh`, { signal: AbortSignal.timeout(3000) });
    const j = await res.json() as { results?: { latitude: number; longitude: number }[] };
    if (j.results?.[0]) geo = { lat: j.results[0].latitude, lon: j.results[0].longitude };
  } catch { /* fallback */ }
  console.log(`✔ ${CITY} 坐标：${geo.lat.toFixed(3)}, ${geo.lon.toFixed(3)}`);

  // 4. 每天的日出日落 → 摄影时间窗（timezone=Asia/Kuching，与中国同 UTC+8）
  const windowsByDate = new Map<string, PhotoPlan['timeWindows']>();
  for (const date of dates) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
        `&daily=sunrise,sunset&start_date=${date}&end_date=${date}&timezone=Asia%2FKuching`;
      const j = await fetch(url, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()) as {
        daily?: { sunrise: string[]; sunset: string[] };
      };
      const rise = j.daily?.sunrise?.[0];
      const set = j.daily?.sunset?.[0];
      if (rise && set) {
        windowsByDate.set(date, sunWindows(rise, set));
        console.log(`✔ ${date} 日出 ${rise.slice(11, 16)} / 日落 ${set.slice(11, 16)}（当地时间）`);
      }
    } catch { /* fallback below */ }
    if (!windowsByDate.has(date)) {
      windowsByDate.set(date, [
        { type: '上午柔光', start: '06:15', end: '06:55', tip: '日出后 10-50 分钟（赤道地区日出≈6:05）' },
        { type: '顶光提示', start: '10:00', end: '15:00', tip: '热带顶光毒辣，顺光拍或找骑楼阴影' },
        { type: '黄金时刻', start: '17:25', end: '18:35', tip: '日落前 55 分钟到日落后 15 分钟' },
        { type: '蓝调时刻', start: '18:35', end: '19:00', tip: '日落 15-40 分钟，天空深蓝窗口短' },
      ]);
    }
  }

  // 5. 妆造：按现场分析的脸型/眼型从模板库匹配（faceFit 空数组 = 不限）
  function pickMakeup(prefId: string): string {
    const all = makeups();
    const fit = (m: typeof all[number]) =>
      m.occasions.includes('拍照') &&
      (m.faceFit.faceShape.length === 0 || m.faceFit.faceShape.includes(face.faceShape)) &&
      (m.faceFit.eyeShape.length === 0 || m.faceFit.eyeShape.includes(face.eyeShape));
    const pref = all.find((m) => m.id === prefId);
    if (pref && fit(pref)) return pref.id;
    const alt = all.find((m) => fit(m));
    return alt?.id ?? 'mk_stage_photo';
  }

  // 6. 逐计划生成
  const results: PhotoPlan[] = [];
  for (const def of PLANS) {
    const date = dates[def.dateIdx];
    let shots: Shot[] = [];
    let props: string[] = [];
    let checklist: string[] = [];
    let source: 'llm' | 'rule' = 'rule';

    if (llmAvailable()) {
      try {
        const r = await chatJSON({
          schema: shotsSchema,
          maxTokens: 3072,
          messages: [
            { role: 'system', content:
`你是拍照策划师。为用户生成「${def.theme}」的 ${def.sceneType} 拍摄计划分镜。拍摄地在马来西亚${CITY}（Kota Kinabalu）。

${def.context}

人物设定（来自本人参考照，表情基调与姿势设计要贴合）：
${persona}
${brief ? `风格简报：${brief.styleBrief}` : ''}

规则：
1. 生成 6-8 个分镜，每个分镜的 pose 字段【必须】从下面姿势库编号中选择（p_01 ~ p_24），严禁自创编号；
2. 每个分镜的 place 写亚庇真实点位细节（如 加雅街薄荷绿墙面前/丹绒亚路海滩退潮水镜位），并标注该分镜适合的时间窗（上午柔光/顶光/黄金时刻/蓝调时刻/夜间）；
3. 每个分镜具体到机位高度（如 相机1.4m平视/0.5m低机位）、景别构图、表情、连拍提示；
4. 用户独自外出：手机 + 三脚架 + 蓝牙遥控，所有分镜必须一人可独立完成；
5. 热带海岛现实约束写进 checklist：防晒霜/驱蚊液/吸油纸补妆/海风对短发的处理/手机防潮防沙；
6. 输出 JSON：{"shots":[{"no":1,"place":"…","angle":"…","framing":"…","pose":"p_xx 动作名","expression":"…","burstTip":"…"}],"props":["道具清单（三脚架/蓝牙遥控必含）"],"checklist":["出发前检查清单 5-8 条"]}` },
            { role: 'user', content: `主题：${def.theme}\n日期：${date}\n地点：${def.locationName}\n\n姿势库（pose 字段唯一取值来源）：\n${poseCatalog()}` },
          ],
        });
        if (r.shots.every((s) => isPoseId(s.pose))) {
          shots = r.shots.map((s, i) => ({ ...s, no: i + 1 }));
          props = r.props;
          checklist = r.checklist;
          source = 'llm';
        } else {
          console.warn(`⚠ [${def.theme}] 分镜引用了姿势库外编号，降级 shots.md 模板`);
        }
      } catch (e) { console.warn(`⚠ [${def.theme}] LLM 分镜失败，降级：${(e as Error).message}`); }
    }
    if (shots.length === 0) {
      shots = defaultShots(def.sceneType);
      props = ['三脚架', '蓝牙遥控器', '防晒霜', '驱蚊液', '吸油纸'];
      checklist = ['电量 ≥ 80%，清出 2GB 存储空间', '按时间窗提前 10 分钟到场踩点', '补妆：吸油纸 + 玻璃唇补涂'];
    }

    const id = `${date}-${SCENE_EN[def.sceneType]}-${shortHash('kk-' + def.theme)}`;
    const plan: PhotoPlan = {
      id,
      theme: def.theme,
      date,
      location: { name: def.locationName, lat: geo.lat, lon: geo.lon, sceneType: def.sceneType },
      timeWindows: windowsByDate.get(date)!,
      outfitRef: { itemIds: [] },
      makeupId: pickMakeup(def.makeupPref),
      shots,
      props,
      checklist,
      status: 'planned',
      source,
      reference: {
        source: 'image',
        title: '本人参考照（短发 · 甜酷）',
        description: `人像设定：${persona}`,
        brief: brief?.styleBrief,
      },
    };

    ensureDir(`plans/${id}/shots`);
    await updateJson(`plans/${id}/plan.json`, null, () => plan);
    try {
      const covers = saveCovers(id, [jpg]);
      plan.reference = { ...plan.reference, cover: covers[0], covers };
      await updateJson(`plans/${id}/plan.json`, null, (p) => { if (p) p.reference = plan.reference; });
    } catch { /* 封面失败不阻断 */ }
    results.push(plan);
    console.log(`✔ 计划落盘 ${id}（${source === 'llm' ? 'LLM 分镜' : '模板分镜'}，${shots.length} 个分镜，妆造 ${plan.makeupId}）`);
  }

  console.log('\n========== 生成结果 ==========');
  for (const p of results) {
    console.log(`\n【${p.date}】${p.theme}`);
    console.log(`  地点：${p.location.name}`);
    for (const w of p.timeWindows) console.log(`  ${w.type} ${w.start}-${w.end}  ${w.tip}`);
    console.log(`  妆造：${p.makeupId}`);
    for (const s of p.shots) console.log(`   ${s.no}. ${s.place}｜${s.angle}｜${s.framing}｜${s.pose}｜${s.expression}`);
  }
  console.log(`\n数据目录：${absPath('plans')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
