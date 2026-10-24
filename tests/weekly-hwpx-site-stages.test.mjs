import test from 'node:test';
import assert from 'node:assert/strict';
import {applySiteStages, assembleDraft} from '../app/weekly-hwpx/draft.mjs';
import {seedRows} from '../app/org-dispute-stage-model.mjs';

// ORG-쟁의단계 ②: 주간보고 3. 2) 투쟁 사업장 현황 자동 채움 규칙. 조직·현황 글은 모두 가짜 값.
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

test('투쟁 중: 첫 줄 단계(날짜) + 직전 확정본 줄 그대로(앱이 채운 옛 단계 줄은 바꿈), 확정본에 없던 조직은 표 끝에 새 줄', () => {
  const r = run([hist('o1', '쟁의발생 결의', '2026-10-20'), hist('o5', '쟁의중', '2026-10-14')]);
  assert.deepEqual(r.starts.get(0), ['- 쟁의발생 결의(10.20)', '- 조정회의 10.22 예정']);
  assert.equal(r.base.sites.length, 5);
  assert.deepEqual(r.base.sites[4], {org: ['합성 마 지부'], status: [], paras: []});
  assert.deepEqual(r.starts.get(4), ['- 쟁의중(10.14)']);
  assert.deepEqual(base().sites.length, 4); // 바탕은 건드리지 않음
});

test('끝남: 끝난 주에만 한 줄, 다음 주에는 빠지고 고칠 목록으로', () => {
  const rows = [hist('o2', '협약체결', '2026-10-24')];
  assert.deepEqual(run(rows).starts.get(1), ['- 협약체결(10.24)']);
  const next = run(rows, '2026-10-26');
  assert.equal(next.starts.has(1), false);
  assert.ok(next.fixes.some(f => f.index === 1));
});

test('교섭 시작 전·교섭 중은 표에 안 나오고, 확정본에 줄이 있으면 말없이 지우지 않고 고칠 목록', () => {
  const r = run([hist('o2', '교섭 중', '2026-10-01'), hist('o4', '쟁의발생 결의', '2026-10-20', 1)]);
  assert.equal(r.starts.has(1), false);
  assert.deepEqual(r.fixes.map(f => [f.index, f.org, f.stage]), [[0, '합성 가 지부', '교섭 시작 전'], [1, '합성 나 지부', '교섭 중']]);
  assert.equal(r.base.sites[1].status[0], '- 지난주에 쓴 현황'); // 줄은 그대로
  assert.equal(r.fixes.some(f => f.index === 2), false); // 빈 줄은 알릴 것 없음
  assert.deepEqual(r.starts.get(3), ['- 쟁의발생 결의(10.20)', '- 협약 소식']);
});

test('이력이 없으면 기본 단계: 확정본 줄이 있는 조직은 고칠 목록, 없는 조직은 아무 일 없음', () => {
  const r = run([]);
  assert.deepEqual(r.fixes.map(f => [f.index, f.stage]), [[0, '교섭 시작 전'], [1, '교섭 시작 전'], [3, '교섭 시작 전']]);
  assert.equal(r.starts.size, 0);
});

test('단계를 읽지 못했거나 조직이 없으면 바탕 그대로', () => {
  const b = base();
  for (const over of [{stages: []}, {orgs: []}, {weekStart: ''}]) {
    const r = applySiteStages(b, {orgs, stages, histories: histories([hist('o1', '쟁의중', '2026-10-20')]), weekStart: '2026-10-19', ...over});
    assert.equal(r.base, b); assert.equal(r.starts.size, 0); assert.deepEqual(r.fixes, []);
  }
});

test('지난 주 보고는 그 주 끝까지의 단계로 읽는다', () => {
  const rows = [hist('o1', '쟁의발생 결의', '2026-10-05'), hist('o1', '협약체결', '2026-10-24', 2)];
  assert.deepEqual(run(rows, '2026-10-12').starts.get(0), ['- 쟁의발생 결의(10.5)', '- 조정회의 10.22 예정']);
  assert.deepEqual(run(rows, '2026-10-19').starts.get(0), ['- 협약체결(10.24)']);
});

test('앱이 채운 첫 줄은 파란 글씨(바탕에 없는 줄), 나머지는 그대로', () => {
  const r = run([hist('o1', '쟁의발생 결의', '2026-10-20')]);
  const out = assembleDraft(r.base, {sites: new Map([[0, r.starts.get(0)]])});
  assert.deepEqual(out.sites[0].status, [{text: '- 쟁의발생 결의(10.20)', changed: true}, '- 조정회의 10.22 예정']);
});

// ORG-쟁의단계 다듬기(2026-10-24 11:05): 단계 기간이 표에 기간으로 나오고, 끝남 기간이 그 주에 걸치면 그 주에 나온다.
const histP = (org, name, date, end, n = 1) => ({...hist(org, name, date, n), end_date: end});
test('기간: 투쟁 중은 - 파업 찬반투표(10.20~10.22), 옛 단계 줄(기간 포함)은 새 줄로 바뀜', () => {
  const r = run([histP('o1', '파업 찬반투표', '2026-10-20', '2026-10-22')]);
  assert.deepEqual(r.starts.get(0), ['- 파업 찬반투표(10.20~10.22)', '- 조정회의 10.22 예정']);
  const again = applySiteStages({...base(), sites: [{org: ['합성 가 지부'], status: ['- 파업 찬반투표(10.13~10.15)', '- 남길 줄'], paras: [null, null]}]},
    {orgs, stages, histories: histories([histP('o1', '파업 찬반투표', '2026-10-20', '2026-10-22')]), weekStart: '2026-10-19'});
  assert.deepEqual(again.starts.get(0), ['- 파업 찬반투표(10.20~10.22)', '- 남길 줄']);
});
test('끝남 기간이 걸친 주마다 한 줄(10.24~10.27 → 10.19 주와 10.26 주), 그다음 주는 빠지고 고칠 목록', () => {
  const rows = [histP('o2', '협약체결', '2026-10-24', '2026-10-27')];
  assert.deepEqual(run(rows).starts.get(1), ['- 협약체결(10.24~10.27)']);
  assert.deepEqual(run(rows, '2026-10-26').starts.get(1), ['- 협약체결(10.24~10.27)']);
  const later = run(rows, '2026-11-02');
  assert.equal(later.starts.has(1), false);
  assert.ok(later.fixes.some(f => f.index === 1));
});
