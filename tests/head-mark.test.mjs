import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HEAD_MARK_HTML} from '../app/head-mark.mjs';
// S67-64 UI-윗줄한줄: 폰 화면 윗줄 맨 앞 WORK ON 아이콘은 head-mark.mjs 글자 하나. index.html 두 자리(앱 머리줄·사업 관리 첫 줄)는 같은 글자,
// 홈은 journal.js가 그 값을 넣는다. 아이콘은 앱 아이콘 그대로, 누르면 라우터 공용 길(data-goto)로 홈.
const html=readFileSync('app/index.html','utf8');
const journal=readFileSync('app/journal.js','utf8');
const ui=readFileSync('app/ui-standard.css','utf8');
test('the mark is the app icon and goes home through the shared router path',()=>{
  assert.match(HEAD_MARK_HTML,/^<a class="head-mark" href="\.\/\?view=home" data-goto="home" aria-label="홈"><img src="\.\/app-icon\.svg" width="20" height="20" alt=""><\/a>$/);
  assert.match(readFileSync('app/app-router.js','utf8'),/closest\?\.\('\[data-view\],\[data-goto\]'\)/);
});
// S70-57: 사업 관리도 앱 머리 줄(아이콘·이름·찾기 돋보기)을 쓰므로 index.html의 아이콘은 앱 머리 줄 한 곳이다.
test('index.html carries the same mark at the start of the phone head (사업 관리 first line has none)',()=>{
  assert.equal(html.split(HEAD_MARK_HTML).length-1,1);
  assert.ok(html.includes('<header class="mobile-shell-header" hidden>'+HEAD_MARK_HTML+'<span data-mobile-view-name>'));
  assert.ok(html.includes('<div class="toolbar report-top-line"><span class="report-filter-slot">'));
  assert.equal((html.match(/class="head-mark"/g)||[]).length,1,'no hand-written copies');
});
test('home head puts the shared mark first',()=>{
  assert.match(journal,/import \{HEAD_MARK_HTML\} from '\.\/head-mark\.mjs'/);
  assert.match(journal,/<div class="journal-head">\$\{HEAD_MARK_HTML\}<b class="journal-day-title"/);
  assert.doesNotMatch(journal,/class="head-mark"/);
});
test('one style block: phone only, 20px picture, 44px press area, head name 15px/500',()=>{
  const at=ui.indexOf('===== S67-64 UI-윗줄한줄');assert.ok(at>0);
  const block=ui.slice(at,ui.indexOf('/* =====',at+10));assert.ok(block.length>200);
  assert.match(block,/\.head-mark\{ display:none; \}\n@media\(max-width:760px\)\{/);
  assert.match(block,/\.head-mark > img\{ display:block; width:20px; height:20px; \}/);
  assert.match(block,/\.head-mark::after\{ content:""; position:absolute; left:-12px; right:-12px; top:-12px; bottom:-12px; \}/);
  assert.match(ui,/#appView > \.mobile-shell-header :is\(time,\[data-mobile-view-name\]\)\{ font-size:var\(--ds-text-head\); font-weight:var\(--ds-weight-medium\);/);
  assert.match(readFileSync('app/theme-tokens.css','utf8'),/--ds-text-head:15px;/);
  // 사업 관리: 같은 요소를 한 줄로 놓을 뿐, 숨기거나 덮어쓰지 않는다.
  assert.match(block,/#appView #meetingsView \.report-top > \.report-top-line\{ display:contents; \}/);
  assert.match(block,/#appView #meetingsView \.report-top > \.report-kind-bar\{ order:1; flex:0 1 auto; min-width:0; margin:0; flex-wrap:nowrap; overflow:hidden; \}/);
  // S67-75 UI-걸러보기칩하나(명진 A안): 상자 네 개가 줄에 다 안 들어갈 때 그 줄 자리를 비우는 규칙 하나만 예외다 — 상자는 칩이 여는 작은 창(.is-filter-panel)으로
  // 같은 요소 그대로 옮겨 보이므로 숨김이 아니라 자리 바꿈이다. 그 밖의 폰 규칙에는 숨김이 없다.
  const ONE_CHIP='#appView #meetingsView .report-top.is-filter-one > .report-kind-bar:not(.is-filter-panel){ display:none; }';
  assert.ok(block.includes(ONE_CHIP));
  assert.doesNotMatch(block.slice(block.indexOf('@media')).split('\n').filter(line=>line.trim()!==ONE_CHIP).join('\n'),/display:none|visibility:hidden/,'no hiding in the phone rules (only the one-chip swap)');
});
