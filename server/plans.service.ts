/**
 * 拍照计划服务 —— 结构由服务端保证，创意由 LLM 提供，降级用 shots.md 模板。
 *
 * createPlan 流程：
 *   地点地理编码（open-meteo geocoding，失败用城市坐标）
 *   → 该日期日出日落 → 时间窗（sun.ts 纯函数）
 *   → LLM 生成分镜（pose 必须引用姿势库编号，服务端逐一校验）
 *   → 校验失败/断网：解析 shots.md 默认分镜模板
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PhotoPlan, Shot } from '../shared/types.ts';
import { config } from './config.ts';
import { absPath, ensureDir, updateJson, readJson } from './store.ts';
import { sunWindows } from './sun.ts';
import { getWeather } from './weather.ts';
import { poseCatalog, shotsCatalog, isPoseId } from './knowledge.ts';
import { getProfile } from './ootd.ts';
import { recommendMakeup } from './rules.ts';
import { chatJSON, llmAvailable } from './llm.ts';
import { PLAN_SHOTS_PROMPT } from './prompts.ts';
import { z } from 'zod';
import { anchorById } from './knowledge.ts';

export type SceneType = PhotoPlan['location']['sceneType'];

const SCENE_EN: Record<SceneType, string> = {
  街拍: 'citywalk', 咖啡店: 'cafe', 公园: 'park', 天台: 'rooftop', 夜景: 'night',
};

// ---------- 列表 ----------

export function listPlans(): PhotoPlan[] {
  const root = absPath('plans');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const f = join(root, d.name, 'plan.json');
      if (!existsSync(f)) return null;
      try {
        return JSON.parse(readFileSync(f, 'utf8')) as PhotoPlan;
      } catch {
        return null;
      }
    })
    .filter((p): p is PhotoPlan => p !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPlan(id: string): PhotoPlan | null {
  const f = absPath(`plans/${id}/plan.json`);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, 'utf8')) as PhotoPlan;
}

export async function updatePlan(id: string, mutator: (p: PhotoPlan) => void | Promise<void>): Promise<PhotoPlan | null> {
  return updateJson<PhotoPlan | null>(`plans/${id}/plan.json`, null, (p) => {
    if (!p) return null;
    void mutator(p);
    return p;
  });
}

// ---------- 地理编码（免费，失败回退城市坐标） ----------

async function geocode(name: string): Promise<{ lat: number; lon: number }> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const j = (await res.json()) as { results?: { latitude: number; longitude: number }[] };
    if (j.results?.[0]) return { lat: j.results[0].latitude, lon: j.results[0].longitude };
  } catch { /* fallback */ }
  return { lat: config.city.lat, lon: config.city.lon };
}

// ---------- shots.md 默认分镜解析 ----------

export function defaultShots(sceneType: SceneType): Shot[] {
  const md = shotsCatalog();
  const sec = md.split(/^## /m).find((s) => s.startsWith(`场景：${sceneType}`));
  if (!sec) return [];
  const shots: Shot[] = [];
  for (const line of sec.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 8 || !/^\d+$/.test(cells[1] ?? '')) continue;
    shots.push({
      no: Number(cells[1]),
      place: cells[2] ?? '',
      angle: cells[3] ?? '',
      framing: cells[4] ?? '',
      pose: cells[5] ?? '',
      expression: cells[6] ?? '',
      burstTip: cells[7] ?? '',
    });
  }
  return shots;
}

// ---------- 创建计划 ----------

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

const SCENE_PROPS: Record<SceneType, string[]> = {
  街拍: ['三脚架（1.2-1.6m）', '蓝牙遥控器', '补光小镜子（检查刘海）'],
  咖啡店: ['三脚架（桌面款即可）', '蓝牙遥控器'],
  公园: ['三脚架', '蓝牙遥控器', '驱蚊液', '野餐垫'],
  天台: ['三脚架（配重防风）', '蓝牙遥控器', '外套（天台风大）'],
  夜景: ['三脚架', '蓝牙遥控器', '手机夜景模式确认', '吸油纸（灯光下补妆）'],
};

export interface CreatePlanOpts {
  theme: string;
  date: string;
  locationName: string;
  sceneType: SceneType;
  outfitItemIds?: string[];
  ootdDate?: string;
}

export async function createPlan(opts: CreatePlanOpts): Promise<PhotoPlan> {
  const { theme, date, locationName, sceneType } = opts;
  const geo = await geocode(locationName);

  // 时间窗：取该日期日出日落（失败给通用窗口）
  let windows: PhotoPlan['timeWindows'];
  try {
    const w = await getWeather(date);
    if (w.sun) windows = w.sun.windows.map((x) => ({ type: x.type, start: x.start, end: x.end, tip: x.tip }));
  } catch { /* fallback below */ }
  windows ??= [
    { type: '上午柔光', start: '07:30', end: '08:10', tip: '日出后 10-50 分钟' },
    { type: '黄金时刻', start: '18:30', end: '19:40', tip: '日落前 55 分钟到日落后 15 分钟' },
    { type: '蓝调时刻', start: '19:40', end: '20:05', tip: '日落 15-40 分钟' },
  ];

  // 妆造：拍照场景 → 高持妆优先
  const profile = getProfile();
  const makeupPick = recommendMakeup({ profile, occasion: '拍照', anchors: profile.anchors })[0];
  const makeupId = makeupPick?.template.id ?? 'mk_stage_photo';

  // 分镜：LLM 生成 + 校验，失败用 shots.md 模板
  let shots: Shot[] = [];
  let props: string[] = [];
  let checklist: string[] = [];
  let source: 'llm' | 'rule' = 'rule';
  const anchorCard = anchorById(profile.anchors[0] ?? 'newjeans');

  if (llmAvailable()) {
    try {
      const r = await chatJSON({
        schema: shotsSchema,
        maxTokens: 3072,
        messages: [
          { role: 'system', content: PLAN_SHOTS_PROMPT(sceneType, theme, anchorCard?.name ?? 'NewJeans 清冷学院') },
          { role: 'user', content: `主题：${theme}\n日期：${date}\n地点：${locationName}\n\n姿势库（pose 字段唯一取值来源）：\n${poseCatalog()}` },
        ],
      });
      // 结构校验：pose 必须引用姿势库编号
      if (r.shots.every((s) => isPoseId(s.pose))) {
        shots = r.shots.map((s, i) => ({ ...s, no: i + 1 }));
        props = r.props.length ? r.props : SCENE_PROPS[sceneType];
        checklist = r.checklist;
        source = 'llm';
      }
    } catch { /* 降级 */ }
  }
  if (shots.length === 0) {
    shots = defaultShots(sceneType);
    props = SCENE_PROPS[sceneType];
    checklist = [
      '电量 ≥ 80%，清出 2GB 存储空间',
      '三脚架、蓝牙遥控器装包',
      '出门前 10 分钟完成妆造定妆',
      '按 checklist 核对服装（提前熨烫）',
      '黄金时刻前 10 分钟到场踩点',
    ];
  }

  const id = `${date}-${SCENE_EN[sceneType]}-${Math.random().toString(36).slice(2, 6)}`;
  const plan: PhotoPlan = {
    id,
    theme,
    date,
    location: { name: locationName, lat: geo.lat, lon: geo.lon, sceneType },
    timeWindows: windows,
    outfitRef: opts.ootdDate ? { ootdDate: opts.ootdDate } : { itemIds: opts.outfitItemIds ?? [] },
    makeupId,
    shots,
    props,
    checklist,
    status: 'planned',
    source,
  };
  ensureDir(`plans/${id}/shots`);
  await updateJson(`plans/${id}/plan.json`, null, () => plan);
  return plan;
}
