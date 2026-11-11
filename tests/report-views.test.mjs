// ACT-사진 6단계: 사업 보고 [목록|달력|사진] 보기의 규칙·글 시험. 이름·번호는 모두 합성 값.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {REPORT_VIEWS, validValue, parsePrefs, KEYS} from '../app/view-prefs.js';
import {REPORT_VIEW_OPTIONS, reportViewOf, shiftMonth, monthWeeks, monthTitle, reportsByDay, cellPlan, pickDay, photosByMeeting, photoGroups, dayHeading, dayKeyOf} from '../app/report-views-model.mjs';
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
  assert.match(fn, /reportDay=cell\.dataset\.rvCell/);
  assert.match(fn, /closest\('\.rv-more'\)[\s\S]*rv-day-list[\s\S]*scrollIntoView/);
  assert.ok(fn.indexOf("closest('[data-mrd-meeting]')") > -1 && fn.indexOf("closest('[data-mrd-meeting]')") < fn.indexOf("closest('[data-rv-cell]')"));
  const css = readFileSync(new URL('../app/meeting-ui.css', import.meta.url), 'utf8');
  assert.match(css, /#meetingList \.rv-cell\[data-rv-cell\]\{cursor:pointer\}/);
  assert.match(css, /#meetingList \.rv-cell\[data-rv-cell\]:not\(\.ds-day-sel\):hover/);
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
