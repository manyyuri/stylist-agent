import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { zaiCodingCnProvider } from '@earendil-works/pi-ai/providers/zai-coding-cn';
import { setProvider } from '@flue/runtime';
import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { GLM_API_KEY, GLM_BASE_URL, config } from '../../server/config.ts';
import { dispatch } from '@flue/runtime';
import { Stylist } from './agents/stylist.ts';
import { DailyOutfit } from './agents/daily-outfit.ts';
import { PhotoReview } from './agents/photo-review.ts';

// Flue 官方 zai provider 使用 ZAI_CODING_CN_API_KEY。只在当前进程内
// 建立别名，不把密钥写回 ~/.pi/models.json 或项目文件。
if (GLM_API_KEY && !process.env.ZAI_CODING_CN_API_KEY) {
  process.env.ZAI_CODING_CN_API_KEY = GLM_API_KEY;
}

const upstream = zaiCodingCnProvider();
const template = upstream.getModels().find((model) => model.id === 'glm-5v-turbo');
if (!template) throw new Error('Flue 内置 zai provider 缺少多模态模型模板');

const glmModel = {
  ...template,
  id: config.models.text,
  name: 'GLM-5.3-Flash',
  baseUrl: GLM_BASE_URL,
  input: ['text', 'image'] as ('text' | 'image')[],
};

setProvider(createProvider({
  id: 'glm',
  name: '智谱 GLM',
  baseUrl: GLM_BASE_URL,
  auth: upstream.auth,
  models: [glmModel],
  api: openAICompletionsApi(),
}));

const app = new Hono();
app.get('/health', (c) => c.json({ ok: true, provider: 'glm', model: config.models.text }));
app.route('/stylist', createAgentRouter(Stylist));
app.route('/daily-outfit', createAgentRouter(DailyOutfit));
app.route('/photo-review', createAgentRouter(PhotoReview));

// 给 Express 上传路由和系统 cron 使用的受限 dispatch 入口。
app.post('/internal/daily-outfit', async (c) => {
  const body = await c.req.json<{ date?: string }>();
  const date = body.date ?? new Date().toISOString().slice(0, 10);
  const receipt = await dispatch(DailyOutfit, {
    id: `daily:${date}`,
    message: { kind: 'signal', type: 'daily.outfit', body: `生成 ${date} 的每日穿搭`, attributes: { date } },
  });
  return c.json(receipt, 202);
});
app.post('/internal/photo-review', async (c) => {
  const body = await c.req.json<{ planId?: string }>();
  if (!body.planId) return c.json({ error: 'planId 不能为空' }, 400);
  const receipt = await dispatch(PhotoReview, {
    id: `photo-review:${body.planId}`,
    message: { kind: 'signal', type: 'photo.review', body: `复盘计划 ${body.planId}`, attributes: { planId: body.planId } },
  });
  return c.json(receipt, 202);
});

export default app;
