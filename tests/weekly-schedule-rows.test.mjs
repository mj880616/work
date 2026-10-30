// WEEKLY-주요일정칸: 두 곳([주간 정리] 2) 주요 일정 · 한글 파일 상자 5. 주요 일정)이 같은 자료, 한글 파일 한 줄 합치기, 투쟁 사업장 구성 이어 쓰기.
// 가짜 이름·가짜 일정만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../app/weekly-schedule-rows.mjs';
import {makeDraft, readDraft, placeDraft, merge3, withHq, withTitleEdit, withSiteLayout, draftHq, draftSiteLayout, keepDocsOnly, hasContent, readCarriedLayout} from '../app/weekly-draft-store.js';
import {scheduleForm, withTitleEdits} from '../app/journal-weekly.js';
import {scheduleItems} from '../app/weekly-hwpx/schedule.mjs';

const calendar = () => ({days:['2026-11-02', '2026-11-03', '2026-11-04'], vacations:[], rows:[
  {day:'2026-11-02', label:'11.2.(월)', items:[{key:'c:e1', time:'10:30', title:'가상 회의 40차', place:'가상 회관', what:'10:30 / 가상 회의 40차 / 가상 회관'}]},
  {day:'2026-11-03', label:'11.3.(화)', items:[{key:'c:e2', time:'종일', title:'가상 교육', place:'', what:'종일 / 가상 교육'}]},
]});
const items = () => new Map(scheduleItems(calendar()).map(i => [i.key, i]));

test('시간 칸: 0930·9:30 → 09:30, 종일, 빈 칸, 읽을 수 없으면 null', () => {
  assert.equal(R.cleanTime('0930'), '09:30');
  assert.equal(R.cleanTime('9:30'), '09:30');
  assert.equal(R.cleanTime('종일'), '종일');
  assert.equal(R.cleanTime(''), '');
  assert.equal(R.cleanTime('25:00'), null);
  assert.equal(R.cleanTime('오전'), null);
});

test('칸별 고침: 바탕과 같으면 고침 없음, 날짜·시간·참석은 다를 때만, 제목·장소는 늘', () => {
  const e1 = items().get('c:e1');
  assert.equal(R.editFrom(e1, {day:'2026-11-02', time:'10:30', title:'가상 회의 40차', place:'가상 회관', who:'가상 담당'}, '가상 담당'), null);
  assert.deepEqual(R.editFrom(e1, {time:'1100', title:'가상 집행국 회의', who:'가상 담당, 가상 임원'}, '가상 담당'),
    {title:'가상 집행국 회의', place:'가상 회관', time:'11:00', who:'가상 담당, 가상 임원'});
  assert.deepEqual(R.editFrom(e1, {day:'2026-11-04'}, ''), {title:'가상 회의 40차', place:'가상 회관', day:'2026-11-04'});
  // 기억이 있으면 바탕은 기억한 이름.
  const memo = {...e1, memo:{key:'k', title:'기억한 이름', place:'기억 장소'}};
  assert.deepEqual(R.baseFields(memo, 'A'), {day:'2026-11-02', time:'10:30', title:'기억한 이름', place:'기억 장소', who:'A'});
});

test('한글 파일 한 줄: 칸을 따로 고쳐도 5. 주요 일정 칸은 "시간 / 제목 / 장소" 한 줄, 참석은 참석자 칸, 날짜를 옮기면 그날 줄로', () => {
  const titles = new Map([['c:e1', {title:'가상 집행국 회의', place:'가상 회관 6층', time:'11:00', who:'가상 담당, 가상 임원'}], ['c:e2', {title:'가상 교육', place:'', day:'2026-11-04'}]]);
  const {calendar:form} = scheduleForm(calendar(), '가상 담당', titles);
  assert.deepEqual(form, [
    {day:'11.2.(월)', items:[{what:'11:00 / 가상 집행국 회의 / 가상 회관 6층', who:['가상 담당', '가상 임원']}]},
    {day:'11.3.(화)', items:[]},
    {day:'11.4.(수)', items:[{what:'종일 / 가상 교육 / 미정', who:['가상 담당']}]},
  ]);
  // 화면·복사용 달력(calendarView)도 같은 값·같은 날.
  const view = withTitleEdits(calendar(), titles);
  assert.deepEqual(view.rows.map(r => [r.day, r.items.map(i => i.what)]), [['2026-11-02', ['11:00 / 가상 집행국 회의 / 가상 회관 6층']], ['2026-11-04', ['종일 / 가상 교육']]]);
});

test('두 곳 같은 자료: 2) 주요 일정에 달력에서 넣은 줄은 상자 5번의 칸별 고침을 따르고, 그 줄을 고치면 같은 항목이 바뀐다', () => {
  const ev = items();
  let draft = withHq(null, R.withPicked([], [ev.get('c:e1')], {titles:new Map()}));
  assert.equal(draftHq(draft).length, 1);
  // 상자 5번에서 제목·시간을 고침 → 2) 줄도 같은 값(줄 값을 다시 쓰지 않아도).
  draft = withTitleEdit(draft, 'c:e1', {title:'가상 집행국 회의', place:'가상 회관', time:'11:00'});
  const titles = placeDraft(readDraft(draft), new Set()).titles;
  assert.deepEqual(R.hqLines(draftHq(draft), {events:ev, titles}), ['- 11.2.(월) 11:00 / 가상 집행국 회의 / 가상 회관']);
  // 2) 표에서 그 줄을 고침 = 같은 titles 항목을 고침 → 상자가 만드는 5번 칸 글도 바뀐다.
  draft = withTitleEdit(draft, 'c:e1', R.editFrom(ev.get('c:e1'), {title:'가상 집행국 회의 40차', place:'가상 회관 6층', time:'11:00'}, ''));
  const t2 = placeDraft(readDraft(draft), new Set()).titles;
  assert.equal(scheduleForm(calendar(), '', t2).calendar[0].items[0].what, '11:00 / 가상 집행국 회의 40차 / 가상 회관 6층');
  assert.deepEqual(R.hqLines(draftHq(draft), {events:ev, titles:t2}), ['- 11.2.(월) 11:00 / 가상 집행국 회의 40차 / 가상 회관 6층']);
  // 달력에서 일정이 없어지면 줄에 적어 둔 값.
  assert.deepEqual(R.hqLines(draftHq(draft), {events:new Map(), titles:t2}), ['- 11.2.(월) 10:30 / 가상 회의 40차 / 가상 회관']);
  // 같은 일정은 두 번 넣지 않는다. 수기 줄·순서·빼기.
  let rows = R.withPicked(draftHq(draft), [ev.get('c:e1'), ev.get('c:e2')], {titles:t2});
  assert.equal(rows.length, 2);
  rows = R.withHqRow(rows, {id:'h1', day:'2026-11-06', time:'13:00', title:'가상 공동 점검', place:''});
  assert.equal(R.hqLine(R.hqFields(rows[2])), '- 11.6.(금) 13:00 / 가상 공동 점검');
  rows = R.movedHqRow(rows, 'h1', 0);
  assert.equal(rows[0].id, 'h1');
  rows = R.withoutHqRow(rows, 'h1');
  assert.equal(rows.length, 2);
});

test('임시저장: 칸별 고침·2) 줄·사업장 구성이 저장·다시 읽기·3자 비교·[처음부터]를 지나도 남는다', () => {
  const d = makeDraft({titles:new Map([['c:e1', {title:'가', place:'', time:'11:00', who:''}]]), hq:[{id:'h1', day:'2026-11-06', time:'', title:'가상 줄', place:''}], siteLayout:{order:['가 노조'], hidden:['나 노조'], at:'2026-10-30T00:00:00Z'}});
  const back = readDraft(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back.titles, [{event:'c:e1', title:'가', place:'', time:'11:00', who:''}]);
  assert.deepEqual(draftHq(back), [{id:'h1', day:'2026-11-06', time:'', title:'가상 줄', place:''}]);
  assert.deepEqual(draftSiteLayout(back), {order:['가 노조'], hidden:['나 노조'], at:'2026-10-30T00:00:00Z'});
  // hq·구성만으로는 '이어서 고치기' 질문을 띄우지 않는다.
  assert.equal(hasContent(makeDraft({hq:[{id:'h1', day:'', time:'', title:'x', place:''}]})), false);
  // 한쪽([주간 정리])은 줄을, 다른 쪽(상자)은 구성을 바꿈 → 둘 다 남는다.
  const base = readDraft(d);
  const mine = withSiteLayout(base, {order:['가 노조', '다 노조'], hidden:['나 노조'], at:'2026-10-30T01:00:00Z'});
  const theirs = withHq(base, [...draftHq(base), {id:'h2', day:'', time:'', title:'더한 줄', place:''}]);
  const {draft:merged, conflicts} = merge3(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(draftHq(merged).length, 2);
  assert.deepEqual(draftSiteLayout(merged).order, ['가 노조', '다 노조']);
  // [처음부터]: 상자 고침(titles)은 비우되 2) 줄·구성은 남긴다.
  const kept = keepDocsOnly(merged);
  assert.deepEqual(kept.titles, []);
  assert.equal(draftHq(kept).length, 2);
  assert.ok(draftSiteLayout(kept));
});

test('투쟁 사업장 구성: 빼기(글은 칸에 그대로)·되돌리기(원래 자리)·추가(내 담당 조직만)·순서, 파일에는 들어간 사업장만', () => {
  const rows = [{index:0, org:'가 노조'}, {index:1, org:'나 노조'}, {index:2, org:'다 노조'}];
  let layout = R.siteHidden(rows, null, '나 노조');
  assert.deepEqual(R.arrangeSites(rows, layout).shown.map(r => r.org), ['가 노조', '다 노조']);
  assert.deepEqual(R.arrangeSites(rows, layout).hidden.map(r => r.org), ['나 노조']);
  const sites = [{org:['가 노조'], status:['- 가']}, {org:['나 노조'], status:['- 적어 둔 글']}, {org:['다 노조'], status:[]}];
  assert.deepEqual(R.layoutSiteData(sites, rows, layout).map(s => s.org[0]), ['가 노조', '다 노조']);
  layout = R.siteShown(rows, layout, '나 노조', '', 1);
  assert.deepEqual(R.arrangeSites(rows, layout).shown.map(r => r.org), ['가 노조', '나 노조', '다 노조']);
  assert.deepEqual(R.layoutSiteData(sites, rows, layout)[1].status, ['- 적어 둔 글']);
  layout = R.siteMoved(rows, layout, '다 노조', 0);
  assert.deepEqual(R.arrangeSites(rows, layout).shown.map(r => r.org), ['다 노조', '가 노조', '나 노조']);
  // [+ 사업장 추가]로 넣은 바탕에 없는 사업장: 내 담당 조직이면 다음 주 바탕에 빈 칸으로.
  layout = R.siteShown(rows, layout, '라 노조');
  assert.deepEqual(R.missingSites(rows, layout, ['가 노조', '라 노조']), ['라 노조']);
  assert.deepEqual(R.missingSites(rows, layout, ['가 노조']), []);
});

test('구성은 다음 주에도 이어진다: 그 주에 구성이 없으면 가장 가까운 지난주 구성(서버 읽기, 칸 준비 전·실패면 없음)', async () => {
  const calls = [];
  const rt = {context:{read:() => ({workspace:{id:'w'}})}, api:async url => { calls.push(url); return [{week_start:'2026-10-26', layout:null}, {week_start:'2026-10-19', layout:{order:['가 노조'], hidden:['나 노조'], at:'x'}}]; }};
  const l = await readCarriedLayout('2026-11-02', rt);
  assert.deepEqual(l, {order:['가 노조'], hidden:['나 노조'], at:'x'});
  assert.match(calls[0], /week_start=lt\.2026-11-02/);
  assert.match(calls[0], /layout:draft->site_layout/);
  assert.match(calls[0], /order=week_start\.desc/);
  // 다음 주 바탕에도 같은 구성: 뺀 사업장은 빠지고 순서 그대로.
  const next = [{index:0, org:'나 노조'}, {index:1, org:'가 노조'}];
  assert.deepEqual(R.arrangeSites(next, l).shown.map(r => r.org), ['가 노조']);
  const fail = {context:{read:() => ({workspace:{id:'w'}})}, api:async () => { throw Object.assign(new Error('x'), {status:400}); }};
  assert.equal(await readCarriedLayout('2026-11-02', fail), null);
});
