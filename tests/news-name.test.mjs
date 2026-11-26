import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {ITEMS as MENU_ITEMS} from '../app/menu-model.mjs';
// S51-17 NEWS-전면개편 P5(설계 docs/design/news-overhaul.md 7.2절): 화면에 보이는 'Now' 글자가 남지 않았는지 본다.
// 고치지 않는 것: 지난 업데이트 기록(app/release-notes/), 화면에 안 보이는 이름(id outside·파일 이름·변수 KPTUNow 같은 낱말 속 Now)·주석, 바깥 라이브러리.

const APP = new URL('../app/', import.meta.url).pathname;
const SKIP_DIRS = new Set(['release-notes', 'markdown-lib', 'node_modules']);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name) && !/^rhwp-/.test(name) && !/-\d+\.\d+/.test(name)) walk(p); continue; }
    if (/\.(m?js|html)$/.test(name)) files.push(p);
  }
})(APP);

// 주석을 뺀 글자: 줄 주석(//, 주소의 :// 제외)·블록 주석·HTML 주석.
const stripComments = src => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
// 낱말로 선 'Now'(앞뒤가 글자·숫자·_·$·.·- 가 아님 — Date.now·fontNow·KPTUNow·UI-Now는 아님).
const NOW_WORD = /(?<![A-Za-z0-9_$.\-])Now(?![A-Za-z0-9_$(])/;

test("화면 글자에 'Now'가 남지 않았다(업데이트 기록 폴더 제외)", () => {
  assert.ok(files.length > 50, '앱 파일을 찾지 못함');
  const hits = [];
  for (const f of files) {
    const lines = stripComments(readFileSync(f, 'utf8')).split('\n');
    lines.forEach((line, i) => { if (NOW_WORD.test(line)) hits.push(`${relative(APP, f)}: ${line.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits, []);
});

// S68-34(11/23 사용자 'News -> 읽을 거리 / 읽을 거리 -> 저장한 글'): 메뉴·제목·찾기 칸 등 화면 글자의 이름이 '읽을 거리'. id·주소(?view=news)·기능 키 outside는 그대로.
test("메뉴 이름은 '읽을 거리', id는 그대로 outside · 옛 읽을 거리 화면(reading)은 '저장한 글'", () => {
  const item = MENU_ITEMS.find(m => m.id === 'outside');
  assert.equal(item?.label, '읽을 거리');
  assert.equal(item?.view, 'outside');
  assert.equal(item?.feature, 'outside');
  assert.equal(MENU_ITEMS.find(m => m.id === 'reading')?.label, '저장한 글');
  const html = readFileSync(join(APP, 'index.html'), 'utf8');
  assert.match(html, /data-view="outside" href="\.\/\?view=news">읽을 거리</);
  assert.match(html, /data-view="outside">[^]*?<span>읽을 거리<\/span>/);
  assert.match(html, /data-view="reading" href="\.\/\?view=reading">저장한 글</);
  const top = readFileSync(join(APP, 'topbar-actions.js'), 'utf8');
  assert.equal((top.match(/outside:'읽을 거리'/g) || []).length, 2);
  assert.match(top, /reading:'저장한 글'/);
});

// 낱말로 선 'News'(requestNewsOpen·NEWS_HL·news-row 같은 코드 이름 속은 아님). 매체 이름·기사 제목은 서버 데이터라 앱 코드에 없다.
const NEWS_WORD = /(?<![A-Za-z0-9_$.\-])News(?![A-Za-z0-9_$(])/;
test("화면 글자에 'News'(옛 화면 이름)가 남지 않았다(주석·업데이트 기록 제외)", () => {
  const hits = [];
  for (const f of files) {
    const lines = stripComments(readFileSync(f, 'utf8')).split('\n');
    lines.forEach((line, i) => { if (NEWS_WORD.test(line)) hits.push(`${relative(APP, f)}: ${line.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits, []);
});
