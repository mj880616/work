// ACT-사진 6단계: 사업 보고 [목록|달력|사진] 보기의 규칙·글 시험. 이름·번호는 모두 합성 값.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {REPORT_VIEWS, validValue, parsePrefs, KEYS} from '../app/view-prefs.js';
import {REPORT_VIEW_OPTIONS, reportViewOf, shiftMonth, monthWeeks, monthTitle, reportsByDay, cellPlan, pickDay, photosByMeeting, photoGroups, dayHeading, dayKeyOf, moveReportAt, REPORT_DAY_MENU_ITEMS} from '../app/report-views-model.mjs';
import {calendarHtml, photoViewHtml} from '../app/report-views.js';

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
  assert.deepEqual(cellPlan([1, 2, 3, 4]), {shown: [1, 2], more: 2, total: 4});
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
  const many = calendarHtml(ctx({rows: [1, 2, 3, 4].map(n => meeting(id(200 + n), `보고${n}`, '2026-10-12T01:00:00Z'))}));
  assert.match(many.match(/<td class="rv-cell[^"]*" data-rv-cell="2026-10-12">.*?<\/td>/)[0], /<li class="rv-more">\+2<\/li>/);
});
test('화면 연결: 칸 누름은 칸 전체(+n 포함)가 그날 고르기, 제목·목록 줄은 보고 열기가 먼저 받음', () => {
  const team = readFileSync(new URL('../app/team.js', import.meta.url), 'utf8');
  const fn = team.match(/function reportViewClick\(e\)\{[^\n]*\}\n/)[0];
  assert.match(fn, /closest\('\[data-rv-cell\]'\)/);
  assert.match(fn, /pickReportDay\(cell\.dataset\.rvCell,!!e\.target\.closest\('\.rv-more'\)\)/);
  assert.match(team, /function pickReportDay\(day,scroll\)\{reportDay=day;renderMeetings\(\);if\(scroll\)[^\n]*rv-day-list[^\n]*scrollIntoView/);
  assert.ok(fn.indexOf("closest('[data-mrd-meeting]')") > -1 && fn.indexOf("closest('[data-mrd-meeting]')") < fn.indexOf("closest('[data-rv-cell]')"));
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
