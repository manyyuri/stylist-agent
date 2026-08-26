/**
 * 对话 SSE —— POST /api/chat（text/event-stream）。
 *
 * 注意：浏览器原生 EventSource 只支持 GET，这里用 fetch + ReadableStream
 * 消费 POST 流（与 OpenAI API 同款模式），前端 api/chatStream.ts 实现。
 */
import { Router, type Request, type Response } from 'express';
import { runAgent } from '../agent.ts';
import type { ChatEvent } from '../../shared/types.ts';

export const chatRouter = Router();

chatRouter.post('/', (req: Request, res: Response) => {
  const { message, imageDataUrls, history } = (req.body ?? {}) as {
    message?: string;
    imageDataUrls?: string[];
    history?: { role: 'user' | 'assistant'; content: string }[];
  };
  if (!message?.trim()) {
    res.status(400).json({ error: 'message 不能为空' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (e: ChatEvent) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  // 客户端断开时中断
  req.on('close', () => { /* Agent 循环自然结束，无需强杀 */ });

  runAgent({ message, imageDataUrls, history }, send)
    .catch((e) => send({ type: 'error', message: (e as Error).message }))
    .finally(() => res.end());
});
