/** 拍照页：计划列表 + 创建（LLM 分镜）+ 详情（时间窗/分镜/checklist）+ 上传复盘 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, List, Tag, Modal, Form, Input, Select, DatePicker, App, Empty, Space,
  Timeline, Checkbox, Upload, Carousel, Image, Alert, Spin, Flex, Typography,
} from 'antd';
import { PlusOutlined, CameraOutlined, ReloadOutlined, LeftOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { PhotoPlan, PhotoReview } from '../../types';
import { request, upload } from '../../api';
import { img, useUiStore } from '../../stores';

const SCENES: PhotoPlan['location']['sceneType'][] = ['街拍', '咖啡店', '公园', '天台', '夜景'];
const VERDICT: Record<string, { color: string; label: string }> = {
  keep: { color: 'green', label: '精选' },
  ok: { color: 'blue', label: '可用' },
  drop: { color: 'default', label: '废片' },
};

export default function PhotoPage() {
  const { message } = App.useApp();
  const [plans, setPlans] = useState<PhotoPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const version = useUiStore((s) => s.version);
  const bump = useUiStore((s) => s.bump);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlans(await request<PhotoPlan[]>('/api/plans'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => { load(); }, [load, version]);

  const create = async (v: { theme: string; date: Dayjs; location: string; sceneType: PhotoPlan['location']['sceneType'] }) => {
    setCreating(true);
    try {
      const plan = await request<PhotoPlan>('/api/plans', {
        method: 'POST',
        body: JSON.stringify({
          theme: v.theme,
          date: v.date.format('YYYY-MM-DD'),
          location: v.location,
          sceneType: v.sceneType,
        }),
      });
      message.success(`计划已生成（${plan.source === 'llm' ? '小镜分镜' : '模板分镜'}）`);
      setCreateOpen(false);
      form.resetFields();
      setSelected(plan.id);
      bump();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const plan = plans.find((p) => p.id === selected);
  if (plan) return <PlanDetail plan={plan} onBack={() => { setSelected(null); load(); }} />;

  return (
    <div style={{ padding: 16 }}>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        block
        className="touchable"
        style={{ marginBottom: 16 }}
        onClick={() => setCreateOpen(true)}
      >
        新建拍照计划
      </Button>
      <Spin spinning={loading}>
        {plans.length === 0 && !loading ? (
          <Empty
            description={
              <span style={{ color: '#6F6678', lineHeight: 1.8 }}>
                还没有拍摄计划
                <br />
                新建一个，小镜来排分镜和黄金时刻
              </span>
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <List
            grid={{ gutter: 12, xs: 24, sm: 12, md: 8 }}
            dataSource={plans}
            renderItem={(p) => (
              <List.Item>
                <Card size="small" hoverable className="rise" onClick={() => setSelected(p.id)}>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>PLAN · {p.id.split('-').pop()?.toUpperCase()}</div>
                  <Card.Meta
                    title={<span style={{ fontSize: 14 }}>{p.theme}</span>}
                    description={
                      <div>
                        <div style={{ marginBottom: 4, color: '#6F6678' }}>{p.date} · {p.location.sceneType} · {p.location.name}</div>
                        <Space size={4} wrap>
                          <Tag color={p.status === 'reviewed' ? 'green' : p.status === 'shot' ? 'blue' : 'default'} style={{ margin: 0 }}>
                            {p.status === 'reviewed' ? '已复盘' : p.status === 'shot' ? '已拍' : '待拍'}
                          </Tag>
                          <Tag style={{ margin: 0, background: '#FAF6F3', border: 'none', color: '#6F6678' }}>{p.shots.length} 镜</Tag>
                          {p.source === 'llm' && <Tag color="magenta" style={{ margin: 0 }}>小镜分镜</Tag>}
                        </Space>
                      </div>
                    }
                  />
                </Card>
              </List.Item>
            )}
          />
        )}
      </Spin>

      <Modal
        title="新建拍照计划"
        open={createOpen}
        footer={null}
        onCancel={() => setCreateOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={create} initialValues={{ sceneType: '街拍', date: dayjs().add(1, 'day') }}>
          <Form.Item name="theme" label="主题" rules={[{ required: true, message: '比如：周六下午安福路街拍' }]}>
            <Input placeholder="周六下午安福路街拍" />
          </Form.Item>
          <Form.Item name="date" label="日期" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="sceneType" label="场景">
            <Select options={SCENES.map((s) => ({ value: s }))} />
          </Form.Item>
          <Form.Item name="location" label="地点" rules={[{ required: true }]}>
            <Input placeholder="安福路 / 永康路 / 徐汇滨江" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={creating} className="touchable">
            生成分镜计划（约 10 秒）
          </Button>
        </Form>
      </Modal>
    </div>
  );
}

// ---------------- 详情 ----------------

function PlanDetail({ plan, onBack }: { plan: PhotoPlan; onBack: () => void }) {
  const { message } = App.useApp();
  const [shots, setShots] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<PhotoReview | null>(plan.review ?? null);

  const loadShots = useCallback(async () => {
    try {
      const r = await request<{ plan: PhotoPlan; shots: string[] }>(`/api/plans/${plan.id}`);
      setShots(r.shots.map((s) => s.split('/').pop()!));
      if (r.plan.review) setReview(r.plan.review);
    } catch { /* ignore */ }
  }, [plan.id]);

  useEffect(() => { loadShots(); }, [loadShots]);

  // checklist 勾选存 localStorage
  const ckKey = `plan-ck-${plan.id}`;
  const [checked, setChecked] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(ckKey) ?? '[]'); } catch { return []; }
  });
  const toggleCk = (v: string[]) => {
    setChecked(v);
    localStorage.setItem(ckKey, JSON.stringify(v));
  };

  const uploadPhotos = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      await upload(`/api/plans/${plan.id}/shots`, files, 'photos');
      message.success(`上传 ${files.length} 张`);
      await loadShots();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const doReview = async () => {
    setReviewing(true);
    try {
      setReview(await request<PhotoReview>(`/api/plans/${plan.id}/review`, { method: 'POST', body: JSON.stringify({}) }));
      message.success('复盘完成，出片率已反哺衣橱');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setReviewing(false);
    }
  };

  const bestUrls = useMemo(
    () => (review?.best ?? []).map((f) => img(`plans/${plan.id}/shots/${f}`)),
    [review, plan.id]
  );
  const golden = plan.timeWindows.find((w) => w.type === '黄金时刻');
  const blue = plan.timeWindows.find((w) => w.type === '蓝调时刻');

  return (
    <div style={{ padding: 16 }}>
      {/* 通告单式抬头 */}
      <div className="hero rise" style={{ marginBottom: 14 }}>
        <div className="hero-top">
          <span className="eyebrow">CALL SHEET · {plan.id.split('-').pop()?.toUpperCase()}</span>
          <Tag
            color={plan.status === 'reviewed' ? 'green' : plan.status === 'shot' ? 'blue' : 'default'}
            style={{ margin: 0 }}
          >
            {plan.status === 'reviewed' ? '已复盘' : plan.status === 'shot' ? '已拍' : '待拍'}
          </Tag>
        </div>
        <h1 className="hero-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button size="small" type="text" icon={<LeftOutlined />} onClick={onBack} style={{ marginLeft: -7 }} />
          {plan.theme}
        </h1>
        <p className="hero-meta">
          {plan.date} · {plan.location.name} · {plan.location.sceneType}
          {plan.source === 'llm' ? ' · 小镜分镜' : ' · 模板分镜'}
        </p>
        <div className="hourchips">
          {plan.timeWindows.map((w) => (
            <div key={w.type} className={w.type === '黄金时刻' ? 'hourchip hourchip-gold' : w.type === '蓝调时刻' ? 'hourchip hourchip-violet' : 'hourchip'}
              style={w.type === '黄金时刻' || w.type === '蓝调时刻' ? undefined : { background: '#FAF6F3', color: '#6F6678' }}>
              <span className="t1">{w.type}</span>
              <span className="t2">{w.start}–{w.end}</span>
            </div>
          ))}
        </div>
        {(golden || blue) && (
          <p className="hero-meta" style={{ margin: '10px 0 0' }}>
            {[golden, blue].filter(Boolean).map((w) => `${w!.type}：${w!.tip}`).join('　')}
          </p>
        )}
      </div>
      <Card size="small" title={`分镜（${plan.shots.length}）— pose 全部引用姿势库`} style={{ marginBottom: 12 }}>
        <Timeline
          items={plan.shots.map((s) => ({
            color: 'pink',
            children: (
              <div style={{ paddingBottom: 4 }}>
                <div style={{ fontWeight: 600 }}>
                  {s.no}. {s.place}
                  <Tag style={{ marginLeft: 8 }}>{s.pose}</Tag>
                </div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                  <div>机位：{s.angle}｜{s.framing}</div>
                  <div>表情：{s.expression}</div>
                  <div style={{ color: '#D6486F' }}>💡 {s.burstTip}</div>
                </div>
              </div>
            ),
          }))}
        />
      </Card>

      {/* 道具 + checklist */}
      <Card size="small" title="道具与出发清单" style={{ marginBottom: 12 }}>
        <Flex gap={6} wrap style={{ marginBottom: 10 }}>
          {plan.props.map((p) => <Tag key={p} color="orange">{p}</Tag>)}
        </Flex>
        <Checkbox.Group value={checked} onChange={(v) => toggleCk(v as string[])} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {plan.checklist.map((c) => (
            <Checkbox key={c} value={c} className="touchable" style={{ whiteSpace: 'normal' }}>{c}</Checkbox>
          ))}
        </Checkbox.Group>
      </Card>

      {/* 上传样片 */}
      <Card
        size="small"
        title="拍后上传样片"
        extra={
          <Button
            size="small"
            type="primary"
            icon={<CameraOutlined />}
            loading={reviewing}
            disabled={shots.length === 0}
            onClick={doReview}
          >
            <ReloadOutlined /> 视觉复盘
          </Button>
        }
        style={{ marginBottom: 12 }}
      >
        <Upload
          multiple
          accept="image/*"
          showUploadList={false}
          customRequest={({ file }) => uploadPhotos([file as unknown as File])}
        >
          <Button icon={<PlusOutlined />} loading={uploading}>选择照片（可多选）</Button>
        </Upload>
        {shots.length > 0 && (
          <div className="hscroll" style={{ marginTop: 12 }}>
            {shots.map((f) => (
              <Image
                key={f}
                src={img(`plans/${plan.id}/shots/${f}`)}
                width={72}
                height={96}
                style={{ objectFit: 'cover', borderRadius: 8 }}
                loading="lazy"
              />
            ))}
          </div>
        )}
      </Card>

      {/* 复盘结果 */}
      {review && (
        <Card size="small" title="复盘结论" style={{ marginBottom: 12 }}>
          {bestUrls.length > 0 && (
            <Carousel autoplay dots autoplaySpeed={3500} style={{ marginBottom: 12 }}>
              {bestUrls.map((u) => (
                <div key={u}>
                  <Image src={u} height={320} style={{ objectFit: 'contain', borderRadius: 10 }} />
                </div>
              ))}
            </Carousel>
          )}
          {review.colorWin.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <Typography.Text type="secondary">本次验证出片的配色：</Typography.Text>
              <Flex gap={6} wrap style={{ marginTop: 4 }}>
                {review.colorWin.map((c) => <Tag key={c} color="green">{c}</Tag>)}
              </Flex>
            </div>
          )}
          <Alert type="info" showIcon message={review.advice} style={{ marginBottom: 10 }} />
          <Timeline
            items={review.perPhoto.map((p) => ({
              color: p.verdict === 'keep' ? 'green' : p.verdict === 'drop' ? 'gray' : 'blue',
              children: (
                <div style={{ fontSize: 12 }}>
                  <Space size={6}>
                    <Image src={img(`plans/${plan.id}/shots/${p.file}`)} width={36} height={48} style={{ objectFit: 'cover', borderRadius: 6 }} preview={false} />
                    <div>
                      <Tag color={VERDICT[p.verdict]?.color} style={{ margin: 0 }}>{VERDICT[p.verdict]?.label}</Tag>
                      <span style={{ color: '#666' }}>{p.why}</span>
                    </div>
                  </Space>
                </div>
              ),
            }))}
          />
        </Card>
      )}
    </div>
  );
}
