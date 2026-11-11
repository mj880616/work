import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

// MTG-할일자동생성금지(요청함 11/11 15:25): 회의 결과(녹음 요약·서버 정리)가 할 일을 저절로 만들지 않는다.
// AI가 찾은 후속 할 일은 저장한 사업 보고의 챙길 것 후보(app_todo_candidates, 늘 open)로만 올리고, 할 일은 사람이 [할 일로]를 눌러야 생긴다.
// 가짜 ID·가짜 글만 쓴다.
const mod = await import('../../app/todo-radar-data.js');
const server = await import('../../supabase/functions/ai-assist/todo-radar.ts');
const id = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
function fakeRt(api) {
  const calls = [];
  return {calls, rt:{context:{read:() => ({user:{id:'u'}, workspace:{id:'w'}})}, api:async (path, opts = {}) => { calls.push({path, opts}); return api(path, opts); }}};
}
// 표 grant(20261021075034)가 authenticated에 준 insert 칸. 상태·할 일 id·처리 시각은 넣지 못한다(늘 open으로 들어감).
const INSERT_COLUMNS = ['workspace_id', 'kind', 'summary', 'due', 'source_kind', 'source_id', 'source_day', 'evidence', 'dedupe_key', 'project_id', 'organization_id'].sort();

test('후보 줄: 넣기 권한이 있는 칸만, 출처는 그 사업 보고, 열쇠는 서버 todo_radar와 같은 꼴', () => {
  const rows = mod.meetingCandidateRows(id(1).toUpperCase(), [{title:'합성 자료 정리', due:'2026-11-20'}, {title:'합성 공문 회신 (가상 담당)', due:''}],
    {workspaceId:'w', day:'2026-11-10', projectId:id(7)});
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), INSERT_COLUMNS);
    assert.equal(r.source_kind, 'meeting'); assert.equal(r.source_id, id(1)); assert.equal(r.source_day, '2026-11-10');
    assert.equal(r.kind, 'my_task'); assert.equal(r.workspace_id, 'w'); assert.equal(r.project_id, id(7)); assert.equal(r.organization_id, null);
    assert.equal(r.dedupe_key, server.dedupeKey('meeting', id(1), r.summary));
  }
  assert.equal(rows[0].due, '2026-11-20'); assert.equal(rows[1].due, null);
  assert.equal(rows[1].summary, '합성 공문 회신 (가상 담당)');
});

test('후보 줄: 빈 줄·같은 요약은 한 번만, 100자·제어 문자 정리, 이상한 기한·사업영역은 비움, 30개까지', () => {
  const long = '가'.repeat(150);
  const rows = mod.meetingCandidateRows(id(1), [{title:'  '}, {title:'합성\u0000 자료\n정리'}, {title:'합성 자료 정리.'}, {title:long, due:'11/20'}, null],
    {workspaceId:'w', day:'2026-11-10', projectId:'new-meeting'});
  assert.deepEqual(rows.map(r => r.summary), ['합성 자료 정리', '가'.repeat(99) + '…']);
  assert.equal([...rows[1].summary].length, 100);
  assert.equal(rows[1].due, null); assert.equal(rows[0].project_id, null);
  const many = Array.from({length:40}, (_, i) => ({title:`합성 일 ${i}`}));
  assert.equal(mod.meetingCandidateRows(id(1), many, {workspaceId:'w', day:'2026-11-10'}).length, mod.MEETING_CANDIDATE_MAX);
  // 회의 id·날짜·작업공간이 이상하면 아무것도 만들지 않는다.
  for (const [mid, opts] of [['new-meeting', {workspaceId:'w', day:'2026-11-10'}], [id(1), {workspaceId:'w', day:'11/10'}], [id(1), {workspaceId:'', day:'2026-11-10'}]])
    assert.deepEqual(mod.meetingCandidateRows(mid, [{title:'합성'}], opts), []);
});

test('addMeetingCandidates: 후보 표에 한 번 넣기(같은 열쇠는 건너뜀), 표가 없으면 missing, 실패는 ok:false, 줄이 없으면 부르지 않음', async () => {
  const {rt, calls} = fakeRt(async (path, opts) => opts.body.map((_, i) => ({id:id(100 + i)})));
  assert.deepEqual(await mod.addMeetingCandidates(id(1), [{title:'합성 자료 정리'}, {title:'합성 공문 회신'}], {day:'2026-11-10', rt}), {ok:true, added:2});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/rest/v1/app_todo_candidates?on_conflict=workspace_id,dedupe_key&select=id');
  assert.equal(calls[0].opts.method, 'POST'); assert.match(calls[0].opts.prefer, /resolution=ignore-duplicates/);
  assert.ok(calls[0].opts.body.every(r => !('status' in r) && !('task_id' in r) && !('decided_at' in r)));
  assert.deepEqual(await mod.addMeetingCandidates(id(1), [], {day:'2026-11-10', rt}), {ok:true, added:0});
  assert.equal(calls.length, 1);
  const gone = fakeRt(async () => { const e = new Error('relation does not exist'); e.status = 404; throw e; });
  assert.deepEqual(await mod.addMeetingCandidates(id(1), [{title:'합성'}], {day:'2026-11-10', rt:gone.rt}), {missing:true});
  const bad = fakeRt(async () => { const e = new Error('denied'); e.status = 403; throw e; });
  assert.deepEqual(await mod.addMeetingCandidates(id(1), [{title:'합성'}], {day:'2026-11-10', rt:bad.rt}), {ok:false});
});

test('녹음 요약은 후속 할 일 입력 줄을 채우지 않고, 저장 뒤 후보로만 올린다', () => {
  const draft = read('app/meeting-transcript-draft.js');
  const code = draft.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /meetingAction(Title|Due|Add|List)|addMeetingAction/, 'AI 요약이 후속 할 일 입력 줄을 건드리지 않는다');
  assert.doesNotMatch(code, /google-tasks|createGoogleTask/, '녹음 요약 모듈은 할 일을 만들지 않는다');
  assert.match(code, /addEventListener\('kptu:record-saved'[\s\S]*?addMeetingCandidates\(id,rows/, '저장한 보고 id로만 후보를 올린다');
  // 입력 줄을 읽고 할 일로 만드는 곳은 손으로 쓰는 길(task-workflow.js)과 저장(team.js) 둘뿐이다.
  const users = readdirSync(new URL('../../app/', import.meta.url)).filter(f => /\.(m?js|html)$/.test(f))
    .filter(f => /meetingAction(Title|Due|Add|List)\b|addMeetingAction/.test(read(`app/${f}`).split('\n').filter(l => !l.trim().startsWith('//')).join('\n'))).sort();
  assert.deepEqual(users, ['index.html', 'task-workflow.js', 'team.js']);
});

test('옛 AI 창(로더에 없음)도 확정·자동 분류로 할 일을 만들거나 입력 줄을 채우지 않는다', () => {
  const legacy = read('app/workflow-ai-v3.js');
  assert.doesNotMatch(legacy, /createConfirmedTasks/);
  assert.doesNotMatch(legacy, /\/rest\/v1\/app_tasks['"`],\s*\{\s*method:\s*['"]POST/);
  assert.doesNotMatch(legacy, /meetingActionList|addMeetingAction/);
  assert.doesNotMatch(read('app/loader-v2.js'), /workflow-ai-v3\.js/);
});
