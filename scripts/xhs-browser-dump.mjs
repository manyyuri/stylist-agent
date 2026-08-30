#!/usr/bin/env node
/**
 * 小红书笔记浏览器提取器 —— chrome-devtools-axi 兜底方案。
 *
 * 何时用：cookies.txt 过期/失效，服务端直抓拿不到完整图集时，连真实 Chrome 兜底。
 * 原理：真实浏览器持有有效登录态（HttpOnly cookies）+ 家庭 IP，不受小红书 IP 风控
 * （error 300012）拦截；页面文档响应里的 __INITIAL_STATE__ 含完整笔记与全部图片。
 *
 * 前置：Chrome 开启远程调试
 *   macOS 一条命令重启：open -a "Google Chrome" --args --remote-debugging-port=9222
 *   （或 Windows: chrome.exe --remote-debugging-port=9222）
 *
 * 用法：
 *   node scripts/xhs-browser-dump.mjs "https://www.xiaohongshu.com/discovery/item/xxx?xsec_token=..."
 *   node scripts/xhs-browser-dump.mjs "<url>" --out ~/stylist-data/xhs-notes/xxx.json
 *
 * 输出：{ title, description, imageUrls: string[], noteId }
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const url = process.argv[2];
const outFlag = process.argv.indexOf('--out');
const outPath = outFlag >= 0 ? resolve(process.argv[outFlag + 1]) : null;
if (!url || !/^https?:\/\//.test(url)) {
  console.error('用法: node scripts/xhs-browser-dump.mjs <小红书链接> [--out <json>]');
  process.exit(2);
}

// 自动连接用户已开远程调试的 Chrome（不新起无痕浏览器，避免 IP 风控）
const ENV = { ...process.env, CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '1' };
const axi = (args, opts = {}) =>
  execFileSync('npx', ['-y', 'chrome-devtools-axi', ...args], {
    encoding: 'utf8', env: ENV, timeout: opts.timeout ?? 120_000, stdio: ['ignore', 'pipe', 'pipe'],
  });

function extractState(html) {
  const m = html.match(/window\.__INITIAL_STATE__=(\{[\s\S]*?\})\s*<\/script>/);
  if (!m) return null;
  const json = m[1]
    .replace(/:\s*undefined\b/g, ':null')
    .replace(/:new\s+Map\(\[\]\)/g, ':{}')
    .replace(/:new\s+Set\(\[\]\)/g, ':[]');
  const st = JSON.parse(json);
  const full = Object.values(st?.note?.noteDetailMap ?? {})[0]?.note;
  const card = st?.feed?.undertakeNote?.items?.[0]?.noteCard;
  const pre = st?.noteData?.normalNotePreloadData;
  const note = full ?? card ?? null;
  const toHttps = (u) => (u ? (u.startsWith('//') ? `https:${u}` : u) : undefined);
  if (note) {
    return {
      title: (note.title ?? '').trim(),
      description: (note.desc ?? '').trim(),
      imageUrls: (note.imageList ?? []).map((i) => toHttps(i?.urlDefault)).filter(Boolean),
      noteId: note.noteId,
    };
  }
  if (pre) {
    return {
      title: (pre.title ?? '').trim(),
      description: (pre.desc ?? '').trim(),
      imageUrls: (pre.imagesList ?? []).map((i) => toHttps(i?.url)).filter(Boolean),
    };
  }
  return null;
}

try {
  console.log('[1/4] 打开笔记（连真实 Chrome）…');
  axi(['open', url], { timeout: 120_000 });

  console.log('[2/4] 定位文档请求…');
  const net = axi(['network', '--type', 'document', '--limit', '10'], { timeout: 60_000 });
  const matches = [...net.matchAll(/reqid=(\d+)\s+GET\s+(\S*xiaohongshu\.com\/\S+)/g)];
  if (matches.length === 0) throw new Error('没找到 xiaohongshu 文档请求（可能被风控重定向）');
  const reqId = matches[matches.length - 1][1];
  console.log(`      reqid=${reqId} ${matches[matches.length - 1][2].slice(0, 80)}`);

  console.log('[3/4] 拉取文档 HTML…');
  const dir = mkdtempSync(join(tmpdir(), 'xhs-dump-'));
  const htmlPath = join(dir, 'note.html');
  axi(['network-get', reqId, '--response-file', htmlPath], { timeout: 60_000 });

  console.log('[4/4] 解析 __INITIAL_STATE__…');
  const html = readFileSync(htmlPath, 'utf8');
  const note = extractState(html);
  rmSync(dir, { recursive: true, force: true });
  if (!note) throw new Error('文档里没有 __INITIAL_STATE__（页面可能未加载完整）');

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(note, null, 2));
    console.log(`已写入 ${outPath}`);
  }
  console.log(`标题: ${note.title}`);
  console.log(`图片数: ${note.imageUrls.length}`);
  if (!outPath) console.log(JSON.stringify(note, null, 2));
} catch (e) {
  console.error(`✗ 提取失败: ${e.message}`);
  console.error('提示：确认 Chrome 已带 --remote-debugging-port=9222 启动，且已登录小红书。');
  process.exit(1);
}
