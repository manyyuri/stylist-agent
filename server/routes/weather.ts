/** 天气代理：GET /api/weather?date=YYYY-MM-DD（当日缓存） */
import { Router } from 'express';
import { getWeather, manualWeather } from '../weather.ts';

export const weatherRouter = Router();

weatherRouter.get('/', async (req, res) => {
  const date = (req.query.date as string) || undefined;
  try {
    res.json(await getWeather(date));
  } catch (e) {
    // 降级：让前端手动输入温度区间
    res.json({
      ...(date ? manualWeather(date, [16, 24]) : manualWeather(new Date().toISOString().slice(0, 10), [16, 24])),
      error: `天气服务不可用：${(e as Error).message}`,
    });
  }
});

/** 手动输入温度区间（open-meteo 失败时的降级入口） */
weatherRouter.post('/manual', (req, res) => {
  const { date, tempRange } = req.body as { date: string; tempRange: [number, number] };
  if (!date || !Array.isArray(tempRange) || tempRange.length !== 2) {
    res.status(400).json({ error: '需要 date 与 tempRange [lo, hi]' });
    return;
  }
  res.json(manualWeather(date, [Number(tempRange[0]), Number(tempRange[1])]));
});
