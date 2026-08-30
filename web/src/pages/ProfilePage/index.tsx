/** 档案页：Descriptions + 锚点多选卡（palette 可视化 + 排序=优先级）+ 自拍分析 + 手动修正 */
import { useEffect, useState } from 'react';
import {
  Card, Descriptions, Button, Modal, Form, InputNumber, Select, Checkbox, App,
  Space, Tag, Alert, Spin, Empty, Flex, Rate,
} from 'antd';
import { CameraOutlined, ArrowUpOutlined } from '@ant-design/icons';
import type { AnchorCard, MonthlyReport, Profile } from '../../types';
import { request, upload } from '../../api';
import { img, useUiStore } from '../../stores';

const BODY_TYPES = ['梨形', '苹果形', '沙漏形', '直筒形', '倒三角'];
const SKIN_TONES = ['冷白', '冷调自然', '暖白', '暖调自然', '小麦色'];
const FACE_SHAPES = ['鹅蛋', '圆脸', '方脸', '长脸', '心形'];
const EYE_SHAPES = ['杏眼', '丹凤眼', '圆眼', '下垂眼', '肿眼泡', '内双', '外双'];
const CONCERNS = ['显腿长', '遮胯', '显脸小', '显白', '遮手臂', '不想太隆重', '通勤得体', '拍照出片'];

export default function ProfilePage() {
  const { message } = App.useApp();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [anchors, setAnchors] = useState<AnchorCard[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [faceDraft, setFaceDraft] = useState<Record<string, string> | null>(null);
  const [monthly, setMonthly] = useState<MonthlyReport | null>(null);
  const version = useUiStore((s) => s.version);
  const bump = useUiStore((s) => s.bump);
  const [form] = Form.useForm();

  useEffect(() => {
    request<Profile>('/api/profile').then(setProfile).catch(() => {});
    request<AnchorCard[]>('/api/anchors').then(setAnchors).catch(() => {});
    request<MonthlyReport>('/api/review/monthly').then(setMonthly).catch(() => {});
  }, [version]);

  const toggleAnchor = async (id: string) => {
    if (!profile) return;
    const cur = profile.anchors;
    const next = cur.includes(id) ? cur.filter((a) => a !== id) : [...cur, id];
    if (next.length === 0) { message.warning('至少保留一个风格锚点'); return; }
    try {
      await request('/api/profile', { method: 'PUT', body: JSON.stringify({ ...profile, anchors: next }) });
      setProfile({ ...profile, anchors: next });
      bump();
    } catch (e) { message.error((e as Error).message); }
  };

  const moveUp = async (id: string) => {
    if (!profile) return;
    const arr = [...profile.anchors];
    const i = arr.indexOf(id);
    if (i <= 0) return;
    [arr[i - 1], arr[i]] = [arr[i]!, arr[i - 1]!];
    try {
      await request('/api/profile', { method: 'PUT', body: JSON.stringify({ ...profile, anchors: arr }) });
      setProfile({ ...profile, anchors: arr });
      bump();
    } catch (e) { message.error((e as Error).message); }
  };

  const analyzeSelfie = async (f: File | undefined) => {
    if (!f) return;
    setSelfieOpen(true);
    setAnalyzing(true);
    setFaceDraft(null);
    try {
      const r = await upload<{ draft: Record<string, string>; photo: string }>('/api/profile/face', [f]);
      setFaceDraft(r.draft);
      message.info('这是小PD的建议，确认无误后点「采纳」写入档案');
    } catch (e) {
      message.error((e as Error).message);
      setSelfieOpen(false);
    } finally {
      setAnalyzing(false);
    }
  };

  const adopt = async () => {
    if (!profile || !faceDraft) return;
    const b = { ...profile.basics };
    if (faceDraft.faceShape && faceDraft.faceShape !== '?') b.faceShape = faceDraft.faceShape as never;
    if (faceDraft.eyeShape && faceDraft.eyeShape !== '?') b.eyeShape = faceDraft.eyeShape as never;
    if (faceDraft.skinTone && faceDraft.skinTone !== '?') b.skinTone = faceDraft.skinTone as never;
    if (faceDraft.colorSeason && faceDraft.colorSeason !== '?') b.colorSeason = faceDraft.colorSeason as never;
    try {
      await request('/api/profile', { method: 'PUT', body: JSON.stringify({ ...profile, basics: b }) });
      setProfile({ ...profile, basics: b });
      setSelfieOpen(false);
      message.success('档案已更新，推荐会跟着变准 ✨');
      bump();
    } catch (e) { message.error((e as Error).message); }
  };

  const saveEdit = async (v: Partial<Profile> & { basics: Profile['basics'] }) => {
    if (!profile) return;
    try {
      const merged = { ...profile, ...v, anchors: v.anchors ?? profile.anchors };
      await request('/api/profile', { method: 'PUT', body: JSON.stringify(merged) });
      setProfile(merged);
      setEditOpen(false);
      message.success('已保存');
      bump();
    } catch (e) { message.error((e as Error).message); }
  };

  /** 采纳锚点漂移建议：把「数据更好的锚点」提为新的主攻（写入档案后 version 自增重取） */
  const adoptDrift = async () => {
    if (!profile || !monthly?.drift) return;
    const { to } = monthly.drift;
    const arr = profile.anchors.filter((a) => a !== to);
    arr.unshift(to);
    try {
      await request('/api/profile', { method: 'PUT', body: JSON.stringify({ ...profile, anchors: arr }) });
      setProfile({ ...profile, anchors: arr });
      bump();
      message.success(`主攻风格已换成「${monthly.drift.toName}」✨`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  if (!profile) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;
  const b = profile.basics;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 小PD · 月度复盘：自我认知层学习 —— 锚点漂移建议，确认才写入 */}
      <Card
        size="small"
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="eyebrow eyebrow-rose">MONTHLY REVIEW</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>小PD · 月度复盘</span>
          </span>
        }
        extra={
          monthly ? (
            <span className="pchip">{monthly.source === 'llm' ? '导演复盘' : '规则复盘'}</span>
          ) : undefined
        }
      >
        {!monthly ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <Spin size="small" />
            <p style={{ marginTop: 8, color: '#999', fontSize: 12 }}>小PD 正在翻这个月的通告单…</p>
          </div>
        ) : monthly.days === 0 ? (
          <div style={{ fontSize: 13, color: '#6F6678', lineHeight: 1.8 }}>
            这个月还没有通告记录。每天来「通告」页盖个「出演确定」，月底小PD 就能给你写导演复盘。
          </div>
        ) : (
          <>
            <p className="narrative" style={{ marginBottom: 10 }}>{monthly.narrative}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <span className="pchip">通告 {monthly.days} 天</span>
              <span className="pchip pchip-rose">就穿这套 {monthly.feedback.liked}</span>
              <span className="pchip">还行 {monthly.feedback.meh}</span>
              <span className="pchip pchip-gold">SCORE {monthly.avgScore}</span>
            </div>
            {monthly.topItems.length > 0 && (
              <div style={{ fontSize: 12, color: '#6F6678', marginBottom: 8 }}>
                本月最出片：{monthly.topItems.map((t) => `${t.subType}（${t.colorName}）`).join(' · ')}
              </div>
            )}
            {monthly.drift && (
              <Alert
                type="warning"
                showIcon
                message={`主攻风格建议换成「${monthly.drift.toName}」`}
                description={monthly.drift.reason}
                action={
                  <Button size="small" type="primary" icon={<ArrowUpOutlined />} onClick={adoptDrift}>
                    采纳建议
                  </Button>
                }
              />
            )}
          </>
        )}
      </Card>

      <Card
        size="small"
        title="形象档案"
        extra={
          <Space>
            <Button size="small" icon={<CameraOutlined />} onClick={() => document.getElementById('selfie-input')?.click()}>
              自拍分析
            </Button>
            <Button size="small" onClick={() => { form.setFieldsValue(profile); setEditOpen(true); }}>
              编辑
            </Button>
          </Space>
        }
      >
        <input id="selfie-input" type="file" accept="image/*" capture="user" hidden onChange={(e) => { analyzeSelfie(e.target.files?.[0]); e.target.value = ''; }} />
        <Descriptions column={2} size="small">
          <Descriptions.Item label="身高">{b.height}cm</Descriptions.Item>
          <Descriptions.Item label="体型">{b.bodyType}</Descriptions.Item>
          <Descriptions.Item label="肤色">{b.skinTone}</Descriptions.Item>
          <Descriptions.Item label="季型">{b.colorSeason ?? '未诊断'}</Descriptions.Item>
          <Descriptions.Item label="脸型">{b.faceShape ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="眼型">{b.eyeShape ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="诉求" span={2}>
            <Flex gap={4} wrap>{b.concerns.map((c) => <Tag key={c} color="pink">{c}</Tag>)}</Flex>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 风格锚点：palette 全出血顶边 = 该团的整体色彩信号 */}
      <Card size="small" title="风格锚点（排序 = 优先级，点卡片选择）" styles={{ body: { padding: 10 } }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {anchors.map((a) => {
            const idx = profile.anchors.indexOf(a.id);
            const active = idx >= 0;
            return (
              <Card
                key={a.id}
                size="small"
                hoverable
                style={{
                  border: active ? '2px solid #D6486F' : '1px solid #EDE5E0',
                  cursor: 'pointer',
                  overflow: 'hidden',
                }}
                styles={{ body: { padding: 10 } }}
                onClick={() => toggleAnchor(a.id)}
                title={
                  <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="eyebrow eyebrow-rose">ANCHOR</span>
                    <span style={{ fontWeight: 600 }}>{a.name}</span>
                  </span>
                }
                extra={
                  active ? (
                    <Space size={4}>
                      <Tag color="magenta" style={{ margin: 0 }}>#{idx + 1}</Tag>
                      <ArrowUpOutlined onClick={(e) => { e.stopPropagation(); moveUp(a.id); }} style={{ color: '#D6486F' }} />
                    </Space>
                  ) : null
                }
              >
                {/* palette 顶边色条：该团应援色 */}
                <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                  {a.palette.map((hex) => (
                    <div key={hex} style={{ flex: 1, background: hex }} title={hex} />
                  ))}
                </div>
                <div style={{ fontSize: 11, color: '#6F6678', lineHeight: 1.6 }}>{a.vibe}</div>
                <div style={{ fontSize: 11, color: '#B4A9B8', marginTop: 4 }}>{a.styleTags.slice(0, 3).join(' · ')}</div>
              </Card>
            );
          })}
        </div>
      </Card>

      {/* 自拍分析向导 */}
      <Modal
        title="自拍分析（仅建议，确认后写入）"
        open={selfieOpen}
        footer={null}
        onCancel={() => setSelfieOpen(false)}
        destroyOnHidden
      >
        {analyzing ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" />
            <p style={{ marginTop: 16, color: '#999' }}>分析脸型 / 眼型 / 肤色冷暖中…</p>
          </div>
        ) : faceDraft ? (
          <>
            <Alert type="info" message={faceDraft.reason || '视觉模型分析结果如下，可全部或部分采纳'} style={{ marginBottom: 12 }} showIcon />
            <Descriptions column={1} size="small" bordered>
              {(['faceShape', 'eyeShape', 'skinTone', 'colorSeason'] as const).map((k) => (
                <Descriptions.Item key={k} label={{ faceShape: '脸型', eyeShape: '眼型', skinTone: '肤色', colorSeason: '季型' }[k]}>
                  {faceDraft[k] === '?' ? <Tag>低置信，请手动选择</Tag> : <Tag color="pink">{faceDraft[k]}</Tag>}
                </Descriptions.Item>
              ))}
            </Descriptions>
            <Space style={{ marginTop: 16, justifyContent: 'flex-end', width: '100%' }}>
              <Button onClick={() => setSelfieOpen(false)}>不采纳</Button>
              <Button type="primary" onClick={adopt}>采纳写入档案</Button>
            </Space>
          </>
        ) : <Empty description="重新拍摄一张" />}
      </Modal>

      {/* 手动编辑 */}
      <Modal
        title="编辑档案"
        open={editOpen}
        footer={null}
        onCancel={() => setEditOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={saveEdit}>
          <Form.Item name={['basics', 'height']} label="身高 (cm)" rules={[{ required: true }]}>
            <InputNumber min={130} max={210} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name={['basics', 'bodyType']} label="体型">
            <Select options={BODY_TYPES.map((v) => ({ value: v }))} />
          </Form.Item>
          <Form.Item name={['basics', 'skinTone']} label="肤色">
            <Select options={SKIN_TONES.map((v) => ({ value: v }))} />
          </Form.Item>
          <Form.Item name={['basics', 'faceShape']} label="脸型">
            <Select allowClear options={FACE_SHAPES.map((v) => ({ value: v }))} />
          </Form.Item>
          <Form.Item name={['basics', 'eyeShape']} label="眼型">
            <Select allowClear options={EYE_SHAPES.map((v) => ({ value: v }))} />
          </Form.Item>
          <Form.Item name={['basics', 'colorSeason']} label="色彩季型">
            <Select allowClear options={['春', '夏', '秋', '冬'].map((v) => ({ value: v }))} />
          </Form.Item>
          <Form.Item name={['basics', 'concerns']} label="穿搭诉求">
            <Checkbox.Group options={CONCERNS} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block className="touchable">保存</Button>
        </Form>
      </Modal>
    </div>
  );
}
