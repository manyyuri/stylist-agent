/**
 * SSE 消费 —— fetch + ReadableStream（POST 流式，EventSource 只支持 GET 所以不用它）。
 * 与 OpenAI SDK 内部同款模式：逐行解析 `data: {...}\n\n`。
 */
import type { ChatEvent } from '../../../shared/types';

export async function streamChat(
  body: { message: string; imageDataUrls?: string[]; history?: { role: 'user' | 'assistant'; content: string }[] },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as ChatEvent);
      } catch { /* 忽略残包 */ }
    }
  }
}
