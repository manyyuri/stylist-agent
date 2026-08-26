/**
 * 工作区 JSON 存储 —— 无 DB，文件即数据库。
 *
 * 设计要点（值得学的工程模式）：
 * 1. 原子写：先写 tmp 再 rename，进程崩溃不会留下半截 JSON；
 * 2. 内存缓存 + 写时失效：读多写少场景零 IO；
 * 3. 每文件一个 promise 链（「全局锁」）：串行化并发写，避免竞态覆盖。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.ts';

const cache = new Map<string, unknown>();
const locks = new Map<string, Promise<unknown>>();

function lock<T>(path: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(path) ?? Promise.resolve();
  const next = prev.then(fn, fn); // 前序无论成败都继续
  locks.set(
    path,
    next.catch(() => {})
  );
  return next;
}

/** 读写任意 JSON，带默认值 —— 读取失败/不存在时写回 initial */
export function readJson<T>(relPath: string, initial: T): T {
  const abs = join(config.dataDir, relPath);
  if (cache.has(abs)) return cache.get(abs) as T;
  try {
    const v = JSON.parse(readFileSync(abs, 'utf8')) as T;
    cache.set(abs, v);
    return v;
  } catch {
    writeJsonSync(relPath, initial);
    return initial;
  }
}

function writeJsonSync<T>(relPath: string, value: T): void {
  const abs = join(config.dataDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = abs + '.tmp';
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, abs); // 同目录 rename = 原子操作
  cache.set(abs, value);
}

/** 串行化修改：read-modify-write 全程持锁；mutator 可原地修改或返回新值 */
export async function updateJson<T>(relPath: string, initial: T, mutator: (v: T) => void | T | Promise<void | T>): Promise<T> {
  return lock(relPath, async () => {
    const v = readJson(relPath, initial);
    const out = await mutator(v);
    writeJsonSync(relPath, out ?? v);
    return out ?? v;
  });
}

export function absPath(relPath: string): string {
  return join(config.dataDir, relPath);
}

export function ensureDir(relPath: string): string {
  const abs = join(config.dataDir, relPath);
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true });
  return abs;
}
