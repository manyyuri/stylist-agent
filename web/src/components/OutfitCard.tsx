/**
 * OOTD 穿搭卡 —— TodayPage 与 ChatPage 工具卡片复用。
 * 设计：单品以「小卡（photocard）」呈现——白边相纸 + 收藏编号钢印，
 * 这是本应用的签名元素（把日常穿搭配变成可收藏的小卡墙）。
 */
import { useEffect, useState } from 'react';
import { Card, Skeleton, Steps, Collapse } from 'antd';
import { ClockCircleOutlined, CameraOutlined } from '@ant-design/icons';
import type { Ootd, WardrobeItem } from '../types';
import { request } from '../api';
import { img } from '../stores';

/** 妆造模板 id → 展示名（与 knowledge/makeup 一致） */
const MAKEUP_NAME: Record<string, string> = {
  mk_commute_10min: '10分钟通勤伪素颜',
  mk_clear_cool: '清冷学院妆',
  mk_glossy_pure: '纯欲水光妆',
  mk_y2k_silver: 'Y2K 银灰妆',
  mk_glam_western: '浓颜欧美妆',
  mk_sweet_energy: '元气甜妹妆',
  mk_cool_white: '冷白皮显白妆',
  mk_stage_photo: '拍照专用持妆妆',
};

/** 单品小卡 */
function Pcard({ item }: { item: WardrobeItem }) {
  return (
    <div className="pcard">
      <div className="pcard-img">
        <img src={img(item.photo)} alt={item.subType} loading="lazy" />
      </div>
      <div className="pcard-cap">
        <div className="pcap-no">NO.{item.id.replace(/^w_/i, '').toUpperCase()}</div>
        <div className="pcap-name">
          <i className="pcap-dot" style={{ background: item.colorHex }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.subType}</span>
        </div>
      </div>
    </div>
  );
}

export default function OutfitCard({ ootd, showActions }: { ootd: Ootd; showActions?: React.ReactNode }) {
  const [items, setItems] = useState<WardrobeItem[]>([]);

  useEffect(() => {
    request<WardrobeItem[]>('/api/wardrobe/items').then(setItems).catch(() => {});
  }, [ootd.date]);

  const picked = ootd.items.map((id) => items.find((i) => i.id === id)).filter(Boolean) as WardrobeItem[];
  const makeupLabel = MAKEUP_NAME[ootd.makeup.templateId] ?? ootd.makeup.templateId;

  return (
    <Card
      size="small"
      styles={{ header: { border: 'none' }, body: { padding: '12px 16px 16px' } }}
      title={
        <div>
          <div className="eyebrow eyebrow-rose">DAILY OOTD · {ootd.date}</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{ootd.occasion} · 今日造型</div>
        </div>
      }
      extra={
        ootd.source === 'llm' ? (
          <span className="pchip pchip-rose">小镜精选</span>
        ) : (
          <span className="pchip">规则推荐</span>
        )
      }
    >
      {/* 天气行 + 匹配分钢印 */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="pchip">
          {ootd.weather.condition} {ootd.weather.tempRange[0]}~{ootd.weather.tempRange[1]}°
        </span>
        {ootd.weather.rainProb >= 30 && <span className="pchip pchip-gold">降水 {ootd.weather.rainProb}%</span>}
        <span className="stamp">
          SCORE <b>{ootd.outfitScore}</b>
        </span>
      </div>

      {/* 小卡墙：今日单品 */}
      <div className="hscroll" style={{ marginBottom: 12 }}>
        {picked.length === 0 && <Skeleton.Image active style={{ width: 96, height: 128 }} />}
        {picked.map((it) => (
          <Pcard key={it.id} item={it} />
        ))}
      </div>

      {/* 女团感叙事 */}
      <p className="narrative">{ootd.narrative}</p>

      {/* 妆造步骤 */}
      {ootd.makeup.stepsSnapshot.length > 0 && (
        <Collapse
          size="small"
          ghost
          items={[
            {
              key: 'makeup',
              label: (
                <span>
                  <ClockCircleOutlined style={{ color: '#D6486F' }} />
                  <span className="eyebrow eyebrow-rose" style={{ margin: '0 6px' }}>MAKEUP</span>
                  {makeupLabel} · {ootd.makeup.stepsSnapshot.length} 步
                </span>
              ),
              children: (
                <Steps
                  direction="vertical"
                  size="small"
                  current={-1}
                  items={ootd.makeup.stepsSnapshot.map((s) => ({
                    title: `${s.no}. ${s.title}`,
                    description: (
                      <div style={{ fontSize: 12 }}>
                        <div style={{ color: '#6F6678' }}>{s.detail}</div>
                        <div style={{ color: '#D6486F', marginTop: 2 }}>{s.products.join(' · ')}</div>
                      </div>
                    ),
                  }))}
                />
              ),
            },
          ]}
        />
      )}

      {/* 拍照建议（琥珀纸条） */}
      <div className="note" style={{ marginTop: 10 }}>
        <CameraOutlined /> {ootd.photoHint}
      </div>

      {ootd.alternatives.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {ootd.alternatives.map((alt, i) => (
            <div key={i} style={{ fontSize: 12, color: '#B4A9B8', marginTop: 4 }}>
              备选{i + 1} · {alt.items.length} 件 · {alt.why}
            </div>
          ))}
        </div>
      )}

      {showActions}
    </Card>
  );
}
