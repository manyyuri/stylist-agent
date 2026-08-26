/**
 * DashScope LLM 客户端 —— 走 OpenAI 兼容模式（openai SDK + baseURL 指向百炼）。
 *
 * 两个学习点：
 * 1. OpenAI 兼容层是国内大模型的事实标准，换模型只改 baseURL + model；
 * 2. chatJSON<T>()：response_format json_object + zod 校验 + 失败重试 1 次，
 *    把「概率模型的自由文本」收敛成「类型安全的结构化数据」。
 */
import OpenAI from 'openai';
import type { ZodType } from 'zod';
import { config, DASHSCOPE_API_KEY, DASHSCOPE_BASE_URL } from './config.ts';

export const textClient = DASHSCOPE_API_KEY
  ? new OpenAI({ apiKey: DASHSCOPE_API_KEY, baseURL: DASHSCOPE_BASE_URL, timeout: 60_000 })
  : null;

export const visionClient = DASHSCOPE_API_KEY
  ? new OpenAI({ apiKey: DASHSCOPE_API_KEY, baseURL: DASHSCOPE_BASE_URL, timeout: 90_000 })
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
  if (!textClient) throw new Error('DASHSCOPE_API_KEY 未配置');
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
