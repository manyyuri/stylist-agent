/**
 * open-meteo 代理 —— 免费无 Key 天气 API。
 * 当日结果内存缓存（key = date），同一天只打一次外网。
 * 失败时返回 source:'manual' 的兜底结构，由前端让用户手动输入温度区间。
 */
import { config } from './config.ts';
import { sunWindows } from './sun.ts';
import type { WeatherInfo } from '../shared/types.ts';

const cache = new Map<string, WeatherInfo>();

// WMO weather codes → 中文描述
const WMO: Record<number, string> = {
  0: '晴', 1: '大致晴', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
  51: '小毛雨', 53: '毛雨', 55: '大毛雨', 61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '强阵雨', 82: '暴雨', 85: '阵雪', 86: '阵雪',
  95: '雷暴', 96: '雷暴冰雹', 99: '雷暴冰雹',
};

export function manualWeather(date: string, tempRange: [number, number]): WeatherInfo {
  return {
    date,
    temp: Math.round((tempRange[0] + tempRange[1]) / 2),
    tempRange,
    condition: '手动输入',
    rainProb: 0,
    source: 'manual',
  };
}

export async function getWeather(date?: string): Promise<WeatherInfo> {
  const d = date ?? today();
  const cached = cache.get(d);
  if (cached) return cached;

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(config.city.lat));
  url.searchParams.set('longitude', String(config.city.lon));
  url.searchParams.set('current', 'temperature_2m,weather_code,precipitation');
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability');
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '7');

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const j = (await res.json()) as {
    current: { temperature_2m: number; weather_code: number };
    daily: {
      time: string[]; weather_code: number[];
      temperature_2m_max: number[]; temperature_2m_min: number[];
      precipitation_probability_max: (number | null)[]; sunrise: string[]; sunset: string[];
    };
    hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: (number | null)[] };
  };

  const idx = j.daily.time.indexOf(d);
  if (idx === -1) throw new Error(`无 ${d} 预报（超出 7 天范围）`);

  const hourly = j.hourly.time
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.startsWith(d))
    .map(({ t, i }) => ({
      time: t.slice(11, 16),
      temp: Math.round(j.hourly.temperature_2m[i]!),
      rainProb: j.hourly.precipitation_probability[i] ?? 0,
    }));

  const info: WeatherInfo = {
    date: d,
    temp: Math.round(j.current.temperature_2m),
    tempRange: [Math.round(j.daily.temperature_2m_min[idx]!), Math.round(j.daily.temperature_2m_max[idx]!)],
    condition: WMO[j.daily.weather_code[idx]!] ?? '未知',
    rainProb: j.daily.precipitation_probability_max[idx] ?? 0,
    hourly,
    sun: {
      sunrise: j.daily.sunrise[idx]!,
      sunset: j.daily.sunset[idx]!,
      windows: sunWindows(j.daily.sunrise[idx]!, j.daily.sunset[idx]!),
    },
    source: 'open-meteo',
  };
  cache.set(d, info);
  return info;
}

export function today(): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
