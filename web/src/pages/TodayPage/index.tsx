/** 今日页：通告单 hero（时刻光带 + 黄金/蓝调时刻）+ OOTD 卡 + 反馈闭环
 *  签名交互：长按卡片 0.5s 盖「出演确定」钢印；下拉重排今日通告 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Segmented, Button, Space, Spin, Empty, App } from 'antd';
import { ReloadOutlined, HeartOutlined, HeartFilled } from '@ant-design/icons';
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
  const [seal, setSeal] = useState<{ x: number; y: number; id: number } | null>(null);
  const [showHint, setShowHint] = useState(() => !localStorage.getItem('seal-hint-seen'));
  const [pull, setPull] = useState(0);
  const pullRef = useRef({ startY: 0, active: false, d: 0 });
  const pressRef = useRef<{ timer: number; sx: number; sy: number } | null>(null);
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

  /* 下拉刷新：页面滚到顶部时下拉超过阈值 → 重取 */
  useEffect(() => {
    const st = pullRef.current;
    const start = (e: TouchEvent) => {
      if (window.scrollY <= 0 && e.touches[0]) {
        st.startY = e.touches[0].clientY;
        st.active = true;
      }
    };
    const move = (e: TouchEvent) => {
      if (!st.active || !e.touches[0]) return;
      const d = e.touches[0].clientY - st.startY;
      st.d = d > 0 && window.scrollY <= 0 ? Math.min(d * 0.45, 84) : 0;
      setPull(st.d);
    };
    const end = () => {
      if (st.active && st.d > 62) {
        navigator.vibrate?.(8);
        load(true);
        request<WeatherInfo>('/api/weather').then(setWeather).catch(() => {});
      }
      st.active = false;
      st.d = 0;
      setPull(0);
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end, { passive: true });
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
    };
  }, [load]);

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

  /* 长按盖「出演确定」钢印（0.5s）——可讲述的动作：在通告单上盖章确认今日舞台 */
  const sealAt = (x: number, y: number) => {
    if (ootd?.feedback !== 'liked') feedback('liked');
    navigator.vibrate?.(14);
    localStorage.setItem('seal-hint-seen', '1');
    setShowHint(false);
    const s = { x, y, id: Date.now() };
    setSeal(s);
    setTimeout(() => setSeal((cur) => (cur?.id === s.id ? null : cur)), 1350);
  };
  const clearPress = () => {
    if (pressRef.current) {
      clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, .ant-collapse-header, .ant-segmented')) return;
    const { clientX, clientY } = e;
    clearPress();
    pressRef.current = {
      sx: clientX,
      sy: clientY,
      timer: window.setTimeout(() => sealAt(clientX, clientY), 500),
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pressRef.current;
    if (p && (Math.abs(e.clientX - p.sx) > 10 || Math.abs(e.clientY - p.sy) > 10)) clearPress();
  };

  const wins = weather?.sun?.windows ?? [];
  const golden = wins.find((w) => w.type === '黄金时刻');
  const blue = wins.find((w) => w.type === '蓝调时刻');
  const d = weather ? new Date(weather.date + 'T12:00:00') : new Date();

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="ptr" style={{ height: pull, lineHeight: pull > 0 ? '32px' : undefined }}>
        {pull > 62 ? '松开，重排今日通告' : '继续下拉'}
      </div>
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
          <div
            className="rise d2"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={clearPress}
            onPointerCancel={clearPress}
            onPointerLeave={clearPress}
          >
            <OutfitCard
              ootd={ootd}
              showActions={
                <div style={{ marginTop: 14 }}>
                  <Space wrap style={{ width: '100%' }} size={8}>
                    <Button
                      type={ootd.feedback === 'liked' ? 'primary' : 'default'}
                      shape="round"
                      icon={ootd.feedback === 'liked' ? <HeartFilled /> : <HeartOutlined />}
                      onClick={() => feedback('liked')}
                      className="touchable"
                    >
                      确认出演
                    </Button>
                    <Button shape="round" icon={<ReloadOutlined />} onClick={() => load(true)} className="touchable">
                      重排通告
                    </Button>
                    <Button type="link" size="small" onClick={() => feedback('meh')}>
                      一般
                    </Button>
                    <Button type="link" size="small" onClick={() => feedback('unchosen')}>
                      没穿
                    </Button>
                  </Space>
                  {showHint && (
                    <div className="eyebrow" style={{ textAlign: 'center', marginTop: 10, letterSpacing: '0.08em' }}>
                      长按卡片 · 盖「出演确定」章
                    </div>
                  )}
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
                  今日通告待排
                  <br />
                  先去「服装间」定妆两件今天穿的单品，小PD就能开始搭配
                </span>
              }
            />
          )
        )}
      </Spin>

      {seal && (
        <span className="seal" style={{ left: seal.x, top: seal.y }} aria-hidden>
          出演确定
        </span>
      )}
    </div>
  );
}
