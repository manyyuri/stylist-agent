/** 月度复盘路由：GET /api/review/monthly?month=YYYY-MM（默认当月） */
import { Router } from 'express';
import { buildMonthlyReport } from '../monthly.ts';

export const reviewRouter = Router();

reviewRouter.get('/monthly', async (req, res) => {
  const month = String(req.query.month ?? new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: 'month 需为 YYYY-MM' });
    return;
  }
  try {
    res.json(await buildMonthlyReport(month));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
