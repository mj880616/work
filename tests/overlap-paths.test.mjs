// MTG-기록겹침거르기 3단계 나머지: 프로젝트 기록(홈·업데이트 창)·담당조직 기록·여러 곳 연결 업데이트·파일로 만든 사업 보고가
// 저장이 끝난 뒤 같은 kptu:record-saved 알림을 내는지, 그 알림을 후보 읽기·연결 계획이 담당조직 기록·업데이트까지 다루는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';

const events = [];
globalThis.window = {dispatchEvent: e => events.push(e), addEventListener: () => {}, KPTUOrganizationOrder: {groupName: () => '', GROUP_NAMES: ['그 외']}};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const saved = () => events.filter(e => e.type === 'kptu:record-saved').map(e => e.detail);
const reset = () => { events.length = 0; };

const U = n => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const {projectUpdateDetail, orgUpdateDetail, basketDetail} = await import('../app/record-saved.js');
const {saveProjectProgress, saveOrganizationUpdate} = await import('../app/quick-save.js');
const {saveUpdate} = await import('../app/update-places.js');
const {readCandidates, linkAndMark} = await import('../app/overlap-data.js');
const {makeRef, linkPlan, mergeTarget, rankCandidates} = await import('../app/overlap-model.mjs');

test('알림 내용: id가 없으면 만들지 않고, 담당조직 기록의 날짜는 서울 날짜다', () => {
  assert.equal(projectUpdateDetail([], {project_id: 'p', summary: '글', effective_on: '2026-10-25'}), null);
  assert.equal(projectUpdateDetail(null, {project_id: 'p', summary: '글'}), null);
  assert.deepEqual(projectUpdateDetail([{id: U(1), effective_on: '2026-10-25'}], {project_id: 'p', summary: '글'}), {kind: 'project_update', id: U(1), project_id: 'p', day: '2026-10-25', text: '글'});
  assert.deepEqual(orgUpdateDetail([{id: U(2), occurred_at: '2026-10-05T16:00:00Z'}], {organization_id: 'o', raw_text: '글'}), {kind: 'org_update', id: U(2), organization_id: 'o', day: '2026-10-06', text: '글'});
  assert.equal(orgUpdateDetail([{occurred_at: '2026-10-05T16:00:00Z'}], {organization_id: 'o', raw_text: '글'}), null);
});

test('업데이트 알림: 프로젝트·조직만 곳으로 담고, 참고 묶음만이거나 글이 비었거나 AI 내보내기를 막았으면 만들지 않는다', () => {
  const note = {id: U(3), raw_text: '면담 결과', occurred_at: '2026-10-05T16:00:00Z', ai_export_allowed: true};
  assert.deepEqual(basketDetail(note, [{kind: 'project', id: 'p'}, {kind: 'reference', id: 'b'}, {kind: 'organization', id: 'o'}]), {kind: 'basket', id: U(3), day: '2026-10-06', text: '면담 결과', targets: [{kind: 'project', id: 'p'}, {kind: 'organization', id: 'o'}]});
  assert.equal(basketDetail(note, [{kind: 'reference', id: 'b'}]), null);
  assert.equal(basketDetail({...note, raw_text: ' '}, [{kind: 'project', id: 'p'}]), null);
  assert.equal(basketDetail({...note, ai_export_allowed: false}, [{kind: 'project', id: 'p'}]), null);
  assert.equal(basketDetail(null, [{kind: 'project', id: 'p'}]), null);
});

test('프로젝트 기록 저장(홈·업데이트 창): 저장 응답의 id를 받아 저장이 끝난 뒤 알린다', async () => {
  reset();
  const sent = [];
  const rt = {api: async (path, options) => { sent.push({path, options}); return [{id: U(4), project_id: 'p1', effective_on: '2026-10-25'}]; }};
  const rows = await saveProjectProgress({project_id: 'p1', raw_text: '기자회견 진행', created_by: 'owner'}, rt);
  assert.equal(sent[0].options.prefer, 'return=representation');
  assert.equal(rows[0].id, U(4));
  assert.deepEqual(saved(), [{kind: 'project_update', id: U(4), project_id: 'p1', day: '2026-10-25', text: '기자회견 진행'}]);
});

test('저장 응답에 행이 없거나 저장이 실패하면 알리지 않는다', async () => {
  reset();
  await saveProjectProgress({project_id: 'p1', raw_text: '글', created_by: 'o'}, {api: async () => []});
  await saveOrganizationUpdate({organization_id: 'o1', raw_text: '글', created_by: 'o'}, {api: async () => null});
  await assert.rejects(saveOrganizationUpdate({organization_id: 'o1', raw_text: '글', created_by: 'o'}, {api: async () => { throw new Error('거절'); }}), /거절/);
  assert.deepEqual(saved(), []);
});

test('담당조직 기록 저장(조직 상세·통화 조직 연결·업데이트 창): org_update 알림을 낸다', async () => {
  reset();
  const sent = [];
  await saveOrganizationUpdate({organization_id: 'o1', raw_text: '현장 면담', created_by: 'owner', doc: {a: 1}}, {api: async (path, options) => { sent.push({path, options}); return [{id: U(5), organization_id: 'o1', occurred_at: '2026-10-25T03:00:00Z'}]; }});
  assert.equal(sent[0].path, '/rest/v1/app_suborganization_updates');
  assert.equal(sent[0].options.prefer, 'return=representation');
  assert.deepEqual(sent[0].options.body, {organization_id: 'o1', raw_text: '현장 면담', created_by: 'owner', doc: {a: 1}});
  assert.deepEqual(saved(), [{kind: 'org_update', id: U(5), organization_id: 'o1', day: '2026-10-25', text: '현장 면담'}]);
});

test('업데이트 여러 곳 연결: 연결이 모두 끝난 뒤에만 알리고, 연결이 거절되면 알리지 않는다', async () => {
  const note = {id: U(6), raw_text: '두 곳 소식', occurred_at: '2026-10-25T03:00:00Z', updated_at: '2026-10-25T03:00:00Z', ai_export_allowed: true};
  const rtOf = confirm => ({context: {read: () => ({workspace: {id: 'w'}})}, api: async path => path.includes('app_basket_confirm_links') ? confirm : [note]});
  reset();
  const places = [{kind: 'project', id: 'p1'}, {kind: 'organization', id: 'o1'}];
  const ok = await saveUpdate({places, text: '두 곳 소식', owner: 'owner'}, rtOf({ok: true, created: 2}));
  assert.equal(ok.linkError, '');
  assert.deepEqual(saved(), [{kind: 'basket', id: U(6), day: '2026-10-25', text: '두 곳 소식', targets: places}]);
  reset();
  const refused = await saveUpdate({places, text: '두 곳 소식', owner: 'owner'}, rtOf({ok: false, error: 'NOTE_CHANGED'}));
  assert.equal(refused.linkError, 'NOTE_CHANGED');
  assert.deepEqual(saved(), []);
  // MTG-프로젝트합치기 3단계: 프로젝트(사업영역) 하나만 골라도 같은 길(바구니 업데이트 + 연결)이라 같은 basket 알림을 낸다.
  reset();
  const single = await saveUpdate({places: [{kind: 'project', id: 'p1'}], text: '두 곳 소식', owner: 'owner'}, rtOf({ok: true, created: 1}));
  assert.equal(single.linkError, '');
  assert.deepEqual(saved(), [{kind: 'basket', id: U(6), day: '2026-10-25', text: '두 곳 소식', targets: [{kind: 'project', id: 'p1'}]}]);
  reset();
  await saveUpdate({places: [{kind: 'reference', id: 'b1'}, {kind: 'reference', id: 'b2'}], text: '참고', owner: 'owner'}, rtOf({ok: true, created: 2}));
  assert.deepEqual(saved(), []);
});

test('담당조직 기록은 사업 보고와만 짝이 되고, 프로젝트 기록 쌍과 같은 계획(조직 한 곳 + 쓴 글)을 쓴다', () => {
  const org = {kind: 'organization', id: U(900)};
  const rec = {ref: makeRef('org_update', U(1)), id: U(1), kind: 'org_update', day: '2026-10-21', text: '현장 면담 진행', title: '', target: org};
  const meeting = {ref: makeRef('meeting', U(2)), kind: 'meeting', day: '2026-10-21', title: '현장 면담', text: '', typeLabel: '면담', target: org};
  assert.deepEqual(linkPlan(rec, meeting), {meetingId: U(2), target: org, summary: '현장 면담 진행'});
  assert.equal(linkPlan(rec, {...meeting, kind: 'project_update'}), null);
  const other = {...meeting, ref: makeRef('meeting', U(3)), target: null};
  assert.equal(rankCandidates(rec, [other, meeting])[0].ref, meeting.ref); // 같은 조직이 먼저
});

test('여러 곳 업데이트는 모든 곳을 사업 보고에 잇고, 이미 메모가 있는 곳은 덮어쓰지 않는다', () => {
  const P = {kind: 'project', id: U(900)}, O = {kind: 'organization', id: U(901)};
  const rec = {ref: makeRef('basket', U(1)), id: U(1), kind: 'basket', day: '2026-10-21', text: '두 곳 소식', title: '', target: P, targets: [P, O]};
  const meeting = {ref: makeRef('meeting', U(2)), kind: 'meeting', day: '2026-10-21', title: '두 곳', text: '', target: O};
  const plan = linkPlan(rec, meeting);
  assert.deepEqual(plan, {meetingId: U(2), target: P, targets: [P, O], summary: '두 곳 소식'});
  const merged = mergeTarget([{...O, hasSummary: true}], plan);
  assert.deepEqual(merged.targets, [O, P]);
  assert.deepEqual(merged.summaryFor, [P]);
  assert.equal(merged.summary, '두 곳 소식');
  assert.equal(merged.added, true);
  const all = mergeTarget([{...P, hasSummary: true}, {...O, hasSummary: true}], plan);
  assert.equal(all.summary, null); assert.equal(all.added, false); assert.equal(all.keptSummary, true);
  assert.equal(linkPlan({...rec, targets: [], target: null}, meeting), null);
});

// 후보 읽기: 담당조직 기록·업데이트를 방금 저장했을 때 반대편은 사업 보고(프로젝트 기록과 같은 범위).
function readerRt(handlers) {
  const calls = [];
  return {calls, context: {read: () => ({workspace: {id: 'w'}})}, api: async path => { calls.push(path); const h = handlers.find(x => path.includes(x.match)); return h ? h.rows : []; }};
}
test('후보 읽기: 담당조직 기록 → 사업 보고(조직 연결로 같은 곳 표시), 업데이트 → 사업 보고(이미 옮겨 담은 보고는 뺀다)', async () => {
  const meetings = [
    {id: U(10), title: '면담', series_name: '현장 면담', meeting_at: '2026-10-21T05:00:00Z', activity_kind: 'meeting', project_id: null},
    {id: U(11), title: '회의', series_name: '다른 회의', meeting_at: '2026-10-21T06:00:00Z', activity_kind: 'meeting', project_id: U(950)},
  ];
  const org = {ref: makeRef('org_update', U(1)), id: U(1), kind: 'org_update', day: '2026-10-21', text: '면담', title: '', target: {kind: 'organization', id: U(901)}};
  const rt1 = readerRt([{match: 'app_meetings', rows: meetings}, {match: 'source_meeting_id', rows: [{source_meeting_id: U(10), project_id: null, organization_id: U(901)}]}]);
  const found = await readCandidates(org, rt1);
  assert.deepEqual(found.map(c => c.ref), [makeRef('meeting', U(10)), makeRef('meeting', U(11))]);
  assert.deepEqual(found[0].target, org.target);
  assert.equal(found[1].target, null);
  assert.ok(rt1.calls.every(p => !p.includes('app_suborganization_updates')), '같은 종류(조직 기록)는 읽지 않는다');

  const basket = {ref: makeRef('basket', U(2)), id: U(2), kind: 'basket', day: '2026-10-21', text: '소식', title: '', target: {kind: 'project', id: U(950)}, targets: [{kind: 'project', id: U(950)}, org.target]};
  const rt2 = readerRt([{match: 'app_meetings', rows: meetings}, {match: 'source_meeting_id', rows: []}, {match: `note_id=eq.${U(2)}`, rows: [{meeting_id: U(10)}]}]);
  const found2 = await readCandidates(basket, rt2);
  assert.deepEqual(found2.map(c => c.ref), [makeRef('meeting', U(11))]);
  assert.deepEqual(found2[0].target, {kind: 'project', id: U(950)});
});

test('[연결로 바꾸기]: 여러 곳 업데이트는 곳마다 연결 메모를 붙여 사업 보고에 한 번에 저장한다', async () => {
  const P = {kind: 'project', id: U(900)}, O = {kind: 'organization', id: U(901)};
  const sent = [];
  const rt = {context: {read: () => ({workspace: {id: 'w'}})}, session: {read: () => ({user: {id: 'u'}})}, api: async (path, options) => {
    sent.push({path, options});
    if (path.includes('app_meetings?id=eq.')) return [{id: U(2), updated_at: '2026-10-21T06:00:00Z'}];
    if (path.includes('app_record_overlap_set')) return {saved: 1};
    if (path.includes('app_meeting_set_links')) return {ok: true, updated_at: '2026-10-21T06:00:01Z', created: 2, removed: 0};
    return [];
  }};
  const rec = {ref: makeRef('basket', U(1)), id: U(1), kind: 'basket', day: '2026-10-21', text: '두 곳 소식', title: '', target: P, targets: [P, O]};
  const cand = {ref: makeRef('meeting', U(2)), kind: 'meeting', day: '2026-10-21', title: '두 곳', text: '', target: O};
  const r = await linkAndMark(rec, cand, rt);
  assert.equal(r.ok, true);
  const links = sent.find(x => x.path.includes('app_meeting_set_links'));
  assert.deepEqual(links.options.body.p_targets.map(t => [t.kind, t.target_id, t.summary]), [['project', P.id, '두 곳 소식'], ['organization', O.id, '두 곳 소식']]);
  const verdict = sent.find(x => x.path.includes('app_record_overlap_set'));
  assert.equal(verdict.options.body.p_pairs[0].verdict, 'same');
});

test('파일로 만든 사업 보고·바구니 연결 화면은 같은 알림 한 곳(record-saved.js)을 쓴다', async () => {
  const {readFileSync} = await import('node:fs');
  const read = f => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
  assert.match(read('meeting-from-files.js'), /announceRecordSaved\(\{kind:'meeting',id:meetingId/);
  assert.match(read('basket-manual-link.js'), /announceRecordSaved\(basketDetail\(n,records\)\)/);
  assert.doesNotMatch(read('journal-weekly.js'), /record-saved/);
});
