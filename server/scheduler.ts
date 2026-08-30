/**
 * 轻量本地调度器：不引入额外队列，任务真正的持久化与重试交给 Flue。
 * 默认开启 —— 「每日」是产品的脉搏：早晨 OOTD 已在通告单上躺好，打开即确认。
 * 需要关闭时设 STYLIST_DISABLE_SCHEDULER=1（如开发环境不想重复生成任务）。
 */
let lastDispatchedDate = '';

export function startScheduler(): () => void {
  if (process.env.STYLIST_DISABLE_SCHEDULER === '1') return () => undefined;
  const flueUrl = process.env.FLUE_URL ?? 'http://127.0.0.1:4291';
  const tick = () => {
    const date = new Date().toISOString().slice(0, 10);
    if (date === lastDispatchedDate) return;
    lastDispatchedDate = date;
    void fetch(`${flueUrl}/internal/daily-outfit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date }),
    }).catch((error) => {
      console.error('[scheduler] daily outfit dispatch failed', error);
      lastDispatchedDate = '';
    });
  };
  tick();
  const timer = setInterval(tick, 60_000);
  return () => clearInterval(timer);
}
