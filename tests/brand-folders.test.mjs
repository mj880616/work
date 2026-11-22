// S68-02: 서버가 만드는 폴더 이름(supabase/functions/_shared/brand-folders.mjs)과 화면 안내 글자. 값은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOLDER_NAMES, folderNames, folderNameFor, keepOldFromMyFeatures, keepOldFromFeatureWorkspace, driveQuoted, NOJO_WORDS_FEATURE } from '../supabase/functions/_shared/brand-folders.mjs';
import { WORD_BASE_FEATURES } from '../app/brand/custom-words-model.mjs';

const WS = '10000000-0000-4000-8000-00000000000a';
globalThis.window ??= {addEventListener() {}, dispatchEvent() {}};

test('폴더 이름 둘: 지금(노조+)·새(WORK ON+). 새로 만들 때만 고르고, 모르면 지금 이름', () => {
  assert.deepEqual(folderNames('record_backup'), ['노조+ 백업', 'WORK ON+ 백업']);
  assert.deepEqual(folderNames('edit_backup'), ['노조+ 편집 백업', 'WORK ON+ 편집 백업']);
  assert.deepEqual(folderNames('photo_trash'), ['.노조+ 휴지통', '.WORK ON+ 휴지통']);
  for (const kind of Object.keys(FOLDER_NAMES)) {
    assert.equal(folderNameFor(kind, false), FOLDER_NAMES[kind].now);
    assert.equal(folderNameFor(kind, true), FOLDER_NAMES[kind].old);
    assert.equal(folderNameFor(kind, null), FOLDER_NAMES[kind].old, '확인 실패는 지금 이름(지금 동작 그대로)');
    assert.equal(folderNameFor(kind, undefined), FOLDER_NAMES[kind].old);
  }
  assert.throws(() => folderNameFor('nope', false));
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
  assert.equal(DEFAULT_FOLDER, '노조+ 백업', '저장소 얼굴(nojo)은 지금 글자');
  assert.equal(folderName('WORK ON+ 백업'), 'WORK ON+ 백업');
  assert.equal(folderName(''), DEFAULT_FOLDER);
  assert.equal(folderName(5), DEFAULT_FOLDER);
  assert.equal(doneText({ date: '2026-11-22', count: 3, root_name: 'WORK ON+ 백업' }), '내 드라이브 › WORK ON+ 백업 › 2026-11-22 에 3건을 받았어요.');
  assert.equal(doneText({ date: '2026-11-22', count: 3 }), '내 드라이브 › 노조+ 백업 › 2026-11-22 에 3건을 받았어요.');
  assert.match(errorText('DRIVE_PUBLIC_SHARING_FOUND', 'WORK ON+ 백업'), /^'WORK ON\+ 백업' 폴더가 공유돼/);
  assert.match(errorText('DRIVE_PUBLIC_SHARING_FOUND'), /^'노조\+ 백업' 폴더가 공유돼/);
  const { backupFolderName, EDIT_BACKUP_FOLDER } = await import('../app/hwp-drive.js');
  assert.equal(EDIT_BACKUP_FOLDER, '노조+ 편집 백업');
  assert.equal(backupFolderName('WORK ON+ 편집 백업'), 'WORK ON+ 편집 백업');
  assert.equal(backupFolderName('a"b'), EDIT_BACKUP_FOLDER);
  assert.equal(backupFolderName(undefined), EDIT_BACKUP_FOLDER);
});
