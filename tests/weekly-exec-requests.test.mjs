import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {makeFakeReport} from '../scripts/weekly-hwpx/fixture.mjs';
import {openHwpx, packHwpx, validateHwpx} from '../app/weekly-hwpx/hwpx.mjs';
import {readReport} from '../app/weekly-hwpx/report.mjs';
import {prepareConfirmed, openConfirmed, startDraft, assembleDraft, buildHwpx} from '../app/weekly-hwpx/draft.mjs';
import {parseFormDay, splitWhat, carryOver, carryCutoff, cleanItem, readItems, sortItems, mergeCarried, formRequests, requestLine,
  relatedNames, readExecRequests, changeExecRequests, EXEC_MAX_ROWS} from '../app/weekly-exec-requests.js';

// WEEKLY-임원요청정리: 주간보고 1. 요청사항 › 1) 임원 일정 배정·논의 요청 줄(app/weekly-exec-requests.js). 이름·조직·사업은 모두 가짜.
const REPORT_DAY = '2026-10-26', TODAY = '2026-10-23';
const CONFIRMED = [
  {day:'10.21.(수)', items:[{what:'10:30 / 가상 노동조합 결의대회 / 가상 광장', who:['가상 임원 갑']}]},           // 지난 날짜
  {day:'10.26.(월)', items:[{what:'14:00 / 가상노동조합 교섭 지원 / 가상 회의실', who:['가상 임원 을']},          // 기준일 당일 + 띄어쓰기 다른 이름
    {what:'15:00 / 다른 모임 행사 / 다른 곳', who:['가상 임원 병']}]},                                             // 관련 없는 조직
  {day:'10.28.(수)', items:[{what:'가상 공공 사업 토론회 / 가상 회관', who:['가상 임원 갑', '가상 임원 정']}]},  // 사업 이름
  {day:'10.29.(목)', items:[{what:'10:00 / 가 집회 / 어딘가', who:[]}]},                                       // 짧은 이름(확신 없음)
  {day:'10.30.(목)', items:[{what:'10:00 / 가상 노동조합 행사', who:[]}]},                                       // 요일이 날짜와 다름
  {day:'10.31.(토) ~ 11.1.(일)', items:[{what:'종일 / 가상 노동조합 수련회 / 가상 수련원', who:['가상 임원 갑']}]}, // 여러 날
  {day:'다음 주 중', items:[{what:'가상 노동조합 간담회', who:[]}]},                                              // 날짜를 못 읽음
];
const NAMES = {orgs:['가상 노동조합', '가'], projects:['가상 공공 사업', '교육']};
let n = 0; const makeId = () => `t${++n}`;

test('지난주에서 가져오기: 지난 날짜·관련 없는 조직·짧은 이름·요일 틀림·못 읽는 날짜는 빼고, 내 사업장·사업과 관련된 줄만 날짜순', () => {
  const cutoff = carryCutoff(REPORT_DAY, TODAY);
  assert.equal(cutoff, REPORT_DAY);
  const {items, counts} = carryOver(CONFIRMED, {cutoff, near:REPORT_DAY, ...NAMES, makeId});
  assert.deepEqual(items.map(i => [i.day, i.until, i.time, i.what, i.place, i.who, i.carried]), [
    ['2026-10-26', undefined, '14:00', '가상노동조합 교섭 지원', '가상 회의실', '가상 임원 을', true],
    ['2026-10-28', undefined, '', '가상 공공 사업 토론회', '가상 회관', '가상 임원 갑, 가상 임원 정', true],
    ['2026-10-31', '2026-11-01', '종일', '가상 노동조합 수련회', '가상 수련원', '가상 임원 갑', true],
  ]);
  assert.deepEqual(counts, {kept:3, past:1, unrelated:2, unread:2});
  // 짧은 이름('가'·'교육')은 쓰지 않는다.
  assert.deepEqual(relatedNames(NAMES), ['가상노동조합', '가상공공사업']);
  // 늦게 쓰면(오늘이 보고일 뒤) 오늘이 기준: 10/26 줄도 빠진다.
  assert.equal(carryCutoff(REPORT_DAY, '2026-10-27'), '2026-10-27');
  assert.deepEqual(carryOver(CONFIRMED, {cutoff:'2026-10-27', near:REPORT_DAY, ...NAMES, makeId}).items.map(i => i.day), ['2026-10-28', '2026-10-31']);
});

test('남는 줄이 없으면 빈 목록(머리만 있는 표), 담당 사업장·사업이 없으면 아무것도 가져오지 않음', () => {
  assert.deepEqual(carryOver(CONFIRMED, {cutoff:REPORT_DAY, near:REPORT_DAY, orgs:[], projects:[], makeId}).items, []);
  assert.deepEqual(carryOver([], {cutoff:REPORT_DAY, near:REPORT_DAY, ...NAMES}).items, []);
  assert.deepEqual(formRequests([]), []);
});

test('양식 날짜 칸 읽기와 가운데 칸 나누기', () => {
  assert.deepEqual(parseFormDay('10.21.(수)', REPORT_DAY), {day:'2026-10-21'});
  assert.deepEqual(parseFormDay('10.21(수)', REPORT_DAY), {day:'2026-10-21'});
  assert.deepEqual(parseFormDay('1.5.(화)', '2026-12-28'), {day:'2027-01-05'}); // 해가 바뀌는 주
  assert.equal(parseFormDay('10.21.(목)', REPORT_DAY), null);
  assert.equal(parseFormDay('10.21. 오전', REPORT_DAY), null);
  assert.deepEqual(splitWhat('10:30 / 행사 / 장소'), {time:'10:30', what:'행사', place:'장소'});
  assert.deepEqual(splitWhat('행사 / 장소'), {time:'', what:'행사', place:'장소'});
  assert.deepEqual(splitWhat('14시 / 행사'), {time:'14시', what:'행사', place:''});
  assert.deepEqual(splitWhat('행사'), {time:'', what:'행사', place:''});
});

test('줄 규칙: 날짜·내용 필수, 끝 날짜는 시작 뒤, 한 줄 글·길이, 날짜·시간순 정렬, 같은 줄은 두 번 가져오지 않음', () => {
  assert.deepEqual(cleanItem({day:'2026-10-28', until:'2026-10-28', time:' 10:30 ', what:' 가상  행사 ', place:'', who:'가상 임원'}, {id:'a'}),
    {id:'a', day:'2026-10-28', time:'10:30', what:'가상 행사', place:'', who:'가상 임원'});
  for (const [input, field] of [[{what:'x'}, 'day'], [{day:'2026-02-30', what:'x'}, 'day'], [{day:'2026-10-28', what:' '}, 'what'],
    [{day:'2026-10-28', until:'2026-10-27', what:'x'}, 'until'], [{day:'2026-10-28', what:'가'.repeat(201)}, 'what'], [{day:'2026-10-28', what:'a\u0007b'}, 'what']])
    assert.throws(() => cleanItem(input, {id:'a'}), e => e.code === 'invalid' && e.field === field, field);
  const rows = [{id:'c', day:'2026-10-28', time:'', what:'시간 없음'}, {id:'b', day:'2026-10-28', time:'14:00', what:'오후'}, {id:'a', day:'2026-10-27', time:'09:00', what:'앞날'}];
  assert.deepEqual(sortItems(rows).map(r => r.id), ['a', 'b', 'c']);
  assert.deepEqual(readItems([...rows.map(r => ({...r, place:'', who:''})), {id:'x', day:'bad', what:'x'}, 'nope']).map(r => r.id), ['a', 'b', 'c']);
  const carried = [{id:'k', day:'2026-10-28', time:'14:00', what:'오후', place:'', who:'', carried:true}, {id:'k2', day:'2026-10-29', time:'', what:'새 줄', place:'', who:'', carried:true}];
  assert.deepEqual(mergeCarried(readItems(rows.map(r => ({...r, place:'', who:''}))), carried).map(r => r.id), ['a', 'b', 'c', 'k2']);
});

test('출력 모양: 한글 파일 요청 표(같은 날은 한 날짜 칸, 참석 요청은 한 사람에 한 문단), 복사 한 줄 — 지난주에서 표시는 어디에도 없다', async () => {
  const items = readItems([
    {id:'b', day:'2026-10-28', time:'', what:'가상 토론회', place:'가상 회관', who:'가상 임원 갑, 가상 임원 정', carried:true},
    {id:'a', day:'2026-10-26', time:'14:00', what:'가상 교섭 지원', place:'가상 회의실', who:'가상 임원 을'},
    {id:'c', day:'2026-10-26', time:'16:00', what:'가상 면담', place:'', who:''},
    {id:'d', day:'2026-10-31', until:'2026-11-01', time:'종일', what:'가상 수련회', place:'', who:'가상 임원 갑'},
  ]);
  const form = formRequests(items);
  assert.deepEqual(form, [
    {day:'10.26.(월)', items:[{what:'14:00 / 가상 교섭 지원 / 가상 회의실', who:['가상 임원 을']}, {what:'16:00 / 가상 면담', who:[]}]},
    {day:'10.28.(수)', items:[{what:'가상 토론회 / 가상 회관', who:['가상 임원 갑', '가상 임원 정']}]},
    {day:'10.31.(토) ~ 11.1.(일)', items:[{what:'종일 / 가상 수련회', who:['가상 임원 갑']}]},
  ]);
  assert.equal(requestLine(items[2]), '- 10.28.(수) 가상 토론회 / 가상 회관 — 참석 요청: 가상 임원 갑, 가상 임원 정');
  assert.equal(JSON.stringify(form).includes('지난주'), false);
  // 확정본 바탕 → 이 줄들로 만든 파일: 규격 검사 통과, 다시 읽으면 같은 표(기존 양식 표 그대로), 직전 주 표·확인 필요 줄은 없음.
  const {team, template} = prepareConfirmed(await openConfirmed(packHwpx(makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib)), zlib)));
  const base = startDraft(team, {me:'가짜담당 갑', myOrgs:[], date:'2026년 10월 26일(월)'});
  const bytes = await buildHwpx(template, assembleDraft({...base, requests:form}));
  assert.deepEqual(validateHwpx(bytes, zlib).errors, []);
  const back = readReport(openHwpx(bytes, zlib));
  assert.deepEqual(back.requests, form);
  const empty = readReport(openHwpx(await buildHwpx(template, assembleDraft({...base, requests:formRequests([])})), zlib));
  assert.deepEqual(empty.requests, []);
});

// The REST calls the screen makes, against a fake PostgREST that keeps one row a week and honours the updated_at condition.
function fakeRest({missing = false} = {}) {
  const rows = [], calls = [];
  let clock = 0;
  const rt = {context:{read:() => ({workspace:{id:'w'}})}, api:async (path, opts = {}) => {
    const url = new URL('https://x' + path), q = url.searchParams, method = opts.method || 'GET';
    calls.push({method, path:url.pathname, query:Object.fromEntries(q), body:opts.body});
    if (missing) throw Object.assign(new Error('missing'), {status:404});
    const hit = () => rows.filter(r => ['workspace_id', 'week_start', 'updated_at'].every(k => !q.has(k) || q.get(k) === `eq.${r[k]}`));
    if (method === 'GET') return hit();
    if (method === 'POST') {
      if (rows.some(r => r.week_start === opts.body.week_start)) throw Object.assign(new Error('dup'), {status:409});
      const row = {id:'row' + rows.length, carried_at:null, ...opts.body, updated_at:`v${++clock}`}; rows.push(row); return [row];
    }
    if (method === 'PATCH') { const list = hit(); for (const r of list) Object.assign(r, opts.body, {updated_at:`v${++clock}`}); return list; }
    throw new Error('method');
  }};
  return {rt, rows, calls, touch:week => { const r = rows.find(x => x.week_start === week); r.items = [...r.items, {id:'other', day:'2026-10-30', time:'', what:'다른 기기에서 더한 줄', place:'', who:''}]; r.updated_at = `v${++clock}`; }};
}
const WEEK = '2026-10-19';
const ROW = {id:'r1', day:'2026-10-28', time:'10:30', what:'가상 결의대회', place:'가상 광장', who:'가상 임원'};

test('서버 저장: 새 주는 POST, 아는 주는 updated_at 조건 PATCH(지우기 없음), 그사이 바뀐 주는 다시 읽어 같은 변경을 한 번 더', async () => {
  const f = fakeRest();
  assert.deepEqual(await readExecRequests(WEEK, f.rt), {missing:false, row:null});
  // 넣기
  let {row} = await changeExecRequests({start:WEEK, row:null, change:list => [...list, ROW]}, f.rt);
  assert.deepEqual(row.items, [ROW]);
  assert.deepEqual(f.calls.at(-1).body, {workspace_id:'w', week_start:WEEK, items:[ROW], updated_at:f.calls.at(-1).body.updated_at});
  // 고치기
  ({row} = await changeExecRequests({start:WEEK, row, change:list => list.map(r => ({...r, what:'고친 결의대회'}))}, f.rt));
  assert.equal(row.items[0].what, '고친 결의대회');
  assert.equal(f.calls.at(-1).method, 'PATCH');
  assert.equal(f.calls.at(-1).query.updated_at, 'eq.v1');
  // 다른 곳에서 바뀐 뒤 지우기: 첫 PATCH는 0행 → 다시 읽고 그 판에서 지움(다른 기기 줄은 남음)
  f.touch(WEEK);
  ({row} = await changeExecRequests({start:WEEK, row, change:list => list.filter(r => r.id !== 'r1')}, f.rt));
  assert.deepEqual(row.items.map(r => r.id), ['other']);
  assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 0);
  // 모두 지워도 행은 빈 목록으로 남는다
  ({row} = await changeExecRequests({start:WEEK, row, change:() => []}, f.rt));
  assert.deepEqual(row.items, []);
  assert.deepEqual((await readExecRequests(WEEK, f.rt)).row.items, []);
});

test('지난주에서 가져오기 저장은 그 주에 한 번(carried_at), 다른 기기가 먼저 만든 주(409)는 다시 읽어 합침, 30줄 넘으면 멈춤', async () => {
  const f = fakeRest();
  const carried = [{...ROW, id:'c1', carried:true}];
  const once = (list, row) => (row?.carried_at ? null : mergeCarried(list, carried));
  let r = await changeExecRequests({start:WEEK, row:null, change:once, carry:true}, f.rt);
  assert.ok(r.row.carried_at);
  assert.deepEqual(r.row.items.map(i => [i.id, i.carried]), [['c1', true]]);
  r = await changeExecRequests({start:WEEK, row:r.row, change:once, carry:true}, f.rt);
  assert.equal(r.skipped, true);
  // 화면이 모르는 사이 다른 기기가 만든 주: POST 409 → 다시 읽고 PATCH
  const g = fakeRest();
  await changeExecRequests({start:WEEK, row:null, change:() => [ROW]}, g.rt);
  r = await changeExecRequests({start:WEEK, row:null, change:list => [...list, {...ROW, id:'r2', what:'둘째'}]}, g.rt);
  assert.deepEqual(r.row.items.map(i => i.id), ['r1', 'r2']);
  await assert.rejects(changeExecRequests({start:WEEK, row:r.row, change:() => Array.from({length:EXEC_MAX_ROWS + 1}, (_, i) => ({...ROW, id:'m' + i}))}, g.rt), {code:'too_many'});
  // 표가 아직 없으면(404) 읽기는 missing, 쓰기는 알림
  const h = fakeRest({missing:true});
  assert.deepEqual(await readExecRequests(WEEK, h.rt), {missing:true, row:null});
  await assert.rejects(changeExecRequests({start:WEEK, row:null, change:() => [ROW]}, h.rt), {code:'missing'});
});
