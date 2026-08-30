/**
 * 拍后复盘服务 —— 数据闭环的收口：
 *   样片 → GLM-5.3-Flash 多模态逐张评价 → 精选进 samples/ → colorWin 反哺单品 photoRating
 *   → 下次 generateCandidates 的 photoBonus 权重变化 → 推荐越用越准。
 */
import { readdirSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PhotoPlan, PhotoReview, WardrobeItem } from '../shared/types.ts';
import { absPath, ensureDir, updateJson, readJson } from './store.ts';
import { imageDataUrl } from './upload.ts';
import { reviewPhotos } from './vision.ts';
import { getPlan, updatePlan } from './plans.service.ts';
import { readOotd } from './ootd.ts';
import { hexToRgb } from './color.ts';

/** 列出某计划已上传的样片（压缩版） */
export function listSessionShots(planId: string): string[] {
  const dir = absPath(`plans/${planId}/shots`);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
}

export async function reviewSession(planId: string): Promise<PhotoReview> {
  const plan = getPlan(planId);
  if (!plan) throw new Error(`计划 ${planId} 不存在`);
  const files = listSessionShots(planId);
  if (files.length === 0) throw new Error('该计划还没有上传样片');

  const dataUrls = await Promise.all(files.map((f) => imageDataUrl(`plans/${planId}/shots/${f}`)));
  const draft = await reviewPhotos(dataUrls);

  // file_1..n → 真实文件名
  const perPhoto = draft.perPhoto.map((p, i) => ({
    ...p,
    file: p.file.startsWith('file_') ? (files[Number(p.file.slice(5)) - 1] ?? p.file) : p.file,
  }));
  const best = draft.best
    .map((f) => (f.startsWith('file_') ? (files[Number(f.slice(5)) - 1] ?? f) : f))
    .filter((f) => files.includes(f));

  const review: PhotoReview = {
    analyzedAt: new Date().toISOString(),
    perPhoto,
    best,
    colorWin: draft.colorWin,
    advice: draft.advice,
  };

  // 精选副本 → samples/
  const samplesDir = ensureDir('samples');
  for (const b of best) {
    copyFileSync(absPath(`plans/${planId}/shots/${b}`), join(samplesDir, `${planId}__${b}`));
  }

  // 反哺：colorWin 中的颜色命中本次穿搭单品 → photoRating +0.5（上限 5）
  await bumpPhotoRating(plan, draft.colorWin);

  await updatePlan(planId, (p) => {
    p.status = 'reviewed';
    p.review = review;
  });
  return review;
}

function parseHex(entry: string): string | null {
  const m = entry.match(/#[0-9a-fA-F]{6}/);
  return m ? m[0] : null;
}

async function bumpPhotoRating(plan: PhotoPlan, colorWin: string[]): Promise<void> {
  const hexes = colorWin.map(parseHex).filter((h): h is string => h !== null);
  if (hexes.length === 0) return;

  // 解析本次穿搭涉及的 item ids
  let itemIds: string[] = [];
  if ('itemIds' in plan.outfitRef) itemIds = plan.outfitRef.itemIds;
  else if ('ootdDate' in plan.outfitRef) itemIds = readOotd(plan.outfitRef.ootdDate)?.items ?? [];
  if (itemIds.length === 0) return;

  await updateJson<WardrobeItem[]>('wardrobe/items.json', [], (items) => {
    for (const it of items) {
      if (!itemIds.includes(it.id)) continue;
      const rgb = hexToRgb(it.colorHex);
      const hit = hexes.some((h) => {
        const t = hexToRgb(h);
        const d = Math.sqrt((rgb.r - t.r) ** 2 + (rgb.g - t.g) ** 2 + (rgb.b - t.b) ** 2);
        return d < 60;
      });
      if (hit) it.photoRating = Math.min(5, (it.photoRating ?? 3) + 0.5);
    }
  });
}

/** 手动标注复盘（断网/无 Key 时可用） */
export async function manualReview(planId: string, keep: string[]): Promise<PhotoReview> {
  const files = listSessionShots(planId);
  const review: PhotoReview = {
    analyzedAt: new Date().toISOString(),
    perPhoto: files.map((f) => ({
      file: f,
      verdict: keep.includes(f) ? ('keep' as const) : ('ok' as const),
      composition: '手动标注',
      light: '-',
      expression: '-',
      why: '离线手动精选',
    })),
    best: keep.filter((k) => files.includes(k)),
    colorWin: [],
    advice: '视觉模型不可用，本次为手动精选。联网后可重新复盘。',
  };
  const samplesDir = ensureDir('samples');
  for (const b of review.best) {
    copyFileSync(absPath(`plans/${planId}/shots/${b}`), join(samplesDir, `${planId}__${b}`));
  }
  await updatePlan(planId, (p) => {
    p.status = 'reviewed';
    p.review = review;
  });
  return review;
}
