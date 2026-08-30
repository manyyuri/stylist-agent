/**
 * OOTD 编排服务 —— 「规则引擎圈候选 + LLM 选品叙事」的混合架构落地。
 *
 * 数据流（spec §2.2）：
 *   规则引擎 Top5 候选（纯数学） → GLM-5.3-Flash 从真实候选中选 1 + 女团感叙事
 *   → validateOutfit 结构校验（LLM 幻觉的最后防线）→ 落盘 ootd/YYYY/MM-DD.json
 * LLM 失败 → 规则 Top1 + 模板文案，source:'rule'，功能不中断。
 */
import type { MakeupStep, Occasion, Ootd, OotdCandidate, Profile, WardrobeItem, WeatherInfo } from '../shared/types.ts';
import { readJson, updateJson } from './store.ts';
import { generateCandidates, recommendMakeup, validateOutfit } from './rules.ts';
import { chatJSON, llmAvailable } from './llm.ts';
import { anchorById, makeupById } from './knowledge.ts';
import { getWeather } from './weather.ts';
import { OUTFIT_NARRATIVE_PROMPT } from './prompts.ts';
import { z } from 'zod';

const narrativeSchema = z.object({
  chosenIndex: z.number().int().min(0),
  narrative: z.string(),
  photoHint: z.string(),
  alternatives: z.array(z.object({ index: z.number().int().min(0), why: z.string() })).max(2),
  makeupTemplateId: z.string().optional(),
});

export function wardrobeItems(): WardrobeItem[] {
  return readJson<WardrobeItem[]>('wardrobe/items.json', []);
}

export function getProfile(): Profile {
  return readJson<Profile>('profile.json', {
    basics: {
      height: 160,
      bodyType: '直筒形',
      skinTone: '冷调自然',
      concerns: ['显腿长'],
    },
    anchors: ['newjeans'],
  });
}

function itemLine(i: WardrobeItem): string {
  return `${i.subType}（${i.colorName}${i.baseColor ? '·基础色' : ''}/正式度${i.formality}/${i.styleTags.join('·') || '无标签'}）`;
}

function candidateSummary(i: number, c: OotdCandidate, items: WardrobeItem[]): string {
  const its = c.items.map((id) => items.find((it) => it.id === id)!).filter(Boolean);
  return `候选${i}：${its.map(itemLine).join(' + ')}｜色彩${c.subscores.color} 锚点${c.subscores.anchor} 穿着${c.subscores.wear} 出片${c.subscores.photo}｜总分${c.totalScore}`;
}

function ootdPath(date: string): string {
  return `ootd/${date.slice(0, 4)}/${date.slice(5, 7)}-${date.slice(8, 10)}.json`;
}

export function readOotd(date: string): Ootd | null {
  return readJson<Ootd | null>(ootdPath(date), null);
}

export interface ComposeOpts {
  date: string;
  occasion: Occasion;
  regenerate?: boolean;
}

export async function composeOotd({ date, occasion, regenerate }: ComposeOpts): Promise<Ootd> {
  const profile = getProfile();
  const items = wardrobeItems();
  if (items.length < 2) throw new Error('衣橱单品不足，先去「衣橱」页拍照入库（至少 2 件）');

  const existing = readOotd(date);
  const exclude = existing?.history?.map((h) => h.items) ?? (existing ? [existing.items] : []);

  let weather: WeatherInfo;
  try {
    weather = await getWeather(date);
  } catch {
    weather = {
      date,
      temp: 20,
      tempRange: [16, 24],
      condition: '天气服务不可用（按 16-24℃ 估算）',
      rainProb: 0,
      source: 'manual',
    };
  }

  const candidates = generateCandidates({
    date,
    occasion,
    weather: { temp: weather.temp, tempRange: weather.tempRange, rainProb: weather.rainProb },
    items,
    profile,
    exclude,
  });
  if (candidates.length === 0) {
    throw new Error('当前衣橱凑不出满足温度/场合的组合，先补充基础款或修正单品的适穿温度');
  }

  const anchor = profile.anchors[0] ?? 'newjeans';
  const anchorCard = anchorById(anchor);
  const makeupPicks = recommendMakeup({ profile, occasion, anchors: profile.anchors });

  let ootd: Ootd | undefined;
  let llmPicked: OotdCandidate | null = null;

  if (llmAvailable()) {
    try {
      const picks = candidates.map((c, i) => candidateSummary(i, c, items)).join('\n');
      const makeupOpts = makeupPicks.map((p) => `${p.template.id}（${p.template.name}，${p.template.timeBudget}分钟）`).join('；');
      const r = await chatJSON({
        schema: narrativeSchema,
        messages: [
          { role: 'system', content: OUTFIT_NARRATIVE_PROMPT },
          {
            role: 'user',
            content: [
              `用户档案：身高${profile.basics.height}cm ${profile.basics.bodyType} ${profile.basics.skinTone}，诉求：${profile.basics.concerns.join('、')}`,
              `主锚点：${anchorCard?.name ?? anchor}（${anchorCard?.vibe ?? ''}；妆造语言：${anchorCard?.makeupTraits ?? ''}）`,
              `今日天气：${weather.condition} ${weather.tempRange[0]}-${weather.tempRange[1]}℃ 降水概率${weather.rainProb}%，场合：${occasion}`,
              `妆造可选项：${makeupOpts}`,
              '',
              picks,
            ].join('\n'),
          },
        ],
      });
      const picked = candidates[Math.min(r.chosenIndex, candidates.length - 1)]!;
      // 最后防线：LLM 选中候选也过结构校验（候选本来自规则引擎，双保险）
      const v = validateOutfit(picked.items, { date, occasion, weather: { temp: weather.temp, tempRange: weather.tempRange, rainProb: weather.rainProb }, items, profile });
      if (v.ok) {
        llmPicked = picked;
        const mk = (r.makeupTemplateId && makeupById(r.makeupTemplateId)) || makeupPicks[0]?.template;
        ootd = {
          date,
          weather: { temp: weather.temp, tempRange: weather.tempRange, condition: weather.condition, rainProb: weather.rainProb },
          occasion,
          anchorUsed: anchor,
          items: picked.items,
          outfitScore: picked.totalScore,
          narrative: r.narrative,
          makeup: mk ? { templateId: mk.id, stepsSnapshot: mk.steps } : { templateId: '', stepsSnapshot: [] as MakeupStep[] },
          photoHint: r.photoHint,
          alternatives: r.alternatives
            .filter((a) => candidates[a.index])
            .slice(0, 2)
            .map((a) => ({ items: candidates[a.index]!.items, why: a.why })),
          feedback: null,
          source: 'llm',
          history: [...exclude, picked.items].map((its) => ({ items: its, anchorUsed: anchor })),
        };
      }
    } catch {
      /* 降级到规则通道 */
    }
  }

  if (!ootd) {
    // 规则通道降级：Top1 + 模板文案
    const top = candidates[0]!;
    const its = top.items.map((id) => items.find((i) => i.id === id)!).filter(Boolean);
    const mk = makeupPicks[0]?.template;
    ootd = {
      date,
      weather: { temp: weather.temp, tempRange: weather.tempRange, condition: weather.condition, rainProb: weather.rainProb },
      occasion,
      anchorUsed: anchor,
      items: top.items,
      outfitScore: top.totalScore,
      narrative: `今日${weather.condition}、${weather.tempRange[0]}-${weather.tempRange[1]}℃，走${anchorCard?.name ?? anchor}路线：${its.map((i) => i.subType + '（' + i.colorName + '）').join(' + ')}。${anchorCard ? anchorCard.makeupTraits : ''}。整体低饱和有层次，通勤和约会都不突兀。`,
      makeup: mk ? { templateId: mk.id, stepsSnapshot: mk.steps } : { templateId: '', stepsSnapshot: [] as MakeupStep[] },
      photoHint: weather.sun ? '黄金时刻（日落前 1 小时）顺光或侧逆光拍一张全身' : '找一面干净白墙，光线均匀时拍全身',
      alternatives: candidates.slice(1, 3).map((c) => ({ items: c.items, why: '规则引擎备选：总分次高' })),
      feedback: null,
      source: 'rule',
      history: [...exclude, top.items].map((its2) => ({ items: its2, anchorUsed: anchor })),
    };
  }

  // 落盘（regenerate 覆盖当日 current，history 保留全部生成过的组合）
  await updateJson<Ootd | null>(ootdPath(date), null, (v) => {
    ootd.history = v?.history?.length ? v.history : ootd.history;
    return ootd;
  });
  return ootd;
}

/** 反馈闭环：liked/meh 视为已穿 → 更新 wearCount/lastWorn */
export async function logFeedback(date: string, verdict: 'liked' | 'meh' | 'unchosen'): Promise<void> {
  const path = ootdPath(date);
  await updateJson<Ootd | null>(path, null, (v) => {
    if (!v) return;
    v.feedback = verdict;
  });
  if (verdict === 'unchosen') return;
  const ootd = readOotd(date);
  if (!ootd) return;
  await updateJson<WardrobeItem[]>('wardrobe/items.json', [], (items) => {
    for (const it of items) {
      if (ootd.items.includes(it.id)) {
        it.wearCount += 1;
        it.lastWorn = date;
      }
    }
  });
}
