// WEEKLY-사업영역묶음 ①(시안 docs/design/mockups/weekly-tidy.html ②, 명진 11/13 (나)): 한글 파일 2. 1) 내 줄 찾기.
// 팀 양식은 첫 칸 = 묶음(영역·의제·기본 사업), 둘째 칸 = 내 사업영역. Web2 화면 줄은 첫 칸 = 내 사업영역(1단), 둘째 칸 = 세부 과제(2단).
// 둘째 칸 이름으로도 내 줄을 찾아 그 자리를 채우고, 표 끝에 새 줄을 만들지 않는다. 이름은 모두 예시(업무 내용 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ME = '예시담당 갑';
// 실제 팀 양식 모양: 여러 묶음, 한 묶음 안에 남의 줄과 내 줄이 섞이고 같은 세부 과제 이름이 사람마다 한 줄씩.
const team = () => ({summary: [
  {area: ['기본 사업'], rows: [
    {task: ['사업영역 G'], progress: ['- 남의 지난 글'], paras: [], owner: ['예시을']},
    {task: ['사업영역 G'], progress: ['- 내 지난 글'], paras: [], owner: [ME]},
  ]},
  {area: ['영역'], rows: [
    {task: ['사업영역 A'], progress: ['- 지난주 A'], paras: [], owner: [ME]},
    {task: ['사업영역 남'], progress: ['- 남의 글'], paras: [], owner: ['예시병']},
  ]},
  {area: ['의제'], rows: [
    {task: ['사업영역 C'], progress: [], paras: [], owner: [ME]},
    {task: ['사업영역/D'], progress: ['- 지난주 D'], paras: [], owner: [ME]},
    {task: ['빈 자리 H'], progress: [], paras: [], owner: [ME]},
  ]},
]});
const screen = [
  {area: '사업영역 A', task: '', lines: ['A 지금 상황'], owner: ''},
  {area: '사업영역 A', task: '세부 과제 A-1', lines: ['A-1 지금 상황'], owner: ''},
  {area: '사업영역 A', task: '세부 과제 A-2', lines: [], owner: ''}, // 기록 없는 세부 과제 = 넣지 않음
  {area: '사업영역 C', task: '', lines: ['C 첫 줄', 'C 둘째 줄'], owner: ''},
  {area: '사업영역 D', task: '', lines: [], owner: ''},
  {area: '사업영역 D', task: '세부 과제 D-1', lines: ['D-1 지금 상황'], owner: ''},
  {area: '사업영역G', task: '', lines: ['G 지금 상황'], owner: ''},
  {area: '사업영역 G', task: 'G-1', lines: ['G-1 글'], owner: ''},
];
const grid = async (w) => {
  const {assembleDraft} = await import('../app/weekly-hwpx/draft.mjs');
  const {lineText} = await import('../app/weekly-hwpx/report.mjs');
  const data = assembleDraft(w.base, {summary: w.summary, owners: w.owners});
  return data.summary.map(a => [a.area.join(' '), a.rows.map(r => [(r.task ?? []).join(' '), r.progress.map(lineText), (r.owner ?? []).join('')])]);
};

test('① 양식 둘째 칸 = 내 사업영역이면 그 줄을 채우고, 세부 과제는 그 칸 안 "◦ 이름" + 줄, 표 끝 새 줄 없음', async () => {
  const {applyBizWindow} = await import('../app/weekly-hwpx/draft.mjs');
  const base = team();
  const w = applyBizWindow(base, ME, screen);
  assert.equal(JSON.stringify(base), JSON.stringify(team()), '원본 바탕은 그대로');
  assert.deepEqual(await grid(w), [
    ['기본 사업', [['사업영역 G', ['- 남의 지난 글'], '예시을'], ['사업영역 G', ['G 지금 상황', '◦ G-1', 'G-1 글'], ME]]],
    ['영역', [['사업영역 A', ['A 지금 상황', '◦ 세부 과제 A-1', 'A-1 지금 상황'], ME], ['사업영역 남', ['- 남의 글'], '예시병']]],
    ['의제', [
      ['사업영역 C', ['C 첫 줄', 'C 둘째 줄'], ME],
      ['사업영역/D', ['◦ 세부 과제 D-1', 'D-1 지금 상황'], ME], // 띄어쓰기·부호 무시
      ['빈 자리 H', [], ME],                                   // 짝 없는 내 줄 = 비움(줄은 남김)
    ]],
  ]);
  assert.equal(w.base.summary.length, 3, '표 끝에 새 묶음을 만들지 않는다');
  assert.equal(w.base.summary.reduce((n, a) => n + a.rows.length, 0), 7, '새 줄을 만들지 않는다');
});

test('① 남의 줄만 같은 이름이면 그 줄을 쓰지 않는다(내 줄 한정)', async () => {
  const {applyBizWindow} = await import('../app/weekly-hwpx/draft.mjs');
  const w = applyBizWindow(team(), ME, [{area: '사업영역 남', task: '', lines: ['내 글'], owner: ''}]);
  const g = await grid(w);
  assert.deepEqual(g[1][1][1], ['사업영역 남', ['- 남의 글'], '예시병'], '남의 줄 그대로');
  assert.deepEqual(g.at(-1), ['사업영역 남', [['', ['내 글'], ME]]], '자리가 없으면 예전처럼 새 줄(고른 자리가 없을 때만)');
});

test('① 양식에 없는 사업영역은 고른 자리(places)에 들어가고, 고른 자리가 없으면 예전처럼 새 줄', async () => {
  const {applyBizWindow, placeOf} = await import('../app/weekly-hwpx/draft.mjs');
  const rows = [{area: '사업영역 F', task: '', lines: ['F 글'], owner: ''}, {area: '사업영역 F', task: 'F-1', lines: ['F-1 글'], owner: ''}];
  const off = await grid(applyBizWindow(team(), ME, rows));
  assert.deepEqual(off.at(-1), ['사업영역 F', [['', ['F 글'], ME], ['F-1', ['F-1 글'], ME]]]);
  const on = await grid(applyBizWindow(team(), ME, rows, {places: {'사업영역F': {area: '의제', task: '빈 자리 H'}}}));
  assert.equal(on.length, 3, '새 묶음 없음');
  assert.deepEqual(on[2][1][2], ['빈 자리 H', ['F 글', '◦ F-1', 'F-1 글'], ME]);
  // 고른 자리가 남의 줄이면 쓰지 않는다(내 줄 한정).
  const other = await grid(applyBizWindow(team(), ME, rows, {places: new Map([['사업영역 F', {area: '영역', task: '사업영역 남'}]])}));
  assert.equal(other.length, 4);
  assert.equal(placeOf({'사업영역 F': {area: '', task: 'x'}}, '사업영역 F'), null, '빈 이름 자리는 무시');
  assert.equal(placeOf(null, '사업영역 F'), null);
});

test('① 실제 서식 파일로 만들어 다시 읽어도 자리 칸에 "◦ 세부 과제" 줄이 그대로 남고 줄 수가 늘지 않는다', async () => {
  const {applyBizWindow, assembleDraft, editableRows, buildHwpx, prepareConfirmed, openConfirmed, startDraft} = await import('../app/weekly-hwpx/draft.mjs');
  const {readReport} = await import('../app/weekly-hwpx/report.mjs');
  const {openHwpx, packHwpx} = await import('../app/weekly-hwpx/hwpx.mjs');
  const {zlib, SAMPLE} = await import('../scripts/weekly-hwpx/cli.mjs');
  const {makeFakeReport} = await import('../scripts/weekly-hwpx/fixture.mjs');
  const fake = packHwpx(makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib)), zlib);
  const {team: t, template} = prepareConfirmed(await openConfirmed(fake));
  const me = '가짜담당 갑';
  const real = startDraft(t, {me, date: ''});
  const mine = editableRows(real, me).filter(r => r.task);
  assert.ok(mine.length > 0, '시험 양식에 세부 과제 칸이 있는 내 줄이 있다');
  const slot = mine[0];
  // 화면 첫 칸 = 양식 둘째 칸 이름(내 사업영역), 그 아래 세부 과제 하나.
  const rows = [{area: slot.task, task: '', lines: ['자리 글'], owner: ''}, {area: slot.task, task: '예시 세부', lines: ['세부 글'], owner: ''}];
  const before = editableRows(real, me).length;
  const w = applyBizWindow(real, me, rows);
  const back = readReport(openHwpx(await buildHwpx(template, assembleDraft(w.base, {summary: w.summary, owners: w.owners})), zlib));
  const got = editableRows(back, me);
  assert.equal(got.length, before, '내 줄 수 그대로(표 끝 새 줄 없음)');
  assert.deepEqual(got.find(r => r.index === slot.index).lines, ['자리 글', '◦ 예시 세부', '세부 글']);
});

test('① 고른 자리가 있는 사업영역은 빈 내 줄을 표 끝에 더하지 않는다(missingAreas)', async () => {
  const {missingAreas, editableRows} = await import('../app/weekly-hwpx/draft.mjs');
  const rows = editableRows(team(), ME);
  assert.deepEqual(missingAreas(rows, ['사업영역 A', '사업영역 C', '사업영역 F']), ['사업영역 F'], '둘째 칸 이름으로 찾은 사업영역은 이미 있음');
  assert.deepEqual(missingAreas(rows, ['사업영역 F'], {places: {'사업영역 F': {area: '의제', task: '빈 자리 H'}}}), []);
  assert.deepEqual(missingAreas(rows, ['사업영역 F'], {places: {'사업영역 F': {area: '영역', task: '사업영역 남'}}}), ['사업영역 F'], '남의 줄 자리는 무시');
});

test('①-b 새 줄로 넣은 사업영역(added)·고르기 목록(placeChoices)', async () => {
  const {applyBizWindow, placeChoices, withAreaRows, missingAreas, editableRows} = await import('../app/weekly-hwpx/draft.mjs');
  const rows = [{area: '사업영역 F', task: '', lines: ['F 글'], owner: ''}, {area: '사업영역 A', task: '', lines: ['A 글'], owner: ''}];
  assert.deepEqual(applyBizWindow(team(), ME, rows).added, ['사업영역 F']);
  // 앱이 더한 빈 줄(withAreaRows)에 들어가도 양식에 없던 자리라 added.
  const b = withAreaRows(team(), missingAreas(editableRows(team(), ME), ['사업영역 F']), ME);
  assert.deepEqual(applyBizWindow(b, ME, rows).added, ['사업영역 F']);
  const places = {'사업영역 F': {area: '의제', task: '빈 자리 H'}};
  const b2 = withAreaRows(team(), missingAreas(editableRows(team(), ME), ['사업영역 F'], {places}), ME); // 고른 자리가 있으면 빈 줄을 더하지 않음
  assert.deepEqual(applyBizWindow(b2, ME, rows, {places}).added, []);
  assert.deepEqual(placeChoices(b, ME), [
    {area: '기본 사업', task: '사업영역 G'}, {area: '영역', task: '사업영역 A'}, {area: '의제', task: '사업영역 C'}, {area: '의제', task: '사업영역/D'}, {area: '의제', task: '빈 자리 H'},
  ], '내 양식 줄만, 앱이 더한 줄·남의 줄 제외');
});

test('①-b places 저장 모양(readPlaces·withPlace) — draft 칸, 칸마다 더 나중 것', async () => {
  const {readPlaces, withPlace, readExtras, mergeExtras} = await import('../app/weekly-feedback.mjs');
  const p = withPlace(null, ' 사업영역  F ', {area: '의제', task: '빈 자리 H'}, '2026-11-13T00:00:00Z');
  assert.deepEqual(p, {at: '2026-11-13T00:00:00Z', map: {'사업영역 F': {area: '의제', task: '빈 자리 H'}}});
  assert.deepEqual(withPlace(p, '사업영역 K', {area: '', task: ''}, 't2').map['사업영역 K'], {area: '', task: ''}, '새 줄로 둠');
  assert.equal(readPlaces({map: {x: {area: 'a', task: ''}}}), null, '한쪽만 빈 자리는 버림');
  assert.equal(readPlaces('x'), null);
  assert.deepEqual(readExtras({places: p}).places, p);
  const newer = withPlace(p, '사업영역 F', {area: '영역', task: '사업영역 A'}, '2026-11-14T00:00:00Z');
  assert.deepEqual(mergeExtras({places: p}, {places: newer}).places, newer);
});

test('② 화면 첫 칸: 사업영역 → 양식 첫 칸 이름(한글 파일과 같은 자리), 양식에 내 줄이 없으면 null', async () => {
  const {areaGroups} = await import('../app/weekly-hwpx/draft.mjs');
  const g = areaGroups(team(), ME, ['사업영역 A', '사업영역 C', '사업영역 D', '사업영역G', '사업영역 F', '사업영역 남']);
  assert.equal(g.get('사업영역 A'), '영역');
  assert.equal(g.get('사업영역 C'), '의제');
  assert.equal(g.get('사업영역 D'), '의제'); // '사업영역/D' — 부호 무시
  assert.equal(g.get('사업영역G'), '기본 사업'); // 띄어쓰기 무시, 여러 사람 줄 가운데 내 줄
  assert.equal(g.has('사업영역 F'), false); // 양식에 없음 → 화면은 자기 이름
  assert.equal(g.has('사업영역 남'), false); // 남의 줄은 내 자리가 아님
  // 고른 자리(①-b)가 있으면 그 줄의 첫 칸
  const p = areaGroups(team(), ME, ['사업영역 F'], {places: {'사업영역 F': {area: '의제', task: '빈 자리 H'}}});
  assert.equal(p.get('사업영역 F'), '의제');
  // 양식이 없는 사람: 내 줄이 없으면 null(지금 모양 그대로). 앱이 더한 빈 줄(keyArea)은 양식 줄이 아니다.
  assert.equal(areaGroups(team(), '처음 쓰는 사람', ['사업영역 A']), null);
  // 양식 첫 칸이 사업영역 이름 그대로(화면과 같은 모양)면 묶을 것이 없다.
  assert.equal(areaGroups({summary: [{area: ['사업영역 A'], rows: [{task: ['과제 1'], progress: [], paras: [], owner: [ME]}]}]}, ME, ['사업영역 A']), null);
  assert.equal(areaGroups({summary: [{area: ['사업영역 A'], rows: [{task: [], progress: [], paras: [], owner: [ME], keyArea: '사업영역 A'}]}]}, ME, ['사업영역 A']), null);
});
