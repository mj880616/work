// MTG-정기회의자료폴더: 정기 회의 자료를 넣을 자료실 폴더 고르기 규칙(app/meeting-folder-model.mjs). 이름은 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {folderNameKey, meetingLinkKey, meetingNameOf, pickMeetingFolder, linkedFolder, filedLine} from '../app/meeting-folder-model.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const folders = [
  {id: id(1), name: '가상 상집'},
  {id: id(2), name: '가상·중집'},
  {id: id(3), name: '회의'},
  {id: id(4), name: '회의'},
  {id: id(5), name: '2026 가상 대회'},
  {id: id(6), name: '가상 운영위'},
];

test('이름 비교: 앞뒤·가운데 띄어쓰기, 가운뎃점, 대소문자만 맞춘다', () => {
  assert.equal(folderNameKey('  가상 상집 '), folderNameKey('가상상집'));
  assert.equal(folderNameKey('가상·중집'), folderNameKey('가상 중집'));
  assert.equal(folderNameKey('가상ㆍ중집'), folderNameKey('가상‧중집'));
  assert.equal(folderNameKey('ABC 회의'), folderNameKey('abc회의'));
  assert.notEqual(folderNameKey('가상 대회'), folderNameKey('2026 가상 대회'));
  assert.notEqual(folderNameKey('가상(1) 회의'), folderNameKey('가상1 회의'), '괄호 같은 다른 문장부호는 맞추지 않는다');
});

test('짝 열쇠는 회의명 정리 열쇠와 같은 모양(띄어쓰기 없이·소문자), 쓸 수 없는 이름은 빈 값', () => {
  assert.equal(meetingLinkKey(' 가상 상집 '), '가상상집');
  assert.equal(meetingLinkKey('ABC 회의'), 'abc회의');
  assert.equal(meetingLinkKey(''), '');
  assert.equal(meetingLinkKey('쉼표,있음'), '');
  assert.equal(meetingLinkKey('가'.repeat(101)), '');
});

test('회의명은 정기 회의 이름, 없으면 제목', () => {
  assert.equal(meetingNameOf({series_name: '가상 상집', title: '가상 상집 3차'}), '가상 상집');
  assert.equal(meetingNameOf({series_name: null, title: ' 가상 운영위 '}), '가상 운영위');
  assert.equal(meetingNameOf(null), '');
});

test('짝이 있으면 짝 폴더(이름이 달라도)', () => {
  const links = [{id: id(5), meeting_key: '가상대의원회'}];
  assert.deepEqual(pickMeetingFolder({folders, links, name: '가상 대의원회'}), {folder: folders[4], how: 'linked'});
  assert.equal(linkedFolder({folders, links, name: '가상 대의원회'}), folders[4]);
  assert.equal(linkedFolder({folders, links, name: '가상 상집'}), null);
});

test('짝이 없으면 이름이 같은 폴더 하나(띄어쓰기·가운뎃점 차이는 같게)', () => {
  assert.deepEqual(pickMeetingFolder({folders, links: [], name: '가상상집'}), {folder: folders[0], how: 'same'});
  assert.deepEqual(pickMeetingFolder({folders, links: [], name: '가상 중집'}), {folder: folders[1], how: 'same'});
  // 서버 칸이 아직 없음(null)이어도 이름이 같은 폴더는 쓴다.
  assert.deepEqual(pickMeetingFolder({folders, links: null, name: '가상 운영위'}), {folder: folders[5], how: 'same'});
});

test('같은 이름 폴더가 둘 이상이면 고르지 않는다, 없으면 null(지금처럼)', () => {
  assert.equal(pickMeetingFolder({folders, links: [], name: '회의'}), null);
  assert.equal(pickMeetingFolder({folders, links: [], name: '없는 회의'}), null);
  assert.equal(pickMeetingFolder({folders, links: [], name: ''}), null);
  assert.equal(pickMeetingFolder({folders: null, links: null, name: '가상 상집'}), null);
});

test('다른 회의와 짝지은 폴더는 이름이 같아도 쓰지 않는다, 보이지 않는(휴지통) 짝 폴더는 쓰지 않는다', () => {
  assert.equal(pickMeetingFolder({folders, links: [{id: id(1), meeting_key: '다른회의'}], name: '가상 상집'}), null);
  const gone = [{id: id(99), meeting_key: '가상상집'}];
  assert.deepEqual(pickMeetingFolder({folders, links: gone, name: '가상 상집'}), {folder: folders[0], how: 'same'});
  // 다른 회의 짝을 빼고 남은 같은 이름 폴더가 하나면 그것.
  assert.deepEqual(pickMeetingFolder({folders, links: [{id: id(3), meeting_key: '다른회의'}], name: '회의'}), {folder: folders[3], how: 'same'});
});

test('넣은 뒤 한 줄', () => {
  assert.equal(filedLine('가상 상집', 2), '‘가상 상집’ 폴더에 넣었어요 2개');
  assert.equal(filedLine('가상 상집', 1, 1), '‘가상 상집’ 폴더에 넣었어요 1개 · 1개는 넣지 못했어요');
  assert.equal(filedLine('가상 상집', 0, 1), '‘가상 상집’ 폴더에 넣지 못했어요. 자료실에서 옮겨 주세요.');
  assert.equal(filedLine('가상 상집', 0, 0), '');
});

test('코드에 실제 폴더·회의 이름을 박지 않고, 서버 함수는 내 작업공간 폴더만·권한을 넓히지 않는다', () => {
  for (const f of ['app/meeting-folder-model.mjs', 'app/meeting-folder.js']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /상집|중집|대의원|궤도|집행위|공공팀/);
  }
  const js = readFileSync(new URL('../app/meeting-folder.js', import.meta.url), 'utf8');
  assert.match(js, /app_meetings\?id=eq\.\$\{enc\(meetingId\)\}&workspace_id=eq\.\$\{enc\(st\.ws\)\}/, '내 작업공간 사업 보고만 읽는다');
  const sql = readFileSync(new URL('../supabase/migrations/20261124213000_library_folder_meeting.sql', import.meta.url), 'utf8');
  assert.match(sql, /private\.app_is_workspace_owner\(ws\)/);
  assert.match(sql, /f\.deleted_at is null for update/);
  assert.match(sql, /revoke all on function public\.app_library_folder_set_meeting\(uuid, text\) from public, anon, authenticated, service_role;\ngrant execute on function public\.app_library_folder_set_meeting\(uuid, text\) to authenticated;/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /to anon|to public|disable row level security|rtw_|create policy|drop policy/i);
});
