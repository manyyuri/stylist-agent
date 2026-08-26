/**
 * zustand —— version 自增触发刷新模式：
 * 任何页面改了服务端数据后 bump()，其它挂载中的页面 useEffect 依赖 version 自动重取。
 */
import { create } from 'zustand';

interface UiState {
  version: number;
  bump: () => void;
  /** 全局衣橱缓存（多页复用） */
  wardrobeVersion: number;
  bumpWardrobe: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1, wardrobeVersion: s.wardrobeVersion + 1 })),
  wardrobeVersion: 0,
  bumpWardrobe: () => set((s) => ({ wardrobeVersion: s.wardrobeVersion + 1 })),
}));

export const CATEGORY_LABEL: Record<string, string> = {
  outerwear: '外套', top: '上装', bottom: '下装', dress: '连衣裙', shoes: '鞋', bag: '包', accessory: '配饰', headwear: '头饰',
};

export function img(url: string): string {
  return url.startsWith('http') ? url : `/workspace/${url}`;
}
