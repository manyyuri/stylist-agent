/** 今日 OOTD：幂等生成 / 换一套 / 反馈闭环 */
import { Router } from 'express';
import type { Occasion } from '../../shared/types.ts';
import { composeOotd, readOotd, logFeedback } from '../ootd.ts';
import { today } from '../weather.ts';

export const ootdRouter = Router();

/** 当日无 OOTD 则幂等生成；有则直接返回 */
ootdRouter.get('/today', async (req, res) => {
  try {
    const date = (req.query.date as string) || today();
    const occasion = ((req.query.occasion as Occasion) || '通勤') as Occasion;
    const existing = readOotd(date);
    if (existing) {
      res.json(existing);
      return;
    }
    const ootd = await composeOotd({ date, occasion });
    res.json(ootd);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** 换一套（排除当日已生成过的组合） */
ootdRouter.post('/today/regenerate', async (req, res) => {
  try {
    const date = (req.body?.date as string) || today();
    const occasion = ((req.body?.occasion as Occasion) || '通勤') as Occasion;
    const ootd = await composeOotd({ date, occasion, regenerate: true });
    res.json(ootd);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** 反馈：liked/meh/unchosen */
ootdRouter.post('/feedback', async (req, res) => {
  const { date, verdict } = req.body as { date: string; verdict: 'liked' | 'meh' | 'unchosen' };
  if (!date || !['liked', 'meh', 'unchosen'].includes(verdict ?? '')) {
    res.status(400).json({ error: '需要 {date, verdict: liked|meh|unchosen}' });
    return;
  }
  if (!readOotd(date)) {
    res.status(404).json({ error: `${date} 没有 OOTD 记录` });
    return;
  }
  await logFeedback(date, verdict);
  res.json({ ok: true });
});
