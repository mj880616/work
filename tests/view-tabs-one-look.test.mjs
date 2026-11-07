import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {cssRules} from './button-six-kinds.mjs';
import {findViewTabs, scanViewTabs, isOneLook} from './view-tabs-one-look.mjs';
// UI-보기탭한모양(S52-17, 2026-11-07 명진 'ㅇ', 시안 docs/design/mockups/bottom-view-tabs.html): 보기 탭은 공용 ⑤ 보기 바꾸기 하나뿐. 재발 방지 시험(App smoke check).
const ui = readFileSync('app/ui-standard.css', 'utf8');
const six = ui.slice(ui.indexOf('/* ===== UI-버튼6가지'));

// 아직 공용 부품으로 옮기지 않은 보기 탭(두 번째 PR에서 전수 정리). 줄기만 하고 늘지 않는다 — 새 보기 탭은 처음부터 .ds-seg.
const PENDING = [
  'app/diary.js diary-source', // S52-20: 정리함 칩(inbox-chips·basket-filters)은 한 목록 [처리 전 ▾]로 바뀌어 없어짐
  'app/org-overview.js so-team-tabs', 'app/org-overview.js role=tab so-team-tab',
  'app/outside-statements.js os-tabs', 'app/outside-statements.js role=tab ?',
  'app/photos.js photos-chips', 'app/telegram-feed.js feed-vsw',
  'app/workplace-detail.js wd-tabs', 'app/workplace-detail.js role=tab wd-tab',
];

test('⑤ 보기 바꾸기 한 모양: 연한 알약 바탕 + 고른 칸만 흰 알약·굵게, 선·밑줄 없음, 넘치면 옆으로 밀기', () => {
  assert.match(six, /\.ds-seg\{[^}]*border:0;[^}]*border-radius:var\(--ds-chip-radius\);[^}]*background:var\(--ds-seg-track\) content-box;[^}]*overflow-x:auto;/);
  assert.match(six, /\.ds-seg\{[^}]*height:calc\(var\(--ds-compact-height\) \+ var\(--ds-seg-hit\) \* 2\)/, '보이는 높이 32px + 누르는 범위 여백');
  assert.match(six, /\.ds-seg button\.ds-seg-btn\{[^}]*border:0;[^}]*border-radius:var\(--ds-chip-radius\);[^}]*background:transparent;[^}]*color:var\(--kptu-muted\);[^}]*font-size:var\(--ds-compact-text\)/);
  assert.match(six, /\.ds-seg > button\.ds-seg-btn:is\(\[aria-pressed="true"\],\[aria-selected="true"\]\),\.ds-seg > \.ds-seg-group:has\(> button\.ds-seg-btn\[aria-pressed="true"\]\)\{ background:var\(--ds-seg-on\); box-shadow:var\(--ds-seg-on-shadow\); \}/);
  assert.match(six, /\.ds-seg button\.ds-seg-btn:is\(\[aria-pressed="true"\],\[aria-selected="true"\]\)\{ font-weight:var\(--ds-weight-strong\); \}/);
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

test('재발 방지: 화면의 보기 탭은 공용 ⑤ 부품만(옮길 목록은 줄기만)', () => {
  const tabs = scanViewTabs(), keyOf = t => `${t.file} ${t.key}`;
  const odd = tabs.filter(t => !isOneLook(t) && !PENDING.includes(keyOf(t))).map(keyOf);
  assert.deepEqual(odd, [], '보기 탭은 class="… ds-seg" 묶음 + class="ds-seg-btn" 칸으로 만드세요(docs/design-decisions.md UI-버튼기준 · UI-보기탭한모양).');
  const done = PENDING.filter(k => !tabs.some(t => keyOf(t) === k && !isOneLook(t)));
  assert.deepEqual(done, [], '공용 부품으로 옮긴 탭은 이 시험의 PENDING 목록에서 지우세요.');
  for (const k of ['app/index.html schedule-switch', 'app/index.html calendar-view-switch', 'app/basket-notes.js nv-switch', 'app/journal.js journal-mode-switch'])
    assert.ok(tabs.some(t => keyOf(t) === k && isOneLook(t)), `${k}는 공용 ⑤`);
});

test('재발 방지: 화면 CSS는 보기 탭 모양(테두리·바탕·글자·높이)을 따로 정하지 않는다 — 자리만', () => {
  const names = ['ds-seg', 'ds-seg-btn', 'ds-seg-group', ...new Set(scanViewTabs().filter(isOneLook).map(t => t.key))];
  const hit = new RegExp(`\\.(${names.map(n => n.replace(/[-]/g, '\\-')).join('|')})(?![\\w-])`);
  const LOOK = /^(border(-[a-z-]+)?|outline|background(-color|-image)?|box-shadow|color|font-weight|font-size|height|min-height|line-height)$/;
  // 폰 아래 전환 줄(일정·노트)은 자리 규칙이 알약 밖 줄 바탕(아래 탭과 같은 색)만 칠한다.
  const DOCK = '#appView :is(.schedule-switch,.nv-switch):not([hidden])';
  // :not(…) 안에 이름이 있으면(공용 칸을 빼는 넓은 규칙) 그 규칙은 보기 탭을 잡지 않는다.
  const dropNot = sel => { let out = '', i = 0; while (i < sel.length) { if (sel.startsWith(':not(', i)) { let d = 0; for (; i < sel.length; i++) { if (sel[i] === '(') d++; else if (sel[i] === ')' && --d === 0) { i++; break; } } } else out += sel[i++]; } return out; };
  const bad = [];
  for (const f of readdirSync('app').filter(n => n.endsWith('.css'))) {
    let css = readFileSync(`app/${f}`, 'utf8');
    if (f === 'ui-standard.css') css = css.slice(0, css.indexOf('/* ===== UI-버튼6가지'));
    for (const [sel, body] of cssRules(css)) {
      if (!hit.test(dropNot(sel)) || /\ssvg$/.test(sel)) continue;
      for (const d of body.split(';')) {
        const m = d.match(/^\s*([a-z-]+)\s*:/);
        if (!m || !LOOK.test(m[1])) continue;
        if (sel === DOCK && /^(background|box-shadow)$/.test(m[1])) continue;
        bad.push(`${f}: ${sel.slice(0, 90)} { ${m[1]} }`);
      }
    }
  }
  assert.deepEqual(bad, [], '보기 탭 모양은 app/ui-standard.css "UI-버튼6가지" ⑤ 한 곳. 화면 CSS는 자리(여백·순서·위치)만.');
});
