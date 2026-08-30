import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { setProvider } from '@flue/runtime';
import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { LLM_API_KEY, LLM_BASE_URL, config } from '../../server/config.ts';
import { dispatch } from '@flue/runtime';
import { Stylist } from './agents/stylist.ts';
import { DailyOutfit } from './agents/daily-outfit.ts';
import { PhotoReview } from './agents/photo-review.ts';

// 密钥来自 server/config.ts（GLM_API_KEY env > ~/.pi/agent/models.json 的 opencode-luna apiKey）。
// 内联 ApiKeyAuth 直接解析，不写回任何配置文件。

// DeepSeek 两个模型：deepseek-v4-flash（文本）/ deepseek-v4-flash-vision-exp（视觉）。
// 都是 reasoning 模型 —— compat.thinkingFormat 用 "deepseek"（reasoning_content 流）。
const baseModel = {
  api: 'openai-completions' as const,
  provider: 'opencode-luna' as const,
  baseUrl: LLM_BASE_URL,
  reasoning: false, // DeepSeek：关 thinking 提速（thinkingFormat deepseek → 发 thinking:{type:disabled}）
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    maxTokensField: 'max_tokens',
    thinkingFormat: 'deepseek' as const,
  },
  contextWindow: 1_048_576,
  maxTokens: 16384,
};

setProvider(createProvider({
  id: 'opencode-luna',
  name: 'OpenCode Luna (DeepSeek)',
  baseUrl: LLM_BASE_URL,
  auth: {
    apiKey: {
      name: 'OpenCode Luna API key',
      resolve: async () =>
        LLM_API_KEY ? { auth: { apiKey: LLM_API_KEY }, source: 'opencode-luna (~/.pi/agent/models.json)' } : undefined,
    },
  },
  models: [
    { ...baseModel, id: config.models.text, name: 'DeepSeek V4 Flash', input: ['text'] },
    { ...baseModel, id: config.models.vision, name: 'DeepSeek V4 Flash Vision', input: ['text', 'image'] },
  ],
  api: openAICompletionsApi(),
}));

const app = new Hono();
app.get('/health', (c) => c.json({ ok: true, provider: 'opencode-luna', models: [config.models.text, config.models.vision] }));
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
