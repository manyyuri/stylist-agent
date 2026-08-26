/** 衣橱：上传识别（草稿）→ 确认入库 → 列表筛选 → 编辑修正 */
import { Router } from 'express';
import multer from 'multer';
import { renameSync } from 'node:fs';
import type { Category, WardrobeItem } from '../../shared/types.ts';
import { readJson, updateJson, absPath } from '../store.ts';
import { processUpload, imageDataUrl } from '../upload.ts';
import { extractItems, type ItemDraft } from '../vision.ts';
import { today } from '../weather.ts';

export const wardrobeRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

function items(): WardrobeItem[] {
  return readJson<WardrobeItem[]>('wardrobe/items.json', []);
}

function nextId(list: WardrobeItem[]): string {
  const max = list.reduce((m, i) => Math.max(m, Number(i.id.slice(2)) || 0), 0);
  return `w_${String(max + 1).padStart(4, '0')}`;
}

/** multipart 图片 → 视觉识别 → 返回草稿 + 暂存照片路径（不入库，必须经确认） */
wardrobeRouter.post('/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '缺少 photo 文件' });
      return;
    }
    const tmpName = `draft-${Date.now().toString(36)}`;
    const img = await processUpload(req.file.buffer, req.file.originalname, `wardrobe/photos/${today()}`, tmpName);
    let draft: ItemDraft | Record<string, never> = {};
    let note: string | undefined;
    try {
      const dataUrl = await imageDataUrl(img.rel);
      draft = await extractItems(dataUrl);
    } catch (e) {
      // 降级：照片已存好，草稿留空让用户手动填 —— 不因为 AI 不可用而卡住入库流程
      note = `AI 识别暂不可用（${(e as Error).message}），请手动填写字段`;
    }
    res.json({ draft, photo: img.rel, note: note ?? draft.note });
  } catch (e) {
    res.status(502).json({ error: `识别失败：${(e as Error).message}（可在确认页手动填写）` });
  }
});

/** 用户确认后的草稿批量入库 */
wardrobeRouter.post('/items', async (req, res) => {
  const drafts = req.body as (Partial<WardrobeItem> & { photo?: string })[];
  if (!Array.isArray(drafts) || drafts.length === 0) {
    res.status(400).json({ error: '空入库请求' });
    return;
  }
  const saved = await updateJson<WardrobeItem[]>('wardrobe/items.json', [], (list) => {
    for (const d of drafts) {
      const id = nextId(list);
      let photo = d.photo ?? '';
      // 草稿照片重命名为正式 id
      if (photo.includes('draft-')) {
        const newRel = photo.replace(/draft-[\w-]+/, id);
        try {
          renameSync(absPath(photo), absPath(newRel));
          photo = newRel;
        } catch { /* 保留原路径 */ }
      }
      list.push({
        id,
        category: (d.category ?? 'top') as Category,
        subType: d.subType ?? '未命名',
        colorName: d.colorName ?? '?',
        colorHex: /^#[0-9a-fA-F]{6}$/.test(d.colorHex ?? '') ? d.colorHex! : '#CCCCCC',
        pattern: d.pattern ?? '纯色',
        material: d.material ?? '?',
        seasons: d.seasons?.length ? d.seasons : (['春', '秋'] as WardrobeItem['seasons']),
        tempRange: Array.isArray(d.tempRange) && d.tempRange.length === 2 ? [d.tempRange[0]!, d.tempRange[1]!] as [number, number] : [10, 28],
        formality: (d.formality ?? 3) as WardrobeItem['formality'],
        styleTags: d.styleTags ?? [],
        baseColor: d.baseColor ?? false,
        photo,
        wearCount: 0,
        createdAt: new Date().toISOString(),
      });
    }
  });
  res.json({ ok: true, count: drafts.length, items: saved.slice(-drafts.length) });
});

/** 列表 + 筛选 */
wardrobeRouter.get('/items', (req, res) => {
  let list = items();
  const { category, season, q } = req.query as { category?: string; season?: string; q?: string };
  if (category) list = list.filter((i) => i.category === category);
  if (season) list = list.filter((i) => i.seasons.includes(season as never));
  if (q) {
    const kw = q.toLowerCase();
    list = list.filter((i) =>
      i.subType.toLowerCase().includes(kw) || i.colorName.includes(q!) || i.styleTags.some((t) => t.toLowerCase().includes(kw))
    );
  }
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json(list);
});

/** 编辑修正（含 wearCount 手动核销、photoRating） */
wardrobeRouter.patch('/items/:id', async (req, res) => {
  const id = String(req.params.id);
  const patch = req.body as Partial<WardrobeItem>;
  const updated = await updateJson<WardrobeItem[]>('wardrobe/items.json', [], (list) => {
    const it = list.find((i) => i.id === id);
    if (!it) return;
    const { id: _drop, ...rest } = patch;
    Object.assign(it, rest);
  });
  const it = updated.find((i) => i.id === id);
  if (!it) {
    res.status(404).json({ error: `单品 ${id} 不存在` });
    return;
  }
  res.json(it);
});
