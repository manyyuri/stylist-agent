/**
 * 月度复盘单测 —— 聚合 + 锚点漂移建议（用临时 dataDir 隔离，不碰真实 ~/stylist-data）。
 * 运行：npm test（tsx --test）
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { config } from './config.ts';
import { buildMonthlyReport } from './monthly.ts';

let dir = '';

function ootd(date: string, anchorUsed: string, outfitScore: number, feedback?: 'liked' | 'meh' | 'unchosen') {
  return {
    date,
    weather: { temp: 26, tempRange: [22, 30], condition: '晴', rainProb: 0 },
    occasion: '日常',
    anchorUsed,
    items: ['w_001'],
    outfitScore,
    narrative: 'x',
    makeup: { templateId: 'mk_clear_cool', stepsSnapshot: [] },
    photoHint: '',
    alternatives: [],
    feedback: feedback ?? null,
    source: 'rule' as const,
  };
}

before(() => {
  dir = join(tmpdir(), `stylist-monthly-${Date.now()}`);
  mkdirSync(join(dir, 'ootd', '2026'), { recursive: true });
  mkdirSync(join(dir, 'wardrobe'), { recursive: true });
  writeFileSync(
    join(dir, 'profile.json'),
    JSON.stringify({
      basics: { height: 165, bodyType: '直筒形', skinTone: '冷调自然', concerns: ['显腿长'] },
      anchors: ['newjeans', 'aespa'],
    }),
  );
  writeFileSync(
    join(dir, 'wardrobe', 'items.json'),
    JSON.stringify([
      {
        id: 'w_001', category: 'top', subType: '短袖T恤', colorName: '奶油白', colorHex: '#F5F0E6',
        pattern: '纯色', material: '棉', seasons: ['春', '夏'], tempRange: [20, 32], formality: 3,
        styleTags: ['学院'], baseColor: true, photo: '', wearCount: 8, photoRating: 5, createdAt: '2025-01-01',
      },
    ]),
  );
  config.dataDir = dir;
  // newjeans：70/72 平均 71；aespa：80/82/85/81 平均 82 → 满足漂移条件
  writeFileSync(join(dir, 'ootd', '2026', '08-01.json'), JSON.stringify(ootd('2026-08-01', 'newjeans', 70, 'liked')));
  writeFileSync(join(dir, 'ootd', '2026', '08-02.json'), JSON.stringify(ootd('2026-08-02', 'aespa', 80, 'liked')));
  writeFileSync(join(dir, 'ootd', '2026', '08-03.json'), JSON.stringify(ootd('2026-08-03', 'aespa', 82, 'meh')));
  writeFileSync(join(dir, 'ootd', '2026', '08-04.json'), JSON.stringify(ootd('2026-08-04', 'aespa', 85, 'liked')));
  writeFileSync(join(dir, 'ootd', '2026', '08-05.json'), JSON.stringify(ootd('2026-08-05', 'newjeans', 72)));
  writeFileSync(join(dir, 'ootd', '2026', '08-06.json'), JSON.stringify(ootd('2026-08-06', 'aespa', 81)));
  // 当日无穿搭 → ootd.ts 落盘 null，应被跳过（历史 bug：排序时 a.date 崩溃）
  writeFileSync(join(dir, 'ootd', '2026', '08-07.json'), 'null');
  writeFileSync(join(dir, 'ootd', '2026', '08-08.json'), 'null');
});

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 清理失败忽略 */
  }
});

test('月度复盘：汇总天数/反馈/平均分/最出片单品', async () => {
  const r = await buildMonthlyReport('2026-08');
  assert.equal(r.days, 6);
  assert.equal(r.feedback.liked, 3);
  assert.equal(r.feedback.meh, 1);
  assert.equal(r.avgScore, 78); // (70+80+82+85+72+81)/6 ≈ 78
  assert.equal(r.source, 'rule'); // 无 GLM key → 规则兜底叙事
  assert.equal(r.topItems.length, 1);
  assert.equal(r.topItems[0]!.subType, '短袖T恤');
});

test('月度复盘：次锚点数据明显更优 → 给出锚点漂移建议', async () => {
  const r = await buildMonthlyReport('2026-08');
  assert.ok(r.drift, '应给出漂移建议');
  assert.equal(r.drift!.from, 'newjeans');
  assert.equal(r.drift!.to, 'aespa');
  const aespa = r.anchorTrends.find((t) => t.anchor === 'aespa');
  assert.ok(aespa);
  assert.equal(aespa.count, 4);
  assert.equal(aespa.avgScore, 82);
});

test('月度复盘：空月份不报错，无漂移', async () => {
  const r = await buildMonthlyReport('2025-01');
  assert.equal(r.days, 0);
  assert.equal(r.drift, null);
  assert.ok(r.narrative.length > 0);
});
