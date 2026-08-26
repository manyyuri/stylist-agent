/**
 * 图片上传管线：multer(memory) → sharp 处理 → 落盘工作区。
 *
 * 处理链：EXIF 转正（iPhone 竖拍方向）→ HEIC 转 JPEG → 最长边压到 1280px。
 * 原图保留（隐私：原图只落本地 Mac），发给视觉模型的是压缩 JPEG。
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { absPath, ensureDir } from './store.ts';

export interface ProcessedImage {
  /** 相对工作区路径（如 wardrobe/photos/2025-06-05/w_0001.jpg） */
  rel: string;
  width: number;
  height: number;
  bytes: number;
}

export async function processUpload(
  buffer: Buffer,
  originalName: string,
  relDir: string,
  baseName: string
): Promise<ProcessedImage> {
  const dirAbs = ensureDir(relDir);
  // 原图副本（保留 HEIC/原始分辨率，仅本地）
  const origDir = join(dirAbs, 'orig');
  mkdirSync(origDir, { recursive: true });
  const origExt = (originalName.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? '.img').toLowerCase();
  writeFileSync(join(origDir, baseName + origExt), buffer);

  // 压缩版：EXIF 转正 + HEIC→JPEG + ≤1280px
  const img = sharp(buffer, { failOn: 'none' }).rotate(); // rotate() 无参 = 按 EXIF 转正
  const meta = await img.metadata();
  let pipeline = img;
  if ((meta.width ?? 0) > 1280 || (meta.height ?? 0) > 1280) {
    pipeline = img.resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true });
  }
  const out = join(dirAbs, `${baseName}.jpg`);
  const info = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toFile(out);

  return { rel: `${relDir}/${baseName}.jpg`, width: info.width, height: info.height, bytes: info.size };
}

/** 读取发给视觉模型的压缩 JPEG base64（data URL） */
export async function imageDataUrl(rel: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(absPath(rel));
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
