/**
 * 黄金/蓝调时刻计算 —— 纯函数 + 精确到分钟的窗口。
 *
 * 摄影常识编码：
 * - 黄金时刻：sunset−55min ~ sunset+15min（暖调低角度光，人像最出片）
 * - 上午柔光：sunrise+10min ~ sunrise+50min
 * - 蓝调时刻：sunset+15min ~ sunset+40min（天空深蓝未黑，霓虹刚亮）
 * - 10:00–15:00 顶光：顺光或找阴影
 */
import type { SunWindow } from '../shared/types.ts';

function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function sunWindows(sunriseISO: string, sunsetISO: string): SunWindow[] {
  const sunrise = new Date(sunriseISO);
  const sunset = new Date(sunsetISO);
  const shift = (base: Date, min: number) => new Date(base.getTime() + min * 60000);

  return [
    {
      type: '上午柔光',
      start: fmt(shift(sunrise, 10)),
      end: fmt(shift(sunrise, 50)),
      tip: '晨光柔和偏冷，适合清冷/学院风，露水未干草地注意鞋',
    },
    {
      type: '顶光提示',
      start: '10:00',
      end: '15:00',
      tip: '顶光时段，顺光拍或找树荫/建筑阴影，避免正午鼻影',
    },
    {
      type: '黄金时刻',
      start: fmt(shift(sunset, -55)),
      end: fmt(shift(sunset, 15)),
      tip: '全天最出片窗口：暖调侧逆光、发丝发光，提前 10 分钟到位架三脚架',
    },
    {
      type: '蓝调时刻',
      start: fmt(shift(sunset, 15)),
      end: fmt(shift(sunset, 40)),
      tip: '天空深蓝+霓虹初亮，适合夜景/城市感锚点，窗口短抓紧拍',
    },
  ];
}
