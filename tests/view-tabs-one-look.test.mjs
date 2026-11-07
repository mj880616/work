import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {cssRules} from './button-six-kinds.mjs';
import {findViewTabs, scanViewTabs, isOneLook} from './view-tabs-one-look.mjs';
// UI-보기탭한모양(S52-17, 2026-11-07 명진 'ㅇ', 시안 docs/design/mockups/bottom-view-tabs.html): 보기 탭은 공용 ⑤ 보기 바꾸기 하나뿐. 재발 방지 시험(App smoke check).
const ui = readFileSync('app/ui-standard.css', 'utf8');
const six = ui.slice(ui.indexOf('/* ===== UI-버튼6가지'));

// 이름에 '보기'가 들었지만 보기 탭이 아니라 목록 거르기 칩(④ 칩)인 줄. 보기 탭이 아니므로 ⑤ 대상이 아니다.
const FILTERS = {
  'app/basket.js inbox-chips': '챙길 것 [처리 전·보냄·이미 함·…] 상태 거르기',
  'app/basket.js basket-filters': '업데이트 [미분류·분류 완료·보류] 거르기',
};
// 이름에 '보기'가 없거나 화면 코드가 그때그때 그리는 보기 탭 — 따로 확인한다.
const MORE = [
  ['app/diary.js', /<div class="diary-source ds-seg" role="group" aria-label="일기 고르기"><button type="button" class="ds-seg-btn" data-diary-lv-filter="all"[^>]*>전체<\/button><button type="button" class="ds-seg-btn" data-diary-lv-filter="star"/],
  ['app/project-system-v3.js', /class="ps3-archive-tabs ds-seg"[^>]*><button type="button" class="ds-seg-btn" data-ps3-archive-tab="archive">보관<\/button><button type="button" class="ds-seg-btn" data-ps3-archive-tab="trash">/],
  ['app/team.js', /renderFilterChips\(host,\{label:'보기',[^\n]*?seg:true/],
  ['app/library-upload.js', /renderFilterChips\(host,\{label:'묶기',[^)]*seg:true/],
  ['app/home-quick.js', /class="home-quick-modes ds-seg"/],
];

test('⑤ 보기 바꾸기 한 모양: 연한 알약 바탕 + 고른 칸만 흰 알약·굵게, 선·밑줄 없음, 넘치면 옆으로 밀기', () => {
  assert.match(six, /\.ds-seg\{[^}]*border:0;[^}]*border-radius:var\(--ds-chip-radius\);[^}]*background:var\(--ds-seg-track\) content-box;[^}]*overflow-x:auto;/);
  assert.match(six, /\.ds-seg\{[^}]*height:calc\(var\(--ds-compact-height\) \+ var\(--ds-seg-hit\) \* 2\)/, '보이는 높이 32px + 누르는 범위 여백');
  assert.match(six, /\.ds-seg button\.ds-seg-btn\{[^}]*border:0;[^}]*border-radius:var\(--ds-chip-radius\);[^}]*background:transparent;[^}]*color:var\(--kptu-muted\);[^}]*font-size:var\(--ds-compact-text\)/);
  // 고른 칸: 누름 단추(aria-pressed)·탭(aria-selected)·라디오(aria-checked) 모두 같은 흰 알약.
  assert.match(six, /\.ds-seg > button\.ds-seg-btn:is\(\[aria-pressed="true"\],\[aria-selected="true"\],\[aria-checked="true"\]\),\.ds-seg > \.ds-seg-group:has\(> button\.ds-seg-btn:is\(\[aria-pressed="true"\],\[aria-checked="true"\]\)\)\{ background:var\(--ds-seg-on\); box-shadow:var\(--ds-seg-on-shadow\); \}/);
  assert.match(six, /\.ds-seg button\.ds-seg-btn:is\(\[aria-pressed="true"\],\[aria-selected="true"\],\[aria-checked="true"\]\)\{ font-weight:var\(--ds-weight-strong\); \}/);
  assert.doesNotMatch(six, /\.ds-seg[^{]*::before\{/, '고른 칸 밑줄 없음');
  assert.doesNotMatch(six, /\.ds-seg[^{]*\{[^}]*border-left:/, '칸 사이 선 없음');
  const tokens = readFileSync('app/theme-tokens.css', 'utf8');
  for (const t of ['--ds-seg-track:', '--ds-seg-on:', '--ds-seg-on-shadow:', '--ds-seg-inset:', '--ds-seg-gap:', '--ds-weight-strong:']) assert.ok(tokens.includes(t), t);
});

test('검사기: role=group·tablist + aria-label에 "보기"인 묶음과 role=tab 버튼을 찾는다', () => {
  const ok = findViewTabs('x.js', '<div class="a ds-seg" role="group" aria-label="노트 보기"><button class="ds-seg-btn">가</button><button class="ds-seg-btn">나</button></div>');
  assert.equal(ok.length, 1); assert.ok(isOneLook(ok[0]));
  const bad = findViewTabs('x.js', '<span class="b" role="group" aria-label="사진 보기"><button class="x">가</button></span><div role="group" aria-label="등록 종류"></div><button role="tab" class="t">다</button>');
  assert.deepEqual(bad.map(t => [t.key, isOneLook(t)]), [['b', false], ['role=tab t', false]]);
  const half = findViewTabs('x.js', '<div class="c ds-seg" role="tablist" aria-label="News 보기"><button class="ds-seg-btn">가</button><button>나</button></div>');
  assert.equal(isOneLook(half[0]), false, '칸 하나라도 공용 칸이 아니면 실패');
});

test('재발 방지: 화면의 보기 탭은 공용 ⑤ 부품만(일정·노트·홈·사진·자료실·담당조직·사업 보고·News·일기·텔레그램·사업영역 보관)', () => {
  const tabs = scanViewTabs(), keyOf = t => `${t.file} ${t.key}`;
  const odd = tabs.filter(t => !isOneLook(t) && !FILTERS[keyOf(t)]).map(keyOf);
  assert.deepEqual(odd, [], '보기 탭은 class="… ds-seg" 묶음 + class="ds-seg-btn" 칸으로 만드세요(docs/design-decisions.md UI-버튼기준 · UI-보기탭한모양).');
  for (const k of Object.keys(FILTERS)) assert.ok(tabs.some(t => keyOf(t) === k), `${k}가 없어졌으면 FILTERS에서 지우세요`);
  for (const k of ['app/index.html schedule-switch', 'app/index.html calendar-view-switch', 'app/basket-notes.js nv-switch', 'app/journal.js journal-mode-switch',
    'app/photos.js photos-chips', 'app/diary.js diary-source', 'app/org-overview.js so-team-tabs', 'app/workplace-detail.js wd-tabs', 'app/outside-statements.js os-tabs', 'app/telegram-feed.js feed-vsw'])
    assert.ok(tabs.some(t => keyOf(t) === k && isOneLook(t)), `${k}는 공용 ⑤`);
  for (const [f, re] of MORE) assert.match(readFileSync(f, 'utf8'), re, f);
  // 그때그때 그리는 보기 줄(사업 보고·자료실 묶기)은 공용 renderFilterChips의 seg:true가 ⑤ 클래스를 붙인다.
  const chips = readFileSync('app/filter-chips.js', 'utf8');
  assert.match(chips, /if\(seg\)host\.classList\.add\('ds-seg'\)/);
  assert.match(chips, /button\.className=seg\?'ds-seg-btn':'quick-pill-button'/);
});

test('재발 방지: 화면 CSS는 보기 탭 모양(테두리·바탕·글자·높이)을 따로 정하지 않는다 — 자리만', () => {
  const names = ['ds-seg', 'ds-seg-btn', 'ds-seg-group', 'ps3-archive-tabs', 'libraryGroupBy', 'reportViewFilter', ...new Set(scanViewTabs().filter(isOneLook).flatMap(t => [t.key, ...t.classes]))];
  const hit = new RegExp(`[.#](${names.map(n => n.replace(/[-]/g, '\\-')).join('|')})(?![\\w-])`);
  const LOOK = /^(border(-[a-z-]+)?|outline|background(-color|-image)?|box-shadow|color|font-weight|font-size|height|min-height|line-height|padding(-[a-z-]+)?)$/;
  // 바탕 위아래 투명 여백(누르는 범위)만큼 바깥 여백을 빼 두었으므로, 위·아래 바깥 여백을 바꾸려면 --ds-seg-hit를 빼고 쓴다(줄 높이가 늘지 않게).
  const MARGIN = /^(margin|margin-top|margin-bottom|margin-block)$/;
  // 폰 아래 전환 줄(일정·노트)은 자리 규칙이 알약 밖 줄 바탕(아래 탭과 같은 색)만 칠한다.
  const DOCK = '#appView :is(.schedule-switch,.nv-switch):not([hidden])';
  // :not(…) 안에 이름이 있으면(공용 칸을 빼는 넓은 규칙) 그 규칙은 보기 탭을 잡지 않는다.
  const dropNot = sel => { let out = '', i = 0; while (i < sel.length) { if (sel.startsWith(':not(', i)) { let d = 0; for (; i < sel.length; i++) { if (sel[i] === '(') d++; else if (sel[i] === ')' && --d === 0) { i++; break; } } } else out += sel[i++]; } return out; };
  // 위·아래가 0인 margin(떠 있는 자리 규칙의 margin:0 / margin:0 auto / margin:0 X 0 Y)은 여백 계산과 상관없다.
  const zeroBlock = (prop, v) => { if (prop !== 'margin') return false; const t = v.replace(/calc\([^;]*?\)\)?/g, 'C').trim().split(/\s+/); return t[0] === '0' && (t.length < 3 || t[2] === '0'); };
  const bad = [];
  for (const f of readdirSync('app').filter(n => n.endsWith('.css'))) {
    let css = readFileSync(`app/${f}`, 'utf8');
    if (f === 'ui-standard.css') css = css.slice(0, css.indexOf('/* ===== UI-버튼6가지'));
    for (const [sel, body] of cssRules(css)) {
      // 끌어 옮기기 자리 표시(.re-drop-*)·안쪽 그림(svg)·탭 안 숫자(.wd-tab-n 등)는 탭 모양이 아니다.
      if (!hit.test(dropNot(sel)) || /\ssvg$|\.re-(drop|dragging)/.test(sel)) continue;
      for (const d of body.split(';')) {
        const m = d.match(/^\s*([a-z-]+)\s*:\s*([\s\S]*)$/);
        if (!m) continue;
        if (MARGIN.test(m[1]) && !/--ds-seg-hit/.test(m[2]) && !zeroBlock(m[1], m[2])) { bad.push(`${f}: ${sel.slice(0, 90)} { ${m[1]} }`); continue; }
        if (!LOOK.test(m[1])) continue;
        if (sel === DOCK && /^(background|box-shadow)$/.test(m[1])) continue;
        bad.push(`${f}: ${sel.slice(0, 90)} { ${m[1]} }`);
      }
    }
  }
  assert.deepEqual(bad, [], '보기 탭 모양은 app/ui-standard.css "UI-버튼6가지" ⑤ 한 곳. 화면 CSS는 자리(여백·순서·위치)만.');
});
