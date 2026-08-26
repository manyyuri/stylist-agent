/** 黄金时刻计算单测 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunWindows } from './sun.ts';

test('黄金时刻 = 日落前 55 分钟 ~ 日落后 15 分钟', () => {
  const w = sunWindows('2025-06-05T04:52:00+08:00', '2025-06-05T18:59:00+08:00');
  const golden = w.find((x) => x.type === '黄金时刻')!;
  assert.equal(golden.start, '18:04');
  assert.equal(golden.end, '19:14');
});

test('上午柔光 = 日出后 10~50 分钟', () => {
  const w = sunWindows('2025-06-05T04:52:00+08:00', '2025-06-05T18:59:00+08:00');
  const soft = w.find((x) => x.type === '上午柔光')!;
  assert.equal(soft.start, '05:02');
  assert.equal(soft.end, '05:42');
});

test('蓝调时刻 = 日落后 15~40 分钟，窗口 25 分钟', () => {
  const w = sunWindows('2025-06-05T04:52:00+08:00', '2025-06-05T18:59:00+08:00');
  const blue = w.find((x) => x.type === '蓝调时刻')!;
  assert.equal(blue.start, '19:14');
  assert.equal(blue.end, '19:39');
});

test('四个窗口齐全且带提示', () => {
  const w = sunWindows('2025-06-05T04:52:00+08:00', '2025-06-05T18:59:00+08:00');
  assert.equal(w.length, 4);
  assert.ok(w.every((x) => x.tip.length > 0));
});
