import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AUTO_FOLDER_RULES, autoMadeKind, isAutoMade, recentHumanRows} from '../app/files-auto-model.mjs';
import {TRASH_FOLDER_NAME} from '../app/photos-model.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
// S51-23 FILES-최근자동제외: 파일 '최근'에서 Web2 자동화가 되풀이해 만드는 파일만 뺀다(폴더로 판별). 이름은 모두 가짜.
const row = (folder_path, name = '가짜.txt') => ({source: 'gd', item_id: 'x', name, is_folder: false, folder_path});

test('시스템 폴더 안 파일은 자동 생성으로 본다(더 깊은 폴더 포함)', () => {
  const cases = [
    ['가짜 수집 › 원문 › 10001_가짜방 › messages › 2026-11', 'telegram'],
    ['원문 › -1000002_가짜 단체방 › attachments', 'telegram'],
    ['원문 › 10001_가짜방', 'telegram'],
    ['가짜 수집 › 검토후보', 'telegram_candidates'],
    ['통화 녹음 › 전사', 'call_transcript'],
    ['가짜 위 › 통화 녹음 › 전사 › 2026-11', 'call_transcript'],
    ['가짜 위 › 검토대기', 'call_analysis'],
    ['가짜 위 › 검토완료', 'call_analysis'],
    ['Web2 읽기용 사본', 'drive_summary'],
    ['Web2 읽기용 사본 › 원장 백업', 'drive_summary'],
    ['Web2 편집 백업', 'edit_backup'],
    ['웹2 › 회의자료 › 가짜 회의 1차 › 회의 녹음 › 녹음 조각', 'recording_pieces'],
    ['가짜 사진 › .Web2 휴지통', 'trash'],
    ['노조+ 읽기용 사본', 'drive_summary'],
    ['노조+ 읽기용 사본 › 원장 백업', 'drive_summary'],
    ['노조+ 편집 백업', 'edit_backup'],
    ['가짜 사진 › .노조+ 휴지통', 'trash'],
  ];
  for (const [path, key] of cases) assert.equal(autoMadeKind(row(path)), key, path);
});

test('사람 파일은 그대로(이름이 숫자.json이어도, 비슷한 이름 폴더여도)', () => {
  const keep = [
    '', null, undefined, '가짜 문서함', '가짜 문서함 › 2026',
    '원문', '원문 › 가짜 보도자료', '가짜 › 원문 › 2026_가짜',  // '원문' 아래가 방 폴더 모양('숫자_')이 아니면 사람 폴더
    'messages › 2026-11', '통화 녹음', '전사', '가짜 › 전사', '회의 녹음', '녹음 조각',
    'Web2 읽기용 사본 백업', '가짜 Web2 편집 백업', '노조+ 읽기용 사본 백업', '가짜 노조+ 편집 백업',
  ];
  for (const path of keep) assert.equal(isAutoMade(row(path, '12345.json')), false, String(path));
  // 이름 모양만으로는 거르지 않는다.
  assert.equal(isAutoMade(row('가짜 문서함', '987_attachment.jpg')), false);
});

test("'최근' 줄: 자동 생성 파일을 빼고 서버 순서 그대로 앞에서 limit줄", () => {
  const rows = [
    row('원문 › 10001_가짜방 › messages › 2026-11', '1.json'),
    row('가짜 문서함', 'a.pdf'),
    row('원문 › 10001_가짜방 › messages › 2026-11', '2_attachment.jpg'),
    row('가짜 문서함 › 2026', 'b.hwpx'),
    row('Web2 편집 백업', 'c.hwp'),
    row('가짜 사진함', 'd.jpg'),
  ];
  assert.deepEqual(recentHumanRows(rows, 15).map(r => r.name), ['a.pdf', 'b.hwpx', 'd.jpg']);
  assert.deepEqual(recentHumanRows(rows, 2).map(r => r.name), ['a.pdf', 'b.hwpx']);
  assert.deepEqual(recentHumanRows(null, 5), []);
  assert.equal(recentHumanRows(rows).length, 3);
});

test('규칙의 폴더 이름 = 각 자동화 코드의 상수(바뀌면 함께 고친다)', () => {
  const names = AUTO_FOLDER_RULES.flatMap(r => r.seq.filter(s => typeof s === 'string'));
  const gs = read('docs/ops/collector-feed.gs');
  assert.match(gs, /var TG_FEED_RAW_FOLDER = '원문';/);
  assert.match(gs, /var CALL_FEED_TRANSCRIPT_FOLDER = '전사';/);
  assert.match(gs, /var CALL_FEED_ANALYSIS_FOLDERS = \['검토대기', '검토완료'\];/);
  assert.match(read('supabase/functions/drive-summary/core.mjs'), /const COPY_FOLDER = FOLDER_NAMES\.copy\.now;/); // S69-41: 이름 글자는 brand-folders.mjs
  assert.match(read('supabase/functions/_shared/hwp-edit.ts'), /export const BACKUP_FOLDER = "노조\+ 편집 백업";/);
  assert.match(read('supabase/functions/_shared/hwp-edit.ts'), /export const OLD_BACKUP_FOLDER = "Web2 편집 백업";/);
  assert.match(read('supabase/functions/onedrive-photos/graph.ts'), /export const TRASH_NAME: string = FOLDER_NAMES\.photo_trash\.now;/); // S69-42
  assert.match(read('supabase/functions/onedrive-photos/graph.ts'), /export const NOJO_TRASH_NAME = "\.노조\+ 휴지통";/);
  // S71-02: '회의 녹음' 이름은 회의 드라이브 자리 규칙 한 곳(_shared/meeting-drive-place.mjs, 자료실 폴더 바로 아래).
  assert.match(read('supabase/functions/_shared/meeting-drive-place.mjs'), /export const RECORDING_FOLDER = '회의 녹음';/);
  assert.match(read('supabase/functions/meeting-transcribe/recording.mjs'), /export const PIECE_FOLDER = '녹음 조각';/);
  assert.equal(TRASH_FOLDER_NAME, '.WORK ON+ 휴지통');
  for (const n of ['원문', '전사', '검토대기', '검토완료', '노조+ 읽기용 사본', 'Web2 읽기용 사본', '노조+ 편집 백업', 'Web2 편집 백업', '회의 녹음', '녹음 조각', '.노조+ 휴지통', '.Web2 휴지통']) assert.ok(names.includes(n), n);
});

test('S68-02: 새 사용자 폴더 이름(WORK ON+ …)도 자동 폴더로 본다 — 서버 상수·brand-folders와 같은 값', async () => {
  const {FOLDER_NAMES} = await import('../supabase/functions/_shared/brand-folders.mjs');
  const {WORKON_TRASH_FOLDER_NAME} = await import('../app/photos-model.mjs');
  assert.match(read('supabase/functions/_shared/hwp-edit.ts'), /export const WORKON_BACKUP_FOLDER = FOLDER_NAMES\.edit_backup\.now;/);
  // S69-41: 새 이름 모두(brand-folders.mjs)가 자동 폴더 규칙에 있다.
  const names = AUTO_FOLDER_RULES.flatMap(r => r.seq.filter(s => typeof s === 'string'));
  for (const kind of ['copy', 'edit_backup']) for (const n of [FOLDER_NAMES[kind].now, ...FOLDER_NAMES[kind].olds]) assert.ok(names.includes(n), n);
  assert.match(read('supabase/functions/onedrive-photos/graph.ts'), /export const WORKON_TRASH_NAME = TRASH_NAME;/);
  assert.equal(FOLDER_NAMES.edit_backup.now, 'WORK ON+ 편집 백업');
  assert.equal(FOLDER_NAMES.edit_backup.old, '노조+ 편집 백업');
  assert.equal(FOLDER_NAMES.photo_trash.now, WORKON_TRASH_FOLDER_NAME);
  assert.equal(FOLDER_NAMES.photo_trash.now, TRASH_FOLDER_NAME, 'S69-42: 지금 이름은 누구나 .WORK ON+ 휴지통');
  for (const n of FOLDER_NAMES.photo_trash.olds) assert.ok(names.includes(n), n);
  assert.equal(autoMadeKind({folder_path: 'WORK ON+ 편집 백업'}), 'edit_backup');
  assert.equal(autoMadeKind({folder_path: '사진 › .WORK ON+ 휴지통'}), 'trash');
  assert.equal(autoMadeKind({folder_path: '가짜 WORK ON+ 편집 백업'}), null);
});

test("'최근' 상태를 만드는 곳 한 곳에서만 거른다(그린 뒤 덮어쓰기 없음), 서버 한도까지 읽는다", () => {
  const src = read('app/files.js');
  assert.equal(src.match(/recentHumanRows\(/g)?.length, 1);
  assert.match(src, /state\.recent = recentHumanRows\(/);
  assert.match(src, /p_shelf: 'recent', p_limit: RECENT_FETCH/);
  assert.match(src, /RECENT_FETCH = 300/);
  assert.match(read('supabase/migrations/20261104120000_cloud_find_sources.sql'), /v_limit < 1 or v_limit > 300/);
  // 찾기·별표·큰 파일·폴더 보기에는 쓰지 않는다.
  assert.doesNotMatch(src, /isAutoMade|autoMadeKind/);
});
