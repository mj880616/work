// ACT-사진 6단계: 사업 보고 [목록|달력|사진] 보기의 규칙·글 시험. 이름·번호는 모두 합성 값.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {REPORT_VIEWS, validValue, parsePrefs, KEYS} from '../app/view-prefs.js';
import {REPORT_VIEW_OPTIONS, reportViewOf, shiftMonth, monthWeeks, monthTitle, reportsByDay, cellPlan, CELL_LINES, pickDay, photosByMeeting, photoGroups, dayHeading, dayKeyOf, moveReportAt, REPORT_DAY_MENU_ITEMS, dayWindowTitle} from '../app/report-views-model.mjs';
import {calendarHtml, photoViewHtml, dayWindowHtml} from '../app/report-views.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M1 = id(101), M2 = id(102), M3 = id(103), M4 = id(104);
const meeting = (mid, title, at) => ({id: mid, title, series_name: title, meeting_at: at, activity_kind: 'struggle'});
const photo = (n, mid, extra = {}) => ({id: id(n), meeting_id: mid, file_id: 'f' + n, file_name: `p${n}.jpg`, mime_type: 'image/jpeg', created_at: `2026-10-2${n % 10}T00:00:00Z`, ...extra});
const rows = [meeting(M1, '○○ 결의대회', '2026-10-24T05:00:00Z'), meeting(M2, '□□ 교육', '2026-10-24T01:00:00Z'), meeting(M3, '△△ 회의', '2026-10-10T05:00:00Z'), meeting(M4, '날짜 없음', 'x')];

test('보기 값은 view-prefs(DB 검사)와 같고 모르는 값은 목록', () => {
  assert.deepEqual(REPORT_VIEW_OPTIONS.map(o => o.value), [...REPORT_VIEWS]);
  assert.ok(KEYS.includes('report_view'));
  assert.ok(validValue('report_view', 'photo') && !validValue('report_view', 'week') && !validValue('report_view', null));
  assert.deepEqual(parsePrefs({report_view: 'calendar', calendar_view: 'week'}), {report_view: 'calendar', calendar_view: 'week'});
  assert.deepEqual(parsePrefs({report_view: 'x'}), {});
  assert.equal(reportViewOf('x'), 'list'); assert.equal(reportViewOf('photo'), 'photo');
});

test('달력 계산: 일요일 시작, 달 넘기기, 날짜는 서울 기준', () => {
  const weeks = monthWeeks({year: 2026, month: 9});
  assert.equal(weeks.length, 5); assert.ok(weeks.every(w => w.length === 7));
  assert.equal(weeks[0][4].key, '2026-10-01'); assert.equal(weeks[0][4].inMonth, true); assert.equal(weeks[0][0].inMonth, false);
  assert.deepEqual(shiftMonth({year: 2026, month: 11}, 1), {year: 2027, month: 0});
  assert.deepEqual(shiftMonth({year: 2026, month: 0}, -1), {year: 2025, month: 11});
  assert.equal(monthTitle({year: 2026, month: 9}), '2026년 10월');
  assert.equal(dayKeyOf(meeting('a', 't', '2026-10-23T16:00:00Z')), '2026-10-24');
  assert.equal(dayKeyOf(rows[3]), '');
  const by = reportsByDay(rows);
  assert.deepEqual(by.get('2026-10-24').map(m => m.id), [M2, M1]);
  assert.equal(by.size, 2);
  // BIZ-달력그날창: 칸에 4줄까지. 4건까지는 '+n' 없이 전부, 넘는 날만 마지막 줄 자리에 '+n'(앞 3건 + 나머지 수).
  assert.equal(CELL_LINES, 4);
  assert.deepEqual(cellPlan([]), {shown: [], more: 0, total: 0});
  assert.deepEqual(cellPlan([1, 2]), {shown: [1, 2], more: 0, total: 2});
  assert.deepEqual(cellPlan([1, 2, 3, 4]), {shown: [1, 2, 3, 4], more: 0, total: 4});
  assert.deepEqual(cellPlan([1, 2, 3, 4, 5]), {shown: [1, 2, 3], more: 2, total: 5});
  assert.deepEqual(cellPlan([1, 2, 3, 4, 5, 6]), {shown: [1, 2, 3], more: 3, total: 6});
  // 보이는 줄 수(이름 + '+n')는 어느 날도 줄 수를 넘지 않고, 보이는 것 + 나머지 = 전체.
  for (let n = 0; n <= 12; n++) for (const lines of [1, 2, 3, 4]) {
    const plan = cellPlan(Array.from({length: n}, (_, i) => i), lines);
    assert.ok(plan.shown.length + (plan.more ? 1 : 0) <= lines, `${n}건 ${lines}줄`);
    assert.equal(plan.shown.length + plan.more, n);
    assert.equal(plan.more === 0, n <= lines);
  }
  assert.deepEqual(cellPlan([1, 2, 3], 2), {shown: [1], more: 2, total: 3});
  assert.deepEqual(cellPlan([1, 2, 3], 0), {shown: [], more: 3, total: 3});
  assert.deepEqual(cellPlan(null), {shown: [], more: 0, total: 0});
  assert.equal(pickDay(by, {year: 2026, month: 9}, '', '2026-10-27'), '2026-10-27');
  assert.equal(pickDay(by, {year: 2026, month: 9}, '2026-10-10', '2026-10-27'), '2026-10-10');
  assert.equal(pickDay(by, {year: 2026, month: 9}, '', '2026-11-02'), '2026-10-24');
  assert.equal(pickDay(by, {year: 2026, month: 7}, '', '2026-11-02'), '');
});

test('사진 묶음: 사진 있는 사업 보고만, 날짜는 최근 위', () => {
  const docs = [photo(1, M1), photo(2, M1), photo(3, M3), photo(4, M2, {file_id: null}), photo(5, M2, {file_name: 'a.pdf', mime_type: 'application/pdf'}), {id: id(9), file_id: 'z', file_name: 'x.jpg', mime_type: 'image/jpeg'}];
  const photos = photosByMeeting(docs);
  assert.deepEqual([...photos.keys()].sort(), [M1, M3].sort());
  assert.equal(photos.get(M1).length, 2);
  const groups = photoGroups(rows, photos);
  assert.deepEqual(groups.map(g => g.day), ['2026-10-24', '2026-10-10']);
  assert.deepEqual(groups[0].items.map(i => i.meeting.id), [M1]);
  assert.equal(dayHeading('2026-10-24'), '10월 24일 (토)');
  assert.equal(dayHeading(''), '날짜 없음');
});

const ctx = (extra = {}) => ({rows, month: {year: 2026, month: 9}, selectedDay: '', todayKey: '2026-10-24', photos: new Map(), colorOf: () => '#808080', nameOf: m => m.title, metaOf: () => '투쟁', kindOf: () => '투쟁', ...extra});
test('달력 글: 날짜 칸에 제목, 누르면 사업 보고, 고른 날 목록에 3장 + 외 n장', () => {
  const docs = Array.from({length: 5}, (_, i) => photo(i + 1, M1));
  const html = calendarHtml(ctx({photos: photosByMeeting(docs)}));
  assert.match(html, /data-rv-month="2026-10"/); assert.match(html, /2026년 10월/);
  assert.equal((html.match(/data-rv-day="/g) || []).length, 31);
  assert.match(html, new RegExp(`data-mrd-meeting="${M1}"`));
  assert.equal((html.match(/class="report-photo-thumb"/g) || []).length, 3);
  assert.match(html, /외 2장/);
  assert.match(html, /data-rv-nav="prev"/); assert.match(html, /data-rv-nav="next"/);
  assert.match(calendarHtml(ctx({rows: []})), /data-wait-empty>맞는 사업 보고 없음</);
  assert.match(calendarHtml(ctx({rows: [meeting('a', '<b>x</b>', '2026-10-24T01:00:00Z')]})), /&lt;b&gt;x&lt;\/b&gt;/);
});
// S57-8 BIZ-달력우클릭끌기 ④(명진 폰 제보 "숫자를 눌러야 클릭이 됨, 터치 범위 넓혀요"): 칸 전체가 '그날 고르기'.
test('달력 글: 이번 달 칸마다 칸 전체 누르기 표시(data-rv-cell), 이번 달 밖 칸은 없음, 숫자 단추는 그대로', () => {
  const html = calendarHtml(ctx());
  assert.equal((html.match(/<td [^>]*data-rv-cell="/g) || []).length, 31);
  assert.match(html, /<td class="rv-cell[^"]*" data-rv-cell="2026-10-01">/);
  assert.equal((html.match(/<td class="rv-cell rv-out"[^>]*>/g) || []).length, 4);
  assert.doesNotMatch(html, /<td class="rv-cell rv-out"[^>]*data-rv-cell/);
  assert.equal((html.match(/<button type="button" class="rv-num[^"]*" data-rv-day="/g) || []).length, 31);
  // 칸 속 제목(사업 보고 열기)·'+n'은 칸 안에 있어 칸 누름이 받는다(제목은 열기가 먼저 받음: team.js 시험 아래).
  const cell = html.match(/<td class="rv-cell[^"]*" data-rv-cell="2026-10-24">.*?<\/td>/)[0];
  assert.match(cell, /class="rv-dots"/); assert.match(cell, new RegExp(`data-mrd-meeting="${M1}"`));
  // BIZ-달력그날창: 4건인 날은 '+n' 없이 넷 다, 6건인 날은 앞 셋 + '+3' 단추(그날 창을 여는 단추, 날짜·전체 건수를 읽어 준다).
  const cellOf = (n, day = '2026-10-12') => calendarHtml(ctx({rows: Array.from({length: n}, (_, i) => meeting(id(201 + i), `보고${i + 1}`, `${day}T0${i}:00:00Z`))})).match(new RegExp(`<td class="rv-cell[^"]*" data-rv-cell="${day}">.*?</td>`))[0];
  const four = cellOf(4);
  assert.equal((four.match(/class="rv-title"/g) || []).length, 4); assert.doesNotMatch(four, /rv-more/);
  const six = cellOf(6);
  assert.equal((six.match(/class="rv-title"/g) || []).length, 3);
  assert.deepEqual([...six.matchAll(/<span>(보고\d)<\/span>/g)].map(x => x[1]), ['보고1', '보고2', '보고3']);
  assert.match(six, /<li><button type="button" class="row-act rv-more" data-rv-more="2026-10-12" aria-haspopup="dialog" aria-label="10월 12일 \(월\) 사업 보고 6건 모두 보기">\+3<\/button><\/li><\/ul><\/td>$/);
  assert.match(cellOf(5), /class="row-act rv-more"[^>]*>\+2<\/button>/);
  // 점(폰 폭)은 그대로 3개까지.
  assert.equal((six.match(/<span class="rv-dots" aria-hidden="true">(.*?)<\/span><ul/)[1].match(/class="rv-dot"/g) || []).length, 3);
});
test('화면 연결: 칸 누름은 칸 전체가 그날 고르기, 제목·목록 줄은 보고 열기가 먼저 받음, +n은 그날 고르기 + 그날 창', () => {
  const team = readFileSync(new URL('../app/team.js', import.meta.url), 'utf8');
  const fn = team.match(/function reportViewClick\(e\)\{[^\n]*\}\n/)[0];
  assert.match(fn, /closest\('\[data-rv-cell\]'\)/);
  assert.match(fn, /pickReportDay\(cell\.dataset\.rvCell,false\)/);
  assert.match(team, /function pickReportDay\(day,scroll\)\{reportDay=day;renderMeetings\(\);if\(scroll\)[^\n]*rv-day-list[^\n]*scrollIntoView/);
  assert.ok(fn.indexOf("closest('[data-mrd-meeting]')") > -1 && fn.indexOf("closest('[data-mrd-meeting]')") < fn.indexOf("closest('[data-rv-cell]')"));
  // BIZ-달력그날창: '+n'은 칸 누름보다 먼저 받아 그날을 고르고(달력 아래로 내리지 않음) 그 칸 자리에 그날 창을 연다.
  assert.match(fn, /const more=e\.target\.closest\('\[data-rv-more\]'\);if\(more\)\{const day=more\.dataset\.rvMore;pickReportDay\(day,false\);showReportDay\(day\);return true\}/);
  assert.ok(fn.indexOf("closest('[data-rv-more]')") < fn.indexOf("closest('[data-rv-cell]')"));
  const css = readFileSync(new URL('../app/meeting-ui.css', import.meta.url), 'utf8');
  assert.match(css, /#meetingList \.rv-cell\[data-rv-cell\]\{cursor:pointer\}/);
  assert.match(css, /#meetingList \.rv-cell\[data-rv-cell\]:not\(\.ds-day-sel\):hover/);
});
// S57-8 BIZ-달력우클릭끌기 PR-2: 우클릭 메뉴·끌어 옮기기의 규칙과 연결.
test('끌어 옮기기 규칙: 날짜만 바뀌고 시각은 그대로, 같은 날·읽을 수 없는 값은 옮기지 않음', () => {
  assert.equal(moveReportAt('2026-10-24T05:00:00.000Z', '2026-10-27'), '2026-10-27T05:00:00.000Z');
  assert.equal(moveReportAt('2026-10-24T05:00:00+00:00', '2026-10-20'), '2026-10-20T05:00:00.000Z');
  // 서울 자정 넘어가는 시각(UTC로는 전날)도 서울 날짜 기준으로 하루씩 센다.
  assert.equal(dayKeyOf({meeting_at: moveReportAt('2026-10-31T16:30:00Z', '2026-11-03')}), '2026-11-03');
  assert.equal(moveReportAt('2026-10-31T16:30:00Z', '2026-11-03'), '2026-11-02T16:30:00.000Z');
  assert.equal(moveReportAt('2026-10-24T05:00:00Z', '2026-10-24'), '');
  assert.equal(moveReportAt('2026-10-24T01:00:00Z', '2026-10-24'), '');
  assert.equal(moveReportAt('x', '2026-10-24'), ''); assert.equal(moveReportAt('2026-10-24T05:00:00Z', '10/27'), ''); assert.equal(moveReportAt(null, ''), '');
  assert.deepEqual(REPORT_DAY_MENU_ITEMS.map(i => i.label), ['이날 사업 보고 추가', '이날 보기']);
});
test('끌어 옮기기 저장: 보고 수정과 같은 meeting_at PATCH 한 길, 지금 일시 그대로인 내 보고 한 줄만, 회차 번호는 보내지 않음', async () => {
  const {createReportDayMover} = await import('../app/report-calendar-actions.js');
  const base = {id: M1, workspace_id: 'ws-1', meeting_at: '2026-10-24T05:00:00+00:00', round_no: 3};
  const make = ({rows, fail = false} = {}) => {
    const log = {calls: [], toasts: [], days: [], reloads: 0};
    const move = createReportDayMover({
      api: async (path, opts) => { log.calls.push({path, opts}); if (fail) throw new Error('boom'); return rows === undefined ? [{id: M1, meeting_at: JSON.parse(JSON.stringify(opts.body)).meeting_at}] : rows; },
      workspaceId: () => 'ws-1', meetingOf: x => (x === M1 ? base : null),
      reload: async () => { log.reloads++; }, setDay: d => log.days.push(d), toast: x => log.toasts.push(x)});
    return {move, log};
  };
  // 놓은 날로 저장: 시각 그대로, 내 작업공간·지금 일시 그대로인 한 줄만, 날짜 칸(meeting_at)·updated_at 말고는 보내지 않는다(회차·Google 일정·사진 칸 없음).
  let {move, log} = make();
  assert.deepEqual(await move(M1, '2026-10-27'), {status: 'saved'});
  assert.equal(log.calls.length, 1);
  const call = log.calls[0];
  assert.equal(call.opts.method, 'PATCH'); assert.equal(call.opts.prefer, 'return=representation');
  assert.match(call.path, new RegExp(`^/rest/v1/app_meetings\\?id=eq\\.${M1}&workspace_id=eq\\.ws-1&meeting_at=eq\\.2026-10-24T05%3A00%3A00\\.000Z&select=id,meeting_at$`));
  assert.deepEqual(Object.keys(call.opts.body).sort(), ['meeting_at', 'updated_at']);
  assert.equal(call.opts.body.meeting_at, '2026-10-27T05:00:00.000Z');
  assert.deepEqual(log.days, ['2026-10-27']); assert.equal(log.reloads, 1); assert.deepEqual(log.toasts, []);
  // 같은 날·없는 보고는 요청 없음.
  ({move, log} = make()); assert.deepEqual(await move(M1, '2026-10-24'), {status: 'same'}); assert.deepEqual(await move(M2, '2026-10-27'), {status: 'skip'}); assert.equal(log.calls.length, 0);
  // 그 사이 다른 곳에서 바뀐 보고(0줄): 고른 날을 바꾸지 않고 새로 불러온다.
  ({move, log} = make({rows: []})); assert.deepEqual(await move(M1, '2026-10-27'), {status: 'changed'});
  assert.deepEqual(log.days, []); assert.equal(log.reloads, 1); assert.equal(log.toasts.length, 1);
  // 서버 실패: 알림만, 화면 상태는 그대로.
  ({move, log} = make({fail: true})); assert.deepEqual(await move(M1, '2026-10-27'), {status: 'failed'});
  assert.deepEqual(log.days, []); assert.equal(log.reloads, 0); assert.match(log.toasts[0], /옮기지 못했어요/);
});
test('끌어 옮기기 연결: 달력 그릴 때 한 번 설치, 우클릭은 보고 메뉴·빈 칸 메뉴, 새 보고 창에 날짜 미리 채움', () => {
  const team = readFileSync(new URL('../app/team.js', import.meta.url), 'utf8');
  const act = readFileSync(new URL('../app/report-calendar-actions.js', import.meta.url), 'utf8');
  assert.match(team, /mountStrips\(box,\(\)=>box\.isConnected\);mountReportDrag\(\)/);
  assert.match(team, /import\('\.\/report-calendar-actions\.js'\)/);
  assert.match(team, /async function meetingListMenu\(e\)\{if\(reportView!=='list'&&reportViewMenu\(e\)\)return;/);
  const menu = team.match(/function reportViewMenu\(e\)\{[\s\S]*?\n\/\/ 끌어 옮기기/)[0];
  assert.match(menu, /\[data-mrd-meeting\]/); assert.match(menu, /KPTUMeetingRoundDetail\?\.open\?\.\(id\)/); assert.match(menu, /openReportMenuAt\(id,at\)/);
  assert.match(menu, /reportView==='calendar'\?t\.closest\('\[data-rv-cell\]'\)/); assert.match(menu, /appMenuPoint\(e,cell\)/);
  assert.match(menu, /newReport\(from\.querySelector\('\.rv-num'\)\|\|from,day\)/);
  assert.match(team, /function newReport\(trigger,date=''\)/); assert.match(team, /openMeetingModal\(\{name:newMeetingName\(\),kind:reportChip,date\}\)/); assert.match(team, /openMeetingModal\(\{kind,trigger,date\}\)/);
  // 저장: 보고 수정 창과 같은 app_meetings PATCH(내 작업공간·지금 일시 그대로인 줄만), 회차 번호·Google 일정·사진 칸은 보내지 않는다.
  assert.match(act, /app_meetings\?id=eq\.[^`]*workspace_id=eq\.[^`]*meeting_at=eq\./);
  assert.match(act, /body: \{meeting_at: iso\(toAt\), updated_at: new Date\(\)\.toISOString\(\)\}/);
  assert.doesNotMatch(act, /round_no|app_documents|google_event/);
  // 빈 칸 우클릭 메뉴(공용 줄 메뉴 row-menu.js)의 모양은 od-link.css에 있어 사업 보고 화면도 그 스타일을 불러와야 모양이 선다.
  const loader = readFileSync(new URL('../app/view-loader.js', import.meta.url), 'utf8');
  assert.match(loader.match(/\n  meetings:\[[^\n]*\]/)[0], /'\.\/od-link\.css'/);
  assert.match(act, /offerUndoNotice\(\{text: `옮겼어요 · /); assert.match(act, /!pc\.matches/); assert.match(act, /e\.pointerType !== 'mouse'/);
  // 끌기 뒤·취소 뒤 클릭 막기(일정 달력 끌기와 같음): 보고 열기(#meetingList 줄 누름)보다 먼저 window capture로, Esc·창 밖 취소는 다음 손 뗌의 클릭까지.
  assert.match(act, /window\.addEventListener\('click', e => \{ if \(swallow\)/);
  assert.match(act, /if \(!g && swallowUp\) \{ swallowUp = false; swallowNext\(\); return; \}/);
  assert.match(act, /e\.key === 'Escape' && g\?\.started\) \{[^}]*swallowUp = true/);
  assert.match(act, /addEventListener\('mouseleave'/);
});
// BIZ-달력그날창: '+n' 그날 창의 글과 연결.
test('그날 창 글: 머리 날짜, 줄마다 색 점·이름·시각(이른 순), 맨 아래 추가 단추, 줄은 칸 안 제목과 같은 열기 표시', () => {
  assert.equal(dayWindowTitle('2026-11-13'), '11.13.(금)'); assert.equal(dayWindowTitle('2026-10-04'), '10.4.(일)'); assert.equal(dayWindowTitle(''), ''); assert.equal(dayWindowTitle('11/13'), '');
  const list = reportsByDay([meeting(id(302), '늦은 <보고>', '2026-11-13T10:00:00Z'), meeting(id(301), '이른 보고', '2026-11-13T01:00:00Z'), meeting(id(303), '다른 날', '2026-11-14T01:00:00Z')]).get('2026-11-13');
  const html = dayWindowHtml({day: '2026-11-13', list, colorOf: () => '#808080', nameOf: m => m.title});
  assert.match(html, /^<div class="rv-pop" data-rv-pop="2026-11-13"><ul class="rv-pop-list">/);
  assert.deepEqual([...html.matchAll(/data-mrd-meeting="([^"]+)"/g)].map(x => x[1]), [id(301), id(302)]);
  assert.deepEqual([...html.matchAll(/<time class="rv-pop-time">([^<]+)<\/time>/g)].map(x => x[1]), ['10:00', '19:00']);
  assert.equal((html.match(/<div class="rv-pop-row" role="button" tabindex="0" data-mrd-meeting="[^"]+" data-rv-from="2026-11-13"/g) || []).length, 2);
  assert.equal((html.match(/class="rv-dot" aria-hidden="true" style="--meeting-color:#808080"/g) || []).length, 2);
  assert.match(html, /<span class="rv-pop-name">늦은 &lt;보고&gt;<\/span>/); assert.match(html, /aria-label="19:00 늦은 &lt;보고&gt;"/);
  // '+n'과 추가 단추는 공용 글자 버튼(row-act) — 화면에서 새 버튼 모양을 만들지 않는다(UI-버튼6가지).
  assert.match(html, /<div class="rv-pop-foot"><button type="button" class="row-act rv-pop-add" data-rv-pop-add="2026-11-13">\+ 이날 사업 보고 추가<\/button><\/div><\/div>$/);
  assert.doesNotMatch(dayWindowHtml({day: '2026-11-13', list: [{id: 'x', meeting_at: null}], colorOf: () => '', nameOf: () => '이름'}), /<time/);
});
test('그날 창 연결: 일정 달력과 같은 창 부품, 줄 누름·우클릭·끌기는 칸 안 제목과 같은 길, 다시 그릴 때도 한 길로 채움', () => {
  const team = readFileSync(new URL('../app/team.js', import.meta.url), 'utf8');
  const act = readFileSync(new URL('../app/report-calendar-actions.js', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../app/calendar-day-overflow.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/meeting-ui.css', import.meta.url), 'utf8');
  // 같은 창 부품: 일정 달력 그날 창(#calendarDayModal)의 show. 새 창을 만들지 않는다.
  assert.match(act, /await import\('\.\/calendar-day-overflow\.js'\)/); assert.match(act, /window\.KPTUCalendarDayOverflow/); assert.match(act, /win\.show\(\{title: dayWindowTitle\(day\), note: `사업 보고 \$\{list\.length\}`, kind: 'report', anchor, trigger: from,/);
  assert.doesNotMatch(act, /insertAdjacentHTML|class="modal/);
  assert.match(shell, /window\.KPTUCalendarDayOverflow=\{apply,open,show\}/);
  // 일정 달력 쪽은 같은 여닫기(reveal)를 기본값으로 탄다: 가운데 창, 연 곳으로 초점, 첫 일정에 초점, Esc = ✕.
  assert.match(shell, /function reveal\(\{anchor=null,trigger=document\.activeElement,initialFocus='#calendarDayList \.cal-event',kind=''\}=\{\}\)/);
  assert.match(shell, /\n    reveal\(\);\n  \}\n  function apply/);
  assert.match(shell, /onRequestClose:\(\)=>modal\.querySelector\('\[data-close="calendarDayModal"\]'\)\?\.click\(\)/);
  assert.match(shell, /if\(kind\)modal\.dataset\.dayKind=kind;else delete modal\.dataset\.dayKind/);
  assert.match(shell, /modal\.classList\.toggle\('kptu-day-at',at\)/); assert.match(shell, /const el=wide\.matches\?/);
  // 닫기는 ✕와 같은 길 하나, 열려 있는지는 창 자신이 안다(따로 상태 없음).
  assert.match(act, /export function closeReportDayWindow\(\) \{\n  const button = document\.querySelector\(`\$\{DAY_MODAL\} \[data-close="calendarDayModal"\]`\);\n  if \(!button\) return false;\n  button\.click\(\);/);
  assert.match(act, /const DAY_MODAL = '#calendarDayModal\[data-day-kind="report"\]:not\(\.hidden\)'/);
  // 줄 누름: 창을 닫고 보고 열기. 추가 단추: 창을 닫고 그 날짜로 새 보고. 우클릭: 부르는 쪽 보고 메뉴가 열렸으면 창 닫기.
  assert.match(act, /if \(row\) \{ const id = String\(row\.dataset\.mrdMeeting\); closeReportDayWindow\(\); dayDeps\?\.open\(id\); \}/);
  assert.match(act, /if \(add\) \{ const day = add\.dataset\.rvPopAdd; closeReportDayWindow\(\); dayDeps\?\.add\(day\); return; \}/);
  assert.match(act, /addEventListener\('contextmenu', e => \{ if \(mine\(e\) && e\.target\.closest\('\[data-mrd-meeting\]'\) && dayDeps\?\.menu\(e\)\) closeReportDayWindow\(\); \}\)/);
  // 끌기: 창 안 줄도 같은 끌기 입력이 받고, 끌기가 시작되면 창을 닫아 놓을 칸이 보이게 한다. 원래 날은 줄의 data-rv-from.
  assert.match(act, /const ROWS = '#meetingList \.rv-cal \[data-mrd-meeting\], #calendarDayList \[data-rv-from\]\[data-mrd-meeting\]'/);
  assert.match(act, /const el = e\.target\.closest\?\.\(ROWS\)/); assert.match(act, /\|\| el\.dataset\.rvFrom \|\|/);
  assert.match(act, /ghostStart\(e\);\n      if \(g\.el\.closest\('#calendarDayList'\)\) closeReportDayWindow\(\);/);
  // team.js: 창을 채우는 길은 showReportDay 하나. 달력을 다시 그린 뒤에도 같은 길(again)로 다시 채우고, 우클릭은 칸 안 제목과 같은 reportViewMenu.
  assert.match(team, /function showReportDay\(day,again=false\)\{void reportActions\(\)\.then\(a=>\{if\(again&&!\(day=a\.reportDayWindowDay\(\)\)\)return;/);
  assert.match(team, /a\.showReportDayWindow\(\{day,again,rows:on\?viewRows\(\):\[\],colorOf:viewColor,nameOf:viewName,/);
  assert.match(team, /open:id=>void window\.KPTUMeetingRoundDetail\?\.open\?\.\(id\),add:d=>newReport\([^\n]*,d\),menu:reportViewMenu\}\)/);
  assert.match(team, /function renderReportCalendar\(box\)\{[^\n]*active\.dataset\.rvMore\?\['data-rv-more',active\.dataset\.rvMore\][^\n]*;showReportDay\('',true\)\}\n/);
  // 모양: 칸 자리에 작게, 어두운 바탕 없이. PC 칸 높이는 4줄이 들어가는 96px 한 곳.
  assert.match(css, /#calendarDayModal\.kptu-day-at\{display:block;padding:0;background:transparent\}/);
  assert.match(css, /#calendarDayModal\.kptu-day-at \.kptu-day-card\{position:absolute;/);
  assert.match(css, /@media\(min-width:761px\)\{\n  #meetingList \.rv-cell\{height:96px;padding:3px\}/);
});
test('사진 글: 날짜 묶음 아래 사업 보고별 격자 자리, 사진 없으면 안내', () => {
  const photos = photosByMeeting([photo(1, M1), photo(2, M1), photo(3, M3)]);
  const html = photoViewHtml(ctx({photos}));
  assert.match(html, /data-rv-photo-day="2026-10-24"/);
  assert.match(html, new RegExp(`data-rv-grid="${M1}"`)); assert.match(html, /사진 2/);
  assert.doesNotMatch(html, new RegExp(`data-rv-grid="${M2}"`));
  assert.match(photoViewHtml(ctx({photos: new Map()})), /<div class="rv-photos"><p class="wait-empty" data-wait-empty>없음<\/p><\/div>/);
});
test('화면 연결: 보기 선택은 서버 칸에만, 자료실 묶음 줄은 사진 보기로', () => {
  const team = readFileSync(new URL('../app/team.js', import.meta.url), 'utf8');
  assert.match(team, /viewPrefs\.set\('report_view'/);
  const lib = readFileSync(new URL('../app/library-upload.js', import.meta.url), 'utf8');
  assert.match(lib, /async function luOpenPhotoSet[^\n]*showPhotos/);
});
