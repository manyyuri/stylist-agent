/**
 * 小红书参考来源解析 —— 链接 / 分享文字 / 封面图。
 *
 * 现实约束：小红书无凭证直链会被反爬墙拦（返回 404 安全页）。可用来源：
 *   1. app「复制链接」得到的 xhslink.com 短链 —— 跳转后带 xsec_token，
 *      服务端可拿到 og:title / og:description / og:image（封面图）；
 *   2. app「复制分享文字」—— 标题 + 正文前几行，纯文本最稳；
 *   3. 用户直接上传小红书截图 —— 视觉模型分析，不依赖反爬。
 * 本模块只负责「拿到参考素材」，风格分析交给 vision/text 模型。
 */
import sharp from 'sharp';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { absPath } from './store.ts';
import { config } from './config.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---------- 小红书登录态 cookies ----------
// 从 cookies.txt（浏览器扩展导出，Netscape 格式）读取，让服务端能抓到完整笔记图集。
// 值只在内存中拼接，不落日志、不进 git。
let cookieCache: string | null | undefined;
function xhsCookie(): string | undefined {
  if (cookieCache !== undefined) return cookieCache || undefined;
  const cfg = config.xhsCookieFile?.trim();
  const env = process.env.XHS_COOKIE_FILE?.trim();
  const p = env || cfg || join(process.env.HOME ?? '', 'Downloads', 'www.xiaohongshu.com_cookies.txt');
  if (!p) { cookieCache = ''; return undefined; }
  try {
    const file = p.startsWith('~') ? resolve(process.env.HOME ?? '', p.replace(/^~\//, '')) : p;
    if (!existsSync(file)) { cookieCache = ''; return undefined; }
    const parts = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => !l.startsWith('#') && l.trim())
      .map((l) => {
        const f = l.split('\t');
        return `${f[5]}=${f[6]}`;
      });
    cookieCache = parts.join('; ');
  } catch {
    cookieCache = '';
  }
  return cookieCache || undefined;
}

export interface ParsedNote {
  title?: string;
  description?: string;
  /** 首图（封面，兼容旧字段） */
  imageUrl?: string;
  /** 笔记全部图片（多图时用） */
  imageUrls?: string[];
  /** 实际抓到的原文（分享文字时即输入本身） */
  text?: string;
}

export function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** 抓取页面：桌面浏览器 UA + 登录态 cookie + 跟随跳转 + 超时；失败抛错由调用方兜底 */
export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept-language': 'zh-CN,zh;q=0.9',
      ...(xhsCookie() ? { cookie: xhsCookie()! } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** 从 HTML 抠 og meta（小红书带 xsec_token 的分享页有 og 标签） */
export function extractOgMeta(html: string): Pick<ParsedNote, 'title' | 'description' | 'imageUrl'> {
  const read = (prop: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
    const alt = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:${prop}["']`, 'i');
    return re.exec(html)?.[1] ?? alt.exec(html)?.[1];
  };
  const title = read('title');
  const description = read('description');
  const imageUrl = read('image');
  return {
    title: title?.trim() || undefined,
    description: description?.trim() || undefined,
    imageUrl: imageUrl?.startsWith('//') ? `https:${imageUrl}` : imageUrl || undefined,
  };
}

/**
 * 小红书页面内嵌 `window.__INITIAL_STATE__`（带 xsec_token 时可取到笔记全文）。
 * 两种路径结构兼容：
 *   1. /discovery/item/... → noteData.normalNotePreloadData（{title, desc, imagesList[]}）
 *   2. /explore/... → note.noteDetailMap[noteId].note（{title, desc, imageList[]}）
 * 结构随前端改版易变，这里 best-effort：任意一步失败就返回 null。
 */


function toHttps(u?: string): string | undefined {
  if (!u) return undefined;
  return u.startsWith('//') ? `https:${u}` : u;
}

/**
 * 小红书页面内嵌 `window.__INITIAL_STATE__`（带 xsec_token + 登录 cookie 时可取到完整笔记与全部图片）。
 * 三种结构兼容（按完整度优先）：
 *   1. note.noteDetailMap[noteId].note —— 完整笔记（imageList[] + urlDefault）
 *   2. feed.undertakeNote.items[0].noteCard —— 承启页完整笔记（imageList[] + urlDefault）
 *   3. noteData.normalNotePreloadData —— 精简预载（imagesList[] + url）
 * 结构随前端改版易变，这里 best-effort：任意一步失败就返回 null。
 */
export function extractXhsState(html: string): Pick<ParsedNote, 'title' | 'description' | 'imageUrls'> | null {
  try {
    const m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
    if (!m?.[1]) return null;
    // 页面里 JSON 内嵌 JS 字面量（xhs 前端习惯）：undefined / new Map([]) / new Set([])，先剔除再解析
    const json = m[1]
      .replace(/:\s*undefined\b/g, ':null')
      .replace(/:new\s+Map\(\[\]\)/g, ':{}')
      .replace(/:new\s+Set\(\[\]\)/g, ':[]');
    const state = JSON.parse(json) as {
      note?: { noteDetailMap?: Record<string, { note?: XhsNote }> };
      feed?: { undertakeNote?: { items?: { noteCard?: XhsNote }[] } };
      noteData?: { normalNotePreloadData?: { title?: string; desc?: string; imagesList?: { url?: string }[] } };
    };
    // 1. 完整笔记（带 cookies + xsec_token 时渲染）
    const full = Object.values(state?.note?.noteDetailMap ?? {})[0]?.note;
    if (full) return pickNote(full);
    // 2. 承启页完整笔记
    const card = state?.feed?.undertakeNote?.items?.[0]?.noteCard;
    if (card) return pickNote(card);
    // 3. 精简预载
    const preload = state?.noteData?.normalNotePreloadData;
    if (preload) {
      return {
        title: preload.title?.trim() || undefined,
        description: preload.desc?.trim() || undefined,
        imageUrls: (preload.imagesList ?? []).map((i) => toHttps(i?.url)).filter((x): x is string => !!x),
      };
    }
    return null;
  } catch {
    return null;
  }
}

interface XhsNote {
  title?: string;
  desc?: string;
  imageList?: { urlDefault?: string }[];
}

function pickNote(note: XhsNote): Pick<ParsedNote, 'title' | 'description' | 'imageUrls'> {
  return {
    title: note.title?.trim() || undefined,
    description: note.desc?.trim() || undefined,
    imageUrls: (note.imageList ?? []).map((i) => toHttps(i?.urlDefault)).filter((x): x is string => !!x),
  };
}

/** 解析页面：og meta 优先，内嵌 state 补充（og 没拿到 desc/image 时）；多图合并去重 */
export async function parsePage(url: string): Promise<ParsedNote> {
  // 优先读浏览器导出的缓存（scripts/xhs-browser-dump.mjs，完整图集）
  const cached = readBrowserCache(url);
  if (cached) return cached;

  const html = await fetchHtml(url);
  const og = extractOgMeta(html);
  const state = extractXhsState(html);
  const urls = [...(og.imageUrl ? [og.imageUrl] : []), ...(state?.imageUrls ?? [])];
  const uniq = [...new Set(urls)];
  const clean = (t?: string) => t?.replace(/\s*-\s*小红书\s*$/, '').trim() || undefined;
  return {
    title: clean(state?.title ?? og.title),
    description: og.description ?? state?.description,
    imageUrl: uniq[0],
    imageUrls: uniq,
  };
}

/** 读取 scripts/xhs-browser-dump.mjs 导出的笔记缓存（~/stylist-data/xhs-notes/<noteId>.json） */
function readBrowserCache(url: string): ParsedNote | null {
  try {
    const noteId = url.match(/\/(?:discovery\/item|explore)\/([0-9a-f]+)/)?.[1];
    if (!noteId) return null;
    const p = join(absPath('xhs-notes'), `${noteId}.json`);
    if (!existsSync(p)) return null;
    const c = JSON.parse(readFileSync(p, 'utf8')) as {
      title?: string; description?: string; imageUrls?: string[];
    };
    const urls = (c.imageUrls ?? []).filter((u): u is string => !!u);
    return {
      title: c.title?.replace(/\s*-\s*小红书\s*$/, '').trim() || undefined,
      description: c.description?.trim() || undefined,
      imageUrl: urls[0],
      imageUrls: urls,
    };
  } catch {
    return null;
  }
}

/** 解析小红书「复制分享文字」：首行当标题，去话题标签与多余换行 */
export function parseShareText(text: string): ParsedNote {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const body = lines
    .filter((l) => !/^#/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
  const title = (lines.find((l) => !/^#/.test(l)) ?? body).slice(0, 60);
  return { title: title || undefined, description: body || undefined, text };
}

/** 拉取封面图 → 压缩成 ≤1280px JPEG buffer（不发原图，隐私同上传管线） */
export async function fetchCoverBuffer(imageUrl: string): Promise<Buffer> {
  const res = await fetch(imageUrl, {
    headers: {
      'user-agent': UA,
      referer: 'https://www.xiaohongshu.com/',
      ...(xhsCookie() ? { cookie: xhsCookie()! } : {}),
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`cover HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const img = sharp(buf, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  let pipeline = img;
  if ((meta.width ?? 0) > 1280 || (meta.height ?? 0) > 1280) {
    pipeline = img.resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true });
  }
  return pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

/**
 * 批量拉取笔记图片 → 各压缩成 ≤1280px JPEG buffer（不发原图，隐私同上传管线）。
 * 并发上限 2，最多 max 张；单张失败跳过（首图失败才抛错）。
 */
export async function fetchCoverBuffers(imageUrls: string[], max = 6): Promise<Buffer[]> {
  const urls = imageUrls.slice(0, max);
  const out: Buffer[] = [];
  const worker = async (i: number) => {
    try {
      out[i] = await fetchCoverBuffer(urls[i]!);
    } catch {
      /* 单张失败跳过 */
    }
  };
  // 并发 2 的池子
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, urls.length) }, async () => {
      while (cursor < urls.length) {
        const i = cursor++;
        await worker(i);
      }
    })
  );
  const ok = out.filter((b): b is Buffer => b !== undefined);
  if (ok.length === 0 && urls.length > 0) throw new Error('所有图片都下载失败');
  return ok;
}

/** 把多张封面 buffer 存到计划目录 ref/ 下，返回相对路径（index 0 = 首图） */
export function saveCovers(planId: string, buffers: Buffer[]): string[] {
  const refDir = join(absPath(`plans/${planId}`), 'ref');
  mkdirSync(refDir, { recursive: true });
  return buffers.map((buf, i) => {
    const rel = `plans/${planId}/ref/cover-${i + 1}.jpg`;
    writeFileSync(absPath(rel), buf);
    return rel;
  });
}
