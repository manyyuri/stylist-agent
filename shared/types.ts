/**
 * 共享数据模型 —— 前后端唯一事实来源（spec §4）
 * server 与 web 均从 `shared/types.ts` import，保证 schema 对齐。
 */

// ===== profile.json =====
export interface Profile {
  basics: {
    height: number; // cm
    weight?: number;
    bodyType: '梨形' | '苹果形' | '沙漏形' | '直筒形' | '倒三角';
    skinTone: '冷白' | '冷调自然' | '暖白' | '暖调自然' | '小麦色';
    colorSeason?: '春' | '夏' | '秋' | '冬';
    faceShape?: '鹅蛋' | '圆脸' | '方脸' | '长脸' | '心形';
    eyeShape?: '杏眼' | '丹凤眼' | '圆眼' | '下垂眼' | '肿眼泡' | '内双' | '外双';
    concerns: string[];
  };
  anchors: string[]; // 风格锚点 id，主锚点在前
  favoriteMembers?: string[]; // 本命爱豆，仅影响叙事口吻
}

// ===== wardrobe/items.json 元素 =====
export type Category = 'outerwear' | 'top' | 'bottom' | 'dress' | 'shoes' | 'bag' | 'accessory' | 'headwear';

export interface WardrobeItem {
  id: string; // w_0001 自增
  category: Category;
  subType: string; // 针织开衫 / 百褶裙 / 乐福鞋……
  colorName: string; // 奶油白
  colorHex: string; // #F5F0E6
  pattern: '纯色' | '条纹' | '碎花' | '格纹' | '印花' | '拼色';
  material: string; // 针织 / 牛仔 / 缎面……
  seasons: ('春' | '夏' | '秋' | '冬')[];
  tempRange: [number, number]; // 适合气温区间（℃）
  formality: 1 | 2 | 3 | 4 | 5; // 1=运动居家 5=礼服
  styleTags: string[]; // 如 ['学院','清冷','newjeans']
  baseColor: boolean; // 黑白灰驼牛仔蓝米等百搭基础色
  photo: string; // 相对工作区路径（如 wardrobe/photos/2025-06-05/w_0001.jpg）
  wearCount: number;
  lastWorn?: string; // YYYY-MM-DD
  photoRating?: number; // 1-5 出片率（复盘反哺）
  createdAt: string;
}

// ===== 妆造模板（knowledge/makeup/*.json）=====
export interface MakeupStep {
  no: number;
  title: string;
  detail: string;
  products: string[];
}

export interface MakeupTemplate {
  id: string; // mk_commute_10min
  name: string;
  anchors: string[];
  faceFit: { faceShape: string[]; eyeShape: string[] }; // 空 = 不限
  skinToneFit: string[]; // 空 = 不限
  occasions: string[];
  timeBudget: number; // 分钟
  difficulty: 1 | 2 | 3;
  steps: MakeupStep[];
  note?: string;
}

// ===== 风格锚点卡（knowledge/anchors/*.json）=====
export interface AnchorCard {
  id: string;
  name: string;
  icons: string[];
  vibe: string;
  palette: string[]; // hex
  silhouettes: string[];
  styleTags: string[];
  makeupTraits: string;
  avoid: string[];
  occasions: string[];
}

// ===== ootd/2025/06-05.json =====
export type Occasion = '通勤' | '日常' | '约会' | '拍照' | '正式';
export type Feedback = 'liked' | 'meh' | 'unchosen';

export interface OotdWeather {
  temp: number;
  tempRange: [number, number];
  condition: string;
  rainProb: number;
}

export interface Ootd {
  date: string;
  weather: OotdWeather;
  occasion: Occasion;
  anchorUsed: string;
  items: string[]; // wardrobe item id（服务端已校验真实存在）
  outfitScore: number;
  narrative: string; // LLM 叙事；降级时为模板文案
  makeup: { templateId: string; stepsSnapshot: MakeupStep[] };
  photoHint: string;
  alternatives: { items: string[]; why: string }[];
  feedback?: Feedback | null;
  source: 'rule' | 'llm';
  /** 当日已生成过的组合（regenerate 时排除用） */
  history?: { items: string[]; anchorUsed: string }[];
}

// ===== 候选组合（规则引擎输出，不入库）=====
export interface OotdCandidate {
  items: string[];
  totalScore: number;
  subscores: { color: number; anchor: number; wear: number; photo: number };
}

// ===== 月度复盘（小PD 导演复盘 + 锚点漂移建议）=====
export interface AnchorTrend {
  anchor: string;
  name: string;
  count: number;
  avgScore: number;
  liked: number;
}

export interface AnchorDrift {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  reason: string;
}

export interface MonthlyReport {
  month: string;
  days: number;
  feedback: { liked: number; meh: number; unchosen: number };
  avgScore: number;
  source: 'llm' | 'rule';
  narrative: string;
  topItems: { id: string; subType: string; colorName: string; photoRating: number; wearCount: number }[];
  anchorTrends: AnchorTrend[];
  drift: AnchorDrift | null;
}

// ===== plans/*/plan.json =====
export interface Shot {
  no: number;
  place: string;
  angle: string; // 机位
  framing: string; // 景别/构图
  pose: string; // 引用姿势库编号，如 p_07
  expression: string;
  burstTip: string;
  reference?: string;
}

export interface PhotoReviewPer {
  file: string;
  verdict: 'keep' | 'ok' | 'drop';
  composition: string;
  light: string;
  expression: string;
  why: string;
}

export interface PhotoReview {
  analyzedAt: string;
  perPhoto: PhotoReviewPer[];
  best: string[];
  colorWin: string[]; // 本次验证出片的配色（含 hex，如 "奶油白 #F5F0E6"）
  advice: string;
}

export interface PhotoPlan {
  id: string; // 2025-06-08-citywalk
  theme: string;
  date: string;
  location: { name: string; lat: number; lon: number; sceneType: '街拍' | '咖啡店' | '公园' | '天台' | '夜景' };
  timeWindows: { type: WindowType; start: string; end: string; tip: string }[];
  outfitRef: { itemIds: string[] } | { ootdDate: string };
  makeupId: string;
  shots: Shot[];
  props: string[];
  checklist: string[];
  status: 'planned' | 'shot' | 'reviewed';
  review?: PhotoReview;
  source?: 'llm' | 'rule';
}

// ===== 天气（open-meteo 代理结果）=====
export interface WeatherInfo {
  date: string;
  temp: number;
  tempRange: [number, number];
  condition: string;
  rainProb: number;
  hourly?: { time: string; temp: number; rainProb: number }[];
  sun?: { sunrise: string; sunset: string; windows: SunWindow[] };
  source: 'open-meteo' | 'manual';
}

export type WindowType = '黄金时刻' | '蓝调时刻' | '上午柔光' | '顶光提示' | '室内不限';

export interface SunWindow {
  type: WindowType;
  start: string;
  end: string;
  tip: string;
}

// ===== SSE 事件（/api/chat）=====
export type ChatEvent =
  | { type: 'message'; delta: string }
  | { type: 'tool-call'; id: string; name: string; args: unknown }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; summary: string; payload?: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string };
