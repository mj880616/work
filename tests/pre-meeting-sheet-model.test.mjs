import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// FEAT-1029묶음 ② 교섭·회의 전 한 장: screen-side rules (pre-meeting-sheet-model.mjs) and the shared sheet renderer. Synthetic data only.
const m = await import('../app/pre-meeting-sheet-model.mjs');
const ORG = 'c0000000-0000-4000-8000-000000000001', ORG2 = 'c0000000-0000-4000-8000-000000000002';
const ORGS = [{id:ORG, name:'A 사업장', aliases:['A지회']}, {id:ORG2, name:'B 지부', aliases:[]}];
const EVENING = Date.parse('2026-10-29T09:30:00Z'), NOON = Date.parse('2026-10-29T03:00:00Z'); // 18:30, 12:00 KST
const ev = (id, title, start, extra = {}) => ({id, calendarId:'work@group.calendar.test', title, start, end:null, location:'', organizationIds:[], ...extra});

test('결정 1: a linked organization and a meeting word; without a link, exactly one organization name in the title', () => {
  assert.equal(m.target(ev('e1', 'A 사업장 임금교섭 4차', '2026-10-30T14:00:00+09:00', {organizationIds:[ORG]}), ORGS).org.id, ORG);
  assert.equal(m.target(ev('e2', '창립 기념 행사', '2026-10-30T14:00:00+09:00', {organizationIds:[ORG]}), ORGS), null, 'no meeting word');
  assert.equal(m.target(ev('e3', 'A 사업장 간담회', '2026-10-30T14:00:00+09:00'), ORGS).org.id, ORG, 'name in the title');
  assert.equal(m.target(ev('e4', 'A 사업장·B 지부 합동 회의', '2026-10-30T14:00:00+09:00'), ORGS), null, 'two names are ambiguous');
  assert.equal(m.target(ev('e5', '운영위원회의', '2026-10-30T14:00:00+09:00'), ORGS), null, 'no organization');
  assert.equal(m.target(ev('e6', '교섭', '2026-10-30T14:00:00+09:00', {organizationIds:['c0000000-0000-4000-8000-000000000099']}), ORGS), null, 'linked to an unknown organization');
  assert.equal(m.target(ev('e7', 'A 사업장 교섭', '2026-10-30T14:00:00+09:00', {organizationIds:[ORG], status:'cancelled'}), ORGS), null);
  assert.equal(m.eventKey(ev('x y', 't', '2026-10-30')), '', 'bad ids give no key');
});

test('결정 2: after 18:00 KST only tomorrow targets, once each; not before 18:00', () => {
  const events = [
    ev('a', 'A 사업장 교섭 4차', '2026-10-30T14:00:00+09:00', {organizationIds:[ORG]}),
    ev('b', 'B 지부 면담', '2026-10-31T10:00:00+09:00', {organizationIds:[ORG2]}),
    ev('c', 'A 사업장 협의', '2026-10-30', {organizationIds:[ORG], allDay:true}),
    ev('a', 'A 사업장 교섭 4차', '2026-10-30T14:00:00+09:00', {organizationIds:[ORG]}),
  ];
  assert.deepEqual(m.autoTargets({events, orgs:ORGS, now:EVENING}).map(t => t.key), ['work@group.calendar.test:a', 'work@group.calendar.test:c']);
  assert.deepEqual(m.autoTargets({events, orgs:ORGS, now:NOON}), []);
  assert.deepEqual(m.autoTargets({events, orgs:ORGS, now:EVENING, have:new Set(['work@group.calendar.test:a']), asked:new Set(['work@group.calendar.test:c'])}), []);
});

test('event body: ISO times, all-day as KST midnight, end never before start, title and place trimmed', () => {
  const b = m.eventBody(ev('a', '  A 사업장   교섭 ', '2026-10-30T14:00:00+09:00', {end:'2026-10-30T13:00:00+09:00', location:'  본사 '}));
  assert.deepEqual(b, {event_key:'work@group.calendar.test:a', title:'A 사업장 교섭', start:'2026-10-30T05:00:00.000Z', end:null, location:'본사'});
  assert.equal(m.eventBody(ev('d', '교섭', '2026-10-30')).start, '2026-10-30T00:00:00+09:00');
  assert.equal(m.eventBody(ev('d', '교섭', '2026-10-30')).location, null);
});

const ROW = {event_key:'k', organization_id:ORG, event_title:'A 사업장 임금교섭 4차', event_start:'2026-10-30T05:00:00.000Z', event_location:'본사 회의실',
  top_lines:[{text:'3차에서 남은 쟁점은 인상률임.', refs:[1, 99]}, {text:'AI 줄만 가리킴.', refs:[7]}, {text:'근거 없음.', refs:[]}],
  groups:[
    {group:'stage', title:'조정 신청', day:'2026-10-20', source_kind:'stage', source_id:ORG},
    {group:'meetings', title:'A 사업장 임금교섭 3차', day:'2026-10-27', source_kind:'meeting', source_id:'m1'},
    {group:'issues', title:'기본급 인상률 이견', day:'2026-10-27', source_kind:'ledger', source_id:'r1'},
    {group:'issues', title:'전략 비공개 결정', day:'2026-10-25', source_kind:'ledger', source_id:'r2', s2:true},
    {group:'commitments', title:'근거 자료 회신', day:'2026-11-01', source_kind:'ledger', source_id:'r3'},
    {group:'feed', title:'통화 · 사측 실무자', day:'2026-10-28', source_kind:'call', source_id:'f1'},
    {group:'feed', title:'텔레그램 · 간부방', day:'2026-10-28', source_kind:'telegram', source_id:'f2'},
    {group:'issues', title:'인상률 이견 남음.', day:null, source_kind:'ai', source_id:'', refs:[2]},
    {group:'people', title:'김지부장', day:null, source_kind:'person', source_id:'p1'},
    {group:'people', title:'요즘: 성과급 안에 반대함.', day:'2026-10-29', source_kind:'people_brief', source_id:ORG},
    {group:'docs', title:'2026 임금 요구안', day:'2026-10-15', source_kind:'document', source_id:'d1'},
    {group:'evil', title:'<b>x</b>', source_kind:'meeting', source_id:'x'},
  ], ai_status:'ok', made_by:'auto', updated_at:'2026-10-29T09:20:00Z'};

test('sheet view: refs only to record lines, AI lines first in their group, S2 tagged, summaries always visible', () => {
  const v = m.sheetView(ROW);
  assert.deepEqual(v.top, [{text:'3차에서 남은 쟁점은 인상률임.', refs:[1]}, {text:'AI 줄만 가리킴.', refs:[]}, {text:'근거 없음.', refs:[]}]);
  assert.equal(v.stage, '조정 신청');
  assert.deepEqual(v.groups.map(g => g.key), ['meetings', 'issues', 'commitments', 'feed', 'people', 'docs']);
  const issues = v.groups.find(g => g.key === 'issues');
  assert.equal(issues.items[0].ai, true);assert.deepEqual(issues.items[0].refs, [2]);
  assert.equal(issues.items.find(i => i.title === '전략 비공개 결정').org, '교섭·전략');
  assert.equal(v.groups.find(g => g.key === 'feed').summary, '2건 — 통화 1 · 텔레그램 1 (최근 30일)');
  assert.equal(v.groups.find(g => g.key === 'people').summary, '1명 — 요즘: 성과급 안에 반대함.');
  assert.equal(v.groups.find(g => g.key === 'meetings').summary, '1건 — 최근 A 사업장 임금교섭 3차(10/27(화))');
  assert.equal(v.made, '10/29(목) 18:20 만듦');
  assert.equal(m.whenText(ROW, EVENING), '내일 10/30(금) 14:00 · 본사 회의실');
  assert.equal(m.sheetView(ROW, ev('k', 'A 사업장 임금교섭 4차', '2026-10-30T15:00:00+09:00')).changed, '일정 시간·제목이 바뀜. [다시 만들기]로 새로 만들 수 있음.');
  assert.equal(m.sheetView(ROW, ev('k', 'A 사업장 임금교섭 4차', '2026-10-30T14:00:00+09:00')).changed, '');
  assert.equal(m.sheetView({...ROW, ai_status:'limit', top_lines:[]}).aiNote, '핵심 세 가지는 AI 한도로 만들지 못함.');
});

test('lines open their original; people go to the organization tab; stage, brief and AI lines do not open', () => {
  assert.deepEqual(m.openTarget(ROW.groups[1]), {type:'meeting', id:'m1'});
  assert.deepEqual(m.openTarget(ROW.groups[2]), {type:'ledger', id:'r1'});
  assert.deepEqual(m.openTarget(ROW.groups[5]), {type:'feed', id:'f1', kind:'call', day:'2026-10-28'});
  assert.deepEqual(m.openTarget(ROW.groups[8]), {type:'people'});
  assert.deepEqual(m.openTarget(ROW.groups[10]), {type:'document', id:'d1'});
  for (const i of [0, 7, 9]) assert.equal(m.openTarget(ROW.groups[i]), null);
});

test('결정 3: organization lines — the next meeting within 7 days and the folded past sheets', () => {
  const past = {...ROW, event_key:'old', event_start:'2026-10-20T05:00:00.000Z'};
  const events = [ev('a', 'A 사업장 교섭 5차', '2026-11-03T14:00:00+09:00', {organizationIds:[ORG]}), ev('z', 'A 사업장 교섭 9차', '2026-11-20T14:00:00+09:00', {organizationIds:[ORG]})];
  const {next, past:list} = m.orgLines({sheets:[ROW, past], events, orgs:ORGS, orgId:ORG, now:EVENING});
  assert.equal(next.key, 'k');assert.equal(m.lineText(next), '다가오는 교섭 10/30(금) 14:00 — 한 장 ›');
  assert.deepEqual(list.map(r => r.event_key), ['old']);
  const other = m.orgLines({sheets:[], events, orgs:ORGS, orgId:ORG, now:EVENING});
  assert.equal(other.next.key, 'work@group.calendar.test:a', 'a calendar event without a sheet yet');
  assert.equal(m.orgLines({sheets:[], events, orgs:ORGS, orgId:ORG2, now:EVENING}).next, null);
});

test('shared renderer: the next-week box and this sheet draw with the same part; no writes and no device storage in the new files', () => {
  const weekly = readFileSync(new URL('../app/journal-weekly.js', import.meta.url), 'utf8');
  const sheet = readFileSync(new URL('../app/pre-meeting-sheet.js', import.meta.url), 'utf8');
  assert.match(weekly, /renderPrepSheet\(host,/);assert.match(sheet, /renderPrepSheet\(body,/);
  for (const [name, src] of [['pre-meeting-sheet.js', sheet], ['model', readFileSync(new URL('../app/pre-meeting-sheet-model.mjs', import.meta.url), 'utf8')], ['view', readFileSync(new URL('../app/prep-sheet-view.js', import.meta.url), 'utf8')]]) {
    assert.doesNotMatch(src, /method\s*:\s*['"](POST|PATCH|DELETE|PUT)/, name + ': no direct writes (the server makes the sheet)');
    assert.doesNotMatch(src, new RegExp(['local', 'Storage|session', 'Storage|indexed', 'DB'].join('')), name + ': no device storage');
  }
  assert.match(sheet, /kind:'pre_meeting_sheet'/);
});
