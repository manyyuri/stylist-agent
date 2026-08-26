/**
 * 规则引擎单测 —— spec §12 P0 验收依据。
 * 运行：npm test（tsx --test）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tempToSpec, colorHarmony, anchorMatch, wearPenalty,
  generateCandidates, validateOutfit, seasonOf, recommendMakeup,
} from './rules.ts';
import type { Profile, WardrobeItem } from '../shared/types.ts';

function item(p: Partial<WardrobeItem>): WardrobeItem {
  return {
    id: 'w_0001', category: 'top', subType: '短袖T恤', colorName: '奶油白', colorHex: '#F5F0E6',
    pattern: '纯色', material: '棉', seasons: ['春', '夏'], tempRange: [20, 32], formality: 3,
    styleTags: ['学院'], baseColor: true, photo: '', wearCount: 0, createdAt: '2025-06-01',
    ...p,
  };
}

const profile: Profile = {
  basics: { height: 165, bodyType: '直筒形', skinTone: '冷调自然', concerns: ['显腿长'] },
  anchors: ['newjeans'],
};

// ---------- §5.1 温度映射 ----------

test('温度映射：≥28 只留夏装类型', () => {
  const spec = tempToSpec(30, 0);
  assert.equal(spec.bucket, 'hot');
  assert.ok(spec.topKeywords.length > 0);
  assert.equal(spec.outerwearRequired, false);
});

test('温度映射：10-15 必含外套', () => {
  assert.equal(tempToSpec(12, 0).outerwearRequired, true);
  assert.equal(tempToSpec(20, 0).outerwearRequired, false);
});

test('温度映射：rainProb≥50 触发雨天规则', () => {
  const spec = tempToSpec(28, 60);
  assert.ok(spec.notes.some((n) => n.includes('防水')));
});

// ---------- §5.3 色彩协调 ----------

test('色彩：全基础色接近满分', () => {
  const items = [
    item({ id: 'a', baseColor: true, colorHex: '#F5F0E6' }),
    item({ id: 'b', category: 'bottom', subType: '牛仔裤', baseColor: true, colorHex: '#3A5BA0' }),
  ];
  const { score } = colorHarmony(items, profile);
  assert.ok(score >= 90, `got ${score}`);
});

test('色彩：冲突色相被扣分', () => {
  const items = [
    item({ id: 'a', baseColor: false, colorHex: '#FF0000', colorName: '正红' }),
    item({ id: 'b', category: 'bottom', subType: '长裤', baseColor: false, colorHex: '#00FF00', colorName: '荧光绿' }),
  ];
  const { score, notes } = colorHarmony(items, profile);
  assert.ok(score < 60, `got ${score}`);
  assert.ok(notes.some((n) => n.includes('冲突') || n.includes('基础色')));
});

test('色彩：冷皮遇姜黄/橘色被降权（P2 验收项）', () => {
  const cold: Profile = { ...profile, basics: { ...profile.basics, skinTone: '冷白' } };
  const items = [item({ id: 'a', baseColor: false, colorHex: '#E07B39', colorName: '姜黄' })];
  const { score, notes } = colorHarmony(items, cold);
  assert.ok(score < 100, `got ${score}`);
  assert.ok(notes.some((n) => n.includes('姜黄')));
  // 暖皮不受此罚
  const warm: Profile = { ...profile, basics: { ...profile.basics, skinTone: '暖白' } };
  const warmScore = colorHarmony(items, warm).score;
  assert.ok(warmScore > score);
});

test('色彩：花色超 1 件被扣分', () => {
  const items = [
    item({ id: 'a', pattern: '碎花', baseColor: true }),
    item({ id: 'b', category: 'bottom', subType: '长裤', pattern: '格纹', baseColor: true }),
  ];
  const { score, notes } = colorHarmony(items, profile);
  assert.ok(notes.some((n) => n.includes('花色')));
  assert.ok(score < 100);
});

// ---------- §5.4 锚点匹配 ----------

test('锚点：newjeans 版型+色盘+标签全命中得分高', () => {
  const nj = [
    item({ id: 'a', subType: '百褶裙', category: 'bottom', colorHex: '#2E3440', styleTags: ['学院', '清冷'] }),
    item({ id: 'b', category: 'shoes', subType: '乐福鞋', colorHex: '#2E3440', styleTags: ['学院'], tempRange: [5, 28] }),
  ];
  const score = anchorMatch(nj, 'newjeans');
  assert.ok(score > 50, `got ${score}`);
});

test('锚点：不相关组合得分低', () => {
  const off = [item({ id: 'a', subType: '皮裤', category: 'bottom', colorHex: '#101014', styleTags: ['欧美'] })];
  assert.ok(anchorMatch(off, 'newjeans') < anchorMatch(off, 'blackpink'));
});

// ---------- §5.5 穿着冷却 ----------

test('穿着冷却：3 天内穿过扣分，囤货 14 天+加分', () => {
  const recent = item({ id: 'a', lastWorn: '2025-06-04' });
  const old = item({ id: 'b', wearCount: 0, createdAt: '2025-05-01' });
  assert.equal(wearPenalty([recent], '2025-06-05'), -10);
  assert.equal(wearPenalty([old], '2025-06-05'), 5);
});

// ---------- §5.6 候选生成 ----------

const wardrobe: WardrobeItem[] = [
  item({ id: 'w_0001', subType: '短袖T恤', colorHex: '#F5F0E6', baseColor: true }),
  item({ id: 'w_0002', category: 'bottom', subType: '百褶裙', colorHex: '#2E3440', baseColor: true, styleTags: ['学院'], tempRange: [10, 28] }),
  item({ id: 'w_0003', category: 'bottom', subType: '直筒牛仔裤', colorHex: '#3A5BA0', baseColor: true, tempRange: [5, 28] }),
  item({ id: 'w_0004', category: 'dress', subType: '缎面吊带裙', colorHex: '#E8D5C4', baseColor: false, styleTags: ['华丽'], tempRange: [22, 34], formality: 4 }),
  item({ id: 'w_0005', category: 'shoes', subType: '乐福鞋', colorHex: '#2E3440', baseColor: true, styleTags: ['学院'], tempRange: [5, 30] }),
  item({ id: 'w_0006', category: 'outerwear', subType: '针织开衫', colorHex: '#C7D2E3', baseColor: false, styleTags: ['清冷'], tempRange: [10, 24] }),
  item({ id: 'w_0007', category: 'top', subType: '吊带', colorHex: '#F2D7DA', baseColor: false, tempRange: [24, 34], formality: 2 }),
];

const ctx = {
  date: '2025-06-05',
  occasion: '通勤' as const,
  weather: { temp: 24, tempRange: [20, 28] as [number, number], rainProb: 10 },
  items: wardrobe,
  profile,
};

test('候选生成：30 件规模 < 300ms（P0 验收③）', () => {
  const big = Array.from({ length: 30 }, (_, i) =>
    item({ id: `w_${String(i).padStart(4, '0')}`, subType: i % 2 ? '短袖T恤' : '长袖衬衫', category: 'top', tempRange: [15, 30], colorHex: ['#F5F0E6', '#C7D2E3', '#D8C3C9'][i % 3]! })
  ).concat(
    Array.from({ length: 12 }, (_, i) =>
      item({ id: `w_b${i}`, subType: i % 2 ? '百褶裙' : '直筒牛仔裤', category: 'bottom' as const, tempRange: [10, 30] })
    )
  );
  const t0 = performance.now();
  const cands = generateCandidates({ ...ctx, items: big });
  const ms = performance.now() - t0;
  assert.ok(cands.length > 0);
  assert.ok(ms < 300, `took ${ms}ms`);
});

test('候选生成：结构合法（top+bottom 或 dress）+ 排序正确 + 最多 5 个', () => {
  const cands = generateCandidates(ctx);
  assert.ok(cands.length >= 1 && cands.length <= 5);
  for (const c of cands) {
    const its = wardrobe.filter((i) => c.items.includes(i.id));
    const ok = (its.some((i) => i.category === 'dress')) || (its.some((i) => i.category === 'top') && its.some((i) => i.category === 'bottom'));
    assert.ok(ok, JSON.stringify(c.items));
  }
  for (let i = 1; i < cands.length; i++) assert.ok(cands[i - 1]!.totalScore >= cands[i]!.totalScore);
});

test('候选生成：exclude 排除已生成组合', () => {
  const first = generateCandidates(ctx);
  const second = generateCandidates({ ...ctx, exclude: [first[0]!.items] });
  const key = (ids: string[]) => [...ids].sort().join('|');
  assert.ok(!second.some((c) => key(c.items) === key(first[0]!.items)));
});

test('候选生成：雨天鞋类只留防水材质', () => {
  const rainy = generateCandidates({ ...ctx, weather: { temp: 24, tempRange: [20, 28], rainProb: 70 } });
  for (const c of rainy) {
    const shoes = wardrobe.filter((i) => c.items.includes(i.id) && i.category === 'shoes');
    assert.ok(shoes.every((s) => /皮|胶|防水/.test(s.material)), JSON.stringify(shoes.map((s) => s.material)));
  }
});

// ---------- §5.7 结构校验（P0 验收②：LLM 编造 id 被拦截） ----------

test('校验：虚构 item id 被拦截', () => {
  const r = validateOutfit(['w_0001', 'w_9999'], ctx);
  assert.equal(r.ok, false);
  assert.ok(r.reason?.includes('不存在'));
});

test('校验：结构不完整被拦截', () => {
  const r = validateOutfit(['w_0001'], ctx); // 只有 top
  assert.equal(r.ok, false);
  assert.ok(r.reason?.includes('结构'));
});

test('校验：合法组合通过', () => {
  const r = validateOutfit(['w_0001', 'w_0002', 'w_0005'], ctx);
  assert.equal(r.ok, true);
});

test('校验：正式度方差过大被拦截（卫衣+礼服）', () => {
  const casual = item({ id: 'w_0098', subType: '卫衣', formality: 1, tempRange: [5, 24] });
  const fancy = item({ id: 'w_0099', category: 'dress', subType: '礼服裙', formality: 4, tempRange: [10, 30] });
  const r = validateOutfit(['w_0098', 'w_0099'], { ...ctx, weather: { temp: 20, tempRange: [16, 24], rainProb: 10 }, items: [...wardrobe, casual, fancy], occasion: '日常' });
  assert.ok(!r.ok);
  assert.ok(r.reason?.includes('方差'));
});

// ---------- 季节/妆造 ----------

test('季节推断', () => {
  assert.equal(seasonOf('2025-06-05'), '夏');
  assert.equal(seasonOf('2025-01-05'), '冬');
});

test('妆造筛选：通勤场景优先 10 分钟档', () => {
  const picks = recommendMakeup({ profile, occasion: '通勤' });
  assert.ok(picks.length >= 1);
  assert.ok(picks[0]!.template.timeBudget <= 15, `got ${picks[0]!.template.timeBudget}`);
});

test('妆造筛选：anchor 命中加分（newjeans → mk_clear_cool）', () => {
  const picks = recommendMakeup({ profile, occasion: '日常', anchor: 'newjeans' });
  assert.equal(picks[0]!.template.id, 'mk_clear_cool');
});

test('妆造筛选：skinToneFit 硬过滤（冷白限定模板，暖皮不可见）', () => {
  const warm: Profile = { ...profile, basics: { ...profile.basics, skinTone: '暖白' } };
  const picks = recommendMakeup({ profile: warm, occasion: '日常' });
  assert.ok(!picks.some((p) => p.template.id === 'mk_cool_white'));
});
