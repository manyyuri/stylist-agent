/** 衣橱页：拍照入库向导（识别草稿 → 用户确认）+ 网格 + 筛选 + 编辑 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button, Row, Col, Image, Segmented, Select, Modal, Form, Input,
  Slider, Checkbox, Switch, ColorPicker, Space, App, Empty, Spin, Alert,
} from 'antd';
import { CameraOutlined, InboxOutlined } from '@ant-design/icons';
import type { Category, WardrobeItem } from '../../types';
import { request, upload } from '../../api';
import { img, CATEGORY_LABEL, useUiStore } from '../../stores';

const CATEGORIES: Category[] = ['outerwear', 'top', 'bottom', 'dress', 'shoes', 'bag', 'accessory', 'headwear'];
const PATTERNS = ['纯色', '条纹', '碎花', '格纹', '印花', '拼色'];

type Draft = Partial<WardrobeItem> & { photo?: string; note?: string };

/** "?" 占位 → 安全默认值 */
function normalizeDraft(d: Draft): Draft {
  return {
    ...d,
    category: CATEGORIES.includes(d.category as Category) ? d.category : 'top',
    subType: d.subType && d.subType !== '?' ? d.subType : '',
    colorName: d.colorName && d.colorName !== '?' ? d.colorName : '',
    colorHex: /^#[0-9a-fA-F]{6}$/.test(d.colorHex ?? '') ? d.colorHex : '#CCCCCC',
    pattern: PATTERNS.includes(d.pattern as never) ? d.pattern : '纯色',
    material: d.material && d.material !== '?' ? d.material : '',
    seasons: d.seasons?.length ? d.seasons : ['春', '秋'],
    tempRange: Array.isArray(d.tempRange) && d.tempRange.length === 2 ? d.tempRange : [12, 26],
    formality: typeof d.formality === 'number' ? d.formality : 3,
    styleTags: d.styleTags ?? [],
    baseColor: d.baseColor ?? false,
  };
}

function ItemForm({ initialValues, onDone, onCancel }: {
  initialValues: Draft; onDone: (v: Draft) => void; onCancel: () => void;
}) {
  const [form] = Form.useForm();
  useEffect(() => {
    form.setFieldsValue(normalizeDraft(initialValues));
  }, [initialValues, form]);

  return (
    <Form form={form} layout="vertical" onFinish={(v) => onDone(v as Draft)}>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="category" label="类别" rules={[{ required: true }]}>
            <Select options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="subType" label="品类名（如 针织开衫）" rules={[{ required: true, message: '填一下品类名' }]}>
            <Input placeholder="短袖T恤 / 百褶裙…" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="colorName" label="颜色名" rules={[{ required: true }]}>
            <Input placeholder="奶油白" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="colorHex" label="色值（点色块修改）" getValueFromEvent={(c) => (typeof c === 'string' ? c : c.toHexString())}>
            <ColorPicker showText format="hex" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="pattern" label="图案">
            <Select options={PATTERNS.map((p) => ({ value: p }))} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="material" label="材质">
            <Input placeholder="针织 / 牛仔 / 缎面…" />
          </Form.Item>
        </Col>
        <Col span={24}>
          <Form.Item name="seasons" label="适合季节">
            <Checkbox.Group options={['春', '夏', '秋', '冬']} />
          </Form.Item>
        </Col>
        <Col span={24}>
          <Form.Item name="tempRange" label="适穿温度区间（℃）">
            <Slider range min={-10} max={40} marks={{ '-10': '-10', 0: '0', 15: '15', 28: '28', 40: '40' }} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="formality" label={`正式度（1 运动 ~ 5 礼服）`} initialValue={3}>
            <Slider min={1} max={5} step={1} marks={{ 1: '1', 3: '3', 5: '5' }} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="baseColor" label="百搭基础色" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Col>
        <Col span={24}>
          <Form.Item name="styleTags" label="风格标签">
            <Select mode="tags" placeholder="学院 / 清冷 / 甜系…" tokenSeparators={[',']} />
          </Form.Item>
        </Col>
      </Row>
      <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" htmlType="submit" className="touchable">
          {initialValues.id ? '保存修改' : '确认入库'}
        </Button>
      </Space>
    </Form>
  );
}

export default function WardrobePage() {
  const { message } = App.useApp();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<string>('all');
  const [season, setSeason] = useState<string | undefined>();
  const wardrobeVersion = useUiStore((s) => s.wardrobeVersion);
  const bumpWardrobe = useUiStore((s) => s.bumpWardrobe);
  const bump = useUiStore((s) => s.bump);

  // 入库向导状态
  const [wizardOpen, setWizardOpen] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [queue, setQueue] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<WardrobeItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (category !== 'all') qs.set('category', category);
      if (season) qs.set('season', season);
      setItems(await request<WardrobeItem[]>(`/api/wardrobe/items?${qs}`));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [category, season, message]);

  useEffect(() => { load(); }, [load, wardrobeVersion]);

  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    setWizardOpen(true);
    setRecognizing(true);
    setDraft(null);
    try {
      const r = await upload<{ draft: Draft; photo: string }>('/api/wardrobe/upload', [f]);
      setDraft({ ...r.draft, photo: r.photo });
    } catch (e) {
      message.error((e as Error).message);
      setWizardOpen(false);
    } finally {
      setRecognizing(false);
    }
  };

  const confirmDraft = (v: Draft) => {
    setQueue((q) => [...q, { ...draft, ...v, photo: draft?.photo }]);
    // 直接开始下一件
    setDraft(null);
    fileRef.current?.click();
  };

  const finishWizard = async () => {
    if (queue.length === 0) { setWizardOpen(false); return; }
    try {
      await request('/api/wardrobe/items', { method: 'POST', body: JSON.stringify(queue) });
      message.success(`入库 ${queue.length} 件 ✅`);
      setQueue([]);
      setWizardOpen(false);
      bumpWardrobe();
      bump();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const saveEdit = async (v: Draft) => {
    try {
      await request(`/api/wardrobe/items/${editing!.id}`, { method: 'PATCH', body: JSON.stringify(v) });
      message.success('已保存');
      setEditing(null);
      bumpWardrobe();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }}
      />
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Button type="primary" icon={<CameraOutlined />} onClick={() => fileRef.current?.click()} className="touchable">
          拍照入库
        </Button>
        <Select
          placeholder="季节"
          allowClear
          style={{ width: 100 }}
          onChange={(v) => setSeason(v)}
          options={['春', '夏', '秋', '冬'].map((s) => ({ value: s }))}
        />
      </Space>

      <Segmented
        block
        value={category}
        onChange={(v) => setCategory(v as string)}
        options={[{ value: 'all', label: '全部' }, ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]}
        style={{ marginBottom: 16, overflowX: 'auto', whiteSpace: 'nowrap' }}
      />

      <Spin spinning={loading}>
        {items.length === 0 && !loading ? (
          <Empty
            description={
              <span style={{ color: '#6F6678', lineHeight: 1.8 }}>
                衣橱还是空的
                <br />
                拍下今天要穿的几件，小镜来建档案、做搭配
              </span>
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Row gutter={[10, 10]}>
            {items.map((it) => (
              <Col xs={12} md={8} key={it.id}>
                <div
                  className="pcard rise"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setEditing(it)}
                >
                  <div className="pcard-img">
                    <img src={img(it.photo)} alt={it.subType} loading="lazy" />
                  </div>
                  <div className="pcard-cap">
                    <div className="pcap-no">NO.{it.id.replace(/^w_/i, '').toUpperCase()}</div>
                    <div className="pcap-name">
                      <i className="pcap-dot" style={{ background: it.colorHex }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.subType}</span>
                    </div>
                    <div className="pcap-tags">
                      <span className="pchip">{it.seasons.join('/')}</span>
                      {it.photoRating ? <span className="pchip pchip-gold">出片 {it.photoRating}</span> : null}
                      {it.wearCount > 0 && <span className="pchip">穿 {it.wearCount} 次</span>}
                      {it.styleTags.slice(0, 1).map((t) => (
                        <span key={t} className="pchip pchip-rose">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        )}
      </Spin>

      {/* 入库向导 */}
      <Modal
        title={recognizing ? '识别中…' : queue.length > 0 ? `已入队 ${queue.length} 件，继续拍下一件` : '确认单品信息'}
        open={wizardOpen}
        footer={null}
        onCancel={() => { setWizardOpen(false); setDraft(null); }}
        width={520}
        destroyOnHidden
      >
        {recognizing ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" />
            <p style={{ marginTop: 16, color: '#999' }}>小镜正在识别这件单品…</p>
          </div>
        ) : draft ? (
          <>
            {draft.note ? <Alert type="warning" message={draft.note} style={{ marginBottom: 12 }} showIcon /> : null}
            {draft.photo && (
              <Image
                src={img(draft.photo)}
                width={80}
                height={100}
                style={{ objectFit: 'cover', borderRadius: 8, marginBottom: 12 }}
                preview={false}
              />
            )}
            <ItemForm initialValues={draft} onDone={confirmDraft} onCancel={() => setWizardOpen(false)} />
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <InboxOutlined style={{ fontSize: 40, color: '#D6486F' }} />
            <p style={{ margin: '12px 0' }}>拍摄下一件，或完成入库</p>
            <Space>
              <Button onClick={() => fileRef.current?.click()}>继续拍</Button>
              <Button type="primary" onClick={finishWizard} disabled={queue.length === 0}>
                完成（{queue.length} 件）
              </Button>
            </Space>
          </div>
        )}
      </Modal>

      {/* 编辑 */}
      <Modal
        title={`编辑 ${editing?.subType ?? ''}`}
        open={!!editing}
        footer={null}
        onCancel={() => setEditing(null)}
        width={520}
        destroyOnHidden
      >
        {editing && <ItemForm key={editing.id} initialValues={editing} onDone={saveEdit} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
