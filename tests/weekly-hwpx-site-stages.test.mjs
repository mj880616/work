import test from 'node:test';
import assert from 'node:assert/strict';
import {applySiteStages, assembleDraft} from '../app/weekly-hwpx/draft.mjs';
import {seedRows} from '../app/org-dispute-stage-model.mjs';

// ORG-쟁의단계 ② → 명진 11/13 17:14 "한글 파일에서도 빼": 3. 2) 투쟁 사업장 칸에 쟁의 단계 줄을 넣지 않는다. 조직·현황 글은 모두 가짜 값.
// ('- 조정 신청(10.10)'은 예전에 앱이 넣은 단계 줄 모양 — 이제 뺀다.)
const stages = seedRows('w').map((row, i) => ({id: 's' + (i + 1), ...row, created_at: '2026-10-01T00:00:00Z'}));
const sid = name => stages.find(s => s.name === name).id;
const orgs = ['가', '나', '다', '라', '마'].map((c, i) => ({id: 'o' + (i + 1), name: `합성 ${c} 지부`, aliases: []}));
const hist = (org, name, date, n = 1) => ({id: `h${org}${n}`, organization_id: org, stage_id: sid(name), stage_name: name, stage_date: date, created_at: `2026-10-01T00:00:0${n}Z`});
const histories = rows => { const m = new Map(); for (const r of rows) (m.get(r.organization_id) ?? m.set(r.organization_id, []).get(r.organization_id)).push(r); return m; };
const base = () => ({title: 't', date: 'd', summary: [], sites: [
  {org: ['합성 가 지부'], status: ['- 조정 신청(10.10)', '- 조정회의 10.22 예정'], paras: [null, null], src: 0},
  {org: ['합성 나 지부'], status: ['- 지난주에 쓴 현황'], paras: [null], src: 1},
  {org: ['합성 다 지부'], status: [], paras: [], src: 2},
  {org: ['합성 라 지부'], status: ['- 협약 소식'], paras: [null], src: 3},
]});
// 보고 주간 10.19~10.25(월~일)
const run = (rows, weekStart = '2026-10-19', over = {}) => applySiteStages(base(), {orgs, stages, histories: histories(rows), weekStart, ...over});

test('투쟁 중: 단계 줄 없이 직전 확정본 줄 그대로(예전 앱 단계 줄은 뺌), 확정본에 없던 조직은 표 끝에 빈 줄', () => {
  const r = run([hist('o1', '쟁의발생 결의', '2026-10-20'), hist('o5', '쟁의중', '2026-10-14')]);
  assert.deepEqual(r.starts.get(0), ['- 조정회의 10.22 예정']);
  assert.equal(r.base.sites.length, 5);
  assert.deepEqual(r.base.sites[4], {org: ['합성 마 지부'], status: [], paras: []});
  assert.equal(r.starts.has(4), false, '빈 줄 그대로(단계 줄 없음)');
  assert.equal(r.fixes.some(f => f.index === 0 || f.index === 4), false);
  assert.deepEqual(base().sites.length, 4); // 바탕은 건드리지 않음
});

test('끝남: 단계 줄 없이 줄 그대로 두고, 끝난 주부터 고칠 목록', () => {
  const rows = [hist('o2', '협약체결', '2026-10-24')];
  const r = run(rows);
  assert.equal(r.starts.has(1), false);
  assert.equal(r.base.sites[1].status[0], '- 지난주에 쓴 현황');
  assert.ok(r.fixes.some(f => f.index === 1 && f.stage === '협약체결'));
  assert.ok(run(rows, '2026-10-26').fixes.some(f => f.index === 1));
});

test('교섭 시작 전·교섭 중은 표에 안 나오고, 확정본에 줄이 있으면 말없이 지우지 않고 고칠 목록', () => {
  const r = run([hist('o2', '교섭 중', '2026-10-01'), hist('o4', '쟁의발생 결의', '2026-10-20', 1)]);
  assert.equal(r.starts.has(1), false);
  assert.deepEqual(r.fixes.map(f => [f.index, f.org, f.stage]), [[0, '합성 가 지부', '교섭 시작 전'], [1, '합성 나 지부', '교섭 중']]);
  assert.equal(r.base.sites[1].status[0], '- 지난주에 쓴 현황'); // 줄은 그대로
  assert.equal(r.fixes.some(f => f.index === 2), false); // 빈 줄은 알릴 것 없음
  assert.equal(r.starts.has(3), false, '단계 줄 없음 — 확정본 줄 그대로');
  assert.deepEqual(r.starts.get(0), ['- 조정회의 10.22 예정'], '고칠 목록 칸도 예전 단계 줄은 뺌');
});

test('이력이 없으면 기본 단계: 확정본 줄이 있는 조직은 고칠 목록, 없는 조직은 아무 일 없음', () => {
  const r = run([]);
  assert.deepEqual(r.fixes.map(f => [f.index, f.stage]), [[0, '교섭 시작 전'], [1, '교섭 시작 전'], [3, '교섭 시작 전']]);
  assert.deepEqual([...r.starts.keys()], [0], '예전 단계 줄이 있던 칸만 바뀜');
});

test('단계를 읽지 못했거나 조직이 없으면 바탕 그대로', () => {
  const b = base();
  for (const over of [{stages: []}, {orgs: []}, {weekStart: ''}]) {
    const r = applySiteStages(b, {orgs, stages, histories: histories([hist('o1', '쟁의중', '2026-10-20')]), weekStart: '2026-10-19', ...over});
    assert.equal(r.base, b); assert.equal(r.starts.size, 0); assert.deepEqual(r.fixes, []);
  }
});

test('파일에도 단계 줄이 없다(assembleDraft)', () => {
  const r = run([hist('o1', '쟁의발생 결의', '2026-10-20')]);
  const out = assembleDraft(r.base, {sites: r.starts});
  const texts = out.sites.flatMap(s => s.status.map(l => typeof l === 'string' ? l : l.text));
  assert.equal(texts.some(t => /결의\(|조정 신청\(/.test(t)), false);
  assert.deepEqual(texts, ['- 조정회의 10.22 예정', '- 지난주에 쓴 현황', '- 협약 소식']);
});

// 기간 표기 단계 줄('- 파업 찬반투표(10.13~10.15)')도 예전 앱 단계 줄로 보고 뺀다.
const histP = (org, name, date, end, n = 1) => ({...hist(org, name, date, n), end_date: end});
test('기간 단계 줄도 뺌', () => {
  const again = applySiteStages({...base(), sites: [{org: ['합성 가 지부'], status: ['- 파업 찬반투표(10.13~10.15)', '- 남길 줄'], paras: [null, null]}]},
    {orgs, stages, histories: histories([histP('o1', '파업 찬반투표', '2026-10-20', '2026-10-22')]), weekStart: '2026-10-19'});
  assert.deepEqual(again.starts.get(0), ['- 남길 줄']);
});
