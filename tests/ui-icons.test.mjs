// S51-25 LIB-폴더밖아이콘: 화면 아이콘은 공용 SVG 한 곳(app/tree-icons.js). 그림 문자(이모지)는 PC 글꼴에서 검은 덩어리로 깨지므로 화면 코드에 두지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {treeIconHtml, iconSvg, iconHtml, ICON_NAMES} from '../app/tree-icons.js';
import {folderIconHtml} from '../app/folder-look.js';

// 그림 문자: 이모지 묶음(U+1F300~)과 기기마다 그림으로 바뀌는 ⚠⛔❗. ★☆✓✕☐ 같은 글자 기호는 글꼴 글자라 그대로 둔다.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{26A0}\u{26D4}\u{2757}]|\\u\{1F[0-9A-Fa-f]{3}\}/u;

test("'폴더 밖'은 회색 점선 폴더 SVG, 최근·큰 파일·별표도 SVG(그림 문자 없음)", () => {
  const out = treeIconHtml('outside', {className: 'ft-ico'});
  assert.match(out, /class="ft-ico tree-ico-outside"/);
  assert.match(out, /<svg[^>]*><path[^>]*stroke-dasharray=/);
  for (const kind of ['recent', 'big', 'outside', 'starred', 'pc', 'ph', 'od', 'gd']) {
    const html = treeIconHtml(kind);
    assert.match(html, /<svg/, kind);
    assert.doesNotMatch(html, EMOJI, kind);
  }
});

test('안 고른 폴더도 그림 문자 대신 같은 폴더 그림(기본 노랑은 CSS 토큰)', () => {
  for (const open of [false, true]) {
    const html = folderIconHtml({}, {open});
    assert.match(html, /class="nx-ico fl-ico" aria-hidden="true"><svg/);
    assert.doesNotMatch(html, EMOJI);
  }
  assert.match(folderIconHtml({color: 3}), /data-fc="3"/);
  const css = readFileSync('app/folder-look.css', 'utf8');
  assert.match(css, /\.fl-ico \{[^}]*color:var\(--fl-ico,var\(--ds-folder-0-ico\)\)/);
});

test('공용 아이콘 이름마다 SVG 하나, 모르는 이름은 빈 글자', () => {
  for (const name of ICON_NAMES) {
    assert.match(iconSvg(name), /^<svg class="ui-ico-svg"[^>]*aria-hidden="true">.+<\/svg>$/, name);
    assert.match(iconHtml(name), new RegExp(`^<span class="ui-ico ui-ico-${name}" aria-hidden="true"><svg`), name);
  }
  assert.equal(iconSvg('없는 이름'), '');
  assert.equal(iconHtml('없는 이름'), '');
});

// 주석·글 내용(입력칸에 넣는 표시 글자, 마크다운 알림 머리)은 빼고, 화면 코드 줄에 그림 문자가 없다.
const SKIP_FILE = /^(markdown-view\.css|chatgpt-html\.mjs)$/;
const codeLines = src => src.replace(/\/\*[^]*?\*\//g, '').split('\n').filter(line => { const t = line.trim(); return t && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*'); })
  .map(line => line.replace(/\/\/ .*$/, '').replace(/\/\*.*?\*\//g, ''));
test('전수: app 화면 코드에 그림 문자 아이콘이 없다', () => {
  const bad = [];
  for (const name of readdirSync('app')) {
    if (!/\.(m?js|css|html)$/.test(name) || SKIP_FILE.test(name)) continue;
    codeLines(readFileSync(`app/${name}`, 'utf8')).forEach(line => { if (EMOJI.test(line)) bad.push(`${name}: ${line.trim().slice(0, 80)}`); });
  }
  assert.deepEqual(bad, []);
});
