import type { ChatEvent } from '../../../shared/types';

interface FluePart {
  type: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

interface FlueMessage {
  id: string;
  role: string;
  parts: FluePart[];
}

interface FlueSnapshot {
  messages: FlueMessage[];
  settlements: { submissionId: string; outcome: string; error?: unknown }[];
}

const DEVICE_KEY = 'stylist-agent:flue-device-id';

function deviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const id = `device-${crypto.randomUUID()}`;
  localStorage.setItem(DEVICE_KEY, id);
  return id;
}

function decodeDataUrl(url: string): { data: string; mimeType: string } {
  const match = url.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) throw new Error('图片格式无效');
  return { mimeType: match[1]!, data: match[2]! };
}

function summarize(output: unknown): string {
  if (output && typeof output === 'object') {
    const value = output as Record<string, unknown>;
    if (value.error) return String(value.error);
    if (Array.isArray(value.items)) return `${value.items.length} 条`;
    if (Array.isArray(value.shots)) return `${value.shots.length} 个分镜`;
    if (value.narrative) return '已生成穿搭';
  }
  return '完成';
}

/**
 * Flue conversation adapter。Flue 的 POST 只负责 admission，回复从 history
 * snapshot 中读取；这里把其 render-ready parts 映射成现有 ChatEvent，避免
 * ChatPage 依赖 Flue 内部协议。
 */
export async function streamChat(
  body: { message: string; imageDataUrls?: string[]; history?: { role: 'user' | 'assistant'; content: string }[] },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const url = `/agents/stylist/${encodeURIComponent(deviceId())}`;
  const attachments = (body.imageDataUrls ?? []).slice(0, 3).map(decodeDataUrl).map((image) => ({ type: 'image' as const, ...image }));
  const admitted = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'user',
      body: body.message,
      ...(attachments.length ? { attachments } : {}),
    }),
    signal,
  });
  if (!admitted.ok) throw new Error(`Flue HTTP ${admitted.status}`);
  const { submissionId } = (await admitted.json()) as { submissionId: string };

  const emittedText = new Map<string, number>();
  const emittedTools = new Set<string>();
  for (;;) {
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    if (!response.ok) throw new Error(`Flue history HTTP ${response.status}`);
    const snapshot = (await response.json()) as FlueSnapshot;

    for (const message of snapshot.messages) {
      if (message.role !== 'assistant') continue;
      for (const part of message.parts) {
        if (part.type === 'text' && part.text) {
          const previous = emittedText.get(message.id) ?? 0;
          if (part.text.length > previous) {
            onEvent({ type: 'message', delta: part.text.slice(previous) });
            emittedText.set(message.id, part.text.length);
          }
        } else if (part.type === 'dynamic-tool' && part.toolCallId && part.toolName) {
          const key = `${part.toolCallId}:${part.state}`;
          if (part.state === 'input-available' && !emittedTools.has(key)) {
            emittedTools.add(key);
            onEvent({ type: 'tool-call', id: part.toolCallId, name: part.toolName, args: part.input });
          }
          if (part.state === 'output-available' && !emittedTools.has(key)) {
            emittedTools.add(key);
            onEvent({ type: 'tool-result', id: part.toolCallId, name: part.toolName, ok: true, summary: summarize(part.output), payload: part.output });
          }
          if (part.state === 'output-error' && !emittedTools.has(key)) {
            emittedTools.add(key);
            onEvent({ type: 'tool-result', id: part.toolCallId, name: part.toolName, ok: false, summary: part.errorText ?? '工具执行失败' });
          }
        }
      }
    }

    const settlement = snapshot.settlements.find((item) => item.submissionId === submissionId);
    if (settlement) {
      if (settlement.outcome !== 'completed') onEvent({ type: 'error', message: `Agent ${settlement.outcome}` });
      onEvent({ type: 'done' });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}
