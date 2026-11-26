// 넣기 자동 점검(scripts/cc/merge-check.mjs) 판정 시험 — 가짜 PR 자료만 쓴다(OPS-넣기점검).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  judgePr, edgeFunctionsFor, importsOf, prLane, laneOfFile, loadLanes, pendingInteractionIds,
  idsMentioned, idHasTest, globToRegExp, formatTable, readFunctionImports,
} from '../scripts/cc/merge-check.mjs';

const lanesDoc = loadLanes();

const importGraph = {
  'supabase/functions/_shared/b.mjs': [],
  'supabase/functions/_shared/a.ts': ['supabase/functions/_shared/b.mjs'],
  'supabase/functions/alpha/index.ts': ['supabase/functions/_shared/a.ts'],
  'supabase/functions/beta/handler.ts': ['supabase/functions/_shared/b.mjs'],
  'supabase/functions/beta/index.ts': ['supabase/functions/beta/handler.ts'],
  'supabase/functions/gamma/index.ts': [],
};

const SI = `# 기준표

## 12. 옛 절
| ID | 기대 | 시험 |
| --- | --- | --- |
| Z1 | 옛것 | 만들 차례 |

## 13. 2026-11-26 확정 — 시험 붙을 차례

| ID | 기대 동작 | 대체하는 옛 줄 | 만드는 작업 | 시험 |
| --- | --- | --- | --- | --- |
| W1 | 밀기 | — | S70-60 | 만들 차례 |
| W3 | 오른쪽 밀기 | S8 | S70-64 | 만들 차례 |
| T11 | 합치지 않음 | — | S70-68 | 그 PR 시험 이름을 적을 차례 |
| D9 | 칩 | D1 | S70-79 | \`standard-interactions.spec.mjs\` D9 |
`;

const pendingIds = pendingInteractionIds(SI);

const greenChecks = [
  {name: 'browser-e2e', status: 'completed', conclusion: 'success'},
  {name: 'smoke', status: 'completed', conclusion: 'success'},
  {name: 'optional', status: 'completed', conclusion: 'skipped'},
];

function basePr(over = {}) {
  return {number: 1, title: '가짜', draft: false, body: '', mergeable: true, mergeable_state: 'clean', ...over};
}

function run({pr = basePr(), files = [], checks = greenChecks, openPrs = []} = {}) {
  return judgePr({pr, files, checks, required: ['browser-e2e']}, {lanesDoc, importGraph, pendingIds, openPrs});
}

const f = (filename, patch = '', status = 'modified') => ({filename, status, patch});

test('초록: 필수 검사 성공 + clean + 초안 아님, 경고 없음', () => {
  const r = run({files: [f('docs/ops/x.md')]});
  assert.equal(r.green, true);
  assert.equal(r.verdict, '초록');
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.warnings, []);
});

test('초록 아님: 초안·필수 검사 없음·실패·도는 중·충돌·blocked', () => {
  assert.ok(run({pr: basePr({draft: true, mergeable_state: 'draft'})}).reasons.includes('초안'));
  assert.ok(run({checks: greenChecks.slice(1)}).reasons.includes('필수 검사 browser-e2e 없음'));
  const failed = run({checks: [...greenChecks.slice(0, 1), {name: 'smoke', status: 'completed', conclusion: 'failure'}], pr: basePr({mergeable_state: 'unstable'})});
  assert.equal(failed.green, false);
  assert.ok(failed.reasons.some((x) => x.includes('실패 검사: smoke')));
  const pending = run({checks: [{name: 'browser-e2e', status: 'in_progress', conclusion: null}], pr: basePr({mergeable_state: 'blocked'})});
  assert.ok(pending.reasons.includes('필수 검사 browser-e2e 도는 중'));
  assert.ok(!pending.reasons.some((x) => x.startsWith('넣기 상태')), '다른 이유가 있으면 blocked는 따로 적지 않는다');
  assert.ok(run({pr: basePr({mergeable: false, mergeable_state: 'dirty'})}).reasons.includes('main과 충돌'));
  assert.ok(run({pr: basePr({mergeable_state: 'behind'})}).reasons.includes('넣기 상태 behind'));
});

test('범위: migration → DB 적용 필요, workflow 변경', () => {
  const r = run({files: [f('supabase/migrations/20261126000000_x.sql'), f('.github/workflows/app-smoke-check.yml')]});
  assert.ok(r.scope.includes('DB 적용 필요(1개 파일)'));
  assert.ok(r.scope.includes('workflow 변경(app-smoke-check.yml)'));
  assert.equal(r.green, true, '범위 표시는 초록을 막지 않는다');
});

test('범위: Edge 함수 직접 + _shared는 부르는 함수 전부(간접 포함)', () => {
  assert.deepEqual(edgeFunctionsFor(['supabase/functions/gamma/index.ts'], importGraph).functions, ['gamma']);
  const shared = edgeFunctionsFor(['supabase/functions/_shared/b.mjs'], importGraph);
  assert.deepEqual(shared.functions, ['alpha', 'beta']);
  const r = run({files: [f('supabase/functions/_shared/b.mjs')]});
  assert.ok(r.scope.includes('Edge 배포: alpha, beta (_shared 1개 계산)'));
  assert.deepEqual(edgeFunctionsFor(['supabase/functions/_shared/a.ts'], importGraph).functions, ['alpha']);
});

test('import 읽기: from·동적 import·export from, 상대 경로만', () => {
  const text = `import {x} from '../_shared/a.ts';\nexport {y} from "./y.mjs";\nconst m = await import('../_shared/c.ts');\nimport 'npm:zod';\nimport z from 'jsr:@std/x';`;
  assert.deepEqual(importsOf(text, 'supabase/functions/alpha/index.ts').sort(), [
    'supabase/functions/_shared/a.ts', 'supabase/functions/_shared/c.ts', 'supabase/functions/alpha/y.mjs',
  ]);
});

test('실제 저장소 import 그림: _shared 파일 하나라도 부르는 함수가 잡힌다', () => {
  const graph = readFunctionImports();
  const anyShared = Object.values(graph).flat().find((p) => p.startsWith('supabase/functions/_shared/'));
  assert.ok(anyShared, '_shared를 부르는 함수가 저장소에 있다');
  assert.ok(edgeFunctionsFor([anyShared], graph).functions.length >= 1);
});

test('영역: lanes.json 패턴으로 판정, 같은 영역 열린 PR이 둘 이상이면 경고', () => {
  assert.equal(laneOfFile('app/folder-tree-ui.mjs', lanesDoc), '가');
  assert.equal(laneOfFile('app/row-swipe.js', lanesDoc), '나');
  assert.equal(laneOfFile('app/reading.js', lanesDoc), '다');
  assert.equal(laneOfFile('app/note-board.js', lanesDoc), '라');
  assert.equal(laneOfFile('app/global-search.js', lanesDoc), '마');
  assert.equal(laneOfFile('supabase/functions/library-files/index.ts', lanesDoc), '바');
  assert.equal(laneOfFile('app/library-drive-line.js', lanesDoc), '바', '위쪽 영역이 먼저');
  assert.equal(laneOfFile('app/calendar-plus.js', lanesDoc), '사');
  assert.equal(prLane(['docs/a.md', 'tests/x.test.mjs'], lanesDoc), null);
  assert.equal(prLane(['app/row-swipe.js', 'app/folder-tree-ui.mjs', 'app/files.js'], lanesDoc), '가');

  const files = [f('app/folder-tree-ui.mjs'), f('tests/app-e2e/a.spec.mjs'), f('app/release-notes/x.json')];
  const openPrs = [
    {number: 1, draft: false, lane: '가', files: ['app/folder-tree-ui.mjs']},
    {number: 7, draft: false, lane: '가', files: ['app/files.js']},
    {number: 8, draft: true, lane: '가', files: ['app/files.js']},
  ];
  const r = run({files, openPrs});
  assert.equal(r.lane, '가. 폴더·목록·끌기');
  assert.ok(r.warnings.some((w) => w.startsWith('같은 영역(가. 폴더·목록·끌기) 열린 PR: #7')));
  assert.ok(!r.warnings.some((w) => w.includes('#8')), '초안은 세지 않는다');
  assert.equal(r.verdict, '초록·경고');
});

test('영역 사는 영역 겹침 경고 없이 같은 파일 겹침만 경고', () => {
  const files = [f('app/calendar-plus.js'), f('tests/app-e2e/a.spec.mjs'), f('app/release-notes/x.json')];
  const r1 = run({files, openPrs: [{number: 5, draft: false, lane: '사', files: ['app/home.js']}]});
  assert.deepEqual(r1.warnings, []);
  const r2 = run({files, openPrs: [{number: 5, draft: false, lane: '사', files: ['app/calendar-plus.js']}]});
  assert.ok(r2.warnings.includes('같은 파일을 고치는 열린 PR: #5'));
});

test('확정 동작 시험: 화면 파일을 바꿨는데 app-e2e 시험이 없으면 경고', () => {
  const r = run({files: [f('app/calendar-plus.js'), f('app/release-notes/x.json'), f('tests/calendar.test.mjs')]});
  assert.ok(r.warnings.includes('화면 파일을 바꿨는데 tests/app-e2e 시험 변경·추가 없음'));
  const ok = run({files: [f('app/calendar-plus.js'), f('app/release-notes/x.json'), f('tests/app-e2e/cal.spec.mjs')]});
  assert.ok(!ok.warnings.some((w) => w.includes('tests/app-e2e')));
});

test('확정 동작 시험: 13절 만들 차례 ID가 본문에 있는데 그 ID 시험이 없으면 경고', () => {
  assert.deepEqual(pendingIds, ['W1', 'W3'], '13절의 만들 차례만(다른 절·시험 이름 있는 줄 제외)');
  assert.deepEqual(idsMentioned('W1·W3 고침, W10·XW1 아님', pendingIds), ['W1', 'W3']);
  assert.equal(idHasTest('W1', ["+test('W1 끝까지 밀어도 메뉴만', async () => {"]), true);
  assert.equal(idHasTest('W1', ["-test('W1 옛 시험', async () => {"]), false, '지운 줄은 세지 않는다');
  assert.equal(idHasTest('W1', ['+// W1 메모만']), false, '시험 이름이어야 한다');

  const files = [
    f('app/row-swipe.js'), f('app/release-notes/x.json'),
    f('tests/app-e2e/standard-interactions.spec.mjs', "@@\n+test.describe('W1 밀기', () => {\n+  test('메뉴만', async () => {});"),
  ];
  const r = run({pr: basePr({body: '확정 동작 ID: W1, W3'}), files});
  assert.ok(r.warnings.includes('확정 동작 ID 시험 없음: W3'));
  assert.deepEqual(r.ids, ['W1', 'W3']);
});

test('release-notes: 화면이 바뀌는데 파일이 없으면 경고, 문서만이면 경고 없음', () => {
  const r = run({files: [f('app/calendar-plus.js'), f('tests/app-e2e/cal.spec.mjs')]});
  assert.ok(r.warnings.includes('화면이 바뀌는데 app/release-notes 파일 없음'));
  assert.deepEqual(run({files: [f('docs/x.md')]}).warnings, []);
});

test('glob: * 는 한 칸, ** 는 여러 칸', () => {
  assert.ok(globToRegExp('app/note-*').test('app/note-board.js'));
  assert.ok(!globToRegExp('app/note-*').test('app/note-x/y.js'));
  assert.ok(globToRegExp('supabase/functions/library-files/**').test('supabase/functions/library-files/a/b.ts'));
});

test('표 출력: 한국어 머리 + PR마다 한 줄, | 글자는 감싼다', () => {
  const out = formatTable([run({pr: basePr({number: 42}), files: [f('docs/x.md')]})]);
  const lines = out.split('\n');
  assert.equal(lines[0], '| PR | 판정 | 영역 | 범위 | 이유·경고 |');
  assert.equal(lines.length, 3);
  assert.match(lines[2], /^\| #42 \| 🟢 초록 \|/);
});
