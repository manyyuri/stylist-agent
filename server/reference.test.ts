/** 小红书参考解析单测：og meta / 内嵌 state / 分享文字 / URL 判定 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractOgMeta, extractXhsState, parseShareText, isUrl } from './reference.ts';

test('isUrl 只认 http(s) 开头', () => {
  assert.equal(isUrl('http://xhslink.com/a/abc'), true);
  assert.equal(isUrl('https://www.xiaohongshu.com/explore/xxx'), true);
  assert.equal(isUrl('这条穿搭也太好看了吧'), false);
  assert.equal(isUrl('xhslink.com/a/abc'), false);
});

test('extractOgMeta 从 HTML 抠 title/description/image（属性顺序两种写法都要兼容）', () => {
  const html = `<html><head>
    <meta property="og:title" content="初秋穿搭 | 燕麦色针织×直筒牛仔裤" />
    <meta name="og:description" content="这套也太好看了吧，通勤也能穿～" />
    <meta content="//sns-img.xhscdn.com/cover.jpg" property="og:image" />
  </head></html>`;
  const meta = extractOgMeta(html);
  assert.equal(meta.title, '初秋穿搭 | 燕麦色针织×直筒牛仔裤');
  assert.equal(meta.description, '这套也太好看了吧，通勤也能穿～');
  assert.equal(meta.imageUrl, 'https://sns-img.xhscdn.com/cover.jpg'); // 协议相对 → 补 https
});

test('extractOgMeta 缺标签时返回 undefined', () => {
  const meta = extractOgMeta('<html><head></head></html>');
  assert.equal(meta.title, undefined);
  assert.equal(meta.imageUrl, undefined);
});

test('extractXhsState 兼容 explore 路径（noteDetailMap）', () => {
  const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"64":{
    "note":{"title":"秋冬美拉德穿搭","desc":"今天分享三套美拉德配色","imageList":[{"urlDefault":"//ci.xiaohongshu.com/a.jpg"}]}
  }}}}</script>`;
  const s = extractXhsState(html)!;
  assert.equal(s.title, '秋冬美拉德穿搭');
  assert.equal(s.description, '今天分享三套美拉德配色');
  assert.deepEqual(s.imageUrls, ['https://ci.xiaohongshu.com/a.jpg']);
});

test('extractXhsState 兼容 discovery/item 路径（normalNotePreloadData.imagesList）', () => {
  const html = `<script>window.__INITIAL_STATE__={"noteData":{"normalNotePreloadData":{
    "title":"7.1晚霞实况","desc":"拍摄正常穿搭","imagesList":[{"url":"//sns-webpic.xhscdn.com/b.jpg","urlSizeLarge":"x"}]
  }}}</script>`;
  const s = extractXhsState(html)!;
  assert.equal(s.title, '7.1晚霞实况');
  assert.equal(s.description, '拍摄正常穿搭');
  assert.deepEqual(s.imageUrls, ['https://sns-webpic.xhscdn.com/b.jpg']);
});

test('extractXhsState 容忍页面里的 undefined 字面量 / 缺 state 返回 null', () => {
  const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{}}}</script>`;
  assert.equal(extractXhsState(html), null);
  assert.equal(extractXhsState('<html></html>'), null);
  const withUndef = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"1":{"note":{"title":"T","imageList":undefined}}}}}</script>`;
  const s = extractXhsState(withUndef)!;
  assert.equal(s.title, 'T');
  assert.deepEqual(s.imageUrls, []);
});

test('parseShareText 首行当标题、去话题标签、压缩空白', () => {
  const text = `初秋氛围感穿搭🍂\n\n这套燕麦色针织真的绝了\n#穿搭 #初秋 #针织开衫\n#OOTD`;
  const t = parseShareText(text);
  assert.equal(t.title, '初秋氛围感穿搭🍂');
  assert.equal(t.description, '初秋氛围感穿搭🍂 这套燕麦色针织真的绝了'); // 标题进正文无害，供分析用
  assert.ok(t.text === text);
});
