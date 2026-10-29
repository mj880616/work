import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
// PHOTO-못받은사진(IMG-빈칸): 그림 칸 공용 규칙(app/img-slot.js)과, 그림을 띄우는 곳이 모두 그 규칙을 쓰는지(재발 방지) 본다.

// 지어낸 문서: 처리기 등록과 요소 몇 개만.
const listeners = {};
const el = tag => {
  const node = {tagName: tag.toUpperCase(), dataset: {}, children: [], attrs: {}, className: '', isConnected: true,
    append(...k) { for (const c of k) { c.parentNode = node; node.children.push(c); } },
    remove() { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(c => c !== node); node.parentNode = null; },
    setAttribute(k, v) { node.attrs[k] = v; }, removeAttribute(k) { delete node.attrs[k]; if (k === 'src') node.src = undefined; },
    querySelector(sel) { return sel === '[data-img-retry]' ? node.children.find(c => 'imgRetry' in c.dataset) || null : null; },
    closest() { return node.inButton ? {} : null; }};
  return node;
};
globalThis.document = {createElement: el, addEventListener(type, f) { (listeners[type] ||= []).push(f); }};
const slot = await import('../app/img-slot.js');

test('a cell is light gray while loading, the picture once drawn, a small ↻ when it could not come; ↻ asks again', () => {
  const box = el('span'), img = el('img');
  let asked = 0;
  slot.slotImg(box, img, 'https://t.example/a', {retry: () => { asked++; }});
  assert.match(box.className, /\bimg-slot\b/);
  assert.equal(box.dataset.imgState, 'loading');
  assert.equal(img.src, 'https://t.example/a');
  img.onerror();
  assert.equal(box.dataset.imgState, 'failed'); assert.equal(box.dataset.imgWhy, 'img');
  assert.equal(img.src, undefined, 'the failed address is taken off (no broken picture)');
  const mark = box.children.at(-1);
  assert.equal(mark.textContent, '↻'); assert.equal(mark.attrs['aria-label'], '다시 받기');
  assert.equal(mark.attrs.role, 'button', 'outside a button the ↻ is its own button');
  assert.equal(slot.slotRetry(box), true);
  assert.equal(asked, 1); assert.equal(box.dataset.imgState, 'loading');
  assert.ok(!box.children.some(c => 'imgRetry' in c.dataset), 'the ↻ goes away while asking again');
  assert.equal(slot.slotRetry(box), false, 'only a failed cell asks again');
  slot.slotFailed(box, null);
  assert.ok(!box.children.some(c => 'imgRetry' in c.dataset), 'no way to ask again: gray cell only');
  img.onload = null;
  slot.slotImg(box, img, 'https://t.example/b');
  img.onload();
  assert.equal(box.dataset.imgState, 'shown');
});

test('inside a button the ↻ is not a nested button; the document handler takes the tap and stops the cell from opening', () => {
  const box = el('span'); box.inButton = true;
  let asked = 0;
  slot.slotFailed(box, () => { asked++; }, 'x');
  const mark = box.children.at(-1);
  assert.equal(mark.attrs.role, undefined);
  const click = listeners.click.at(-1);
  let stopped = false;
  mark.closest = sel => (sel === '[data-img-retry]' ? mark : sel === '.img-slot' ? box : null);
  click({target: mark, preventDefault() {}, stopPropagation() { stopped = true; }});
  assert.equal(asked, 1); assert.equal(stopped, true);
});

test('safety net: any picture that fails is hidden everywhere, and shown again when it loads', () => {
  const img = el('img');
  listeners.error.at(-1)({target: img});
  assert.ok('imgBroken' in img.dataset);
  listeners.load.at(-1)({target: img});
  assert.ok(!('imgBroken' in img.dataset));
  const css = readFileSync(new URL('../app/base-ui.css', import.meta.url), 'utf8');
  assert.match(css, /img\[data-img-broken\]/);
  assert.match(css, /\.img-slot:not\(\[data-img-state="shown"\]\) img/);
  assert.match(css, /img:not\(\[src\]\)/);
});

// 재발 방지: 앱 안에서 <img>를 만드는 파일은 공용 칸(img-slot.js)을 쓴다. 예외는 까닭과 함께 여기에만 둔다.
const LIB = /^(legacy|editor-lib|pdf-lib|markdown-lib|hwp-lab|rhwp)/;
const ALLOW = new Map([
  ['img-slot.js', '공용 칸 자체'],
  ['photo-share.js', '<img>가 그린 바이트를 읽기만 함(주석)'],
  ['diary.js', '고른 파일의 기기 안 미리보기(받기 아님) — 실패는 안전망이 감춤'],
  ['report-photo-row.js', '고른 파일의 기기 안 미리보기(받기 아님) — 실패하면 그림을 빼고 확장자만'],
  ['markdown-view.js', '글 안 외부 그림 주소(링크 칩) — 실패하면 그림을 빼고 링크 글자만'],
  ['page-design-core.js', '공유(공개) 페이지 글 렌더 — 실패한 그림을 뺌(Web1, 앱 밖)'],
  ['ed-render.mjs', '노트·공유 페이지 공용 렌더 — 노트 사진은 note-body.js가 공용 칸으로 채움'],
]);
const files = readdirSync(new URL('../app/', import.meta.url), {recursive: true}).map(String)
  .filter(f => /\.(m?js)$/.test(f) && !LIB.test(f) && !f.includes('/'));

test('every app file that makes an <img> uses the shared cell (img-slot.js), or is a listed exception', () => {
  const makers = files.filter(f => /createElement\(\s*['"]img['"]\s*\)|<img[\s>]/.test(readFileSync(new URL('../app/' + f, import.meta.url), 'utf8')));
  assert.ok(makers.length >= 8, `found ${makers.length}`);
  for (const f of makers) {
    if (ALLOW.has(f)) continue;
    const src = readFileSync(new URL('../app/' + f, import.meta.url), 'utf8');
    assert.match(src, /from '\.\/img-slot\.js'/, `${f}: 그림 칸은 img-slot.js(받는 중 회색·못 받음 ↻)를 쓴다`);
  }
});

test('no big fallback letters on a picture: no "원드라이브 사진" alt, no "사진" mark, no loading/failure sentences in photo cells', () => {
  for (const f of files) {
    const src = readFileSync(new URL('../app/' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /원드라이브 사진'/, f);
    assert.doesNotMatch(src, /diary-photo-mark/, f);
    assert.doesNotMatch(src, /사진을 불러오는 중|사진을 불러오지 못했어요/, f);
  }
  for (const f of readdirSync(new URL('../app/', import.meta.url)).filter(f => f.endsWith('.css'))) {
    assert.doesNotMatch(readFileSync(new URL('../app/' + f, import.meta.url), 'utf8'), /diary-photo-mark/, f);
  }
});
