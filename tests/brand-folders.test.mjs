// S68-02: 서버가 만드는 폴더 이름(supabase/functions/_shared/brand-folders.mjs)과 화면 안내 글자. 값은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_NAMES, appNameFor, DRIVE_BRAND, FOLDER_NAMES, knownFolderNames, renameTo, rootRenameTo, ROOT_FOLDER_NAME, folderNames, folderNameFor, keepOldFromMyFeatures, keepOldFromFeatureWorkspace, driveQuoted, NOJO_WORDS_FEATURE } from '../supabase/functions/_shared/brand-folders.mjs';
import { WORD_BASE_FEATURES } from '../app/brand/custom-words-model.mjs';

const WS = '10000000-0000-4000-8000-00000000000a';
globalThis.window ??= {addEventListener() {}, dispatchEvent() {}};

test('폴더 이름: 새로 만들 때 늘 새 이름(구글 드라이브 S69-41, 원드라이브 사진 휴지통 S69-42 — nojo_words여도)', () => {
  assert.deepEqual(folderNames('record_backup'), ['노조+ 백업', 'WORK ON+ 백업']);
  assert.deepEqual(folderNames('edit_backup'), ['노조+ 편집 백업', 'WORK ON+ 편집 백업']);
  assert.deepEqual(folderNames('photo_trash'), ['.노조+ 휴지통', '.WORK ON+ 휴지통']);
  for (const kind of Object.keys(FOLDER_NAMES)) {
    assert.equal(folderNameFor(kind, false), FOLDER_NAMES[kind].now);
    const keep = FOLDER_NAMES[kind].now;
    assert.equal(folderNameFor(kind, true), keep, kind);
    assert.equal(folderNameFor(kind, null), keep, kind);
    assert.equal(folderNameFor(kind, undefined), keep, kind);
  }
  assert.equal(FOLDER_NAMES.photo_trash.drive, false, '원드라이브 휴지통은 [한곳으로 모으기] 대상이 아님(쓸 때 바꿈)');
  assert.deepEqual([...FOLDER_NAMES.photo_trash.olds], ['.노조+ 휴지통', '.Web2 휴지통'], '옛 이름 둘 다 알아봄');
  assert.throws(() => folderNameFor('nope', false));
});

test('S69-41: 앱 이름 글자는 DRIVE_BRAND 한 곳, 옛 이름 → 새 이름(사람이 바꾼 이름은 그대로)', () => {
  assert.equal(DRIVE_BRAND, 'WORK ON+');
  assert.equal(ROOT_FOLDER_NAME, DRIVE_BRAND);
  for (const kind of ['record_backup', 'edit_backup', 'basket', 'copy']) {
    assert.ok(FOLDER_NAMES[kind].now.startsWith(DRIVE_BRAND), kind);
    assert.ok(!FOLDER_NAMES[kind].olds.includes(FOLDER_NAMES[kind].now), kind);
    assert.deepEqual([...knownFolderNames(kind)], [...FOLDER_NAMES[kind].olds, FOLDER_NAMES[kind].now]);
  }
  assert.equal(renameTo('basket', 'Web2 바구니'), 'WORK ON+ 바구니');
  assert.equal(renameTo('record_backup', '노조+ 백업'), 'WORK ON+ 백업');
  assert.equal(renameTo('edit_backup', 'Web2 편집 백업'), 'WORK ON+ 편집 백업');
  assert.equal(renameTo('edit_backup', '노조+ 편집 백업'), 'WORK ON+ 편집 백업');
  assert.equal(renameTo('copy', '노조+ 읽기용 사본'), 'WORK ON+ 읽기용 사본');
  assert.equal(renameTo('copy', 'Web2 읽기용 사본'), 'WORK ON+ 읽기용 사본');
  assert.equal(renameTo('basket', 'WORK ON+ 바구니'), null, '이미 새 이름');
  assert.equal(renameTo('basket', '내 바구니'), null, '사람이 바꾼 이름');
  // S69-42: 원드라이브 사진 휴지통 옛 이름 둘 → '.WORK ON+ 휴지통'(NFD로 와도).
  assert.equal(renameTo('photo_trash', '.노조+ 휴지통'), '.WORK ON+ 휴지통');
  assert.equal(renameTo('photo_trash', '.Web2 휴지통'), '.WORK ON+ 휴지통');
  assert.equal(renameTo('photo_trash', '.노조+ 휴지통'.normalize('NFD')), '.WORK ON+ 휴지통');
  assert.equal(renameTo('photo_trash', '.WORK ON+ 휴지통'), null);
  for (const n of ['웹2', 'Web2', '공공기관사업팀 Workspace', '노조+', '노동조합+']) assert.equal(rootRenameTo(n), 'WORK ON+', n);
  for (const n of ['WORK ON+', '내 업무', '웹2 자료']) assert.equal(rootRenameTo(n), null, n);
});

test('nojo_words 판정: 로그인 토큰 app_my_features 답·service role app_operator_feature_workspace 답', () => {
  assert.equal(NOJO_WORDS_FEATURE, 'nojo_words');
  assert.equal(WORD_BASE_FEATURES[NOJO_WORDS_FEATURE], 'nojo', '화면 바탕 낱말 묶음과 같은 기능 키');
  assert.equal(keepOldFromMyFeatures(['calls', 'nojo_words']), true);
  assert.equal(keepOldFromMyFeatures([]), false);
  assert.equal(keepOldFromMyFeatures(null), null);
  assert.equal(keepOldFromMyFeatures({ nojo_words: true }), null);
  assert.equal(keepOldFromFeatureWorkspace(WS, WS), true);
  assert.equal(keepOldFromFeatureWorkspace('20000000-0000-4000-8000-00000000000b', WS), false);
  assert.equal(keepOldFromFeatureWorkspace(null, WS), false);
  assert.equal(keepOldFromFeatureWorkspace(undefined, WS), null);
  assert.equal(keepOldFromFeatureWorkspace({ message: 'x' }, WS), null);
});

test("Drive 검색 쿼리: '+'·공백은 그대로, URL에서는 %2B로 간다", () => {
  assert.equal(driveQuoted('WORK ON+ 편집 백업'), 'WORK ON+ 편집 백업');
  assert.equal(driveQuoted("a'b\\c"), "a\\'b\\\\c");
  const q = new URLSearchParams({ q: `name = '${driveQuoted('WORK ON+ 편집 백업')}'` }).toString();
  assert.match(q, /WORK\+ON%2B/);
  assert.equal(new URLSearchParams(q).get('q'), "name = 'WORK ON+ 편집 백업'");
});

test('화면: 백업 폴더 이름은 서버가 알려 준 실제 이름, 모를 때만 얼굴 기본 이름', async () => {
  const { doneText, folderName, DEFAULT_FOLDER, errorText } = await import('../app/record-backup.js');
  assert.equal(DEFAULT_FOLDER, 'WORK ON+ 백업', 'S69-42: 누구나 새 이름(서버가 쓸 때 옛 이름을 바꿈)');
  assert.equal(folderName('WORK ON+ 백업'), 'WORK ON+ 백업');
  assert.equal(folderName(''), DEFAULT_FOLDER);
  assert.equal(folderName(5), DEFAULT_FOLDER);
  assert.equal(doneText({ date: '2026-11-22', count: 3, root_name: 'WORK ON+ 백업' }), '내 드라이브 › WORK ON+ 백업 › 2026-11-22 에 3건을 받았어요.');
  assert.equal(doneText({ date: '2026-11-22', count: 3 }), '내 드라이브 › WORK ON+ 백업 › 2026-11-22 에 3건을 받았어요.');
  assert.match(errorText('DRIVE_PUBLIC_SHARING_FOUND', 'WORK ON+ 백업'), /^'WORK ON\+ 백업' 폴더가 공유돼/);
  assert.match(errorText('DRIVE_PUBLIC_SHARING_FOUND'), /^'WORK ON\+ 백업' 폴더가 공유돼/);
  const { backupFolderName, EDIT_BACKUP_FOLDER } = await import('../app/hwp-drive.js');
  assert.equal(EDIT_BACKUP_FOLDER, 'WORK ON+ 편집 백업');
  assert.equal(backupFolderName('WORK ON+ 편집 백업'), 'WORK ON+ 편집 백업');
  assert.equal(backupFolderName('a"b'), EDIT_BACKUP_FOLDER);
  assert.equal(backupFolderName(undefined), EDIT_BACKUP_FOLDER);
});

// S68-21: 새로 만드는 문서 안 앱 이름 — 폴더 이름과 같은 규칙(모름은 지금 글자).
test('S68-21: appNameFor', () => {
  assert.deepEqual({...APP_NAMES}, {old: '노조+', now: 'WORK ON+'});
  assert.equal(appNameFor(false), 'WORK ON+');
  // S69-42: 누구나 WORK ON+.
  assert.equal(appNameFor(true), 'WORK ON+');
  assert.equal(appNameFor(null), 'WORK ON+');
  assert.equal(appNameFor(undefined), 'WORK ON+');
});

// S71-49: 보드 사진 폴더 이름은 공용 자리 한 곳(앱 이름이 붙지 않아 브랜드가 바뀌어도 그대로).
test('보드 사진 폴더 이름', async () => {
  const { BOARD_PHOTO_FOLDER_NAME } = await import('../supabase/functions/_shared/brand-folders.mjs');
  assert.equal(BOARD_PHOTO_FOLDER_NAME, '보드 사진');
});
