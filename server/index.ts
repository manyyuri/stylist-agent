/**
 * Express 入口 —— 监听 0.0.0.0，打印 .local 局域网地址（iPhone Safari 直连）。
 */
import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
import { config, ROOT_DIR, DASHSCOPE_API_KEY } from './config.ts';
import { ensureDir } from './store.ts';
import { profileRouter } from './routes/profile.ts';
import { wardrobeRouter } from './routes/wardrobe.ts';
import { weatherRouter } from './routes/weather.ts';
import { ootdRouter } from './routes/ootd.ts';
import { plansRouter } from './routes/plans.ts';
import { chatRouter } from './routes/chat.ts';
import { anchors } from './knowledge.ts';

const app = express();
app.disable('x-powered-by');

// 局域网跨域（iPhone 直连 + vite dev proxy 双场景）
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: '50mb' })); // 聊天附图走 base64

// 工作区图片静态托管（压缩版 JPEG；orig/ 子目录不暴露）
app.use('/workspace', (req, res, next) => {
  if (req.path.includes('/orig/')) {
    res.status(403).end('原图不对外提供');
    return;
  }
  next();
}, express.static(config.dataDir, { maxAge: '7d', immutable: true }));

app.use('/api/profile', profileRouter);
app.use('/api/wardrobe', wardrobeRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/ootd', ootdRouter);
app.use('/api/plans', plansRouter);
app.use('/api/chat', chatRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, llm: !!DASHSCOPE_API_KEY, dataDir: config.dataDir });
});

app.get('/api/anchors', (_req, res) => {
  res.json(anchors());
});

// 生产构建产物托管（web/dist）
const dist = resolve(ROOT_DIR, 'web/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/workspace).*/, (_req, res) => {
    res.sendFile(resolve(dist, 'index.html'));
  });
}

// 统一错误出口（Express 5 会自动把 async 抛错路由到这里）
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: (err as Error)?.message ?? '服务内部错误' });
});

ensureDir('');
app.listen(config.port, '0.0.0.0', () => {
  const nets = Object.values(os.networkInterfaces()).flat().filter((n) => n?.family === 'IPv4' && !n.internal);
  const lan = nets[0]?.address ?? '?';
  console.log(`
┌──────────────────────────────────────────────┐
│  小镜 · 女团风形象管家  stylist-agent         │
├──────────────────────────────────────────────┤
│  iPhone Safari:  http://${os.hostname().replace(/\..*/, '')}.local:${config.port}${' '.repeat(Math.max(0, 3 - String(config.port).length))}│
│  局域网 IP:       http://${lan}:${config.port}  │
│  工作区:          ${config.dataDir}  │
│  大模型:          ${DASHSCOPE_API_KEY ? `DashScope 已配置（${config.models.text}）` : '⚠ 未配置 DASHSCOPE_API_KEY，规则引擎降级可用'}  │
└──────────────────────────────────────────────┘
  （远程访问：Mac 与 iPhone 都开 Tailscale，用 100.x IP 访问同端口）
`);
});
