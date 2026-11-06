import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scan, compare, cssDebt, htmlDebt, KIND_CLASSES} from './button-six-kinds.mjs';
// UI-버튼6가지(2026-11-06 명진 요청 23:23, 시안 승인): 버튼은 6가지뿐, 모양은 ui-standard.css 한 곳. 재발 방지 시험(App smoke check).
const ui = readFileSync('app/ui-standard.css', 'utf8');
const block = ui.slice(ui.indexOf('/* ===== UI-버튼6가지')); // 다른 규칙의 설명에 이름이 나와도 묶음 머리부터

test('6가지 공용 규칙이 ui-standard.css 한 곳에 있고 값은 토큰만 쓴다', () => {
  assert.ok(ui.indexOf('/* ===== UI-버튼6가지') > 0);
  assert.deepEqual(KIND_CLASSES, ['primary', 'secondary', 'ghost', 'danger', 'row-act', 'ds-chip', 'ds-seg-btn', 'icon-btn']);
  // ④ 칩: 알약, 28px, 고른 것만 선택 표시 색(연한 바탕 + 선)
  assert.match(block, /button\.ds-chip\{[^}]*height:var\(--ds-compact-height-sm\)[^}]*border-radius:var\(--ds-chip-radius\)/);
  assert.match(block, /button\.ds-chip:is\(\[aria-pressed="true"\],\[aria-checked="true"\]\)\{[^}]*background:var\(--ds-select-bg\)[^}]*border-color:var\(--ds-select-line\)/);
  // ⑤ 보기 바꾸기: 붙은 칸, 32px, 고른 칸은 연한 바탕 + 아래 선
  assert.match(block, /\.ds-seg\{[^}]*height:var\(--ds-compact-height\)[^}]*border-radius:var\(--ds-radius-control\)/);
  assert.match(block, /\.ds-seg button\.ds-seg-btn\[aria-pressed="true"\],\.ds-seg-group > button\.ds-seg-btn\[aria-pressed="true"\] \+ button\.ds-seg-btn\{[^}]*background:var\(--ds-select-bg\)/);
  assert.match(block, /\.ds-seg button\.ds-seg-btn\[aria-pressed="true"\]::before\{[^}]*background:var\(--ds-select-line\)/);
  assert.match(block, /\.ds-seg > :is\(button\.ds-seg-btn,\.ds-seg-group\) \+ :is\(button\.ds-seg-btn,\.ds-seg-group\)\{ border-left:/, '칸 사이 선, 붙은 두 칸 안은 선 없음');
  // ⑥ 아이콘: 선·바탕 없음
  assert.match(block, /button\.icon-btn\{[^}]*border-color:transparent;[^}]*background:transparent;/);
  // 누르는 범위 44px(보이는 크기와 상관없이)
  assert.match(block, /:is\(button\.ds-chip,\.ds-seg button\.ds-seg-btn\)::after\{[^}]*height:var\(--kptu-touch-target,44px\)/);
  // 꺼짐은 흐리게만
  assert.match(block, /:disabled\{ opacity:\.5;/);
  // 숫자 값을 새로 정하지 않는다(px·색 글자 없이 토큰만)
  const rules = block.slice(block.indexOf('*/') + 2);
  assert.doesNotMatch(rules.replace(/var\([^)]*\)/g, '').replace(/outline:2px solid/g, ''), /\b\d+px\b|#[0-9a-f]{3,8}\b|rgb\(/i, '초점 테두리(2px, 다른 버튼과 같음) 말고는 숫자 없이 토큰');
});

test('검사기: 화면 CSS의 버튼 높이·모서리·바탕·테두리 선언, 6가지 클래스 없는 버튼을 센다', () => {
  assert.equal(cssDebt('x.css', '#a button{height:40px;color:red;border-radius:12px} .row{height:3px}'), 2);
  assert.equal(cssDebt('ui-standard.css', 'button.ds-chip{height:1px} #homeView button{height:1px}'), 1, '공용 규칙은 세지 않고 화면 id 규칙만');
  assert.equal(cssDebt('x.css', '@media (min-width:1px){ .x .icon-btn{background:none} } @keyframes k{from{height:0}}'), 1);
  assert.equal(htmlDebt('<button class="secondary">a</button><button type="button">b</button><button class="x ds-chip">c</button><button class="mini">d</button>'), 2);
  assert.equal(htmlDebt('<button class="icon-btn gt-menu"></button><button class="${on?\'primary\':\'secondary\'}"></button>'), 0);
});

test('재발 방지: 6가지 밖 버튼·화면별 버튼 모양 선언이 기준표보다 늘지 않는다', () => {
  const baseline = JSON.parse(readFileSync(new URL('./button-six-kinds-baseline.json', import.meta.url), 'utf8'));
  const {grown, reduced} = compare(scan(), baseline);
  if (reduced.length) console.info('UI-버튼6가지 빚이 줄었어요. tests/button-six-kinds-baseline.json 숫자도 줄여 주세요:\n' + reduced.join('\n'));
  assert.deepEqual(grown, [], '새 버튼은 6가지 클래스(primary·secondary·danger·row-act·ds-chip·ds-seg-btn·icon-btn) 중 하나를 쓰고, '
    + '높이·모서리·바탕·테두리는 화면 CSS에 쓰지 말고 app/ui-standard.css "UI-버튼6가지" 규칙에 맡기세요(docs/design-decisions.md UI-버튼6가지).');
});

test('정리한 화면 ③ 홈: 머리 줄·빠른 입력 전환은 6가지 부품만, 화면 CSS에 그 버튼 모양 규칙 없음', () => {
  const journal = readFileSync('app/journal.js', 'utf8'), quick = readFileSync('app/home-quick.js', 'utf8');
  assert.match(journal, /class="icon-btn" data-journal-prev[^>]*>‹/);
  assert.match(journal, /class="icon-btn" data-journal-next[^>]*>›/);
  assert.match(journal, /class="secondary" data-journal-today>이번 주/);
  assert.match(journal, /class="journal-mode-switch ds-seg"[^>]*><button type="button" class="ds-seg-btn" data-journal-mode="day"/);
  assert.match(quick, /class="home-quick-modes ds-seg"[^>]*><span class="home-quick-update-split ds-seg-group"><button type="button" class="ds-seg-btn" data-quick-mode="update">/);
  assert.match(quick, /<button type="button" class="ds-seg-btn" data-quick-mode="task">/);
  const css = ['journal.css', 'ui-standard.css', 'quick-controls.css'].map(f => readFileSync(`app/${f}`, 'utf8')).join('\n');
  assert.doesNotMatch(css, /\.journal-mode-switch button/, '[하루|주간 정리] 칸 모양은 공용 ⑤');
  assert.doesNotMatch(css, /\.journal-week-nav \.mini/, '‹ › [이번 주] 모양은 공용 ⑥·②');
  assert.doesNotMatch(css, /\.home-quick-modes button[^\n{]*\{[^}]*(border|background|height|border-radius)\s*:/, '[업데이트 ▾][할 일] 모양은 공용 ⑤');
});
