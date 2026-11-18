// PRIVACY-백업안내(S66-01): 화면 쪽 순수 부분과 서버 모델이 같은 규칙을 쓰는지, 화면이 부르는 곳·저장 위치를 고정한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
globalThis.window ??= {addEventListener() {}, dispatchEvent() {}};
const C = await import('../app/record-backup.js');
const M = await import('../supabase/functions/record-backup/model.mjs');
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('자동 백업 차례(7일)는 화면과 서버 모델이 같다', () => {
  const now = Date.parse('2026-11-18T00:00:00Z');
  for (const [auto, last] of [[false, null], [true, null], [true, 'x'], [true, '2026-11-12T00:00:00Z'], [true, '2026-11-11T00:00:00Z'], [true, '2026-11-17T23:00:00Z']])
    assert.equal(C.autoDue(auto, last, now), M.autoDue(auto, last, now), JSON.stringify([auto, last]));
});
test('스위치·안내 기억은 참·거짓만, 기본은 꺼짐·안내 아직', () => {
  assert.deepEqual(C.backupPrefs(undefined), {auto: false, intro: false});
  assert.deepEqual(C.backupPrefs({auto: 'yes', intro: 1}), {auto: false, intro: false});
  assert.deepEqual(C.backupPrefs({auto: true, intro: true}), {auto: true, intro: true});
});
test('알림 글·오류 글', () => {
  assert.equal(C.doneText({date: '2026-11-15', count: 741}), '내 드라이브 › 노조+ 백업 › 2026-11-15 에 741건을 받았어요.');
  assert.match(C.errorText('DRIVE_NOT_CONNECTED'), /드라이브를 연결/);
  assert.match(C.errorText('무엇이든'), /잠시 뒤/);
});
test('record-backup 함수를 부르는 곳은 record-backup.js 하나, 기기 저장 없음', () => {
  const src = read('app/record-backup.js');
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(src));
  assert.match(src, /viewPrefs\.set\('record_backup'/);
  for (const f of ['app/profile-settings.js', 'app/loader-v2.js']) assert.ok(!read(f).includes('/functions/v1/record-backup'), f);
  assert.match(read('app/profile-settings.js'), /import\('\.\/record-backup\.js'\)/);
  assert.match(read('app/loader-v2.js'), /import\('\.\/record-backup\.js'\)\.then\(m=>m\.startRecordBackup\(\)\)/);
});
