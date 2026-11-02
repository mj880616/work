// UI-업데이트안내: 업데이트 기록 파일 검사·버전명·배포물 생성·앱 쪽 해석(app/release-notes-model.mjs, scripts/build-pages.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNoteFile, collectNotes, buildReleaseNotes, parseReleaseNotes, newSince, noticeText, lineProblem, isNoteFile, OUTPUT_PATH } from '../app/release-notes-model.mjs';
import { buildPages } from '../scripts/build-pages.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const note = (date, changes, checks = []) => JSON.stringify({ date, changes, checks });

test('저장소의 기록 파일은 모두 맞는 모양이다', () => {
  const dir = join(root, 'app/release-notes');
  const entries = readdirSync(dir).map(name => [`app/release-notes/${name}`, readFileSync(join(dir, name), 'utf8')]);
  assert.ok(entries.length >= 1);
  const { errors } = collectNotes(entries);
  assert.deepEqual(errors, []);
});

test('파일 이름·날짜·칸·줄 수를 검사한다', () => {
  assert.equal(checkNoteFile('app/release-notes/20261029-0130-a.json', note('2026-10-29', ['바뀐 점'])).errors.length, 0);
  assert.match(checkNoteFile('app/release-notes/2026-10-29-a.json', note('2026-10-29', ['x'])).errors[0], /파일 이름/);
  assert.match(checkNoteFile('app/release-notes/20261029-0130-A.json', note('2026-10-29', ['x'])).errors[0], /파일 이름/);
  assert.match(checkNoteFile('app/release-notes/20261029-0130-a.json', note('2026-10-28', ['x'])).errors[0], /date/);
  assert.match(checkNoteFile('app/release-notes/20261029-0130-a.json', note('2026-10-29', [])).errors[0], /changes는 1~3줄/);
  assert.match(checkNoteFile('app/release-notes/20261029-0130-a.json', note('2026-10-29', ['a', 'b', 'c', 'd'])).errors[0], /changes/);
  assert.match(checkNoteFile('app/release-notes/20261029-0130-a.json', JSON.stringify({ date: '2026-10-29', changes: ['a'], pr: 1 })).errors[0], /모르는 칸/);
  assert.match(checkNoteFile('app/release-notes/20261029-0130-a.json', '{').errors[0], /JSON/);
  // 버퍼(빌드 입력)도 읽는다.
  assert.equal(checkNoteFile('app/release-notes/20261029-0130-a.json', Buffer.from(note('2026-10-29', ['한 줄']))).errors.length, 0);
});

test('공개 파일에 들어가면 안 되는 모양은 줄마다 막는다', () => {
  for (const bad of ['메일 a.b@example.org', 'https://x.example 열기', 'www.example.com', 'abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_x 키', 'eyJhbG', '1.2.3.4', '/home/claude/x', 'C:\\Users', 'Bearer x', 'token 갱신', '<script>', 'RLS 고침', '가'.repeat(101), ' 앞 공백', '', 'a\u0007b'])
    assert.notEqual(lineProblem(bad), '', bad);
  for (const good of ['일정 목록이 더 빨리 열려요', '메뉴 → 내 프로필 맨 아래 \'업데이트 기록\' 펼쳐 보기', '사진 3장까지 한 번에 올려요', '가'.repeat(100)])
    assert.equal(lineProblem(good), '', good);
});

test('버전명은 날짜-그날 순번, 최신이 먼저', () => {
  const { notes, errors } = collectNotes([
    ['app/release-notes/20261028-0930-b.json', note('2026-10-28', ['둘째'])],
    ['app/release-notes/20261027-2300-a.json', note('2026-10-27', ['첫째'], ['폰 확인'])],
    ['app/release-notes/20261028-0800-a.json', note('2026-10-28', ['첫 번째'])],
    ['app/release-notes/20261028-1000-bad.json', note('2026-10-28', ['http://x'])]
  ]);
  assert.equal(errors.length, 1);
  assert.deepEqual(notes.map(n => n.v), ['10/28-2', '10/28-1', '10/27-1']);
  assert.deepEqual(notes[2], { v: '10/27-1', date: '2026-10-27', changes: ['첫째'], checks: ['폰 확인'] });
});

test('배포물 JSON은 앱이 그대로 읽는다', () => {
  const out = buildReleaseNotes([['app/release-notes/20261101-0100-a.json', note('2026-11-01', ['a줄'])], ['app/release-notes/20261101-0200-b.json', note('2026-11-01', ['b줄'], ['b확인'])]]);
  const list = parseReleaseNotes(JSON.parse(out));
  assert.equal(list.current, '11/1-2');
  assert.deepEqual(list.notes.map(n => n.v), ['11/1-2', '11/1-1']);
});

test('앱 쪽 해석: 모양이 틀린 기록만 빼고, 전체가 틀리면 null', () => {
  assert.equal(parseReleaseNotes(null), null);
  assert.equal(parseReleaseNotes({ schema: 2, notes: [] }), null);
  assert.equal(parseReleaseNotes({ schema: 1, notes: 'x' }), null);
  const list = parseReleaseNotes({ schema: 1, current: '없음', notes: [
    { v: '10/29-1', date: '2026-10-29', changes: ['좋음'], checks: [] },
    { v: '<b>', date: '2026-10-29', changes: ['나쁨'] },
    { v: '10/28-1', date: '2026-10-28', changes: ['<img onerror=x>'] }
  ] });
  assert.deepEqual(list.notes.map(n => n.v), ['10/29-1']);
  assert.equal(list.current, '10/29-1');
});

test('새 버전 알림 문구: 이 화면이 알던 기록 뒤로 생긴 것만 센다', () => {
  const list = { current: '10/29-3', notes: ['10/29-3', '10/29-2', '10/29-1'].map(v => ({ v, date: '2026-10-29', changes: [`${v} 바뀐 점`], checks: [] })) };
  assert.equal(noticeText(newSince(list, '10/29-2')), '새 버전: 10/29-3 바뀐 점');
  assert.equal(noticeText(newSince(list, '10/29-1')), '새 버전 · 바뀐 것 2건');
  assert.equal(noticeText(newSince(list, '10/29-3')), '새 버전이 있어요');
  assert.equal(noticeText(newSince(list, null)), '새 버전이 있어요');
  assert.equal(noticeText(newSince(list, '9/1-1')), '새 버전이 있어요');
  assert.equal(noticeText(newSince(null, '10/29-1')), '새 버전이 있어요');
});

test('Pages 빌드가 기록 파일을 모아 배포물에만 app/release-notes.json을 만든다', () => {
  const input = {
    'app/index.html': '<script src="./app.js"></script>',
    'app/app.js': 'export const x=1;',
    'app/release-notes/20261029-0130-a.json': Buffer.from(note('2026-10-29', ['한 줄']))
  };
  const out = buildPages(input);
  assert.ok(isNoteFile('app/release-notes/20261029-0130-a.json'));
  assert.equal(parseReleaseNotes(JSON.parse(out[OUTPUT_PATH])).current, '10/29-1');
  const none = buildPages({ 'app/index.html': '<p>x</p>' });
  assert.equal(Object.hasOwn(none, OUTPUT_PATH), false, '기록 파일이 없으면 만들지 않는다');
});

// UI-업데이트기록찾기(요청함 11/02): 검색 칸 거르기(화면 안에서만).
test('검색: 낱말이 모두 든 줄만 남기고, 맞는 줄이 없는 기록은 뺀다', async () => {
  const { searchNotes, searchWords } = await import('../app/release-notes-model.mjs');
  const notes = [
    { v: '10/29-2', date: '2026-10-29', changes: ['사진 메뉴가 빨라졌어요', '노트 폴더가 생겼어요'], checks: ['사진 탭 열어 보기'] },
    { v: '10/28-1', date: '2026-10-28', changes: ['일정 색을 고를 수 있어요'], checks: [] },
    { v: '9/12-1', date: '2026-09-12', changes: ['Google 캘린더 일정이 보여요'], checks: [] }
  ];
  assert.equal(searchNotes(notes, ''), null);
  assert.equal(searchNotes(notes, '   '), null);
  assert.deepEqual(searchWords('  사진  탭 '), ['사진', '탭']);
  assert.equal(searchWords('a b c d e f g h').length, 6);
  const photo = searchNotes(notes, '사진');
  assert.equal(photo.length, 1);
  assert.deepEqual(photo[0].changes, ['사진 메뉴가 빨라졌어요']);
  assert.deepEqual(photo[0].checks, ['사진 탭 열어 보기']);
  // 낱말 여럿 = 모두 든 줄만
  assert.deepEqual(searchNotes(notes, '사진 탭')[0].changes, []);
  assert.deepEqual(searchNotes(notes, '사진 탭')[0].checks, ['사진 탭 열어 보기']);
  // 대소문자 무시, 최신 먼저 그대로
  assert.deepEqual(searchNotes(notes, 'google').map(x => x.note.v), ['9/12-1']);
  assert.deepEqual(searchNotes(notes, '일정').map(x => x.note.v), ['10/28-1', '9/12-1']);
  // 날짜·버전명으로 찾으면 그날 줄이 모두 남는다
  assert.deepEqual(searchNotes(notes, '10/28').map(x => x.note.v), ['10/28-1']);
  assert.equal(searchNotes(notes, '9/12 캘린더')[0].changes.length, 1);
  assert.deepEqual(searchNotes(notes, '없는낱말'), []);
});

test('지난 기록은 Web2 첫날(9/11)부터 하루에 많아야 1개다', () => {
  const dir = join(root, 'app/release-notes');
  const days = readdirSync(dir).filter(n => /^\d{8}-\d{4}-history\.json$/.test(n)).map(n => n.slice(0, 8));
  assert.equal(new Set(days).size, days.length);
  assert.equal(days.sort()[0], '20260911');
  for (const name of readdirSync(dir).filter(n => /-history\.json$/.test(n) && /^2026(09|10(0|1|2[0-8]))/.test(n)))
    assert.deepEqual(JSON.parse(readFileSync(join(dir, name), 'utf8')).checks, [], name);
});
