/**
 * 规则引擎 —— 结构合法性全由确定性代码保证，LLM 只在候选集内做选择与叙事。
 *
 * 核心哲学（cook5）：概率模型负责创意，确定性规则负责正确性。
 * 本文件零网络依赖，断网时 OOTD 功能照常。
 */
import type { Occasion, OotdCandidate, Profile, WardrobeItem, MakeupTemplate } from '../shared/types.ts';
import { anchorById, makeups } from './knowledge.ts';
import { hexToHsl, hueDistance, isColdSkinTrap, isWarmSkinTrap, rgbDistance } from './color.ts';

// ---------------------------------------------------------------------------
// §5.1 温度 → 单品类型映射
// ---------------------------------------------------------------------------

export interface TempSpec {
  bucket: 'hot' | 'warm' | 'mild' | 'cool' | 'cold' | 'verycold' | 'freezing';
  label: string;
  /** 该温度桶下单品 subType 关键词白名单（空 = 不限，仅靠 tempRange） */
  topKeywords: string[];
  bottomKeywords: string[];
  dressKeywords: string[];
  outerwearKeywords: string[];
  outerwearRequired: boolean;
  notes: string[];
}

const SPECS: TempSpec[] = [
  {
    bucket: 'hot', label: '≥28 炎热',
    topKeywords: ['吊带', '短袖', '背心', 'T恤', 'T恤', 'polo', '无袖', '抹胸', '削肩'],
    bottomKeywords: ['短裤', '短裙', '半身裙', '裙', '阔腿'],
    dressKeywords: ['裙', '吊带', '短袖'],
    outerwearKeywords: ['防晒', '薄开衫'], outerwearRequired: false,
    notes: ['浅色透气优先', '雨天排除浅色布鞋'],
  },
  {
    bucket: 'warm', label: '24-28 夏末',
    topKeywords: ['短袖', 'T恤', '吊带', '薄衬衫', 'polo'],
    bottomKeywords: ['短裤', '短裙', '半身裙', '裙', '薄裤', '阔腿', '牛仔裤'],
    dressKeywords: ['裙'],
    outerwearKeywords: ['薄外套', '开衫', '马甲'], outerwearRequired: false,
    notes: [],
  },
  {
    bucket: 'mild', label: '20-24 舒适',
    topKeywords: ['长袖', '针织', '薄毛衣', '卫衣', '衬衫'],
    bottomKeywords: ['长裤', '牛仔裤', '西裤', '阔腿', '裙', '半身裙'],
    dressKeywords: ['裙', '长袖'],
    outerwearKeywords: ['薄外套', '开衫', '马甲', '衬衫外套'], outerwearRequired: false,
    notes: ['可选薄外套'],
  },
  {
    bucket: 'cool', label: '15-20 微凉',
    topKeywords: ['针织', '卫衣', '毛衣', '长袖', '衬衫'],
    bottomKeywords: ['长裤', '牛仔裤', '西裤', '阔腿', '裙'],
    dressKeywords: ['裙', '针织'],
    outerwearKeywords: ['开衫', '夹克', '薄外套'], outerwearRequired: false,
    notes: ['推荐开衫'],
  },
  {
    bucket: 'cold', label: '10-15 凉爽',
    topKeywords: ['针织', '卫衣', '毛衣', '长袖'],
    bottomKeywords: ['长裤', '牛仔裤', '西裤', '厚裙'],
    dressKeywords: ['针织', '长袖'],
    outerwearKeywords: ['夹克', '风衣', '外套', '西装'], outerwearRequired: true,
    notes: ['必含外套'],
  },
  {
    bucket: 'verycold', label: '5-10 冷',
    topKeywords: ['毛衣', '针织', '加绒', '卫衣'],
    bottomKeywords: ['长裤', '牛仔裤', '加绒'],
    dressKeywords: ['针织', '厚'],
    outerwearKeywords: ['大衣', '厚外套', '羽绒服', '皮草'], outerwearRequired: true,
    notes: ['大衣/厚外套'],
  },
  {
    bucket: 'freezing', label: '<5 严寒',
    topKeywords: ['毛衣', '加绒', '高领'],
    bottomKeywords: ['加绒', '厚裤', '长裤'],
    dressKeywords: ['厚', '针织'],
    outerwearKeywords: ['羽绒', '厚大衣', '派克'], outerwearRequired: true,
    notes: ['羽绒/厚大衣 + 围巾'],
  },
];

export function tempToSpec(temp: number, rainProb = 0): TempSpec {
  const spec = temp >= 28 ? SPECS[0]! : temp >= 24 ? SPECS[1]! : temp >= 20 ? SPECS[2]!
    : temp >= 15 ? SPECS[3]! : temp >= 10 ? SPECS[4]! : temp >= 5 ? SPECS[5]! : SPECS[6]!;
  if (rainProb >= 50) return { ...spec, notes: [...spec.notes, '雨概率≥50%：鞋只留防水材质，必备外套'] };
  return spec;
}

function kwMatch(subType: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const s = subType.toLowerCase();
  return keywords.some((k) => s.includes(k.toLowerCase()));
}

// ---------------------------------------------------------------------------
// §5.2 场合 → 正式度过滤
// ---------------------------------------------------------------------------

export const FORMALITY_RANGE: Record<Occasion, [number, number]> = {
  通勤: [2, 4],
  日常: [1, 4],
  约会: [1, 4],
  拍照: [1, 4],
  正式: [3, 5],
};

function formalityOk(item: WardrobeItem, occasion: Occasion): boolean {
  const [lo, hi] = FORMALITY_RANGE[occasion];
  return item.formality >= lo && item.formality <= hi;
}

// ---------------------------------------------------------------------------
// 季节
// ---------------------------------------------------------------------------

export function seasonOf(date: string): '春' | '夏' | '秋' | '冬' {
  const m = Number(date.slice(5, 7));
  if (m >= 3 && m <= 5) return '春';
  if (m >= 6 && m <= 8) return '夏';
  if (m >= 9 && m <= 11) return '秋';
  return '冬';
}

// ---------------------------------------------------------------------------
// §5.3 色彩协调打分 colorHarmony(items) → 0~100
// ---------------------------------------------------------------------------

export interface ColorScore { score: number; notes: string[] }

export function colorHarmony(items: WardrobeItem[], profile?: Profile): ColorScore {
  const notes: string[] = [];
  let score = 100;
  const colored = items.filter((i) => !i.baseColor && i.pattern === '纯色');

  // 规则 1：非基础色色相数 ≤ 3
  const hues = new Set<number>();
  for (const i of colored) {
    const { h, s } = hexToHsl(i.colorHex);
    if (s > 0.15) hues.add(Math.round(h / 30)); // 12 分桶
  }
  if (hues.size > 3) {
    score -= (hues.size - 3) * 15;
    notes.push(`色相数 ${hues.size} 超过 3`);
  }

  // 规则 2：至少一件基础色打底
  if (items.length > 0 && !items.some((i) => i.baseColor)) {
    score -= 20;
    notes.push('缺基础色打底');
  }

  // 规则 3：非基础色之间同色系（Δhue<40°）或互补（160°-200°）
  for (let a = 0; a < colored.length; a++) {
    for (let b = a + 1; b < colored.length; b++) {
      const ha = hexToHsl(colored[a]!.colorHex);
      const hb = hexToHsl(colored[b]!.colorHex);
      if (ha.s <= 0.15 || hb.s <= 0.15) continue;
      const dh = hueDistance(ha.h, hb.h);
      if (dh >= 40 && dh < 160 || dh > 200) {
        score -= 30;
        notes.push(`${colored[a]!.colorName}×${colored[b]!.colorName} 色相冲突`);
      }
    }
  }

  // 规则 4：花色全场至多 1 件
  const patterns = items.filter((i) => i.pattern !== '纯色');
  if (patterns.length > 1) {
    score -= (patterns.length - 1) * 15;
    notes.push(`花色单品 ${patterns.length} 件`);
  }

  // 规则 5：季型/冷暖皮适配（colorSeason 诊断后启用）
  const tone = profile?.basics.skinTone;
  if (tone === '冷白' || tone === '冷调自然') {
    const traps = items.filter((i) => !i.baseColor && isColdSkinTrap(i.colorHex));
    if (traps.length) {
      score -= 25;
      notes.push(`冷皮遇姜黄/橘色系（${traps.map((t) => t.colorName).join('、')}）`);
    }
  } else if (tone === '暖白' || tone === '暖调自然' || tone === '小麦色') {
    const traps = items.filter((i) => !i.baseColor && isWarmSkinTrap(i.colorHex));
    if (traps.length) {
      score -= 25;
      notes.push(`暖皮遇荧光/冷紫（${traps.map((t) => t.colorName).join('、')}）`);
    }
  }

  return { score: clamp(score, 0, 100), notes };
}

// ---------------------------------------------------------------------------
// §5.4 锚点匹配打分 anchorMatch(items, anchorId) → 0~100
// ---------------------------------------------------------------------------

export function anchorMatch(items: WardrobeItem[], anchorId: string): number {
  const anchor = anchorById(anchorId);
  if (!anchor) return 0;
  let raw = 0;
  for (const item of items) {
    if (item.styleTags.some((t) => anchor.styleTags.includes(t))) raw += 15;
    if (anchor.palette.some((p) => rgbDistance(p, item.colorHex) < 60)) raw += 10;
    if (anchor.silhouettes.some((s) => item.subType.includes(s) || s.includes(item.subType))) raw += 20;
  }
  const perItemMax = 45;
  return clamp(Math.round((raw / (items.length * perItemMax)) * 100), 0, 100);
}

/**
 * 锚点唯一真相：整个系统只认「排序前二」的锚点（主 75% + 次 25%）。
 * 档案页的排序 = 优先级，第二锚点必须有回响——否则多选就是假承诺。
 * 所有消费方（候选生成 / 妆造 / 拍照企划 / 缺口检查）统一从这里取锚点。
 */
export function effectiveAnchors(profile: Profile): string[] {
  return profile.anchors.slice(0, 2);
}

export function anchorScore(items: WardrobeItem[], anchors: string[]): number {
  const primary = anchors[0] ?? 'newjeans';
  let s = anchorMatch(items, primary);
  const secondary = anchors[1];
  if (secondary && secondary !== primary) {
    s = s * 0.75 + anchorMatch(items, secondary) * 0.25;
  }
  return Math.round(s);
}

// ---------------------------------------------------------------------------
// §5.5 穿着冷却 / §5 photoRating
// ---------------------------------------------------------------------------

export function wearPenalty(items: WardrobeItem[], today: string): number {
  let p = 0;
  const t = new Date(today).getTime();
  for (const i of items) {
    if (i.lastWorn) {
      const days = (t - new Date(i.lastWorn).getTime()) / 86400000;
      if (days < 3) p -= 10;
    }
    if (i.wearCount === 0) {
      const age = (t - new Date(i.createdAt).getTime()) / 86400000;
      if (age > 14) p += 5; // 买来没穿过，鼓励消耗
    }
  }
  return p;
}

export function photoBonus(items: WardrobeItem[]): number {
  return items.reduce((s, i) => s + (i.photoRating ?? 0) * 5, 0);
}

// ---------------------------------------------------------------------------
// 单品级过滤（温度/季节/场合/雨天）
// ---------------------------------------------------------------------------

export interface FilterCtx {
  date: string;
  temp: number;
  rainProb: number;
  occasion: Occasion;
}

function itemPasses(item: WardrobeItem, ctx: FilterCtx): boolean {
  const spec = tempToSpec(ctx.temp, ctx.rainProb);
  const season = seasonOf(ctx.date);
  if (!item.seasons.includes(season)) return false;
  if (!formalityOk(item, ctx.occasion)) return false;
  if (item.tempRange[0] > ctx.temp || item.tempRange[1] < ctx.temp) return false;
  switch (item.category) {
    case 'top': return kwMatch(item.subType, spec.topKeywords);
    case 'bottom': return kwMatch(item.subType, spec.bottomKeywords);
    case 'dress': return kwMatch(item.subType, spec.dressKeywords);
    case 'outerwear':
      if (ctx.rainProb >= 50) return true; // 雨天外套全放行（必备另查）
      return kwMatch(item.subType, spec.outerwearKeywords) || item.tempRange[1] >= ctx.temp;
    case 'shoes':
      if (ctx.rainProb >= 50) return /皮|胶|防水|塑胶|橡/i.test(item.material);
      if (ctx.temp >= 28) return !/雪地|加绒/.test(item.subType); // 热天不推雪地靴
      return true;
    default: return true;
  }
}

// ---------------------------------------------------------------------------
// §5.6 候选生成
// ---------------------------------------------------------------------------

const MAX_COMBOS = 300;

export interface CandidateCtx {
  date: string;
  occasion: Occasion;
  weather: { temp: number; tempRange: [number, number]; rainProb: number };
  items: WardrobeItem[];
  profile: Profile;
  /** regenerate 时排除已生成过的组合 */
  exclude?: string[][];
}

export function generateCandidates(ctx: CandidateCtx): OotdCandidate[] {
  const { date, occasion, weather, profile } = ctx;
  // open-meteo 失败时前端手动输入区间 —— 取中点代表当日温度
  const temp = weather.temp ?? ((weather.tempRange[0] + weather.tempRange[1]) / 2);
  const fctx: FilterCtx = { date, temp, rainProb: weather.rainProb, occasion };
  const spec = tempToSpec(temp, weather.rainProb);

  const pool = ctx.items.filter((i) => itemPasses(i, fctx));
  const by = (c: WardrobeItem['category']) => pool.filter((i) => i.category === c);

  const cores: WardrobeItem[][] = [];
  for (const dress of by('dress')) cores.push([dress]);
  for (const top of by('top')) for (const bottom of by('bottom')) cores.push([top, bottom]);
  if (cores.length === 0) return [];

  // 可选件：outerwear(≤1) + shoes(≤1) + accessory/bag/headwear 合计 ≤2
  const optionals: WardrobeItem[][] = [[]];
  const outs = by('outerwear'), shoes = by('shoes'), accs = [...by('accessory'), ...by('bag'), ...by('headwear')];
  const addOne = (arr: WardrobeItem[], slot: number) => optionals.push([arr[slot]!]);
  for (let i = 0; i < outs.length; i++) addOne(outs, i);
  for (let i = 0; i < shoes.length; i++) addOne(shoes, i);
  for (let a = 0; a < accs.length; a++) {
    optionals.push([accs[a]!]);
    for (let b = a + 1; b < accs.length; b++) optionals.push([accs[a]!, accs[b]!]); // 两件配饰
  }
  for (const o of outs) for (const s of shoes) optionals.push([o, s]); // 外套+鞋

  let combos: WardrobeItem[][];
  if (spec.outerwearRequired || weather.rainProb >= 50) {
    combos = [];
    for (const core of cores) {
      for (const opt of optionals) {
        const hasOuter = [...core, ...opt].some((i) => i.category === 'outerwear');
        if (!hasOuter) continue;
        combos.push([...core, ...opt]);
      }
    }
  } else {
    combos = cores.flatMap((core) => optionals.map((opt) => [...core, ...opt]));
  }

  // 排除已生成
  const excl = new Set((ctx.exclude ?? []).map((ids) => [...ids].sort().join('|')));
  combos = combos.filter((c) => !excl.has(c.map((i) => i.id).sort().join('|')));

  // 防爆炸：超限随机采样
  if (combos.length > MAX_COMBOS) {
    const sampled: typeof combos = [];
    const used = new Set<number>();
    while (sampled.length < MAX_COMBOS) {
      const idx = Math.floor(Math.random() * combos.length);
      if (used.has(idx)) continue;
      used.add(idx);
      sampled.push(combos[idx]!);
    }
    combos = sampled;
  }

  const anchors = effectiveAnchors(profile);
  const scored: OotdCandidate[] = combos.map((combo) => {
    const color = colorHarmony(combo, profile).score;
    const anchor = anchorScore(combo, anchors);
    const wear = wearPenalty(combo, date);
    const photo = photoBonus(combo);
    return {
      items: combo.map((i) => i.id),
      totalScore: Math.round(color * 0.35 + anchor * 0.45 + wear + photo),
      subscores: { color, anchor, wear, photo },
    };
  });

  scored.sort((a, b) => b.totalScore - a.totalScore);
  return scored.slice(0, 5);
}

// ---------------------------------------------------------------------------
// §5.7 结构校验 —— LLM 产出的最后防线
// ---------------------------------------------------------------------------

export interface ValidateResult { ok: boolean; reason?: string }

export function validateOutfit(itemIds: string[], ctx: CandidateCtx): ValidateResult {
  const items = ctx.items.filter((i) => itemIds.includes(i.id));
  if (items.length !== itemIds.length) {
    const missing = itemIds.filter((id) => !ctx.items.some((i) => i.id === id));
    return { ok: false, reason: `单品不存在：${missing.join(', ')}` };
  }
  const hasTop = items.some((i) => i.category === 'top');
  const hasBottom = items.some((i) => i.category === 'bottom');
  const hasDress = items.some((i) => i.category === 'dress');
  if (!((hasTop && hasBottom) || hasDress)) return { ok: false, reason: '结构不完整（需 top+bottom 或 dress）' };

  const temp = ctx.weather.temp ?? ((ctx.weather.tempRange[0] + ctx.weather.tempRange[1]) / 2);
  const fctx: FilterCtx = { date: ctx.date, temp, rainProb: ctx.weather.rainProb, occasion: ctx.occasion };
  for (const i of items) {
    if (!itemPasses(i, fctx)) return { ok: false, reason: `${i.subType} 不满足温度/场合/季节约束` };
  }
  // 正式度方差 ≤ 2
  const fs = items.map((i) => i.formality);
  if (Math.max(...fs) - Math.min(...fs) > 2) return { ok: false, reason: '正式度方差过大' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 妆造模板筛选（P1）
// ---------------------------------------------------------------------------

export interface MakeupPick { template: MakeupTemplate; score: number; why: string }

export function recommendMakeup(opts: {
  profile: Profile;
  occasion: Occasion;
  anchor?: string;
  anchors?: string[];
  timeBudget?: number;
}): MakeupPick[] {
  const { profile, occasion } = opts;
  const anchors = opts.anchors ?? (opts.anchor ? [opts.anchor] : effectiveAnchors(profile));
  const budget = opts.timeBudget ?? (occasion === '通勤' ? 10 : occasion === '拍照' ? 45 : 20);
  const picks: MakeupPick[] = [];
  for (const t of makeups()) {
    if (t.occasions.length > 0 && !t.occasions.includes(occasion)) continue;
    // 脸型/肤色硬性适配（模板限定则必须命中，不限则放行）
    if (t.faceFit.faceShape.length > 0 && profile.basics.faceShape && !t.faceFit.faceShape.includes(profile.basics.faceShape)) continue;
    if (t.skinToneFit.length > 0 && !t.skinToneFit.includes(profile.basics.skinTone)) continue;

    let score = 0;
    const why: string[] = [];
    // 主锚点 +30，次锚点 +15 —— 与 anchorScore 同一套优先级，二锚点有回响
    for (let i = 0; i < anchors.length; i++) {
      if (t.anchors.includes(anchors[i]!)) {
        score += i === 0 ? 30 : 15;
        why.push(`匹配锚点 ${anchors[i]}`);
      }
    }
    // 眼型：限定未命中软降权（如肿眼泡遇到重珠光系）
    if (t.faceFit.eyeShape.length > 0 && profile.basics.eyeShape && !t.faceFit.eyeShape.includes(profile.basics.eyeShape)) score -= 15;
    else if (t.faceFit.eyeShape.length === 0) score += 5;
    if (t.timeBudget <= budget) { score += 20; why.push(`${t.timeBudget} 分钟可完成`); }
    else score -= (t.timeBudget - budget) * 2;
    picks.push({ template: t, score, why: why.join('；') });
  }
  picks.sort((a, b) => b.score - a.score);
  return picks.slice(0, 2);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
