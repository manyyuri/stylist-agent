/**
 * 时刻氛围 —— 界面随真实日光呼吸。
 * 数据来自 /api/weather 的太阳窗口（黄金时刻/蓝调时刻/日出日落），
 * 写入 <html data-hour="day|golden|blue|night">，CSS 变量接管色温。
 * 每分钟重算一次；请求失败静默降级为默认（day）。
 */
import { useEffect } from 'react';
import { request } from '../api';
import type { WeatherInfo } from '../types';

let cached: WeatherInfo | null = null;

const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

function phase(w: WeatherInfo, now: Date): 'golden' | 'blue' | 'night' | 'day' {
  const cur = now.getHours() * 60 + now.getMinutes();
  const wins = w.sun?.windows ?? [];
  const golden = wins.find((x) => x.type === '黄金时刻');
  const blue = wins.find((x) => x.type === '蓝调时刻');
  // 蓝调窗口（向后延 15 分钟余韵）
  if (blue && cur >= toMin(blue.start) && cur <= toMin(blue.end) + 15) return 'blue';
  // 黄金窗口（提前一小时开始进入暖调）
  if (golden && cur >= toMin(golden.start) - 60 && cur <= toMin(golden.end)) return 'golden';
  // 夜：日出前 / 蓝调结束后
  const sunrise = w.sun?.sunrise ? toMin(w.sun.sunrise.slice(11, 16)) : 6 * 60;
  const nightfall = blue ? toMin(blue.end) + 15 : w.sun?.sunset ? toMin(w.sun.sunset.slice(11, 16)) + 45 : 19 * 60;
  if (cur < sunrise - 30 || cur > nightfall) return 'night';
  return 'day';
}

function apply() {
  const mood = cached ? phase(cached, new Date()) : 'day';
  document.documentElement.dataset.hour = mood;
}

export function useHourMood() {
  useEffect(() => {
    if (!cached) {
      request<WeatherInfo>('/api/weather')
        .then((w) => {
          cached = w;
          apply();
        })
        .catch(() => apply());
    } else {
      apply();
    }
    const timer = setInterval(apply, 60_000);
    return () => clearInterval(timer);
  }, []);
}
