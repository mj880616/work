// UI-색고르기통일(2026-10-29): 색을 고르는 칸은 모두 공용 부품(app/color-swatch.mjs) 하나.
// 고른 색이 다른 색으로 보이는 일이 다시 생기지 않도록, 새 색 고르기 칸이 공용 부품을 쓰지 않거나
// 선택 표시가 색 칸의 바탕·테두리를 바꾸면 실패한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {swatchHtml, swatchColor} from '../app/color-swatch.mjs';

const root = fileURLToPath(new URL('../app/', import.meta.url));
// 외부 라이브러리(판 번호가 든 폴더)와 PDF·한글 실험 도구 안쪽은 우리 화면이 아니다.
const skipDir = name => /\d+\.\d+/.test(name) || ['pdf-lib', 'node_modules'].includes(name);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (!skipDir(name)) walk(path, out); }
    else if (/\.(js|mjs|html|css)$/.test(name)) out.push(path);
  }
  return out;
}
const files = walk(root).map(path => ({path, name: relative(root, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8')}));
const code = files.filter(f => /\.(js|mjs|html)$/.test(f.name));
const styles = files.filter(f => f.name.endsWith('.css'));
const COLORISH = /colou?r|swatch/i;
// 색 견본 칸이 아닌 것: 편집기 글자색·형광펜 메뉴는 '가' 글자 견본이 든 목록 줄(✓ 표시, 바탕이 견본을 덮지 않음).
const NOT_A_SWATCH = [/data-ed-colou?r/, /data-ed-highlight/];
// 아직 공용 부품이 아닌 곳(이름을 적어 둔 예외만 허용, 새로 생기면 실패):
// 캘린더 목록의 캘린더별 색(calendar-persistence.js .cp-color)은 브라우저 기본 자유 색 칸이다. 칸 자체가 고른 색이고 덮는 표시가 없다.
// 정해진 색 줄로 바꿀지는 따로 정한다(PR 본문 '사용자 결정').
const NATIVE_ALLOWED = new Set(["calendar-persistence.js .type='color'"]);

test('공용 부품: 칸은 고른 색 그대로 채운 네모이고, 고름은 표시만 바뀐다', () => {
  const ids = ['#a4bdfc', '#7ae7bf', '#dbadff', '#ff887c', '#fbd75b', '#ffb878', '#46d6db', '#e1e1e1', '#5484ed', '#51b749', '#dc2127'];
  for (const color of ids) {
    const off = swatchHtml({color, label: color, attrs: {'data-x': '1'}});
    const on = swatchHtml({color, label: color, on: true, attrs: {'data-x': '1'}});
    assert.match(off, new RegExp(`<span class="ui-swatch-fill" aria-hidden="true" style="background:${color}"`));
    assert.equal(on.replace('aria-pressed="true"', 'aria-pressed="false"'), off, '고르면 aria 값만 바뀐다(색·모양 그대로)');
  }
  const radio = swatchHtml({color: 'var(--ds-project-blue)', label: '파랑', role: 'radio', on: true});
  assert.match(radio, /role="radio" aria-checked="true"/);
  assert.match(radio, /style="background:var\(--ds-project-blue\)"/);
});

test('공용 부품: 이상한 색 값·속성은 넣지 않는다', () => {
  for (const bad of ['red;background:url(x)', 'url(javascript:1)', 'expression(1)', '#12345', 'var(--x);color:red', '" onclick="x']) assert.equal(swatchColor(bad), '', bad);
  const html = swatchHtml({color: 'red;background:url(x)', label: '"><img>', text: '3', attrs: {onclick: 'x', 'data-ok': '"q'}});
  assert.doesNotMatch(html, /style=|onclick|<img/);
  assert.match(html, /data-text="3"/);
  assert.match(html, /data-ok="&quot;q"/);
});

test('색 고르기 칸은 모두 공용 부품을 쓴다(단추를 직접 만들지 않는다)', () => {
  const bad = [];
  for (const f of code) {
    if (f.name === 'color-swatch.mjs') continue;
    // ① 브라우저 기본 색 고르기 칸 금지
    for (const m of f.text.matchAll(/<input\b[^>]*\btype\s*=\s*["']color["']|\.type\s*=\s*["']color["']|setAttribute\(\s*["']type["']\s*,\s*["']color["']/g)) { if (!NATIVE_ALLOWED.has(`${f.name} ${m[0]}`)) bad.push(`${f.name}: 기본 색 고르기 칸 ${m[0].slice(0, 60)}`); }
    // ② 글로 쓴 단추 중 색·견본 이름이 든 것
    for (const m of f.text.matchAll(/<button\b([^>]*)>/g)) {
      const attrs = m[1].replace(/\sstyle\s*=\s*"[^"]*"/g, ''); // 줄 앞 색 점(style 변수)은 색 고르기가 아니다
      if (!COLORISH.test(attrs) || NOT_A_SWATCH.some(r => r.test(attrs))) continue;
      if (!/class\s*=\s*["'][^"']*\bui-swatch\b/.test(attrs)) bad.push(`${f.name}: ${m[0].slice(0, 100)}`);
    }
    // ③ createElement('button')로 만든 뒤 색·견본 이름을 붙인 것
    for (const m of f.text.matchAll(/createElement\(\s*["']button["']\s*\)/g)) {
      const after = f.text.slice(m.index, m.index + 400).split(/\breturn\b|\n/)[0];
      if (/(className\s*=|classList\.add\(|dataset\.|setAttribute\(\s*["']data-)[^;]*(colou?r|swatch)/i.test(after) && !/ui-swatch/.test(after)) bad.push(`${f.name}: ${after.slice(0, 120)}`);
    }
  }
  assert.deepEqual(bad, [], '색 고르기 칸은 app/color-swatch.mjs(swatchHtml·createSwatch)로 그린다');
});

test('공용 부품을 쓰는 곳(참고 일정 색·일정 색·프로젝트 색)', () => {
  const users = code.filter(f => /from\s+['"]\.\/color-swatch\.mjs['"]/.test(f.text)).map(f => f.name).sort();
  assert.deepEqual(users, ['calendar-plus.js', 'calendar-ref-settings.js', 'project-system-v3.js']);
});

test('색 칸의 모양·고름 표시는 ui-standard.css 공용 규칙만 정하고, 고름이 색을 덮지 않는다', () => {
  const bad = [];
  for (const f of styles) {
    const text = f.text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim(), body = m[2];
      if (/^@/.test(selector)) continue;
      const swatch = /\.ui-swatch\b|\.ui-swatch-fill\b/.test(selector);
      if (swatch && f.name !== 'ui-standard.css') bad.push(`${f.name}: ${selector} — 화면별 CSS가 색 칸을 바꿈`);
      // 옛 색 칸 이름이 다시 생기면 실패(공용 부품으로 옮겼음)
      if (/\.(ps-calref-color|calendar-color-swatch|ps3-color-option|ps3-color-swatch)\b/.test(selector)) bad.push(`${f.name}: ${selector} — 옛 색 칸 규칙`);
      // 고름 표시(aria-pressed·aria-checked·.selected)가 색 칸의 바탕·테두리 색을 바꾸면 고른 색이 덮인다.
      const picked = /aria-pressed|aria-checked|\.selected\b|\.active\b/.test(selector);
      if (picked && swatch && /\.ui-swatch-fill/.test(selector) && /(^|;)\s*(background|border(-[a-z]+)?-?color|border(-left|-right|-top|-bottom)?)\s*:/.test(body)) bad.push(`${f.name}: ${selector} — 고름이 색 네모를 덮음`);
    }
  }
  assert.deepEqual(bad, []);
});
