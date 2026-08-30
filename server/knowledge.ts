/**
 * 知识库加载器 —— knowledge/ 目录随代码内置，启动时一次性读入内存。
 * poses.md 的编号表是 LLM 生成分镜时 pose 字段的唯一合法取值来源（防幻觉）。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnchorCard, MakeupTemplate } from '../shared/types.ts';

// 知识库目录：cwd（Express 与 Flue 都以项目根为工作目录）优先，
// import.meta.url 兜底——bundle 里 import.meta.url 指向 flue/dist，不能直接用。
const KNOWN = existsSync(resolve(process.cwd(), 'knowledge'))
  ? resolve(process.cwd(), 'knowledge')
  : resolve(dirname(fileURLToPath(import.meta.url)), '../knowledge');

function loadDir<T>(dir: string): T[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T);
}

let _anchors: AnchorCard[] | null = null;
let _makeups: MakeupTemplate[] | null = null;
let _poseIds: string[] | null = null;
let _poseCatalog: string | null = null;
let _shotsCatalog: string | null = null;
let _colorsDoc: string | null = null;

export function anchors(): AnchorCard[] {
  return (_anchors ??= loadDir<AnchorCard>(join(KNOWN, 'anchors')));
}

export function anchorById(id: string): AnchorCard | undefined {
  return anchors().find((a) => a.id === id);
}

export function makeups(): MakeupTemplate[] {
  return (_makeups ??= loadDir<MakeupTemplate>(join(KNOWN, 'makeup')));
}

export function makeupById(id: string): MakeupTemplate | undefined {
  return makeups().find((m) => m.id === id);
}

/** 姿势库全量 markdown（拼进 LLM prompt） */
export function poseCatalog(): string {
  return (_poseCatalog ??= readFileSync(join(KNOWN, 'poses.md'), 'utf8'));
}

/** 合法姿势编号 p_01…p_24 */
export function poseIds(): string[] {
  if (_poseIds) return _poseIds;
  const md = poseCatalog();
  _poseIds = [...md.matchAll(/\b(p_\d{2})\b/g)].map((m) => m[1]!);
  return [...new Set(_poseIds)];
}

export function isPoseId(v: string): boolean {
  return poseIds().includes(v.trim().split(/\s+/)[0] ?? '');
}

export function shotsCatalog(): string {
  return (_shotsCatalog ??= readFileSync(join(KNOWN, 'shots.md'), 'utf8'));
}

export function colorsDoc(): string {
  return (_colorsDoc ??= readFileSync(join(KNOWN, 'colors.md'), 'utf8'));
}
