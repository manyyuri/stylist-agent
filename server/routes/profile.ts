/** 档案：读写 + 自拍分析（vision 只出建议，用户确认后 PUT 写入） */
import { Router } from 'express';
import multer from 'multer';
import type { Profile } from '../../shared/types.ts';
import { updateJson } from '../store.ts';
import { analyzeFace } from '../vision.ts';
import { imageDataUrl } from '../upload.ts';
import { getProfile } from '../ootd.ts';

export const profileRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

profileRouter.get('/', (_req, res) => {
  res.json(getProfile());
});

profileRouter.put('/', (req, res) => {
  const p = req.body as Profile;
  if (!p?.basics?.height || !p?.basics?.skinTone) {
    res.status(400).json({ error: '档案缺少必填字段（height/skinTone）' });
    return;
  }
  if (!Array.isArray(p.anchors) || p.anchors.length === 0) {
    res.status(400).json({ error: '至少选择一个风格锚点' });
    return;
  }
  updateJson('profile.json', getProfile(), (v) => Object.assign(v, p));
  res.json({ ok: true });
});

/** 自拍分析 → 返回建议草稿（不落盘，等用户确认） */
profileRouter.post('/face', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '缺少 photo 文件' });
      return;
    }
    const { processUpload } = await import('../upload.ts');
    const img = await processUpload(req.file.buffer, req.file.originalname, 'profile', 'selfie-latest');
    const dataUrl = await imageDataUrl(img.rel);
    const draft = await analyzeFace(dataUrl);
    res.json({ draft, photo: img.rel });
  } catch (e) {
    res.status(502).json({ error: `视觉分析失败：${(e as Error).message}` });
  }
});
