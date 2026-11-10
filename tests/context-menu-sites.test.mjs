import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// UI-우클릭전수: app/context-menu.js가 우클릭으로 눌러 주는 ⋯ 버튼이 있는 파일의 목록. 새 파일이 ⋯ 버튼을 넣으면 이 시험이
// 실패해서, 그 화면을 tests/app-e2e/context-menu-all.spec.mjs(공통 검사)에서 확인하고 아래 목록에 더하도록 한다.
const KNOWN = [
  'basket-link-records.js', 'basket-notes.js', 'basket.js', 'calendar-day-overflow.js', 'calendar-interactions-v2.js' /* 일정 수정 창 머리줄 ⋯(data-ctx="off", 우클릭은 달력 일정의 메뉴가 맡음) */, 'call-feed.js', 'diary-list.js', 'diary.js', 'google-tasks.js', 'inbox-todos.js' /* TODO-내일만 챙길 것 줄 ⋯ */, 'notice-box.mjs' /* UI-잊지말기줄단추: 잊지 말기 한 목록 줄마다 ⋯(공용 줄 부품, 메뉴는 forget-list.js) — 공통 우클릭이 그 줄 ⋯을 연다(tests/app-e2e/forget-row-buttons.spec.mjs) */,
  'folder-tree-ui.mjs' /* FOLDER-나무새기준: 공용 폴더 나무 줄의 ⋯(노트·자료실·파일·사진이 같은 부품) — 우클릭은 그 화면의 공통 검사가 본다 */, 'list-edit.mjs' /* S51-28 공용 '목록 고치기' 줄의 ⋯(분류 고치기·쟁의 단계 관리) — 우클릭은 공용 context-menu.js가 그 줄의 ⋯를 연다 */, 'journal-hwpx.js' /* WEEKLY-주요일정칸: 한글 파일 상자 투쟁 사업장 줄 ⋯(이번 주 보고에서 빼기) — 공통 우클릭이 그 줄 ⋯을 연다 */, 'journal-weekly.js', 'journal.js', 'ledger-browse.js', 'legacy/meeting-detail-patches.js', 'library-tree.js', 'library-upload.js',
  'meeting-columns.js', 'meeting-name-panel.js' /* S53-20 회의명 고르기 작은 창 줄 ⋯(data-ctx="off" — 고르기 창 안이라 우클릭 메뉴 없음) */, 'meeting-round-detail.js', 'now-highlights.js' /* S53-5 News [밑줄] 탭 줄 ⋯(메모·노트로·복사·지우기) — 공통 우클릭이 그 줄 ⋯을 연다 */, 'now-detail.js' /* S52-39 News 글 원문 칸 ⋯([모두 선택]·[복사]·[공유]) — 원문 위 우클릭은 tests/app-e2e/news-copy-select.spec.mjs(884·1440)가 본다 */, 'org-dispute-stage-ui.js', 'news-clipping.js' /* 뉴스 클리핑 머리 줄 ⋯(data-ctx="off", 도구 줄 메뉴라 우클릭 대상 아님) */, 'outside-statements.js' /* 바깥 성명 머리 줄 ⋯(data-ctx="off", 도구 줄 메뉴라 우클릭 대상 아님) */, 'photo-view.js', 'photos.js', 'project-system-v3.js', 'quick-links.js', 'reference-bundles.js', 'row-more.js' /* WEEKLY-화면디자인정리: 주간 정리 화면 줄 끝 ⋯(<details> 하나 + 메뉴 칸 하나) — 공통 우클릭이 그 줄 ⋯을 연다 */,
  'share-pages.js', 'suborganizations.js', 'task-inline.js', 'task-row-view.js', 'task-workflow.js', 'telegram-feed.js', 'workplace-detail.js'
];
const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const SKIP = new Set(['hwp-lab', 'markdown-lib', 'pdf-lib', 'editor-lib', 'node_modules']);
function walk(dir, base = '', out = []) {
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(join(dir, e.name), base + e.name + '/', out); }
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) out.push(base + e.name);
  }
  return out;
}
const code = text => text.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
// A ⋯ that is a button / summary label (">⋯<", "'⋯'", ">⋯</", a MORE constant), not a sentence that mentions ⋯.
const TRIGGER = />\s*[⋯⋮]\s*</;
const TRIGGER_JS = /(?:text:|textContent\s*=|,|=)\s*'[⋯⋮]'|MORE(?:_ICON)?\s*=\s*'<span[^']*>⋯/;

test('⋯ trigger files are all known (new ⋯ screens must join the right-click check)', () => {
  const found = walk(app).filter(f => { const t = code(readFileSync(join(app, f), 'utf8')); return TRIGGER.test(t) || TRIGGER_JS.test(t); }).sort();
  const unknown = found.filter(f => f !== 'context-menu.js' && !KNOWN.includes(f));
  assert.deepEqual(unknown, [], `새 ⋯ 버튼 파일: ${unknown.join(', ')} — tests/app-e2e/context-menu-all.spec.mjs에서 우클릭을 확인하고 KNOWN에 더하세요`);
});

test('data-ctx values are only area or off', () => {
  for (const f of walk(app)) {
    const t = code(readFileSync(join(app, f), 'utf8'));
    for (const m of t.matchAll(/data-ctx['"]?\s*[=:]\s*\\?["']([^"'\\]*)/g)) assert.ok(['area', 'off', 'screen'].includes(m[1]), `${f}: data-ctx="${m[1]}"`);
  }
});
