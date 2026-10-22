import { test } from 'node:test';
import assert from 'node:assert/strict';
// JOURNAL-조직현황AI요약: [주간 정리] '4. 산하 조직 현황 > 1) 요약'의 조직별 요약 — 저장(owner RLS 표 app_weekly_org_summaries),
// [요약 만들기](ai-assist kind=org_summary, 주·조직 ID만), 고친 요약(edited=true), 화면 묶음·복사·한글 파일 후보. Fake names only.
const sum = import('../app/journal-org-summary.js');
const weekly = import('../app/journal-weekly.js');
const draft = import('../app/weekly-hwpx/draft.mjs');
const OA = '11111111-1111-4111-8111-111111111111', OB = '22222222-2222-4222-8222-222222222222';
const ok = items => ({status:'ok', items});

function fakeRt(answer) {
  const calls = [];
  return {calls, context:{read:() => ({workspace:{id:'w'}, user:{id:'u'}})},
    api:async (path, options = {}) => { calls.push({path, ...options}); return answer(path, options); },
    session:{ensure:async () => true, read:() => ({access_token:'t'})}, config:{url:'https://sb.example', key:'anon'}};
}

test('cleanEdited: lines trimmed, blank lines dropped, 8 lines·1,000 characters, control characters refused', async () => {
  const m = await sum;
  assert.equal(m.cleanEdited('  첫 줄.  \n\n둘째 줄.\r\n'), '첫 줄.\n둘째 줄.');
  assert.equal(m.cleanEdited('   \n '), '');
  assert.throws(() => m.cleanEdited(Array.from({length:9}, (_, i) => `${i}줄`).join('\n')), {code:'too_many'});
  assert.throws(() => m.cleanEdited('가'.repeat(1001)), {code:'too_long'});
  assert.throws(() => m.cleanEdited('a\u0007b'), {code:'control'});
  assert.equal(m.cleanEdited('탭\t있는 줄'), '탭 있는 줄');
});

test('readOrgSummaries: this workspace and week only; a missing table (404) is {missing:true}', async () => {
  const m = await sum;
  const rt = fakeRt(() => [{id:'r1', organization_id:OA.toUpperCase(), summary:'요약 글.', edited:true}, {id:'bad', organization_id:'x', summary:'?'}]);
  const map = await m.readOrgSummaries('2026-10-05', rt);
  const q = new URLSearchParams(rt.calls[0].path.split('?')[1]);
  assert.equal(q.get('workspace_id'), 'eq.w'); assert.equal(q.get('week_start'), 'eq.2026-10-05');
  assert.deepEqual([...map.keys()], [OA]); assert.equal(map.get(OA).edited, true);
  const missing = await m.readOrgSummaries('2026-10-05', fakeRt(() => { throw Object.assign(new Error('nf'), {status:404}); }));
  assert.equal(missing.missing, true);
  await assert.rejects(m.readOrgSummaries('2026-10-05', fakeRt(() => { throw Object.assign(new Error('x'), {status:500}); })));
});

test('saveEditedSummary: edited=true PATCH on a saved row, POST when new (409 → PATCH), empty text deletes', async () => {
  const m = await sum;
  let rt = fakeRt((path, o) => (o.method === 'PATCH' ? [{id:'r1', summary:'고친 글.', edited:true}] : []));
  await m.saveEditedSummary({start:'2026-10-05', organizationId:OA, row:{id:'r1'}, text:' 고친 글. '}, rt);
  assert.equal(rt.calls[0].method, 'PATCH'); assert.deepEqual({...rt.calls[0].body, updated_at:0}, {summary:'고친 글.', edited:true, updated_at:0});
  assert.match(rt.calls[0].path, /workspace_id=eq\.w&week_start=eq\.2026-10-05&organization_id=eq\./);
  rt = fakeRt((path, o) => { if (o.method === 'POST') throw Object.assign(new Error('dup'), {status:409}); return [{id:'r2', summary:'새 글.', edited:true}]; });
  await m.saveEditedSummary({start:'2026-10-05', organizationId:OA, text:'새 글.'}, rt);
  assert.deepEqual(rt.calls.map(c => c.method), ['POST', 'PATCH']);
  assert.deepEqual(Object.keys(rt.calls[0].body).sort(), ['edited', 'organization_id', 'summary', 'updated_at', 'week_start', 'workspace_id']);
  rt = fakeRt(() => []);
  assert.equal(await m.saveEditedSummary({start:'2026-10-05', organizationId:OA, row:{id:'r1'}, text:'  '}, rt), null);
  assert.equal(rt.calls[0].method, 'DELETE');
  await assert.rejects(m.saveEditedSummary({start:'2026-10-05', organizationId:'not-a-uuid', text:'x'}, rt));
});

test('requestOrgSummaries: sends only kind, week and organization ids; reads the counts; errors are plain words', async () => {
  const m = await sum;
  let body = null;
  const fetcher = async (url, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ok:true, kind:'org_summary', week_start:'2026-10-05', kept:[OB], items:[{organization_id:OA, summary:'요약.'}], empty:[], partial:true}), {status:200}); };
  const rt = fakeRt(() => []);
  const r = await m.requestOrgSummaries({start:'2026-10-05', organizationIds:[OA, OB, OA, 'nope']}, {rt, fetcher});
  assert.deepEqual(body, {kind:'org_summary', week_start:'2026-10-05', organization_ids:[OA, OB]});
  assert.deepEqual(r, {ok:true, written:1, kept:1, empty:0, partial:true, more:0});
  assert.equal(m.resultMessage(r), '조직 1곳 요약을 만들었어요. 고친 요약 1곳은 그대로 두었어요. 기록이 많아 일부만 보고 만들었어요.');
  const busy = await m.requestOrgSummaries({start:'2026-10-05', organizationIds:[OA]}, {rt, fetcher:async () => new Response(JSON.stringify({ok:false, error:'daily_limit'}), {status:429})});
  assert.equal(busy.ok, false); assert.equal(busy.code, 'daily_limit');
  const notReady = await m.requestOrgSummaries({start:'2026-10-05', organizationIds:[OA]}, {rt, fetcher:async () => new Response(JSON.stringify({ok:false, error:'org_summary_not_ready'}), {status:503})});
  assert.equal(notReady.message, '조직 요약은 아직 준비 중이에요.');
  assert.equal((await m.requestOrgSummaries({start:'2026-10-05', organizationIds:[]}, {rt, fetcher})).code, 'invalid_request');
  const many = Array.from({length:22}, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`);
  const r2 = await m.requestOrgSummaries({start:'2026-10-05', organizationIds:many}, {rt, fetcher:async (u, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ok:true, kind:'org_summary', week_start:'2026-10-05', kept:[], items:[], empty:[]}), {status:200}); }});
  assert.equal(body.organization_ids.length, 20); assert.equal(r2.more, 2);
});

const basket = {notes:[{id:'b1', raw_text:'안녕하세요\n가 조직 소식', occurred_at:'2026-10-06T00:30:00Z'}],
  links:[{note_id:'b1', status:'confirmed', organization_id:OA, organization:{name:'가 조직'}}], docs:[]};
const orgUpdates = Object.assign([{id:'u1', organization_id:OB, organization:{name:'나 조직'}, occurred_at:'2026-10-07T01:00:00Z', raw_text:'나 조직 기록'}],
  {mine:new Set([OA, OB]), orgs:[{id:OA, name:'가 조직'}, {id:OB, name:'나 조직'}]});
const model = summaries => ({start:'2026-10-05', lines:new Map(), linesState:'ok', today:'2026-10-06',
  materials:{basket:ok(basket), orgUpdates:ok(orgUpdates), ...(summaries === undefined ? {} : {orgSummaries:summaries})}});

test('weekly model: sections carry their id and saved summary; copy text uses the summary lines, else the records', async () => {
  const m = await weekly;
  const saved = new Map([[OA, {summary:'가 조직 임금교섭 진행.\n10.24.(금) 찬반투표 예정.', edited:false}]]);
  const w = m.weeklySummary(model(ok(saved)));
  assert.equal(w.orgs.summaries, 'ok');
  const [a, b] = w.orgs.sections;
  assert.equal(a.id, OA); assert.deepEqual(a.summary, {text:'가 조직 임금교섭 진행.\n10.24.(금) 찬반투표 예정.', edited:false});
  assert.equal(b.id, OB); assert.equal(b.summary, undefined);
  const text = m.weeklyReportText(w).split('\n'), at = text.indexOf('4. 산하 조직 현황');
  assert.deepEqual(text.slice(at + 2, at + 7), ['◦ 가 조직', '- 가 조직 임금교섭 진행.', '- 10.24.(금) 찬반투표 예정.', '◦ 나 조직', '- 10월 7일(수) 나 조직 기록']);
  // No table yet / still loading / failed: the records as before.
  assert.equal(m.weeklySummary(model(ok(Object.assign(new Map(), {missing:true})))).orgs.summaries, 'missing');
  assert.equal(m.weeklySummary(model(undefined)).orgs.summaries, 'loading');
  assert.equal(m.weeklySummary(model({status:'failed'})).orgs.summaries, 'failed');
  assert.equal(m.weeklySummary(model({status:'failed'})).orgs.sections[0].summary, undefined);
});

test('한글 파일 후보: an organization with a summary offers its summary lines; the others their records', async () => {
  const m = await weekly, d = await draft;
  const saved = new Map([[OA, {summary:'가 조직 임금교섭 진행.', edited:true}]]);
  const w = m.weeklySummary(model(ok(saved)));
  const orgs = [{index:0, org:'가 조직', lines:[]}, {index:1, org:'나 조직', lines:[]}];
  const got = d.weekMaterial(w, [], orgs);
  assert.deepEqual(got.byOrg.get(0).map(l => [l.day, l.text]), [['', '- 가 조직 임금교섭 진행.']]);
  assert.deepEqual(got.byOrg.get(1).map(l => [l.day, l.text]), [['2026-10-07', '- 나 조직 기록']]);
});
