/**
 * 业务工具注册表 —— Flue Agent 的「手和脚」。
 *
 * 每个工具保留 Zod 参数校验和真实业务 handler。Flue adapter 将模型参数
 * 交给这里做第二层校验，确保模型不能绕过规则引擎编造衣橱数据。
 * 关键原则：所有涉及「真实数据」的操作（衣橱/档案/穿搭）都只能通过工具完成，
 * 模型拿到的永远是工具返回的事实，从机制上杜绝编造单品 ID。
 *
 * 类型技巧：handler 参数用 z.output<typeof xxxSchema> 注解 —— 定义点享受
 * 完整类型推导；注册表接口用 (args: never) 保持逆变安全。
 */
import type { ChatEvent, Occasion, PhotoPlan } from '../shared/types.ts';
import { z } from 'zod';
import { getProfile, wardrobeItems, composeOotd, logFeedback, readOotd } from './ootd.ts';
import { recommendMakeup, effectiveAnchors } from './rules.ts';
import { getWeather, today } from './weather.ts';
import { anchorById } from './knowledge.ts';
import { createPlan } from './plans.service.ts';
import { readJson } from './store.ts';

export interface ToolCtx {
  /** SSE 推送（工具执行中向前端发事件，如穿搭卡/计划卡） */
  emit: (e: ChatEvent) => void;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodType;
  handler: (args: never, ctx: ToolCtx) => Promise<unknown>;
}

// ---------- 参数 schema ----------

const queryWardrobeSchema = z.object({
  categories: z.array(z.enum(['outerwear', 'top', 'bottom', 'dress', 'shoes', 'bag', 'accessory', 'headwear'])).optional(),
  seasons: z.array(z.enum(['春', '夏', '秋', '冬'])).optional(),
  colorFamily: z.string().optional().describe('颜色族关键词，如 白/蓝/粉'),
  tags: z.array(z.string()).optional().describe('风格标签'),
  itemId: z.string().optional(),
});

const getWeatherSchema = z.object({ date: z.string().optional() });

const generateOutfitSchema = z.object({
  date: z.string().describe('YYYY-MM-DD'),
  occasion: z.enum(['通勤', '日常', '约会', '拍照', '正式']),
  anchor: z.string().optional().describe('锚点 id，缺省用用户主锚点'),
});

const logFeedbackSchema = z.object({
  date: z.string(),
  verdict: z.enum(['liked', 'meh', 'unchosen']),
});

const recommendMakeupSchema = z.object({
  occasion: z.enum(['通勤', '日常', '约会', '拍照', '正式']),
  anchor: z.string().optional(),
  timeBudget: z.number().optional(),
});

const createPlanSchema = z.object({
  theme: z.string().describe('拍摄主题，如 周六下午安福路街拍'),
  date: z.string().describe('YYYY-MM-DD'),
  location: z.string().describe('地点名称'),
  sceneType: z.enum(['街拍', '咖啡店', '公园', '天台', '夜景']),
  outfitRef: z.array(z.string()).optional().describe('wardrobe item ids'),
});

const reviewSessionSchema = z.object({ planId: z.string() });

// ---------- 工具实现 ----------

export const TOOLS: ToolDef[] = [
  {
    name: 'get_profile',
    description: '读取用户形象档案：身高/体型/肤色/脸型眼型/风格锚点/诉求',
    schema: z.object({}),
    async handler() {
      return getProfile();
    },
  },
  {
    name: 'query_wardrobe',
    description: '查询用户真实衣橱单品（唯一可信的单品数据源，回答穿搭问题前必须先查）',
    schema: queryWardrobeSchema,
    async handler(q: z.output<typeof queryWardrobeSchema>) {
      let items = wardrobeItems();
      if (q.itemId) return items.find((i) => i.id === q.itemId) ?? { error: 'item 不存在' };
      if (q.categories?.length) items = items.filter((i) => q.categories!.includes(i.category));
      if (q.seasons?.length) items = items.filter((i) => i.seasons.some((ss) => q.seasons!.includes(ss)));
      if (q.colorFamily) items = items.filter((i) => i.colorName.includes(q.colorFamily!));
      if (q.tags?.length) items = items.filter((i) => q.tags!.some((t) => i.styleTags.includes(t)));
      return {
        total: items.length,
        items: items.map((i) => ({
          id: i.id, subType: i.subType, colorName: i.colorName, category: i.category,
          formality: i.formality, styleTags: i.styleTags, photoRating: i.photoRating,
        })),
      };
    },
  },
  {
    name: 'get_weather',
    description: '获取指定日期天气（温度区间/降水概率/日出日落/黄金时刻窗口）',
    schema: getWeatherSchema,
    async handler(q: z.output<typeof getWeatherSchema>) {
      const date = q.date ?? today();
      try {
        return await getWeather(date);
      } catch (e) {
        return { error: `天气服务不可用：${(e as Error).message}`, fallback: '可建议用户在界面手动输入温度' };
      }
    },
  },
  {
    name: 'generate_outfit',
    description: '生成每日 OOTD：规则引擎筛真实候选 + 选一套 + 女团感叙事 + 妆造 + 拍照建议。结构服务端已校验',
    schema: generateOutfitSchema,
    async handler(args: z.output<typeof generateOutfitSchema>, _ctx) {
      const ootd = await composeOotd({
        date: args.date,
        occasion: args.occasion as Occasion,
        regenerate: !!readOotd(args.date),
      });
      return ootd;
    },
  },
  {
    name: 'log_outfit_feedback',
    description: '记录用户对某日穿搭的反馈（liked=就穿这套 / meh=一般 / unchosen=没穿），并更新穿着记录',
    schema: logFeedbackSchema,
    async handler(a: z.output<typeof logFeedbackSchema>) {
      await logFeedback(a.date, a.verdict);
      return { ok: true, date: a.date, verdict: a.verdict };
    },
  },
  {
    name: 'recommend_makeup',
    description: '按档案脸型眼型肤色 + 场合筛选妆造模板，返回主推 + 备选（含分步步骤与时长）',
    schema: recommendMakeupSchema,
    async handler(a: z.output<typeof recommendMakeupSchema>) {
      return recommendMakeup({
        profile: getProfile(),
        occasion: a.occasion as Occasion,
        anchor: a.anchor,
        timeBudget: a.timeBudget,
      });
    },
  },
  {
    name: 'create_photo_plan',
    description: '生成可独立执行的拍照计划：时间窗（黄金时刻）+ 分镜（引用姿势库编号）+ 道具清单 + checklist',
    schema: createPlanSchema,
    async handler(a: z.output<typeof createPlanSchema>, _ctx) {
      const plan = await createPlan({
        theme: a.theme,
        date: a.date,
        locationName: a.location,
        sceneType: a.sceneType,
        outfitItemIds: a.outfitRef,
      });
      return plan;
    },
  },
  {
    name: 'review_photo_session',
    description: '对已上传样片的拍照计划触发视觉复盘（逐张 verdict + 精选 + 出片配色反哺衣橱出片率）',
    schema: reviewSessionSchema,
    async handler(a: z.output<typeof reviewSessionSchema>) {
      const plans = readJson<PhotoPlan[]>('plans/__placeholder.json', []);
      void plans;
      const { reviewSession } = await import('./review.service.ts');
      return await reviewSession(a.planId);
    },
  },
  {
    name: 'wardrobe_gap_check',
    description: '对比风格锚点需求与衣橱现状，输出购衣缺口建议（哪些版型/色盘还缺）',
    schema: z.object({}),
    async handler() {
      const profile = getProfile();
      const items = wardrobeItems();
      const gaps: { anchor: string; missing: string[]; paletteHit: string }[] = [];
      for (const anchorId of effectiveAnchors(profile)) {
        const card = anchorById(anchorId);
        if (!card) continue;
        const missing: string[] = [];
        for (const sil of card.silhouettes) {
          if (!items.some((i) => i.subType.includes(sil) || sil.includes(i.subType))) missing.push(sil);
        }
        const paletteHit = card.palette.filter((hex) => items.some((i) => rgbClose(hex, i.colorHex))).length;
        gaps.push({ anchor: card.name, missing: missing.slice(0, 5), paletteHit: `${paletteHit}/${card.palette.length}` });
      }
      return gaps;
    },
  },
];

function rgbClose(a: string, b: string): boolean {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const dr = ((pa >> 16) & 255) - ((pb >> 16) & 255);
  const dg = ((pa >> 8) & 255) - ((pb >> 8) & 255);
  const db = (pa & 255) - (pb & 255);
  return Math.sqrt(dr * dr + dg * dg + db * db) < 60;
}

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
