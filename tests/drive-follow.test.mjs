// S70-76 LIB-드라이브늘같게: 앱에서 옮기기·폴더 만들기·이름 바꾸기·옮기기 → 그 자리에서 서버에 '드라이브도 같게'(app/drive-follow.mjs).
// 가짜 api·가짜 창만(네트워크 없음). 값은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FOLLOW_PATH, affectsLibrary, followDrive, followFailed, mountDriveFollow, onDriveFollow } from '../app/drive-follow.mjs';

const BASE = 'https://sb.example';
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

test('어떤 저장이 자료실 표를 바꾸나: 폴더·자료 연결 표의 쓰기만(읽기·다른 표·함수 아님)', () => {
  for (const [path, method] of [
    ['/rest/v1/app_library_folder_items', 'POST'], // 옮기기(새 연결)·여러 개 옮기기·끌기·정돈 제안 승인
    ['/rest/v1/app_library_folder_items?document_id=eq.x&workspace_id=eq.y', 'PATCH'], // 다른 폴더로
    ['/rest/v1/app_library_folder_items?document_id=eq.x', 'DELETE'], // 폴더 밖으로
    ['/rest/v1/app_library_folders', 'POST'], // 폴더 만들기
    ['/rest/v1/app_library_folders?id=eq.x&workspace_id=eq.y', 'PATCH'], // 이름 바꾸기·폴더 옮기기
    [`${BASE}/rest/v1/app_library_folders?id=eq.x`, 'PATCH'],
  ]) assert.equal(affectsLibrary({ path, method }, BASE), true, `${method} ${path}`);
  for (const [path, method] of [
    ['/rest/v1/app_library_folders?select=id', 'GET'],
    ['/rest/v1/app_library_folders_x', 'POST'],
    ['/rest/v1/rpc/app_library_folder_set_color', 'POST'],
    ['/rest/v1/app_documents', 'POST'],
    ['/functions/v1/workspace-drive?action=drive-mirror', 'POST'],
  ]) assert.equal(affectsLibrary({ path, method }, BASE), false, `${method} ${path}`);
  assert.equal(affectsLibrary(null), false);
});

test('밀렸는가: 대기·남음·서버 실패·닿지 못함은 밀림, 연결 없음·자료실 없음·DB 적용 전·옮길 수 없는 파일은 아님', () => {
  assert.equal(followFailed({ ok: true, pending: 1 }), true);
  assert.equal(followFailed({ ok: true, more: true }), true);
  assert.equal(followFailed({ ok: false, code: 'mirror_failed' }), true);
  assert.equal(followFailed({ ok: false, code: 'unreachable' }), true);
  assert.equal(followFailed(null), true);
  for (const code of ['drive_not_connected', 'not_ready', 'settings_unavailable', 'library_missing']) assert.equal(followFailed({ ok: false, code }), false, code);
  assert.equal(followFailed({ ok: true, pending: 0, cant: 2, more: false }), false);
});

test('부탁 하나: 모양 {mode:"auto"}만, 서버가 남겼으면(more) 이어서, 겹친 부탁은 묶어 끝난 뒤 한 번 더, 실패해도 throw 없음', async () => {
  const asks = [];
  let answers = [{ ok: true, more: true, files_moved: 5 }, { ok: true, more: false, files_moved: 2 }];
  const api = async (path, opt) => { asks.push([path, opt.method, JSON.stringify(opt.body), opt.singleFlight]); await tick(); return answers.shift() || { ok: true }; };
  const heard = [];
  const off = onDriveFollow(r => heard.push(r));
  const r = await followDrive(api);
  assert.deepEqual(asks, [[FOLLOW_PATH, 'POST', '{"mode":"auto"}', false], [FOLLOW_PATH, 'POST', '{"mode":"auto"}', false]]);
  assert.equal(r.files_moved, 2);
  assert.equal(heard.length, 1, '끝난 뒤 한 번 알림');
  // 겹친 부탁: 도는 중 두 번 더 → 끝난 뒤 한 번만 더
  asks.length = 0; answers = [{ ok: true }, { ok: true }, { ok: true }];
  const a = followDrive(api); const b = followDrive(api); const c = followDrive(api);
  assert.equal(a, b); assert.equal(b, c);
  await a; await tick(30);
  assert.equal(asks.length, 2, '겹친 부탁은 묶어서 한 번 더');
  // 닿지 못함
  const bad = await followDrive(async () => { throw new Error('offline'); });
  assert.deepEqual(bad, { ok: false, code: 'unreachable' });
  off();
});

test('앱 어디서든 저장 직후 그 자리에서 부탁하고, 밀리면 1분 뒤 한 번만 더(계속 실패하면 멈춤)', async () => {
  const listeners = new Map();
  const win = { addEventListener: (k, fn) => listeners.set(k, fn), removeEventListener: k => listeners.delete(k) };
  const asks = [];
  let answers = [];
  const rt = () => ({ config: { url: BASE }, api: async (path, opt) => { asks.push(JSON.stringify(opt.body)); return answers.shift() || { ok: true, pending: 0 }; } });
  const stop = mountDriveFollow({ win, rt, retryMs: 10 });
  const saved = detail => listeners.get('kptu:api-saved')({ detail });
  saved({ path: '/rest/v1/app_library_folders?select=id', method: 'GET' });
  await tick();
  assert.equal(asks.length, 0, '읽기는 부탁하지 않음');
  answers = [{ ok: true, pending: 1 }, { ok: true, pending: 1 }];
  saved({ path: `${BASE}/rest/v1/app_library_folder_items`, method: 'POST' });
  await tick(2);
  assert.deepEqual(asks, ['{"mode":"auto"}'], '저장 직후 그 자리에서');
  await tick(40);
  assert.equal(asks.length, 2, '밀렸으면 한 번 더');
  await tick(40);
  assert.equal(asks.length, 2, '그래도 밀리면 멈춤(다음 옮기기·자료실 열기·[다시]에서 서버가 다시)');
  answers = [{ ok: true, pending: 0 }];
  saved({ path: '/rest/v1/app_library_folders?id=eq.x', method: 'PATCH' });
  await tick(40);
  assert.equal(asks.length, 3);
  stop();
  assert.equal(listeners.size, 0);
});

test('부탁 길은 하나: 화면 모듈은 drive-follow.mjs만 쓰고, 드라이브를 직접 부르지 않으며, 일회용 메뉴는 없다', () => {
  const read = f => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
  const loader = read('loader-v2.js');
  assert.match(loader, /import\('\.\/drive-follow\.mjs'\)\.then\(m=>m\.mountDriveFollow\(\)\)/);
  const follow = read('drive-follow.mjs');
  assert.doesNotMatch(follow, /googleapis/, '드라이브 직접 호출 없음(기기 저장 없음은 Browser storage audit이 본다)');
  for (const f of ['library-upload.js', 'library-drive-line.js', 'weekly-save-folder.js']) {
    const code = read(f).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /drive-align|drive-check|library-drive-check|mode: ?'align'/, f);
  }
  assert.doesNotMatch(read('library-upload.js'), /'드라이브 폴더 맞추기'|'드라이브와 맞는지 보기'/);
});
