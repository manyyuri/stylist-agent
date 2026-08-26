/**
 * 色彩数学 —— 规则引擎的地基（纯函数，可单测）。
 * hex → RGB → HSL，色相环距离，ΔE 简化（RGB 欧氏距离）。
 */

export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number } // h: 0-360, s/l: 0-1

export function hexToRgb(hex: string): RGB {
  const m = hex.trim().replace(/^#/, '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

export function hexToHsl(hex: string): HSL {
  return rgbToHsl(hexToRgb(hex));
}

/** 两个 hex 的 RGB 欧氏距离（简化 ΔE），0~441 */
export function rgbDistance(a: string, b: string): number {
  const x = hexToRgb(a), y = hexToRgb(b);
  return Math.sqrt((x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2);
}

/** 色相环最短弧距离，0~180 */
export function hueDistance(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

/** 中性色自动判定：黑白灰/驼/米/牛仔蓝（低饱和或典型基础色域） */
export function autoBaseColor(hex: string): boolean {
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.12) return true; // 黑白灰
  if (s < 0.35 && l > 0.7 && h >= 20 && h <= 55) return true; // 米/驼
  if (h >= 195 && h <= 230 && s < 0.55) return true; // 牛仔蓝
  return false;
}

/** 冷皮雷区：姜黄/橘色系（高饱和暖橙） */
export function isColdSkinTrap(hex: string): boolean {
  const { h, s } = hexToHsl(hex);
  return h >= 15 && h <= 50 && s > 0.4;
}

/** 暖皮雷区：冷紫 / 荧光高亮色 */
export function isWarmSkinTrap(hex: string): boolean {
  const { h, s, l } = hexToHsl(hex);
  if (h >= 250 && h <= 300 && s > 0.3) return true; // 冷紫
  return s > 0.85 && l > 0.6; // 荧光感
}
