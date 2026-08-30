/**
 * 月度复盘 —— 闭环在「自我认知层」学习的收口。
 *
 * 数据闭环第一环（单品层）：feedback → wearCount/lastWorn，colorWin → photoRating。
 * 这一环只学会了「哪件单品出片」。
 * 月度复盘是第二环（自我认知层）：把一个月通告单里的穿搭分数、反馈、出片数据
 * 汇总成小PD 的导演复盘，并在数据支持时给出「主攻风格锚点漂移」建议——
 * 用户确认才写入档案，与自拍分析同一个「仅建议、确认后写入」模式。
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AnchorDrift, AnchorTrend, MonthlyReport, Ootd } from '../shared/types.ts';
import { config } from './config.ts';
import { anchorById } from './knowledge.ts';
import { chatJSON, llmAvailable } from './llm.ts';
import { getProfile, wardrobeItems } from './ootd.ts';
import { MONTHLY_REVIEW_PROMPT } from './prompts.ts';

/** 读取某月全部 OOTD（数据目录 ootd/YYYY/MM-DD.json），按日期升序 */
function monthOotds(month: string): Ootd[] {
  const [y, m] = month.split('-');
  const dir = join(config.dataDir, 'ootd', y!);
  if (!existsSync(dir)) return [];
  const out: Ootd[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || !f.startsWith(`${m}-`)) continue;
    try {
      const v = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Ootd | null;
      // 当日无穿搭/半截文件都跳过（ootd.ts 用 null 表示「今天还没生成」）
      if (v && typeof v.date === 'string' && Array.isArray(v.items)) out.push(v);
    } catch {
      /* 半截文件跳过 */
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const narrativeSchema = z.object({ narrative: z.string() });

function defaultNarrative(r: {
  month: string; days: number; feedback: { liked: number; meh: number; unchosen: number };
  avgScore: number; drift: AnchorDrift | null;
}): string {
  const { month, days, feedback, avgScore, drift } = r;
  const parts = [`${month} 通告共 ${days} 天，平均分 ${avgScore}。`];
  if (feedback.liked > 0) parts.push(`你觉得「就穿这套」${feedback.liked} 次、还行 ${feedback.meh} 次。`);
  else parts.push('这个月你还没来得及给反馈，先穿起来再说。');
  if (drift) parts.push(`小PD 注意到：${drift.reason}。要不要把主攻换成「${drift.toName}」？`);
  else if (days > 0) parts.push('风格方向稳定，继续保持。');
  return parts.join('');
}

export async function buildMonthlyReport(month: string): Promise<MonthlyReport> {
  const ootds = monthOotds(month);
  const profile = getProfile();
  const items = wardrobeItems();

  // ---- 汇总 ----
  const feedback = { liked: 0, meh: 0, unchosen: 0 };
  let scoreSum = 0;
  let scored = 0;
  const byAnchor = new Map<string, { count: number; sum: number; liked: number }>();
  for (const o of ootds) {
    if (o.feedback) feedback[o.feedback] += 1;
    if (typeof o.outfitScore === 'number') {
      scoreSum += o.outfitScore;
      scored += 1;
    }
    const a = o.anchorUsed;
    if (!a) continue;
    const e = byAnchor.get(a) ?? { count: 0, sum: 0, liked: 0 };
    e.count += 1;
    e.sum += o.outfitScore ?? 0;
    if (o.feedback === 'liked') e.liked += 1;
    byAnchor.set(a, e);
  }
  const avgScore = scored ? Math.round(scoreSum / scored) : 0;

  const anchorTrends: AnchorTrend[] = [...byAnchor.entries()]
    .map(([anchor, e]) => ({
      anchor,
      name: anchorById(anchor)?.name ?? anchor,
      count: e.count,
      avgScore: Math.round(e.sum / e.count),
      liked: e.liked,
    }))
    .sort((a, b) => b.avgScore - a.avgScore || b.count - a.count);

  // 本月最出片的单品（photoRating 是这本日记里最诚实的信号）
  const topItems = items
    .filter((i) => (i.photoRating ?? 0) > 0)
    .sort((a, b) => (b.photoRating ?? 0) - (a.photoRating ?? 0))
    .slice(0, 3)
    .map((i) => ({
      id: i.id,
      subType: i.subType,
      colorName: i.colorName,
      photoRating: i.photoRating ?? 0,
      wearCount: i.wearCount,
    }));

  // ---- 锚点漂移建议：次锚点数据足够且明显优于主锚点 → 建议升序 ----
  let drift: AnchorDrift | null = null;
  const primary = profile.anchors[0] ?? '';
  const secondary = profile.anchors[1];
  const pT = anchorTrends.find((t) => t.anchor === primary);
  const sT = secondary ? anchorTrends.find((t) => t.anchor === secondary) : undefined;
  if (secondary && sT && sT.count >= 3 && pT && sT.avgScore >= pT.avgScore + 3) {
    drift = {
      from: primary,
      fromName: anchorById(primary)?.name ?? primary,
      to: secondary,
      toName: anchorById(secondary)?.name ?? secondary,
      reason: `本月 ${sT.count} 次以「${sT.name}」为主锚点的穿搭平均分 ${sT.avgScore}，高于主锚点「${pT.name}」的 ${pT.avgScore}（其中被点赞 ${sT.liked} 次）`,
    };
  }

  // ---- 叙事：LLM 导演复盘 + 规则兜底 ----
  let narrative = '';
  let source: 'llm' | 'rule' = 'rule';
  if (llmAvailable() && ootds.length > 0) {
    try {
      const r = await chatJSON({
        schema: narrativeSchema,
        maxTokens: 800,
        messages: [
          { role: 'system', content: MONTHLY_REVIEW_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({ month, days: ootds.length, feedback, avgScore, anchorTrends, drift, topItems }),
          },
        ],
      });
      narrative = r.narrative;
      source = 'llm';
    } catch {
      /* 兜底 */
    }
  }
  if (!narrative) {
    narrative = defaultNarrative({ month, days: ootds.length, feedback, avgScore, drift });
  }

  return {
    month,
    days: ootds.length,
    feedback,
    avgScore,
    source,
    narrative,
    topItems,
    anchorTrends,
    drift,
  };
}
