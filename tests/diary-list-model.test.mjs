// JOURNAL-일기목록: 일기 [목록] 규칙(달 묶음·고정 칸·별표 보기·찾기·줄 글자·표시 저장 모양)과 화면 연결(보기 기억·기기 저장 없음). 합성 자료만.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildDiaryList, rowText, dayLabel, monthLabel, diaryPinnedAt, diaryStarredAt, withMark, matches, queryWords, MARK_KEYS, withDoneDays, doneLine, inDiaryPhoto, originKey, photoOrigins, withOrigins} from '../app/diary-list-model.mjs';
import {validValue, parsePrefs, KEYS, DIARY_VIEWS} from '../app/view-prefs.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const row = (day, text = '', metadata = {}, attachments = []) => ({id:'id-' + day, journal_day:day, raw_text:text, metadata, attachments, updated_at:'2026-10-28T00:00:00Z'});
const T = '2026-10-28T01:00:00.000Z';

test('날짜·달 이름', () => {
  assert.equal(dayLabel('2026-10-28'), '10월 28일 (수)');
  assert.equal(dayLabel('2026-09-01'), '9월 1일 (화)');
  assert.equal(monthLabel('2026-10'), '2026년 10월');
});

test('줄 글자: 두 줄 이상이면 첫 줄이 제목, 한 줄이면 날짜만 + 그 줄, 글이 없으면 사진 수', () => {
  assert.deepEqual(rowText(row('2026-10-28', '가을 산책\n\n  단풍이 들었다  \n셋째')), {title:'가을 산책', line:'단풍이 들었다'});
  assert.deepEqual(rowText(row('2026-10-28', '한 줄뿐')), {title:'', line:'한 줄뿐'});
  assert.deepEqual(rowText(row('2026-10-28', ' '), 3), {title:'', line:'사진 3장'});
  assert.deepEqual(rowText(row('2026-10-28', '')), {title:'', line:''});
});

test('고정·별표 표시는 metadata의 시각 글자만 인정한다', () => {
  assert.equal(diaryPinnedAt(row('2026-10-28', 'a', {pinned_at:T})), T);
  assert.equal(diaryStarredAt(row('2026-10-28', 'a', {starred_at:T})), T);
  for (const bad of [{pinned_at:true}, {pinned_at:'아무거나'}, {pinned_at:1}, null, []]) assert.equal(diaryPinnedAt(row('2026-10-28', 'a', bad)), null, JSON.stringify(bad));
});

test('withMark: 다른 metadata 칸(사진 코멘트 등)은 그대로, 켜면 시각, 끄면 칸을 뺀다', () => {
  const now = new Date(T), base = {photo_comments:{f1:'좋다'}, starred_at:T};
  assert.deepEqual(withMark(base, MARK_KEYS.pin, true, now), {photo_comments:{f1:'좋다'}, starred_at:T, pinned_at:T});
  assert.deepEqual(withMark(base, MARK_KEYS.star, false, now), {photo_comments:{f1:'좋다'}});
  assert.deepEqual(base, {photo_comments:{f1:'좋다'}, starred_at:T}, '원본을 바꾸지 않는다');
  assert.deepEqual(withMark(null, 'pinned_at', true, now), {pinned_at:T});
  assert.throws(() => withMark({}, 'folder', true));
});

const sample = [
  row('2026-10-28', '오늘\n맑음'), row('2026-10-03', '개천절'), row('2026-10-15', '중간', {starred_at:T}),
  row('2026-09-30', '구월 끝', {pinned_at:'2026-10-01T00:00:00Z'}), row('2026-09-02', '구월 둘째', {pinned_at:'2026-10-20T00:00:00Z', starred_at:T}),
  row('2026-09-10', '구월 열흘'), row('2025-12-31', '작년'), {journal_day:'bad'}, null,
];

test('목록: 최신순, 고정은 맨 위 칸에 따로(최근 고정 먼저), 달마다 묶고 가장 최근 달만 펼침', () => {
  const list = buildDiaryList(sample);
  assert.deepEqual(list.pinned.map(r => r.journal_day), ['2026-09-02', '2026-09-30']);
  assert.deepEqual(list.months.map(m => [m.label, m.count, m.open]), [['2026년 10월', 3, true], ['2026년 9월', 1, false], ['2025년 12월', 1, false]]);
  assert.deepEqual(list.months[0].rows.map(r => r.journal_day), ['2026-10-28', '2026-10-15', '2026-10-03']);
  assert.equal(list.total, 7);
});

test('펼침은 사용자가 고른 대로(메모리), ★ 보기·찾기 중에는 모두 펼친다', () => {
  assert.equal(buildDiaryList(sample, {opened:{'2026-09':true}}).months[1].open, true);
  assert.equal(buildDiaryList(sample, {opened:{'2026-10':false}}).months[0].open, false);
  const star = buildDiaryList(sample, {filter:'star'});
  assert.deepEqual(star.pinned.map(r => r.journal_day), ['2026-09-02']);
  assert.deepEqual(star.months.map(m => [m.key, m.count, m.open]), [['2026-10', 1, true]]);
  const found = buildDiaryList(sample, {query:'구월'});
  assert.deepEqual(found.months.map(m => [m.key, m.open]), [['2026-09', true]]);
  assert.equal(found.total, 3);
});

test('찾기: 낱말이 모두 들어 있어야 하고 날짜 표시로도 찾는다', () => {
  assert.deepEqual(queryWords('  구월  끝 '), ['구월', '끝']);
  assert.equal(matches(row('2026-09-30', '구월 끝'), queryWords('끝 구월')), true);
  assert.equal(matches(row('2026-09-30', '구월 끝'), queryWords('구월 시작')), false);
  assert.equal(matches(row('2026-09-30', 'x'), queryWords('9월 30일')), true);
  assert.equal(matches(row('2026-09-30', 'Hello'), queryWords('hello')), true);
  assert.equal(buildDiaryList(sample, {query:'없는말'}).total, 0);
});

test('보기 기억 diary_view: 화면 규칙과 DB 검사(마지막 migration)가 같다', () => {
  assert.deepEqual([...DIARY_VIEWS], ['calendar', 'list']);
  assert.ok(KEYS.includes('diary_view'));
  for (const ok of DIARY_VIEWS) assert.equal(validValue('diary_view', ok), true);
  for (const bad of ['month', 'List', '', null, 1, ['list']]) assert.equal(validValue('diary_view', bad), false, JSON.stringify(bad));
  assert.deepEqual(parsePrefs({diary_view:'list', theme:'navy'}), {diary_view:'list', theme:'navy'});
  assert.deepEqual(parsePrefs({diary_view:'grid'}), {});
  const sql = read('supabase/migrations/20261028100000_profile_view_prefs_diary_view.sql');
  assert.match(sql, /view_prefs ->> 'diary_view' in \('calendar', 'list'\)/);
});

test('화면 연결: 기기 저장 없음, 보기는 view_prefs로만, 일기 검색은 전체 검색 경계를 넓히지 않음, 텔레그램 밀기 부품 재사용', () => {
  const list = read('app/diary-list.js'), diary = read('app/diary.js'), data = read('app/diary-data.js'), model = read('app/diary-list-model.mjs');
  for (const src of [list, model]) assert.doesNotMatch(src, /(local|session)Stor[a]ge|indexed[D]B/); // 단어를 그대로 쓰면 기기 저장 감사가 이 줄을 잡는다
  assert.match(diary, /viewPrefs\.set\('diary_view', next, \{rejectable:true\}\)/);
  assert.match(list, /from '\.\/tg-day-model\.mjs'/);
  assert.match(list, /swipeIntent/);
  assert.doesNotMatch(list, /from '\.\/global-search|rpc\/app_search_records/);
  // 표시 저장은 owner RLS의 내 일기 행 PATCH(updated_at·두 표시 값이 읽은 그대로일 때만), updated_at은 건드리지 않는다.
  const mark = data.slice(data.indexOf('export async function setDiaryMark'), data.indexOf('export async function readDiaryDay'));
  assert.match(mark, /const where = `\$\{base\(rt\)\}/);
  assert.match(data, /const base = rt => `\/rest\/v1\/app_notes\?workspace_id=eq\.\$\{encode\(workspace\(rt\)\)\}&kind=eq\.diary`/);
  assert.match(mark, /&updated_at=eq\./);
  assert.match(mark, /markGuard\('pinned_at'/);
  assert.match(mark, /markGuard\('starred_at'/);
  assert.match(mark, /body:\{metadata\}/);
  assert.doesNotMatch(mark, /updated_at:new Date/);
});

// JOURNAL-오늘한일달력 (S50-29): 일기 없는 날도 '오늘 한 일'이 있으면 목록에 나온다(한 일만 있는 날 줄 — 📌·★ 없음, 별표 보기·고정 칸에는 안 나옴).
test('한 일만 있는 날: 목록에 더함·일기 있는 날은 그대로·찾기·별표 보기 제외', () => {
  const rows = [row('2026-10-03', '가을 산책', {starred_at:T})];
  const done = new Map([['2026-10-03', ['산책 전 회의']], ['2026-10-05', ['가상 교섭 준비', '미술 학원']], ['bad', ['x']], ['2026-10-06', []]]);
  const all = withDoneDays(rows, done);
  assert.equal(all.length, 2);
  const only = all.find(r => r.done_only);
  assert.deepEqual({day:only.journal_day, lines:only.done_lines}, {day:'2026-10-05', lines:['가상 교섭 준비', '미술 학원']});
  assert.deepEqual(rowText(only), {title:'', line:'한 일 · 가상 교섭 준비 외 1'});
  assert.equal(doneLine(['하나']), '한 일 · 하나');
  assert.equal(buildDiaryList(all).total, 2);
  assert.equal(buildDiaryList(all, {query:'학원'}).total, 1);
  assert.equal(buildDiaryList(all, {filter:'star'}).total, 1);
  assert.equal(buildDiaryList(all, {filter:'star'}).months[0].rows[0].journal_day, '2026-10-03');
  assert.equal(withDoneDays(rows, null), rows);
  assert.equal(withDoneDays(rows, new Map()), rows);
  assert.equal(rows.length, 1); // 원래 목록은 바꾸지 않는다
});
test('한 일 읽기는 읽기만: 기간·최근 줄 GET, 일기 화면은 같은 부품을 씀', () => {
  const data = read('app/journal-data.js');
  assert.match(data, /export async function readWorkBetween[\s\S]*?select=journal_day,raw_text&order=journal_day\.asc/);
  assert.match(data, /export async function readWorkRecent[\s\S]*?order=journal_day\.desc&limit=\$\{max\}/);
  const lines = read('app/work-day-lines.js');
  assert.match(lines, /export async function readDoneBetween/);
  assert.match(lines, /export async function readDoneRecent/);
  assert.match(read('app/diary.js'), /m\.readDoneBetween\(first, last, rt\)/);
  assert.match(read('app/diary-list.js'), /m\.readDoneRecent\(rt\)/);
});

test('DIARY-넣은사진표시: 일기 첨부(올린 사진) 칸만 일기에 넣은 사진, 원드라이브·폰 원본·없는 첨부·이미지 아닌 첨부는 아니다', () => {
  const r = row('2026-11-07', '', {}, [{drive_file_id:'a1', mime_type:'image/jpeg', size_bytes:10}, {drive_file_id:'f1', mime_type:'application/pdf', size_bytes:10}]);
  assert.equal(inDiaryPhoto({source:'upload', key:'a1'}, r), true);
  assert.equal(inDiaryPhoto({source:'upload', key:'zz'}, r), false);
  assert.equal(inDiaryPhoto({source:'upload', key:'f1'}, r), false);
  assert.equal(inDiaryPhoto({source:'onedrive', key:'a1'}, r), false);
  assert.equal(inDiaryPhoto({source:'phone', key:'a1'}, r), false);
  assert.equal(inDiaryPhoto({source:'upload', key:'a1'}, null), false);
  assert.equal(inDiaryPhoto(null, r), false);
});

test('DIARY-넣은사진원본: 넣을 때 적은 원본 식별값으로 원드라이브·폰 원본 칸도 일기에 넣은 사진이 된다', () => {
  const att = [{drive_file_id:'a1', mime_type:'image/jpeg'}, {drive_file_id:'a2', mime_type:'image/jpeg'}, {drive_file_id:'f1', mime_type:'application/pdf'}];
  const r = row('2026-11-07', '', {photo_origins:{a1:'onedrive:OD1', a2:'phone:ms:77', f1:'onedrive:OD9', gone:'onedrive:OD8'}}, att);
  assert.equal(inDiaryPhoto({source:'onedrive', key:'OD1'}, r), true);
  assert.equal(inDiaryPhoto({source:'phone', key:'ms:77'}, r), true);
  assert.equal(inDiaryPhoto({source:'onedrive', key:'OD2'}, r), false);
  assert.equal(inDiaryPhoto({source:'phone', key:'OD1'}, r), false);   // 출처가 다르면 같은 값이어도 아니다
  assert.equal(inDiaryPhoto({source:'onedrive', key:'OD9'}, r), false); // 이미지 아닌 첨부
  assert.equal(inDiaryPhoto({source:'onedrive', key:'OD8'}, r), false); // 첨부가 빠진 사진
  assert.deepEqual(photoOrigins(r), {a1:'onedrive:OD1', a2:'phone:ms:77'});
  // 옛 일기(식별값 없음)·깨진 값은 그대로 아니다
  for (const bad of [{}, {photo_origins:'x'}, {photo_origins:['onedrive:a']}, {photo_origins:{a1:5, a2:'upload:zz'}}]) {
    const old = row('2026-11-07', '', bad, att);
    assert.equal(inDiaryPhoto({source:'onedrive', key:'OD1'}, old), false);
    assert.deepEqual(photoOrigins(old), {});
  }
  assert.equal(inDiaryPhoto({source:'onedrive', key:'OD1'}, null), false);
});
test('DIARY-넣은사진원본: originKey는 원드라이브·폰만, withOrigins는 다른 칸을 지키며 더한다', () => {
  assert.equal(originKey('onedrive', 'X'), 'onedrive:X'); assert.equal(originKey('phone', 'ms:5'), 'phone:ms:5');
  assert.equal(originKey('upload', 'X'), ''); assert.equal(originKey('gdrive', 'X'), ''); assert.equal(originKey('onedrive', ''), '');
  const meta = {starred_at:'t', photo_comments:{a:'c'}, photo_origins:{a:'onedrive:1'}};
  assert.deepEqual(withOrigins(meta, {b:'phone:ms:2', c:'bad', d:'upload:x'}), {starred_at:'t', photo_comments:{a:'c'}, photo_origins:{a:'onedrive:1', b:'phone:ms:2'}});
  assert.deepEqual(withOrigins(null, {a:'onedrive:1'}), {photo_origins:{a:'onedrive:1'}});
  assert.deepEqual(withOrigins({x:1}, {}), {x:1});
  assert.deepEqual(meta.photo_origins, {a:'onedrive:1'}); // 받은 값은 바꾸지 않는다
});
