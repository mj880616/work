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
      if (/^(?:#appView\s+)?#[\w-]+View\s+(?:button|\[aria-pressed=["']?true["']?\])(?::(?:hover|focus|focus-visible|active))?$/.test(s) && !/:not\(\.ed-editor \*(?:, [.\w-]+)*\)/.test(s)) bad.push(`${f}: ${s}`);
    }
  }
  assert.deepEqual(bad, [], '넓은 버튼 규칙에는 :not(.ed-editor *)를 붙이세요(편집 도구줄 모양은 ed-doc.css 한 곳)');
  // FOLDER-나무새기준(S51-12): 공용 폴더 나무 단추(.ft-btn)도 이 넓은 규칙에서 뺀다(모양은 folder-tree.css 한 곳).
  // S52-09 UI-요청상자통일: 공용 알림 상자(.nbx) 안 버튼도 뺀다(모양은 UI-버튼6가지·UI-요청상자통일 한 곳).
  // UI-보기탭한모양(S52-17): 공용 ⑤ 칸(.ds-seg-btn)도 뺀다.
  // UI-올리기진행표시(S52-15): 공용 올리는 줄(.up-rows)의 ✕·[다시]도 이 넓은 규칙에서 뺀다(모양은 ui-standard.css 공용 버튼).
  assert.match(read('basket.css'), /#basketView button:not\(\.ed-editor \*(?:, \.ft-btn)?(?:, \.nbx \*)?(?:, \.up-rows \*)?(?:, \.ds-seg-btn)?\) \{/);
});

test('④ 편집 도구줄은 폰·PC 같은 [· ▾] 한 칸(따로 떨어진 [·][▾] 두 칸 없음)', () => {
  const ed = read('ed-editor.js');
  assert.match(ed, /const PHONE_ORDER = \['style', 'strong', 'symDot', \.\.\.GROUP_KEYS, 'undo', 'redo'\];/);
  assert.match(ed, /\['symDot', '· ▾', '점 기호 선택', 'sym'\]/);
  assert.doesNotMatch(ed, /dotNow|ed-pair|setLabel\(buttons\.symDot/);
  assert.doesNotMatch(read('ed-doc.css'), /ed-pair/);
});

// 화면의 새 항목 추가 버튼: PC는 화면 머리 오른쪽의 작은 [+ ○○], 폰은 위쪽 줄 안 네모 작은 +(ui-standard.css 한 규칙).
// UI-동그란더하기삭제(11/09): 떠 있는 동그란 [+]는 없다. 자료실만 위쪽 한 줄 작업(LIB-위쪽한줄)이 들어갈 때까지 동그란 [+]로 남는다.
const SQUARE = [
  ['#calendarView .calendar-toolbar #newEventBtn', 'index.html', /id="newEventBtn"/],
  // BIZ-위쪽정돈(B안, 11/09): 사업 보고 [+]는 폰에서도 맨 위 줄 오른쪽 작은 아이콘(meeting-ui.css, 별도 시험 biz-top-tidy.spec.mjs).
  ['#diaryView #newDiaryBtn', 'diary.js', /id="newDiaryBtn"/],
  ['#ledgerView button.lb-add', 'ledger-browse.js', /class="lb-add"[^>]*>\+ 기록하기</],
  ['#pagesView .sp-root button.sp-add', 'share-pages.js', /class:'icon-btn sp-add'[^\n]*dataset:\{spAdd:''\}/],
];
test('⑥ 폰 추가 버튼은 위쪽 줄 안 네모 작은 + 한 규칙에 들고, 떠 있는 동그란 [+]는 자료실만', () => {
  const css = read('ui-standard.css');
  const rule = /#appView :is\(([^{}]+)\)\{\s*position:relative;/.exec(css);
  assert.ok(rule, '폰 네모 작은 + 규칙');
  assert.deepEqual(rule[1].split(',').map(s => s.trim()), SQUARE.map(a => a[0]));
  for (const [, f, mark] of SQUARE) assert.match(read(f), mark, f);
  // 아이콘·누르는 범위·초점 줄도 같은 목록이다.
  const inner = SQUARE.map(a => a[0]).join(',');
  assert.equal(css.split(inner).length - 1, 4);
  // 떠 있는 동그란 [+]: position:fixed + 원(border-radius:50%)은 자료실 [+ 자료 등록] 하나뿐이다.
  const round = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*border-radius:50%[^{}]*)\}/g)].filter(m => /position:\s*fixed/.test(m[2])).map(m => m[1].trim().replace(/\s+/g, ' '));
  assert.deepEqual(round, ['#appView #libraryView #newDocumentBtn']);
  assert.doesNotMatch(css, /button\.primary\[data-sp-new\]/);
  // 목록 끝 여백: 동그란 [+] 몫은 자료실만, 나머지는 전환 줄 몫만.
  assert.match(css, /#appView #libraryView\.view-panel\{ padding-bottom:calc\(var\(--kptu-switch-dock,0px\) \+ var\(--kptu-touch-target,44px\) \+ var\(--ds-fab-gap\)/);
  assert.match(css, /#appView :is\(#projectsView,#meetingsView,#ledgerView,#pagesView\)\.view-panel\{ padding-bottom:calc\(var\(--kptu-switch-dock,0px\) \+ 16px/);
  // 원장 [+ 기록하기]는 PC에서도 다른 화면처럼 주 색으로 채운 작은 버튼(흰 테두리 버튼 아님).
  assert.match(read('ledger-import.css'), /#appView #ledgerView \.lb-add\{[^}]*background:var\(--kptu-primary\); color:var\(--kptu-on-primary\);/);
  // 공유 페이지: 폰은 + 하나와 작은 메뉴, PC는 글자 버튼 둘(같은 창을 연다).
  const sp = read('share-pages.js');
  assert.match(sp, /phoneQuery\.matches\s*\?[\s\S]*?dataset:\{spAdd:''\}[\s\S]*?:\s*el\('div', \{class:'sp-head-actions btn-row'\}[\s\S]*?dataset:\{spNewHtml:''\}, text:'\+ HTML'[\s\S]*?dataset:\{spNew:''\}, text:'\+ 새 공유 페이지'/);
  assert.match(sp, /class="row-act" data-sp-add-action="page">새 공유 페이지<\/button><button type="button" class="row-act" data-sp-add-action="html">HTML 올리기</);
});

test('① 위쪽 빈 띠: 노트 수정·통화·텔레그램 상세, 폰 노트 뒤로 가기, 폰 업무일지 날짜 한 번', () => {
  const basket = read('basket.css'), notes = read('basket-notes.js');
  assert.match(notes, /const NOTE_BACK = '<button type="button" class="basket-back note-back" data-note-back aria-label="노트 목록으로"><span aria-hidden="true">‹<\/span> 노트<\/button>';/);
  assert.match(notes, /<div class="basket-detail-head">\$\{basketBackHtml\(selected\?\.id, NOTE_BACK, rt\)\}<div class="note-head-main"/);
  // S48-28: 쓰던 글이 있으면 공용 작은 확인창으로 묻고 닫는다(askClose → close).
  assert.match(notes, /hasAttribute\('data-note-back'\)\) void askClose\(b\);/);
  assert.match(basket, /@media\(min-width:761px\)\{\s*#appView #basketView button\.note-back\{ display:none; \}\s*#appView #basketView > \[data-note-host\] > \[data-note-detail\] > \.basket-detail-head:not\(:has\(> \[data-basket-return\]\)\):has\(> \.note-head-main\[hidden\]\)\{ display:none; \}/);
  assert.match(read('feed.css'), /#appView \.feed-view \.feed-pane > \.feed-detail-head:first-child,\s*#appView \.feed-view \.feed-list > \.feed-head:first-child:has\(> \.back-text\)\{ margin:0 0 12px;/);
  // UI-머리줄겹침: 음수 여백으로 위 머리줄 자리에 끌어올리지 않고, 빈 위 머리줄을 접는다(위에 다른 칸이 있어도 포개지지 않음).
  for (const f of ['feed.css', 'basket.css', 'ui-standard.css', 'reference-bundles.css']) assert.doesNotMatch(read(f), /margin:calc\(-1 \* \(var\(--kptu-touch-target/, f);
  assert.match(read('ui-standard.css'), /html:has\(#basketView:not\(\.hidden\) > \[data-basket-detail\]:not\(\[hidden\]\)\) #appView > \.mobile-shell-header\{ display:none; \}/);
  assert.match(read('journal.js'), /function syncDayTitle\(\) \{\s*const box = \$\('\[data-journal-day\]'\); if \(!box\) return;\s*box\.querySelector\('\[data-journal-day-title\]'\)\?\.remove\(\);/);
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

// UI-화면정리 C '구성 개선'(요청함 10/28 20:03 C-1~6, S48-46). 기록은 docs/design/ui-abc-c-status.md·docs/design-decisions.md "UI-화면정리 C 구성 개선".
test('C2 정리함은 PC에서 다른 화면처럼 본문 칸을 꽉 쓴다(예전 최대 폭 1100px 없음)', () => {
  const css = noComments(read('basket.css'));
  assert.doesNotMatch(css, /#basketView\s*\{[^}]*max-width:\s*1100px/);
  assert.match(css, /@media\(min-width:761px\)\{\s*#basketView\s*\{\s*max-width:none;/);
});

test('C4 업데이트 줄: 복사 아이콘 없이 ⋯ 하나, [복사]는 폰·PC 모두 ⋯ 메뉴 맨 위, [미분류]를 고른 동안 줄에 미분류를 또 쓰지 않음', () => {
  const js = read('basket.js');
  assert.doesNotMatch(js, /data-basket-row-copy/);
  assert.match(js, /function rowMenuItems\(note\)\{\s*return \[\.\.\.\(String\(note\.raw_text\|\|''\)\.trim\(\)\?\[\['copy','복사'\]\]:\[\]\)/);
  // S52-20 HOME-잊지말기한목록: 업데이트 줄도 한 목록의 공용 줄(notice-box rowHtml)이고 ⋯은 줄 끝 ⑥ 아이콘(늘 보임). [미분류]=처리 전 보기에서는 '미분류'를 쓰지 않는다.
  assert.match(js, /filter === 'unclassified' && label !== '미분류' \? label : ''/);
  assert.match(js, /tail: `<button type="button" class="icon-btn" data-basket-row-more=/);
});

test('C3 일기 달력은 폰·PC 모두 둥근 상자 대신 격자선 한 겹(칸 사이 0)', () => {
  const css = noComments(read('diary.css'));
  assert.match(css, /^#appView #diaryView \.diary-days\{ gap:0;/m);
  assert.match(css, /^#appView #diaryView \.diary-cell\{ border:0; border-right:[^}]*border-radius:0; \}/m);
});

test('C5 폰 하단바: 하단바에 칸이 없는 화면에서는 아무 칸도 칠하지 않는다(메뉴 창이 열려 있을 때만 [메뉴])', async () => {
  const {selectedMobileTab} = await import('../app/mobile-tab-selection.mjs');
  assert.equal(selectedMobileTab({view: 'library'}), null);
  assert.equal(selectedMobileTab({view: 'ledger'}), null);
  assert.equal(selectedMobileTab({view: 'library', menuOpen: true}), 'menu');
});
