// HOME-업무일지홈(2026-10-30 명진 시안 v2): 홈 = 업무일지. 요약 줄 숫자 규칙과 화면 순서·메뉴 정의를 본다(DOM 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

globalThis.window ??= {KPTURuntime: null, addEventListener() {}};
const {summaryParts} = await import('../app/home-summary.js');
const read = rel => readFileSync(new URL('../app/' + rel, import.meta.url), 'utf8');

test('요약 줄: 나한테 온 요청 = asks, 챙길 것 = 나머지 처리 전, 정리 안 된 것 = 업데이트 미분류; 모르면 숨김', () => {
  assert.deepEqual(summaryParts({update: 4, todo: 2, asks: 2}), {asks: 2, todos: 0, unsorted: 4});
  assert.deepEqual(summaryParts({update: 0, todo: 5, asks: 1}), {asks: 1, todos: 4, unsorted: 0});
  assert.deepEqual(summaryParts({update: 3, todo: 0, asks: null}), {asks: 0, todos: 0, unsorted: 3});
  assert.equal(summaryParts({update: null, todo: 1, asks: 0}), null);
  assert.equal(summaryParts({}), null);
});

test('홈 순서: 날짜 줄 → 요약 → 업데이트 입력줄 → [그날 일정 | 할 일] → 오늘 한 일 → 주간보고 재료·그 밖의 기록', () => {
  const src = read('journal.js');
  const at = s => { const i = src.indexOf(s); assert.ok(i > 0, s); return i; };
  const order = ['data-journal-days', 'data-home-summary', 'home-quick-placeholder', 'data-journal-schedule', 'data-journal-tasks', 'data-journal-done-day', 'data-journal-materials'].map(at);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(src, /mountRadar|data-journal-radar/);
  assert.match(read('index.html'), /<section id="homeView" class="view-panel hidden">\s*<div id="journalRoot" class="journal"><\/div>/);
  assert.doesNotMatch(read('index.html'), /id="journalView"|data-view="journal"|data-home-cards/);
});

test('메뉴: [일정] 묶음에 업무일지가 없고, 옛 journal 주소·이동은 홈으로', async () => {
  const menu = await import('../app/menu-model.mjs');
  const cal = menu.itemOf('calendar');
  assert.deepEqual(cal.group, ['calendar', 'tasks', 'diary']);
  assert.deepEqual(cal.pc, ['tasks', 'diary']);
  assert.match(read('app-router.js'), /VIEW_ALIAS=\{[^}]*journal:'home'\}/);
  assert.match(read('app-router.js'), /home:\['day','mode'\]/);
  assert.match(read('view-loader.js'), /VIEW_ALIAS=\{[^}]*journal:'home'\}/);
  assert.match(read('view-loader.js'), /async function home\(\)\{ await module\('\.\/journal\.js'\)/);
});

test('옛 홈 칸 화면 파일은 없고, 수집 시각·AI 사용량은 내 프로필에서 연다', () => {
  for (const f of ['home-read.js', 'home-read.css', 'home-fill.js', 'home-edit.js', 'home-extra.js', 'home-cards-model.mjs', 'home-dashboard-v2.js']) {
    assert.throws(() => read(f), /ENOENT/, f);
  }
  const prof = read('profile-status.js');
  assert.match(prof, /mountCollectionStatus\(/); assert.match(prof, /mountAiUsageLine\(/);
  assert.match(read('profile-settings.js'), /import\('\.\/profile-status\.js'\)/);
});

test('할 일 줄: 기한은 공용 dueLabel + .task-due-text(진회색, 노란색 아님), 사업 보고 이름은 흐린 글씨', () => {
  const j = read('journal.js');
  assert.match(j, /class="task-due-text" data-journal-task-due/);
  assert.match(j, /class="task-meeting-text" data-journal-task-meeting/);
  assert.doesNotMatch(j, /사업 보고 후속/);
  assert.match(read('inbox-todos.js'), /class=\\"task-due-text\\" data-inbox-todo-due|class="task-due-text" data-inbox-todo-due/);
  assert.match(read('google-tasks.js'), /class="task-due-text" data-gt-linked-due/);
  const css = read('ui-standard.css');
  const rule = css.match(/#appView \.task-due-text,\.modal \.task-due-text\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /color:var\(--kptu-muted\)/);
  assert.doesNotMatch(rule, /warning|yellow|basket/);
  assert.match(css, /\.task-meeting-text\{[^}]*color:var\(--kptu-faint\)/);
});
