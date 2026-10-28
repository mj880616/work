import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// UI-화면정리 C(2026-10-28 명진 요청 20:03, B단계 남은 일): 편집 도구줄 하나로·추가 버튼 자리·위쪽 빈 띠·사업 보고 중복의 재발 방지.
// 기록은 docs/design-decisions.md "UI-화면정리 C". ⋯ 점 모양(사업 보고 화면 포함)은 tests/ui-cleanup-b.test.mjs가 본다.
const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const SKIP = new Set(['hwp-lab', 'markdown-lib', 'pdf-lib', 'editor-lib', 'node_modules', 'legacy']);
function walk(dir, base = '', out = []) {
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !/-\d+\.\d+/.test(e.name)) walk(join(dir, e.name), base + e.name + '/', out); }
    else out.push(base + e.name);
  }
  return out;
}
const files = walk(app);
const read = f => readFileSync(join(app, f), 'utf8');
const noComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const selectorsOf = css => [...noComments(css).matchAll(/([^{}]+)\{/g)].flatMap(m => m[1].split(',').map(s => s.trim())).filter(s => s && !s.startsWith('@'));

test('④ 화면 칸 전체의 버튼 기본 모양(#화면 button)이 글 편집 도구줄(.ed-editor)까지 덮지 않는다', () => {
  const bad = [];
  for (const f of files.filter(x => x.endsWith('.css') && x !== 'ed-doc.css')) {
    for (const s of selectorsOf(read(f))) {
      // 화면 id(들)만으로 그 아래 아무 버튼·아무 눌린 칸을 잡는 넓은 규칙은 ed-doc.css의 도구줄 규칙(.ed-bar button)보다 세서, 노트만 테두리 버튼이 되었다.
      if (/^(?:#appView\s+)?#[\w-]+View\s+(?:button|\[aria-pressed=["']?true["']?\])(?::(?:hover|focus|focus-visible|active))?$/.test(s) && !s.includes(':not(.ed-editor *)')) bad.push(`${f}: ${s}`);
    }
  }
  assert.deepEqual(bad, [], '넓은 버튼 규칙에는 :not(.ed-editor *)를 붙이세요(편집 도구줄 모양은 ed-doc.css 한 곳)');
  assert.match(read('basket.css'), /#basketView button:not\(\.ed-editor \*\) \{/);
});

test('④ 편집 도구줄은 폰·PC 같은 [· ▾] 한 칸(따로 떨어진 [·][▾] 두 칸 없음)', () => {
  const ed = read('ed-editor.js');
  assert.match(ed, /const PHONE_ORDER = \['style', 'strong', 'symDot', \.\.\.GROUP_KEYS, 'undo', 'redo'\];/);
  assert.match(ed, /\['symDot', '· ▾', '점 기호 고르기', 'sym'\]/);
  assert.doesNotMatch(ed, /dotNow|ed-pair|setLabel\(buttons\.symDot/);
  assert.doesNotMatch(read('ed-doc.css'), /ed-pair/);
});

// 화면의 새 항목 추가 버튼: PC는 화면 머리 오른쪽의 작은 [+ ○○], 폰은 하단 탭 위 동그란 [+] 하나(ui-standard.css 한 규칙).
const ADD = [
  ['#calendarView .calendar-toolbar #newEventBtn', 'index.html', /id="newEventBtn"/],
  ['#projectsView #newProjectBtn', 'index.html', /id="newProjectBtn"/],
  ['#libraryView #newDocumentBtn', 'index.html', /id="newDocumentBtn"[^>]*>\+ /],
  ['#meetingsView #newMeetingBtn', 'index.html', /id="newMeetingBtn"[^>]*>\+ /],
  ['#diaryView #newDiaryBtn', 'diary.js', /id="newDiaryBtn"/],
  ['#ledgerView button.lb-add', 'ledger-browse.js', /class="lb-add"[^>]*>\+ 기록하기</],
  ['#pagesView .sp-root button.primary[data-sp-new]', 'share-pages.js', /dataset:\{spNew:''\}, text:'\+ 새 공유 페이지'/],
];
test('⑥ 화면 추가 버튼은 모두 폰 동그란 [+] 한 규칙에 들고, 글자는 [+ ○○]', () => {
  const css = read('ui-standard.css');
  const fab = /#appView #calendarView \.calendar-toolbar #newEventBtn,([^{]+)\{\s*position:fixed;/.exec(css);
  assert.ok(fab, '폰 동그란 [+] 규칙');
  const list = ('#appView #calendarView .calendar-toolbar #newEventBtn,' + fab[1]).split(',').map(s => s.trim().replace(/^#appView /, ''));
  assert.deepEqual(list, ADD.map(a => a[0]));
  for (const [, f, mark] of ADD) assert.match(read(f), mark, f);
  // 아이콘·누르는 범위·자판 숨김도 같은 목록이다.
  const inner = ADD.map(a => a[0]).join(',');
  assert.equal(css.split(inner).length - 1, 4);
  assert.match(css, /#appView :is\(#projectsView,#libraryView,#meetingsView,#diaryView,#ledgerView,#pagesView\)\.view-panel\{ padding-bottom/);
  // 원장 [+ 기록하기]는 PC에서도 다른 화면처럼 주 색으로 채운 작은 버튼(흰 테두리 버튼 아님).
  assert.match(read('ledger-import.css'), /#appView #ledgerView \.lb-add\{[^}]*background:var\(--kptu-primary\); color:var\(--kptu-on-primary\);/);
});

test('① 위쪽 빈 띠: 노트 수정·통화·텔레그램 상세, 폰 노트 뒤로 가기, 폰 업무일지 날짜 한 번', () => {
  const basket = read('basket.css'), notes = read('basket-notes.js');
  assert.match(notes, /class="basket-back note-back" data-note-back aria-label="노트 목록으로"><span aria-hidden="true">‹<\/span> 노트<\/button><div class="note-head-main"/);
  assert.match(notes, /hasAttribute\('data-note-back'\)\) close\(\);/);
  assert.match(basket, /@media\(min-width:761px\)\{\s*#appView #basketView button\.note-back\{ display:none; \}\s*#appView #basketView > \[data-note-host\] > \[data-note-detail\] > \.basket-detail-head:has\(> \.note-head-main\[hidden\]\)\{ display:none; \}/);
  assert.match(read('feed.css'), /#appView \.feed-view \.feed-pane > \.feed-detail-head:first-child,\s*#appView \.feed-view \.feed-list > \.feed-head:first-child:has\(> \.back-text\)\{ margin:calc\(-1 \* \(var\(--kptu-touch-target,44px\) \+ 12px\)\) 0 12px;/);
  assert.match(read('journal.js'), /const noDayTitle = window\.matchMedia\?\.\('\(max-width:760px\),\(min-width:1024px\)'\);/);
});

test('③ 사업 보고 후속 할 일: 머리의 추가 단추는 [+] 하나, AI 후보 찾기는 그 입력 줄 안', () => {
  const t = read('meeting-round-detail.js');
  const head = /<div class="mtg-group-head"><h3 id="mrdTasksHead">후속 할 일<\/h3>([\s\S]*?)<\/div>/.exec(t);
  assert.ok(head);
  assert.equal((head[1].match(/<button/g) || []).length, 1);
  assert.match(head[1], /id="mrdAddTask"/);
  const form = /<div id="mrdTaskForm"[\s\S]*?<div id="mrdTaskStatus"/.exec(t);
  assert.match(form[0], /id="mrdMakeTodos"[^>]*>AI로 후보 찾기</);
  assert.doesNotMatch(t, /후속 할 일 만들기<\/button>/);
});
