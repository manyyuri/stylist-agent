/**
 * Agent 循环 —— LLM 的「大脑」，工具是它的「手脚」。
 *
 * 这是本项目最核心的 AI 工程模式（OpenAI Assistants / 各种 Agent 框架的本质）：
 *
 *   while (回合数 < 上限):
 *     流式调用 LLM（带 tools 定义）
 *       ├─ 收到文本 delta  → SSE 推给前端（打字机效果）
 *       └─ 收到 tool_calls → 执行真实工具 → 结果作为 tool 角色消息回灌
 *                           → 下一回合 LLM 基于事实继续回答
 *
 * 前端拿到的不只是气泡文本：tool-result 事件携带结构化 payload，
 * 直接渲染成穿搭卡/计划卡（AI 应用的「工具卡片」模式）。
 */
import type OpenAI from 'openai';
import type { ChatEvent } from '../shared/types.ts';
import { textClient, llmAvailable } from './llm.ts';
import { config } from './config.ts';
import { findTool, toOpenAITools } from './tools.ts';
import { XIAOJING_SYSTEM } from './prompts.ts';
import { getProfile, wardrobeItems } from './ootd.ts';
import { extractItems } from './vision.ts';
import { today } from './weather.ts';

const MAX_TURNS = 8;

type Emit = (e: ChatEvent) => void;

export interface AgentInput {
  message: string;
  /** 聊天中附图（触发视觉识别，结果注入上下文） */
  imageDataUrls?: string[];
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export async function runAgent(input: AgentInput, emit: Emit): Promise<void> {
  if (!llmAvailable()) {
    emit({ type: 'error', message: '造型师离线（未配置 DASHSCOPE_API_KEY），今日推荐仍可用——去「今日」页看规则引擎推荐' });
    emit({ type: 'done' });
    return;
  }

  // ---- 组装上下文：档案/衣橱概况/日期（让模型零工具调用也有事实依据）----
  const profile = getProfile();
  const items = wardrobeItems();
  const context = [
    `当前日期：${today()}（${new Date().toLocaleDateString('zh-CN', { weekday: 'long' })}）`,
    `用户档案：${JSON.stringify(profile)}`,
    `衣橱概况：共 ${items.length} 件。${items.length ? `类别分布 ${JSON.stringify(countByCategory(items))}。查询细节请用 query_wardrobe 工具。` : '衣橱为空，建议用户先去「衣橱」页拍照入库。'}`,
  ].join('\n');

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: `${XIAOJING_SYSTEM}\n\n[运行时上下文]\n${context}` },
    ...(input.history ?? []),
  ];

  let userContent = input.message;
  if (input.imageDataUrls?.length) {
    emit({ type: 'tool-call', id: 'vision-pre', name: '视觉识别', args: { images: input.imageDataUrls.length } });
    try {
      const drafts: unknown[] = [];
      for (const url of input.imageDataUrls.slice(0, 3)) drafts.push(await extractItems(url));
      userContent += `\n\n[用户附图的视觉识别结果（草稿，非入库数据）]\n${JSON.stringify(drafts, null, 2)}`;
      emit({ type: 'tool-result', id: 'vision-pre', name: '视觉识别', ok: true, summary: '附图识别完成' });
    } catch (e) {
      emit({ type: 'tool-result', id: 'vision-pre', name: '视觉识别', ok: false, summary: `识别失败：${(e as Error).message}` });
    }
  }
  messages.push({ role: 'user', content: userContent });

  // ---- 主循环 ----
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = await textClient!.chat.completions.create({
        model: config.models.text,
        messages,
        tools: toOpenAITools(),
        stream: true,
        max_tokens: 4096,
      });

      let content = '';
      const toolAcc = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          emit({ type: 'message', delta: delta.content });
        }
        for (const tc of delta.tool_calls ?? []) {
          const acc = toolAcc.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
          toolAcc.set(tc.index, acc);
        }
      }

      const calls = [...toolAcc.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
      if (calls.length === 0) break; // 纯文本回答，结束

      // 本回合 assistant 消息（含 tool_calls）入史
      messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args } })),
      });

      for (const call of calls) {
        const tool = findTool(call.name);
        emit({ type: 'tool-call', id: call.id, name: call.name, args: safeJson(call.args) });
        if (!tool) {
          const msg = `未知工具 ${call.name}`;
          emit({ type: 'tool-result', id: call.id, name: call.name, ok: false, summary: msg });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: msg }) });
          continue;
        }
        try {
          const args = tool.schema.safeParse(safeJson(call.args));
          if (!args.success) throw new Error(`参数校验失败: ${args.error.message.slice(0, 200)}`);
          const result = await tool.handler(args.data as never, { emit });
          const summary = summarize(result);
          emit({ type: 'tool-result', id: call.id, name: call.name, ok: true, summary, payload: compact(result) });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(compact(result)) });
        } catch (e) {
          const msg = (e as Error).message;
          emit({ type: 'tool-result', id: call.id, name: call.name, ok: false, summary: msg });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: msg }) });
        }
      }
      // 继续下一回合：LLM 拿到工具结果继续生成
    }
  } catch (e) {
    emit({ type: 'error', message: `造型师开小差了：${(e as Error).message}` });
  } finally {
    emit({ type: 'done' });
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

function countByCategory(items: { category: string }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const i of items) m[i.category] = (m[i.category] ?? 0) + 1;
  return m;
}

/** 给 SSE 事件用的结果摘要 */
function summarize(r: unknown): string {
  if (r === null || r === undefined) return '完成';
  if (Array.isArray(r)) return `${r.length} 条结果`;
  if (typeof r === 'object') {
    const o = r as Record<string, unknown>;
    if (o.error) return String(o.error).slice(0, 80);
    if ('items' in o && Array.isArray(o.items)) return `${o.items.length} 条`;
    if ('narrative' in o) return '已生成穿搭';
    if ('shots' in o && Array.isArray(o.shots)) return `${(o.shots as unknown[]).length} 个分镜`;
  }
  return '完成';
}

/** 回灌给 LLM 的结果压缩（防超 token） */
function compact(r: unknown): unknown {
  const s = JSON.stringify(r);
  if (s.length <= 6000) return r;
  return { truncated: true, preview: s.slice(0, 3000) };
}
