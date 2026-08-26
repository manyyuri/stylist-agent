/**
 * 视觉管线 —— qwen-vl-max 三条独立管线，全部：
 *   压缩 JPEG base64 → 结构化 prompt → zod 校验 → 失败重试 1 次。
 *
 * 隐私约定：原图只落本地工作区，发给云端的是 ≤1280px 的压缩 JPEG。
 */
import { z } from 'zod';
import { visionClient } from './llm.ts';
import { config } from './config.ts';
import { extractJSON } from './llm.ts';
import { ANALYZE_FACE_PROMPT, EXTRACT_ITEM_PROMPT, REVIEW_PHOTOS_PROMPT } from './prompts.ts';
import { autoBaseColor } from './color.ts';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// ---------- schema ----------

const itemDraftSchema = z.object({
  category: z.enum(['outerwear', 'top', 'bottom', 'dress', 'shoes', 'bag', 'accessory', 'headwear']),
  subType: z.string(),
  colorName: z.string(),
  colorHex: z.union([hex, z.literal('?')]),
  pattern: z.enum(['纯色', '条纹', '碎花', '格纹', '印花', '拼色']).or(z.literal('?')),
  material: z.string(),
  seasons: z.array(z.enum(['春', '夏', '秋', '冬'])),
  tempRange: z.tuple([z.number(), z.number()]),
  formality: z.union([z.number().int().min(1).max(5), z.literal('?')]),
  styleTags: z.array(z.string()),
  baseColor: z.boolean(),
  note: z.string().default(''),
});
export type ItemDraft = z.infer<typeof itemDraftSchema>;

const faceSchema = z.object({
  faceShape: z.string(),
  eyeShape: z.string(),
  skinTone: z.string(),
  colorSeason: z.string(),
  reason: z.string(),
});
export type FaceDraft = z.infer<typeof faceSchema>;

const reviewSchema = z.object({
  perPhoto: z.array(z.object({
    file: z.string(),
    verdict: z.enum(['keep', 'ok', 'drop']),
    composition: z.string(),
    light: z.string(),
    expression: z.string(),
    why: z.string(),
  })),
  best: z.array(z.string()),
  colorWin: z.array(z.string()),
  advice: z.string(),
});
export type ReviewDraft = z.infer<typeof reviewSchema>;

// ---------- 底层调用 ----------

async function visionJSON<T>(schema: z.ZodType<T>, prompt: string, images: string[]): Promise<T> {
  if (!visionClient) throw new Error('DASHSCOPE_API_KEY 未配置');
  const content: unknown[] = [{ type: 'text', text: prompt }];
  for (const url of images) content.push({ type: 'image_url', image_url: { url } });

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await visionClient.chat.completions.create({
      model: config.models.vision,
      messages: [{ role: 'user', content } as never],
      max_tokens: 3072,
      temperature: 0.2,
    });
    const text = res.choices[0]?.message?.content ?? '';
    try {
      const parsed = schema.safeParse(extractJSON(text));
      if (parsed.success) return parsed.data;
      lastErr = new Error(`vision schema 校验失败: ${parsed.error.message.slice(0, 200)}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------- 管线 1：单品识别（入库草稿，必须经用户确认） ----------

export async function extractItems(dataUrl: string): Promise<ItemDraft> {
  const draft = await visionJSON(itemDraftSchema, EXTRACT_ITEM_PROMPT, [dataUrl]);
  // baseColor 兜底：模型漏判时用色彩数学补
  if (draft.colorHex !== '?' && !draft.baseColor) {
    draft.baseColor = autoBaseColor(draft.colorHex);
  }
  return draft;
}

// ---------- 管线 2：自拍分析（只出建议，用户确认后才写 profile） ----------

export async function analyzeFace(dataUrl: string): Promise<FaceDraft> {
  return visionJSON(faceSchema, ANALYZE_FACE_PROMPT, [dataUrl]);
}

// ---------- 管线 3：拍照复盘 ----------

export async function reviewPhotos(dataUrls: string[]): Promise<ReviewDraft> {
  if (dataUrls.length === 0) throw new Error('没有可复盘的照片');
  const prompt =
    REVIEW_PHOTOS_PROMPT + `\n\n共 ${dataUrls.length} 张，按顺序命名 file_1…file_${dataUrls.length}。`;
  return visionJSON(reviewSchema, prompt, dataUrls);
}
