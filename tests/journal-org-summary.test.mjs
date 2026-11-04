import { test } from 'node:test';
import assert from 'node:assert/strict';
// [주간 정리] 4. 산하 조직 현황 — WEEKLY-메뉴짝짓기 P6·P7: AI 요약 모듈(journal-org-summary.js)은 지웠고 저장된 요약은 읽지 않는다.
// 화면 묶음·복사·한글 파일 후보만 본다. Fake names only.
const weekly = import('../app/journal-weekly.js');
const draft = import('../app/weekly-hwpx/draft.mjs');
const OA = '11111111-1111-4111-8111-111111111111', OB = '22222222-2222-4222-8222-222222222222';
const ok = items => ({status:'ok', items});

const basket = {notes:[{id:'b1', raw_text:'안녕하세요\n가 조직 소식', occurred_at:'2026-10-06T00:30:00Z'}],
  links:[{note_id:'b1', status:'confirmed', organization_id:OA, organization:{name:'가 조직'}}], docs:[]};
const orgUpdates = Object.assign([{id:'u1', organization_id:OB, organization:{name:'나 조직'}, occurred_at:'2026-10-07T01:00:00Z', raw_text:'나 조직 기록'}],
  {mine:new Set([OA, OB]), orgs:[{id:OA, name:'가 조직'}, {id:OB, name:'나 조직'}]});
const model = summaries => ({start:'2026-10-05', lines:new Map(), linesState:'ok', today:'2026-10-06',
  materials:{basket:ok(basket), orgUpdates:ok(orgUpdates), ...(summaries === undefined ? {} : {orgSummaries:summaries})}});

// WEEKLY-메뉴짝짓기 P6: [주간 정리] 4. 1)은 저장된 AI 요약을 읽지 않는다(표는 보존). 칸 줄은 주별 조직보고 표(model.orgLines)가 있으면 그것, 없으면 기록.
test('weekly model: sections carry their id (no saved summary); copy text uses the weekly org lines when given, else the records', async () => {
  const m = await weekly;
  const saved = new Map([[OA, {summary:'가 조직 임금교섭 진행.', edited:false}]]);
  const w = m.weeklySummary(model(ok(saved)));
  const [a, b] = w.orgs.sections;
  assert.equal(a.id, OA); assert.equal(a.summary, undefined);
  assert.equal(b.id, OB); assert.equal(b.summary, undefined);
  let text = m.weeklyReportText(w).split('\n'), at = text.indexOf('4. 산하 조직 현황');
  assert.equal(text[at + 2], '◦ 가 조직');
  assert.ok(!text.includes('- 가 조직 임금교섭 진행.'), '저장된 AI 요약은 쓰지 않는다');
  text = m.weeklyReportText({...w, orgLines:new Map([[OA, ['- 10.6. 가상 교섭']]])}).split('\n'); at = text.indexOf('4. 산하 조직 현황');
  assert.deepEqual(w.orgs.mine.map(o => o.id).sort(), [OA, OB].sort());
  assert.ok(text.includes('- 10.6. 가상 교섭'));
});

test('한글 파일 후보: 조직마다 그 주 기록(요약 없음)', async () => {
  const m = await weekly, d = await draft;
  const saved = new Map([[OA, {summary:'가 조직 임금교섭 진행.', edited:true}]]);
  const w = m.weeklySummary(model(ok(saved)));
  const orgs = [{index:0, org:'가 조직', lines:[]}, {index:1, org:'나 조직', lines:[]}];
  const got = d.weekMaterial(w, [], orgs);
  assert.ok(!(got.byOrg.get(0) ?? []).some(l => l.text.includes('임금교섭 진행')));
  assert.deepEqual(got.byOrg.get(1).map(l => [l.day, l.text]), [['2026-10-07', '- 나 조직 기록']]);
});

