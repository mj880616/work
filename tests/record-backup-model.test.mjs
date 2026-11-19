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
test('첫 안내는 가입 직후(14일 안)에만', () => {
  const now = Date.parse('2026-11-18T00:00:00Z');
  assert.equal(C.justJoined('2026-11-17T00:00:00Z', now), true);
  assert.equal(C.justJoined('2026-11-04T00:00:01Z', now), true);
  assert.equal(C.justJoined('2026-11-04T00:00:00Z', now), false);
  for (const v of [undefined, null, '', 'x', '2026-12-01T00:00:00Z']) assert.equal(C.justJoined(v, now), false, String(v));
});
test('알림 글·오류 글', () => {
  assert.equal(C.doneText({date: '2026-11-15', count: 741}), '내 드라이브 › 노조+ 백업 › 2026-11-15 에 741건을 받았어요.');
  assert.match(C.errorText('DRIVE_NOT_CONNECTED'), /드라이브를 연결/);
  assert.match(C.errorText('무엇이든'), /잠시 뒤/);
});
test('record-backup 함수를 부르는 곳은 record-backup.js 하나, 설정은 서버 화면 기억(기기 저장 금지는 audit가 본다)', () => {
  const src = read('app/record-backup.js');
  assert.match(src, /viewPrefs\.set\('record_backup'/);
  for (const f of ['app/profile-settings.js', 'app/loader-v2.js']) assert.ok(!read(f).includes('/functions/v1/record-backup'), f);
  assert.match(read('app/profile-settings.js'), /import\('\.\/record-backup\.js'\)/);
  assert.match(read('app/loader-v2.js'), /import\('\.\/record-backup\.js'\)\.then\(m=>m\.startRecordBackup\(\)\)/);
});

// V67(11/19): id 칸이 없는 표를 id로 줄 세워 백업 전체가 RECORD_READ_FAILED로 실패했다.
// 백업 목록의 모든 표는 줄 세우는 칸(order, 없으면 id)이 그 표 정의에 있어야 한다(저장소 migration에서 정의를 찾을 수 있는 표만 본다).
import {readdirSync} from 'node:fs';
test('백업 표마다 줄 세우는 칸이 표 정의에 있다', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const sql = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const checked = [];
  for (const cat of M.CATEGORIES) for (const t of cat.tables) {
    if (t.by === 'user') continue;
    const m = new RegExp(`create table (?:if not exists )?public\\.${t.name}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i').exec(sql);
    if (!m) continue;
    const col = t.order || 'id';
    assert.match(m[1], new RegExp(`^\\s*${col}\\s`, 'm'), `${t.name}: 줄 세우는 칸 ${col} 없음`);
    checked.push(t.name);
  }
  assert.ok(checked.includes('app_journal_drafts') && checked.includes('app_pre_meeting_sheets') && checked.includes('app_journal_next_week_sheets'));
  const q = M.tableQuery(M.CATEGORIES.find(c => c.key === 'meetings').tables.find(t => t.name === 'app_journal_drafts'), {workspaceId: 'w', userId: 'u'}, {limit: 1, offset: 0});
  assert.match(q, /order=journal_day\.asc/);
});
