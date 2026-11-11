// ORG-기록하나로 O-6(설계 docs/design/record-one.md 2-8·4절 '한글 파일'): 한글 파일 4. 1)·3. 2) 줄과 [확정] 사진이 화면 창 결과와 같은지.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as M from '../app/record-window-model.mjs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const W = '2026-11-16';
const R = (key, day, text, x = {}) => ({kind: 'org_update', key, org: 'o1', day, end_day: null, text, full: text, created_at: '2026-11-17T00:00:00Z', ...x});
const E = (key, day, text, org = 'o1') => ({kind: 'event', key, org, day, end_day: null, text});

test('파일 줄 = 창의 보인 줄(날짜 오름차순), 접힌 줄·뺀 줄은 빠짐', () => {
  const days = ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
  const records = days.map((d, i) => R('r' + i, d, '기록 ' + i));
  records.push(R('now', '2026-11-17', '이번 주 일'), R('gone', '2026-11-18', '뺀 일'));
  const marks = [{section: 'org', ref_kind: 'org_update', ref_key: 'gone', week_start: W, choice: 'out', report_body: null}];
  const cell = {mode: 'window', ...M.orgCell({org: 'o1', week: W, records, marks, order: 'desc'})};
  const lines = M.fileLines(cell);
  assert.ok(lines.length <= M.ORG_MAX);
  assert.deepEqual(lines.map(l => l.day), [...lines.map(l => l.day)].sort(), '늘 날짜 오름차순');
  assert.ok(lines.some(l => l.key === 'now'));
  assert.ok(!lines.some(l => l.key === 'gone'), '뺀 줄은 파일에 없음');
  assert.ok(!lines.some(l => cell.folded.some(f => f.id === l.id)), '접힌 줄은 파일에 없음');
});

test('사진 주: 사진 줄 + 확정 뒤 추가(새 판으로 확정하면 정식 줄), 옛 주: 옛 넣은 줄', () => {
  const cell = {mode: 'snapshot', lines: [R('b', '2026-11-18', '나중 일')], after: [R('a', '2026-11-17', '확정 뒤 기록')]};
  assert.deepEqual(M.fileLines(cell).map(l => l.key), ['a', 'b']);
  assert.deepEqual(M.fileLines({mode: 'old', lines: [{kind: 'old', key: 'x', day: '2026-11-02', text: '옛 줄'}]}).map(l => l.key), ['x']);
  assert.deepEqual(M.fileLines(null), []);
});

test('사진 한 칸 모양 = 화면 읽기(snapshotCell)와 같은 줄 id, 보고용 글 반영, 일정 seen 전부', () => {
  const lines = [R('r1', '2026-11-17', '보고용 글'), E('ev1', '2026-11-20', '일정 제목'), {kind: 'org_update', key: 'bad', day: '2026-11-17', text: '  '}];
  const row = M.snapshotRow({section: 'org', org: 'o1', label: ' A 지부 ', lines, seen: ['ev1', 'ev2', 'ev1']});
  assert.deepEqual(row, {section: 'org', ref_kind: 'organization', ref_key: 'o1', label: 'A 지부', seen_events: ['ev1', 'ev2'],
    lines: [{ref_kind: 'org_update', ref_key: 'r1', day: '2026-11-17', end_day: null, text: '보고용 글'}, {ref_kind: 'event', ref_key: 'ev1', day: '2026-11-20', end_day: null, text: '일정 제목'}]});
  const back = M.snapshotCell({rows: [row]}, 'o1');
  assert.deepEqual(back.lines.map(l => l.id), [M.lineId('org_update', 'r1'), M.lineId('event', 'ev1')]);
  assert.deepEqual([...back.seen], ['ev1', 'ev2']);
  assert.equal(M.snapshotRow({section: 'site', org: 'o1'}).section, 'site');
  assert.equal(M.snapshotRow({section: 'x', org: 'o1'}).section, 'org');
  assert.equal(M.SNAPSHOT_MAX_BYTES, 131072);
});

test('seen_events = 그 조직 창 안 일정 전부(다른 조직·창 밖 제외)', () => {
  const events = [E('in', '2026-11-20', 'a'), E('out', '2026-12-30', 'b'), E('other', '2026-11-20', 'c', 'o2'), R('rec', '2026-11-17', '기록')];
  assert.deepEqual(M.seenEvents({org: 'o1', week: W, events}), ['in']);
});

test('한글 파일: 전환 주부터는 창 결과(readWeekLines 안 읽음), 창을 다 읽기 전엔 만들지 않음, [확정] 성공 직후 사진', () => {
  const hw = read('app/journal-hwpx.js'), jr = read('app/journal.js'), view = read('app/record-window-view.js'), save = read('app/report-snapshot-save.js');
  assert.match(hw, /const weekRows = !fresh && orgs0\.length \? await readWeekLines/);
  assert.match(hw, /getWeek\(\)\.win\?\.\(\)/);
  assert.match(hw, /조직보고 표가 아직 다 나오지 않았어요/);
  assert.match(hw, /if \(b\.snapRows\) void saveReportSnapshot\(/);
  // 사진은 자료실 저장 성공(ok) 갈래 안에서만.
  const ok = hw.indexOf('if (ok && s.store) {'), snap = hw.indexOf('void saveReportSnapshot('), other = hw.indexOf('} else void recordIssued(s, b.bytes);');
  assert.ok(ok > 0 && snap > ok && snap < other);
  assert.match(jr, /win:fileWindow/);
  assert.match(jr, /weekWin\.fileReady\(\) \|\| !siteWin\.fileReady\(\)/);
  assert.match(view, /ctl\.fileLines = orgId => M\.fileLines\(ctl\.cell\(orgId, 'asc'\)\)/);
  // 사진 저장: 고칠 수 있는 칸만(고치기 = document_id·rows, 넣기 = 넷), confirmed_at은 서버가.
  assert.match(save, /body: \{document_id: doc, rows\}/);
  assert.match(save, /body: \{workspace_id: workspaceId, week_start: week, document_id: doc, rows\}/);
  assert.doesNotMatch(save, /confirmed_at:|\b(?:local|session)Storage\b/);
});

test('사진 저장: 고친 행이 있으면 넣지 않고, 없으면 넣는다, 128KiB 넘으면 보내지 않는다', async () => {
  const {saveReportSnapshot} = await import('../app/report-snapshot-save.js');
  const calls = [];
  const rt = hit => ({api: async (path, o) => { calls.push([o.method, path, Object.keys(o.body).sort()]); return o.method === 'PATCH' ? (hit ? [{week_start: W}] : []) : [{week_start: W}]; }});
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(await saveReportSnapshot({rt: rt(true), workspaceId: 'w', week: W, documentId: id, rows: []}), {ok: true, row: {week_start: W}});
  assert.equal(calls.length, 1);
  calls.length = 0;
  assert.equal((await saveReportSnapshot({rt: rt(false), workspaceId: 'w', week: W, documentId: 'not-uuid', rows: []})).ok, true);
  assert.deepEqual(calls.map(c => c[0]), ['PATCH', 'POST']);
  assert.deepEqual(calls[1][2], ['document_id', 'rows', 'week_start', 'workspace_id']);
  calls.length = 0;
  const big = [{lines: [{text: 'x'.repeat(140000)}]}];
  assert.deepEqual(await saveReportSnapshot({rt: rt(false), workspaceId: 'w', week: W, rows: big}), {ok: false, reason: 'size'});
  assert.equal(calls.length, 0);
  assert.equal((await saveReportSnapshot({rt: rt(false), workspaceId: 'w', week: 'x', rows: []})).ok, false);
  const fail = {api: async () => { throw Object.assign(new Error('x'), {status: 500}); }};
  const warn = console.warn; console.warn = () => {};
  try { assert.deepEqual(await saveReportSnapshot({rt: fail, workspaceId: 'w', week: W, rows: []}), {ok: false, reason: 'failed'}); } finally { console.warn = warn; }
});

test('O-6 ②: 옛 주별 조직보고 제안 보내기(weekly-org-suggest)·ai-assist org_week_lines는 없다, 원장 재료는 옮긴 줄을 뺀다', () => {
  const {existsSync} = require_fs();
  assert.equal(existsSync(new URL('../app/weekly-org-suggest.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../supabase/functions/ai-assist/org-week-lines.ts', import.meta.url)), false);
  for (const f of ['app/quick-save.js', 'app/workplace-detail.js', 'app/basket-classification.js', 'app/weekly-org-lines.js']) assert.doesNotMatch(read(f), /weekly-org-suggest|suggestOrgWeek|suggestFromLinks|fillMissing|org_week_lines/, f);
  const h = read('supabase/functions/ai-assist/handler.ts');
  assert.doesNotMatch(h, /"org_week_lines"|runOrgWeekLines|ORG_WEEK_/);
  assert.match(h, /export const ORG_MOVED_KINDS = Object\.freeze\(\["status_row", "weekly_line"\] as const\);/);
  assert.match(h, /&or=\(source_kind\.is\.null,source_kind\.not\.in\.\(\$\{ORG_MOVED_KINDS\.join\(","\)\}\)\)&select=id,organization_id,occurred_at,raw_text,source_kind/);
  assert.match(h, /if \(\(ORG_MOVED_KINDS as readonly unknown\[\]\)\.includes\(u\.source_kind\)\) continue;/);
});
function require_fs() { return {existsSync: p => { try { readFileSync(p); return true; } catch { return false; } }}; }

// BIZ-기록하나로 B-4 ①(설계 4절 '한글 파일'): 한글 파일 2. 1) 요약 표 내 줄 = 화면 사업요약 창(지금 상황 + 담당) 그대로. 이름·글은 합성 값.
test('B-4 ①: 2. 1) 파일 내 줄 = 창 결과 — 같은 이름 줄은 그 칸, 없는 줄은 글이 있을 때 더하고, 바탕에만 있는 내 줄은 비움, 남의 줄·표 틀 그대로', async () => {
  const {applyBizWindow, assembleDraft, editableRows, buildHwpx} = await import('../app/weekly-hwpx/draft.mjs');
  const {readReport, lineText} = await import('../app/weekly-hwpx/report.mjs');
  const {openHwpx, packHwpx} = await import('../app/weekly-hwpx/hwpx.mjs');
  const {zlib, SAMPLE} = await import('../scripts/weekly-hwpx/cli.mjs');
  const {makeFakeReport} = await import('../scripts/weekly-hwpx/fixture.mjs');
  const {prepareConfirmed, openConfirmed, startDraft} = await import('../app/weekly-hwpx/draft.mjs');
  const ME = '가짜담당 갑';
  const base = {summary: [
    {area: ['가짜 영역 가'], rows: [
      {task: ['가짜 과제 하나'], progress: ['- 지난주 글 하나'], paras: [], owner: [ME]},
      {task: ['가짜 과제 둘'], progress: ['- 지난주 글 둘'], paras: [], owner: null}, // 위 담당과 합친 칸(내 줄)
      {task: ['가짜 남 과제'], progress: ['- 남의 글'], paras: [], owner: ['가짜을']},
    ]},
    {area: ['가짜 주제·영역'], rows: [{task: ['가짜 주제/영역'], progress: ['- 주제 지난 글'], paras: [], owner: [ME]}]},
  ]};
  const rows = [
    {area: '가짜 영역 가', task: '가짜과제 하나', lines: ['지금 상황 첫 줄', '둘째 줄'], owner: ''},
    {area: '가짜 영역 가', task: '가짜 과제 새것', lines: ['새 과제 글'], owner: '가짜담당 갑/가짜병'},
    {area: '가짜 주제 · 영역', task: '', lines: [], owner: ''},
    {area: '가짜 새 영역', task: '', lines: ['새 영역 글'], owner: ''},
    {area: '가짜 영역 가', task: '가짜 남 과제', lines: [], owner: ''}, // 남의 줄과 같은 이름 + 빈 지금 상황 = 더하지 않음
  ];
  const w = applyBizWindow(base, ME, rows);
  assert.equal(base.summary[0].rows.length, 3, '원본 바탕은 그대로');
  const data = assembleDraft(w.base, {summary: w.summary, owners: w.owners});
  const grid = data.summary.map(a => [a.area.join(' '), a.rows.map(r => [(r.task ?? []).join(' '), r.progress.map(lineText), r.owner])]);
  assert.deepEqual(grid, [
    ['가짜 영역 가', [
      ['가짜 과제 하나', ['지금 상황 첫 줄', '둘째 줄'], [ME]], // 담당이 비면 바탕 담당 그대로
      ['가짜 과제 둘', [], null],                               // 바탕에만 있는 내 줄 = 비움(줄은 남김, 합친 칸 그대로)
      ['가짜 남 과제', ['- 남의 글'], ['가짜을']],              // 남의 줄 그대로
      ['가짜 과제 새것', ['새 과제 글'], ['가짜담당 갑/가짜병']], // 없는 줄 = 그 묶음 맨 아래, 담당 = 화면 담당
    ]],
    ['가짜 주제·영역', [['가짜 주제/영역', [], [ME]]]],          // 세부 과제 없는 화면 줄 = 주제 칸(S52-24), 빈 지금 상황 = 빈 칸
    ['가짜 새 영역', [['', ['새 영역 글'], [ME]]]],
  ]);
  // 바뀐 줄은 파란 글씨(바탕과 다른 글).
  assert.ok(data.summary[0].rows[0].progress.every(l => typeof l === 'object' && l.changed));
  // 내 이름도 담당도 모르면 줄을 더하지 않는다.
  assert.equal(applyBizWindow({summary: []}, '', [{area: '가짜', task: '', lines: ['x'], owner: ''}]).base.summary.length, 0);
  // 실제 서식으로 만든 파일을 다시 읽으면 화면 줄 그대로(규격 검사 통과).
  const fake = packHwpx(makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib)), zlib);
  const {team, template} = prepareConfirmed(await openConfirmed(fake));
  const real = startDraft(team, {me: ME, date: ''});
  const mine = editableRows(real, ME);
  const want = mine.map((r, i) => ({area: r.area, task: r.task, lines: [`창 글 ${i}`], owner: ''}));
  const ww = applyBizWindow(real, ME, want);
  const back = readReport(openHwpx(await buildHwpx(template, assembleDraft(ww.base, {summary: ww.summary, owners: ww.owners})), zlib));
  assert.deepEqual(editableRows(back, ME).map(r => r.lines), want.map(r => r.lines));
});

test('B-4 ①: 한글 파일 2. 1)은 화면 사업요약 상자 결과 — 다 그린 뒤에만, 표가 없으면(404) 예전 칸', () => {
  const hw = read('app/journal-hwpx.js'), jr = read('app/journal.js'), box = read('app/weekly-summary-table.js');
  assert.match(hw, /const biz = fresh \? \(getWeek\(\)\.biz\?\.\(\) \?\? \{status:'loading'\}\) : null;/);
  assert.match(hw, /사업요약표가 아직 다 나오지 않았어요/);
  assert.match(hw, /draft\.applyBizWindow\(state\.base, state\.me, bizRows\)/);
  assert.match(jr, /biz:bizFile/);
  assert.match(jr, /bizWeekly\.fileRows\(start\)/);
  assert.match(box, /fileRows:week=>inst\.fileRows\(week\)/);
  assert.match(box, /state\.done=\{run,from,now:fresh\?nowStatus:''\}/);
});

test('B-4 ④: [확정] 사진 2. 1) 줄 = 파일에 넣은 지금 상황·담당(section biz_summary), 조직 사진과 한 배열', async () => {
  const {summarySnapshotRow} = await import('../app/weekly-hwpx/draft.mjs');
  assert.deepEqual(summarySnapshotRow({space: 's1', area: ' 가짜 영역 ', task: '가짜 과제', lines: ['첫 줄', '  ', '둘째\t줄'], owner: '가짜 담당'}),
    {section: 'biz_summary', ref_kind: 'space', ref_key: 's1', label: '가짜 영역 › 가짜 과제', owner: '가짜 담당',
      lines: [{ref_kind: 'space', ref_key: 's1', day: null, end_day: null, text: '첫 줄'}, {ref_kind: 'space', ref_key: 's1', day: null, end_day: null, text: '둘째 줄'}]});
  assert.equal(summarySnapshotRow({space: 's2', area: '가짜 영역', task: '', lines: [], owner: ''}).label, '가짜 영역');
  assert.equal(summarySnapshotRow({area: 'x'}), null);
  // 조직 창 화면 읽기(snapshotCell)는 2. 1) 줄을 조직 칸으로 읽지 않는다(section이 다름).
  assert.equal(M.snapshotCell({rows: [summarySnapshotRow({space: 'o1', area: 'a', lines: ['x']})]}, 'o1'), null);
  const hw = read('app/journal-hwpx.js');
  assert.match(hw, /\.\.\.\(bizRows \? bizRows\.map\(r => draft\.summarySnapshotRow\(r\)\)\.filter\(Boolean\) : \[\]\)/);
});

// ORG-폴드두열표(요청함 11/11, 시안 docs/design/mockups/org-table-fold-two-cols.html): 담당조직 [전체 표](.oa-table)는 접은 폰·폴드 펼침·PC 모두 두 열 표.
// 화면 시험(tests/app-e2e/org-overview.spec.mjs)이 세 폭을 실제로 재고, 여기서는 그 바탕이 되는 CSS·소스 약속을 지킨다.
test('ORG-폴드두열표 ①: 760 이하 쌓기 규칙은 [전체 표](.oa-table)에 걸지 않고, 홈 [주간 정리] 표는 그대로 쌓인다(우선순위 변화 없음)', () => {
  const css = read('app/weekly-org-lines.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // 첫 760 이하 블록 = 이 표 틀 전체를 쌓는 규칙(thead 감춤 포함). 그 안의 선택자는 모두 .wl-table:where(:not(.oa-table))로 시작해야 한다.
  const blocks = [...css.matchAll(/@media \(max-width:760px\)\{([\s\S]*?)\n\}/g)].map(m => m[1]);
  const stack = blocks.find(b => /thead\{display:none\}/.test(b));
  assert.ok(stack, '표 틀을 쌓는 760 이하 블록이 있다');
  const selectors = [...stack.matchAll(/(^|\n)\s*([^{}\n]+)\{/g)].flatMap(m => m[2].split(',').map(s => s.trim()));
  assert.ok(selectors.length >= 5);
  for (const sel of selectors) assert.match(sel, /^\.wl-table:where\(:not\(\.oa-table\)\)/, `${sel} — 쌓기 규칙은 .oa-table을 빼야 한다`);
  assert.doesNotMatch(stack, /\.wl-table\s+thead\{/, '옛 선택자(.wl-table thead)가 남아 있으면 [전체 표]도 쌓인다');
  // 홈 [주간 정리](.wl-weekly)의 자기 규칙(두 번째 760 이하 블록·컨테이너 쿼리)은 그대로 있다.
  assert.match(css, /\.wl-table\.wl-weekly tbody th\.wl-c-org\{background:none;padding-top:6px;border-top:1px solid var\(--kptu-border\)\}/);
  assert.match(css, /@container \(max-width:30em\)\{[\s\S]*\.wl-table\.wl-weekly thead\{display:none\}/);
  assert.match(read('app/journal.css'), /@media\(max-width:760px\)\{\n  #appView #homeView \.journal-weekly\{ padding:10px; \}\n  #appView #homeView \.journal-weekly-table,/, '주간 정리의 다른 표(journal.css) 폰 쌓기는 건드리지 않았다');
});

test('ORG-폴드두열표 ②: [조직] 열 폭 = 끌어 정한 폭 → 가장 긴 이름 맞춤 → 9.5em(600 이상), 접은 폰(600 미만)은 7em 고정에 끌기 손잡이 감춤', () => {
  const css = read('app/weekly-org-lines.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.wl-table\.oa-table \.wl-c-org\{width:var\(--oa-w-org,var\(--oa-w-org-fit,9\.5em\)\)\}/);
  const phone = css.match(/@media \(max-width:599px\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(phone, /\.wl-table\.oa-table \.wl-c-org\{width:7em\}/);
  assert.match(phone, /\.wl-table\.oa-table \.col-grip\{display:none\}/);
  // 끌어 정한 폭 변수에 CSS가 기본값을 주면 이름 맞춤 폭이 쓰일 자리가 없다(예전 .oa{--oa-w-org:11em}).
  assert.doesNotMatch(read('app/suborganizations.css'), /--oa-w-org\s*:/);
  // 화면 폭 경계는 앱 공용 600(screen-width.mjs)과 같다.
  assert.match(read('app/org-overview.js'), /import \{SPLIT_QUERY\} from '\.\/screen-width\.mjs'/);
});

test('ORG-폴드두열표 ③: org-overview.js는 가장 긴 이름을 한 줄로 두고 재어 --oa-w-org-fit(표 폭 45% 상한)을 정하고, 칸 끌기 맞춤도 같은 측정을 쓴다', () => {
  const src = read('app/org-overview.js');
  assert.match(src, /function nameWidth\(panel\)/);
  assert.match(src, /style\.whiteSpace = 'nowrap'/, '꺾여 있어도 본래 이름 길이를 재려고 잠깐 한 줄로 둔다');
  assert.match(src, /function fitOrgColumn\(\)/);
  assert.match(src, /--oa-w-org-fit/);
  assert.match(src, /tableWidth \* 0\.45/);
  assert.match(src, /mountColResize\(\{host: panel, name: 'orgall', vars: \{org: '--oa-w-org'\}[^)]*fit: \(\) => nameWidth\(panel\)\}\)/, '칸 경계 두 번 누르기 맞춤도 같은 측정');
  // 그린 뒤·[전체 표] 탭을 열 때·화면 폭이 바뀔 때·글꼴이 온 뒤 다시 맞춘다.
  assert.ok((src.match(/fitOrgColumn\(\)/g) || []).length >= 5);
  assert.match(src, /addEventListener\('resize'/);
  assert.match(src, /document\.fonts\?\.ready/);
  // 표 틀·쟁의 단계·줄 ⋯는 그대로: 같은 표 부품 한 곳과 조직 이름 → 상세 열기.
  assert.match(src, /tableClass: 'oa-table'/);
  assert.match(src, /data-oa-open=/);
});
