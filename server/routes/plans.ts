/** 拍照计划：CRUD + 样片上传 + 复盘 */
import { Router } from 'express';
import multer from 'multer';
import type { PhotoPlan } from '../../shared/types.ts';
import { listPlans, getPlan, createPlan, updatePlan } from '../plans.service.ts';
import { reviewSession, manualReview, listSessionShots } from '../review.service.ts';
import { processUpload } from '../upload.ts';

export const plansRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 20 } });

plansRouter.get('/', (_req, res) => {
  res.json(listPlans());
});

plansRouter.post('/', async (req, res) => {
  try {
    const { theme, date, location, sceneType, outfitItemIds, ootdDate } = req.body as {
      theme: string; date: string; location: string; sceneType: PhotoPlan['location']['sceneType'];
      outfitItemIds?: string[]; ootdDate?: string;
    };
    if (!theme || !date || !location || !sceneType) {
      res.status(400).json({ error: '需要 theme/date/location/sceneType' });
      return;
    }
    const plan = await createPlan({ theme, date, locationName: location, sceneType, outfitItemIds, ootdDate });
    res.json(plan);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

plansRouter.get('/:id', (req, res) => {
  const plan = getPlan(String(req.params.id));
  if (!plan) {
    res.status(404).json({ error: '计划不存在' });
    return;
  }
  res.json({ plan, shots: listSessionShots(String(req.params.id)) });
});

plansRouter.patch('/:id', async (req, res) => {
  const p = await updatePlan(req.params.id, (plan) => {
    Object.assign(plan, req.body as Partial<PhotoPlan>);
  });
  if (!p) {
    res.status(404).json({ error: '计划不存在' });
    return;
  }
  res.json(p);
});

/** 上传样片（拍后），multipart files[] */
plansRouter.post('/:id/shots', upload.array('photos', 20), async (req, res) => {
  const plan = getPlan(String(req.params.id));
  if (!plan) {
    res.status(404).json({ error: '计划不存在' });
    return;
  }
  const files = req.files as Express.Multer.File[];
  if (!files?.length) {
    res.status(400).json({ error: '缺少 photos 文件' });
    return;
  }
  const saved: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const img = await processUpload(f.buffer, f.originalname, `plans/${plan.id}/shots`, `shot-${Date.now().toString(36)}-${i}`);
    saved.push(img.rel);
  }
  if (plan.status === 'planned') await updatePlan(plan.id, (p) => { p.status = 'shot'; });
  res.json({ ok: true, count: saved.length });
});

/** 触发复盘（视觉管线）；断网时 body.keep 提供手动精选文件名 */
plansRouter.post('/:id/review', async (req, res) => {
  try {
    const keep = (req.body?.keep as string[] | undefined) ?? undefined;
    if (keep) {
      res.json(await manualReview(req.params.id, keep));
    } else {
      res.json(await reviewSession(String(req.params.id)));
    }
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});
