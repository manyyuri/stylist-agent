/** 今日页：通告单 hero（时刻光带 + 黄金/蓝调时刻）+ OOTD 卡 + 反馈闭环 */
import { useCallback, useEffect, useState } from 'react';
import { Segmented, Button, Space, Spin, Empty, App, Tag } from 'antd';
import { ReloadOutlined, HeartOutlined, HeartFilled, MinusOutlined, StopOutlined } from '@ant-design/icons';
import type { Feedback, Occasion, Ootd, WeatherInfo } from '../../types';
import { request } from '../../api';
import OutfitCard from '../../components/OutfitCard';
import { useUiStore } from '../../stores';

const WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export default function TodayPage() {
  const { message } = App.useApp();
  const [occasion, setOccasion] = useState<Occasion>('通勤');
  const [ootd, setOotd] = useState<Ootd | null>(null);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const version = useUiStore((s) => s.version);
  const bump = useUiStore((s) => s.bump);

  const load = useCallback(
    async (regen = false) => {
      setLoading(true);
      try {
        const j = regen
          ? await request<Ootd>('/api/ootd/today/regenerate', { method: 'POST', body: JSON.stringify({ occasion }) })
          : await request<Ootd>(`/api/ootd/today?occasion=${encodeURIComponent(occasion)}`);
        setOotd(j);
      } catch (e) {
        setOotd(null);
        message.error((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [occasion, message],
  );

  useEffect(() => {
    request<WeatherInfo>('/api/weather').then(setWeather).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occasion, version]);

  const feedback = async (verdict: Feedback) => {
    if (!ootd) return;
    try {
      await request('/api/ootd/feedback', { method: 'POST', body: JSON.stringify({ date: ootd.date, verdict }) });
      setOotd({ ...ootd, feedback: verdict });
      bump();
      if (verdict === 'liked') message.success('已记录！这套的出片率会越来越准 💗');
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const wins = weather?.sun?.windows ?? [];
  const golden = wins.find((w) => w.type === '黄金时刻');
  const blue = wins.find((w) => w.type === '蓝调时刻');
  const d = weather ? new Date(weather.date + 'T12:00:00') : new Date();

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 通告单 hero */}
      <div className="hero rise">
        <div className="hero-top">
          <span className="eyebrow">
            {WEEK[d.getDay()]} · {MONTH[d.getMonth()]} {String(d.getDate()).padStart(2, '0')}
          </span>
          <span className="onair">
            <i />
            ON AIR
          </span>
        </div>
        <h1 className="hero-title">今日通告单</h1>
        <p className="hero-meta">
          {weather
            ? `${weather.condition} ${weather.tempRange[0]}~${weather.tempRange[1]}° · 降水 ${weather.rainProb}%`
            : '正在读取今日天气…'}
          {ootd ? ` · SCORE ${ootd.outfitScore}` : ''}
        </p>
        <div className="hourchips">
          {golden && (
            <div className="hourchip hourchip-gold">
              <span className="t1">GOLDEN HOUR</span>
              <span className="t2">
                {golden.start}–{golden.end}
              </span>
            </div>
          )}
          {blue && (
            <div className="hourchip hourchip-violet">
              <span className="t1">BLUE HOUR</span>
              <span className="t2">
                {blue.start}–{blue.end}
              </span>
            </div>
          )}
          {weather && weather.rainProb >= 30 && (
            <div className="hourchip hourchip-rain">
              <span className="t1">RAIN</span>
              <span className="t2">{weather.rainProb}%</span>
            </div>
          )}
        </div>
      </div>

      <Segmented
        block
        value={occasion}
        onChange={(v) => setOccasion(v as Occasion)}
        options={['通勤', '日常', '约会', '拍照', '正式']}
        className="rise d1"
      />

      <Spin spinning={loading}>
        {ootd ? (
          <div className="rise d2">
            <OutfitCard
              ootd={ootd}
              showActions={
                <div style={{ marginTop: 14 }}>
                  <Space wrap style={{ width: '100%' }}>
                    <Button
                      type={ootd.feedback === 'liked' ? 'primary' : 'default'}
                      icon={ootd.feedback === 'liked' ? <HeartFilled /> : <HeartOutlined />}
                      onClick={() => feedback('liked')}
                      className="touchable"
                    >
                      就穿这套
                    </Button>
                    <Button icon={<MinusOutlined />} onClick={() => feedback('meh')} className="touchable">
                      一般
                    </Button>
                    <Button icon={<StopOutlined />} onClick={() => feedback('unchosen')} className="touchable">
                      没穿
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={() => load(true)} className="touchable">
                      换一套
                    </Button>
                  </Space>
                </div>
              }
            />
          </div>
        ) : (
          !loading && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span style={{ color: '#6F6678', lineHeight: 1.8 }}>
                  还没有今日造型
                  <br />
                  先去「衣橱」拍两件今天穿的单品，小镜就能开始搭配
                </span>
              }
            />
          )
        )}
      </Spin>
    </div>
  );
}
