/**
 * 智谱 GLM LLM 客户端 —— 走 OpenAI 兼容模式。
 *
 * GLM-5.3-Flash 同时承担文本和视觉请求；具体模型名由 config.json 控制。
 * chatJSON<T>() 通过 JSON mode + zod 校验 + 失败重试，把概率模型的自由文本
 * 收敛成类型安全的结构化数据。
 */
import OpenAI from 'openai';
import type { ZodType } from 'zod';
import { config, GLM_API_KEY, GLM_BASE_URL } from './config.ts';

export const textClient = GLM_API_KEY
  ? new OpenAI({ apiKey: GLM_API_KEY, baseURL: GLM_BASE_URL, timeout: 60_000 })
  : null;

// GLM-5.3-Flash 支持多模态输入，文本和视觉共用 provider/key，超时略长。
export const visionClient = GLM_API_KEY
  ? new OpenAI({ apiKey: GLM_API_KEY, baseURL: GLM_BASE_URL, timeout: 90_000 })
  : null;

export function llmAvailable(): boolean {
  return textClient !== null;
}

/** 从 LLM 回复里稳健地抠出 JSON（容忍 ```json 围栏、前后废话） */
export function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1]! : text;
  const start = Math.min(...['{', '['].map((c) => { const i = raw.indexOf(c); return i === -1 ? Infinity : i; }));
  if (!isFinite(start)) throw new Error('回复中无 JSON');
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  return JSON.parse(raw.slice(start, end + 1));
}

/** 结构化输出：json mode + zod 校验 + 重试 1 次 */
export async function chatJSON<T>(opts: {
  schema: ZodType<T>;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  model?: string;
  maxTokens?: number;
}): Promise<T> {
  if (!textClient) throw new Error('GLM_API_KEY 未配置');
  const model = opts.model ?? config.models.text;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await textClient.chat.completions.create({
      model,
      messages: opts.messages,
      response_format: { type: 'json_object' },
      max_tokens: opts.maxTokens ?? 2048,
      temperature: 0.7,
    });
    const text = res.choices[0]?.message?.content ?? '';
    try {
      const parsed = opts.schema.safeParse(extractJSON(text));
      if (parsed.success) return parsed.data;
      lastErr = new Error(`schema 校验失败: ${parsed.error.message.slice(0, 300)}`);
    } catch (e) {
      lastErr = e;
    }
    // 重试时把错误喂回去，让模型自我纠正
    if (attempt === 0) {
      opts.messages.push({ role: 'assistant', content: text }, {
        role: 'user',
        content: `你的输出未通过 schema 校验：${String(lastErr)}。请严格只输出合法 JSON，不要任何解释。`,
      });
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
