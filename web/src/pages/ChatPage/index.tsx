/**
 * 对话页 —— @ant-design/x v2：BubbleList + Sender。
 *
 * 学习点：AI 应用的「工具卡片」模式 —— SSE 的 tool-result 事件带结构化 payload，
 * 不渲染成气泡文本而是渲染成复用的业务卡片（穿搭卡/计划卡），
 * 这是 ChatGPT Plugins / Cursor / 各种 Copilot 的通用交互范式。
 */
import { useRef, useState } from 'react';
import { Bubble, Sender } from '@ant-design/x';
import { Card, Tag, App as AntApp, Image, Typography } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import type { ChatEvent, Ootd, PhotoPlan } from '../../types';
import { streamChat } from '../../api/chatStream';
import { fileToDataUrl } from '../../api';
import OutfitCard from '../../components/OutfitCard';

interface Msg {
  key: string;
  role: 'user' | 'ai' | 'tool';
  content: string;
}

let keySeq = 0;
const nextKey = () => `m${++keySeq}`;

const SUGGESTIONS = ['今天穿什么？', '明天约会，帮我配一套', '周末想去安福路街拍，做个拍照计划', '我的衣橱还缺什么？'];

/** 工具事件卡片：按 payload 类型渲染结构化 UI */
function ToolEventCard({ raw }: { raw: string }) {
  let ev: { kind: 'call' | 'result'; name: string; summary?: string; ok?: boolean; payload?: unknown };
  try {
    ev = JSON.parse(raw);
  } catch {
    return null;
  }
  if (ev.kind === 'call') {
    return (
      <div style={{ fontSize: 12, color: '#999', padding: '2px 8px' }}>
        🔧 正在调用 <b>{ev.name}</b> …
      </div>
    );
  }
  const p = ev.payload as (Ootd & PhotoPlan & Record<string, unknown>) | undefined;
  const isOotd = !!p && typeof p === 'object' && 'narrative' in p && 'makeup' in p;
  const isPlan = !!p && typeof p === 'object' && 'shots' in p && 'timeWindows' in p;
  return (
    <div style={{ padding: '4px 0' }}>
      <Tag color={ev.ok ? 'green' : 'red'} style={{ marginBottom: isOotd || isPlan ? 8 : 0 }}>
        {ev.ok ? '✓' : '✗'} {ev.name}：{ev.summary}
      </Tag>
      {isOotd && <OutfitCard ootd={p as Ootd} />}
      {isPlan && <PlanMiniCard plan={p as PhotoPlan} />}
    </div>
  );
}

function PlanMiniCard({ plan }: { plan: PhotoPlan }) {
  return (
    <Card size="small" title={`📸 ${plan.theme}`} extra={<Tag color="pink">{plan.location.sceneType}</Tag>}>
      <div style={{ fontSize: 12, color: '#666' }}>
        {plan.date} · {plan.location.name} · {plan.shots.length} 个分镜
      </div>
      <div style={{ marginTop: 6 }}>
        {plan.timeWindows.slice(0, 2).map((w) => (
          <Tag key={w.type} color={w.type === '黄金时刻' ? 'gold' : 'default'}>
            {w.type} {w.start}-{w.end}
          </Tag>
        ))}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        详情去「拍照」页查看
      </Typography.Text>
    </Card>
  );
}

const BubbleList = Bubble.List;

export default function ChatPage() {
  const { message } = AntApp.useApp();
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      key: 'hello',
      role: 'ai',
      content:
        '我是小镜，你的女团风造型师 👋\n可以问我「今天穿什么」，也可以让我安排周末的拍照计划。回答基于你的真实衣橱，绝不瞎编。',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [attached, setAttached] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const append = (m: Omit<Msg, 'key'>) => {
    const k = nextKey();
    setMsgs((ms) => [...ms, { ...m, key: k }]);
    return k;
  };
  const patch = (k: string, content: string, init?: boolean) =>
    setMsgs((ms) => ms.map((x) => (x.key === k ? { ...x, content: init ? content : x.content + content } : x)));

  const pickFiles = async (files: FileList | null) => {
    if (!files) return;
    const urls: string[] = [];
    for (const f of Array.from(files).slice(0, 3)) urls.push(await fileToDataUrl(f));
    setAttached((a) => [...a, ...urls].slice(0, 3));
  };

  const send = (text: string) => {
    if (!text.trim() || loading) return;
    append({ role: 'user', content: attached.length ? `${text}\n[图片 x${attached.length}]` : text });
    const aiKey = nextKey();
    setMsgs((ms) => [...ms, { key: aiKey, role: 'ai', content: '' }]);
    setLoading(true);
    setInput('');
    const images = attached;
    setAttached([]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    streamChat(
      { message: text, imageDataUrls: images.length ? images : undefined },
      (ev: ChatEvent) => {
        if (ev.type === 'message') {
          patch(aiKey, ev.delta ?? '');
        } else if (ev.type === 'tool-call') {
          append({ role: 'tool', content: JSON.stringify({ kind: 'call', name: ev.name }) });
        } else if (ev.type === 'tool-result') {
          append({
            role: 'tool',
            content: JSON.stringify({ kind: 'result', name: ev.name, ok: ev.ok, summary: ev.summary, payload: ev.payload }),
          });
        } else if (ev.type === 'done') {
          setMsgs((ms) => ms.map((x) => (x.key === aiKey && !x.content ? { ...x, content: '（小镜没有多说，看看上面的卡片吧）' } : x)));
        } else if (ev.type === 'error') {
          patch(aiKey, `\n⚠️ ${ev.message}`);
        }
      },
      ctrl.signal,
    )
      .catch((err: Error) => {
        patch(aiKey, `\n⚠️ ${err.message}`);
        message.error(err.message);
      })
      .finally(() => {
        setLoading(false);
        abortRef.current = null;
      });
  };

  // 用户气泡带图片预览
  const renderUserContent = (c: string, imgs: string[]) => (
    <div>
      {imgs.length > 0 && (
        <Image.PreviewGroup>
          <div style={{ display: 'flex', gap: 6, marginBottom: imgs.length && c ? 6 : 0 }}>
            {imgs.map((u) => (
              <Image key={u} src={u} width={64} height={64} style={{ objectFit: 'cover', borderRadius: 8 }} />
            ))}
          </div>
        </Image.PreviewGroup>
      )}
      {c && <span style={{ whiteSpace: 'pre-wrap' }}>{c.replace(/\n\[图片 x\d+\]$/, '')}</span>}
    </div>
  );

  return (
    <div className="chat-root">
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />
      <div className="chat-scroll">
        <BubbleList
          autoScroll
          style={{ padding: '16px 12px', minHeight: '100%' }}
          role={{
            user: { placement: 'end', variant: 'filled', shape: 'corner' },
            ai: { placement: 'start', variant: 'outlined', shape: 'corner' },
            tool: { contentRender: (c) => <ToolEventCard raw={String(c)} /> },
          }}
          items={msgs.map((m) =>
            m.role === 'tool'
              ? { key: m.key, role: 'tool', content: m.content }
              : {
                  key: m.key,
                  role: m.role,
                  content: m.content,
                  contentRender: m.role === 'user' ? (c) => renderUserContent(String(c), attached) : (c) => <span style={{ whiteSpace: 'pre-wrap' }}>{String(c)}</span>,
                },
          )}
        />
      </div>
      {msgs.length <= 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 16px 8px' }}>
          {SUGGESTIONS.map((s) => (
            <span key={s} className="chip rise" onClick={() => send(s)}>
              {s}
            </span>
          ))}
        </div>
      )}
      {attached.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: '0 16px 8px' }}>
          {attached.map((u) => (
            <div key={u} style={{ position: 'relative' }}>
              <img src={u} width={48} height={48} style={{ objectFit: 'cover', borderRadius: 8 }} />
              <a
                onClick={() => setAttached((a) => a.filter((x) => x !== u))}
                style={{ position: 'absolute', top: -6, right: -6, background: '#999', color: '#fff', borderRadius: 9, width: 18, height: 18, textAlign: 'center', lineHeight: '18px', fontSize: 11 }}
              >
                ×
              </a>
            </div>
          ))}
        </div>
      )}
      <div className="chat-sender">
        <Sender
          value={input}
          onChange={setInput}
          onSubmit={send}
          loading={loading}
          onCancel={() => abortRef.current?.abort()}
          placeholder="问小镜…（Enter 发送）"
          prefix={
            <PaperClipOutlined onClick={() => fileRef.current?.click()} style={{ color: '#999', fontSize: 16, padding: 4 }} />
          }
        />
      </div>
    </div>
  );
}
