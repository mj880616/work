// S69-22(명진 11/24 08:54 "앱과 자동 수집이 쓰고 있는것좀 한 폴더에 몰아두면 안되니"):
// 앱 드라이브 폴더를 맨 위 앱 폴더 한 곳 아래로 모으기 — 찾기는 저장한 id·표식, [모으기]는 부모만 바꿈(가짜 드라이브, 네트워크 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_FOLDER_MARK, GATHER_KINDS, NOT_GATHERED, createParentFor, gatherKindOf, gatherQuery, renameQuery, basketFolderClause, BASKET_NAMES, isBasketFolder, isDriveId, markFor, placedAtTop, privateOwnedFolder, topParents, topParentsClause,
} from '../supabase/functions/_shared/app-folders.mjs';
import { GATHER_MAX_MOVES, GatherError, RENAME_MAX, gatherFolders, parseGatherRequest } from '../supabase/functions/workspace-drive/gather-folders.mjs';
import { createDriveUpload } from '../supabase/functions/_shared/drive-upload.ts';
import { inspectBasketOriginal } from '../supabase/functions/_shared/basket-file-origin.ts';

const ROOT = 'app-root-folder-1';
const DRIVE_ROOT = 'my-drive-root-0001';

test('부모 조건: 맨 위와 맨 위 앱 폴더 둘 다 본다, 이상한 id는 넣지 않는다', () => {
  assert.equal(topParentsClause(ROOT), `('root' in parents or '${ROOT}' in parents)`);
  assert.equal(topParentsClause(null), `('root' in parents)`);
  assert.equal(topParentsClause("x' or 'a' in parents"), `('root' in parents)`, '따옴표가 든 값은 쿼리에 넣지 않는다');
  assert.deepEqual(topParents([ROOT, ROOT, 'short']), ['root', ROOT]);
  assert.equal(createParentFor(ROOT), ROOT);
  assert.equal(createParentFor(undefined), 'root');
  assert.equal(isDriveId('root'), false);
  assert.equal(placedAtTop([ROOT], ROOT), true);
  assert.equal(placedAtTop([DRIVE_ROOT], ROOT, DRIVE_ROOT), true);
  assert.equal(placedAtTop(['other-folder-123'], ROOT), false);
  assert.equal(placedAtTop([ROOT, 'other-folder-123'], ROOT), false);
});

test('모으기 대상 표: 앱이 만든 폴더만, 앱 코드 밖 폴더(텔레그램·AI 업무수집·음성 녹음 백업)는 쿼리에 없다', () => {
  const q = gatherQuery();
  assert.match(q, /^'root' in parents and 'me' in owners and trashed = false and mimeType = 'application\/vnd.google-apps.folder' and \(/);
  for (const k of GATHER_KINDS) assert.ok(q.includes(`key='${k.mark.key}' and value='${k.mark.value}'`), k.kind);
  for (const name of ['Web2 바구니', '노조+ 편집 백업', 'WORK ON+ 편집 백업', 'Web2 편집 백업']) assert.ok(q.includes(`name = '${name}'`), name);
  for (const n of ['Telegram업무자료', 'AI 업무수집', '음성 녹음 백업', 'web2-phone-key', '요청함']) assert.equal(q.includes(n), false, n);
  assert.deepEqual(NOT_GATHERED.map(x => x.name).slice(0, 3), ['Telegram업무자료', 'AI 업무수집', '음성 녹음 백업']);
  assert.deepEqual(gatherKindOf({ name: 'Web2 바구니' }), { kind: 'basket', marked: false });
  assert.deepEqual(gatherKindOf({ name: '아무 이름', appProperties: { kptu_backup: 'root' } }), { kind: 'record_backup', marked: true });
  assert.deepEqual(gatherKindOf({ name: 'x', appProperties: { kptu_summary: 'folder', kptu_workspace: 'kptu-work' } }), { kind: 'copy', marked: true });
  assert.equal(gatherKindOf({ name: 'x', appProperties: { kptu_summary: 'folder', kptu_workspace: 'other' } }), null, '다른 작업공간 표식은 아님');
  assert.equal(gatherKindOf({ name: 'Telegram업무자료' }), null);
  assert.deepEqual(markFor('edit_backup'), { [APP_FOLDER_MARK]: 'edit_backup' });
  assert.equal(markFor('record_backup'), null, '기존 표식이 있는 종류는 새 표식을 붙이지 않는다');
  assert.equal(privateOwnedFolder({ id: ROOT, mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, trashed: false, permissions: [{ type: 'user', role: 'owner' }] }), true);
  assert.equal(privateOwnedFolder({ id: ROOT, mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, trashed: false, permissions: [{ type: 'user', role: 'owner' }, { type: 'anyone', role: 'reader' }] }), false);
});

test('요청 모양: action 하나 + {} 또는 {dry_run:true}만(폴더 id 같은 다른 값은 거절)', () => {
  const u = q => new URL('https://x.test/functions/v1/workspace-drive?' + q);
  assert.deepEqual(parseGatherRequest(u('action=gather-folders'), {}), { dryRun: false });
  assert.deepEqual(parseGatherRequest(u('action=gather-folders'), { dry_run: true }), { dryRun: true });
  assert.equal(parseGatherRequest(u('action=gather-folders&root=x'), {}), null);
  assert.equal(parseGatherRequest(u('action=gather-folders'), { root_id: ROOT }), null);
  assert.equal(parseGatherRequest(u('action=gather-folders'), { dry_run: 'yes' }), null);
  assert.equal(parseGatherRequest(u('action=gather-folders'), null), null);
  assert.equal(parseGatherRequest(u('action=gather-folders'), []), null);
});

// 가짜 드라이브: 맨 위(DRIVE_ROOT)·맨 위 앱 폴더(ROOT)와 그 안 폴더들. 목록 쿼리는 모으기(gatherQuery: 'root' in parents만)와
// 이름 맞추기(renameQuery: 맨 위 또는 맨 위 앱 폴더 바로 아래) 둘뿐. PATCH는 옮기기(부모+표식) 또는 이름 맞추기(이름+표식)만 받는다.
function fakeDrive({ files, rootPerms = [{ type: 'user', role: 'owner' }], patchFail = new Set(), rootName = '웹2' } = {}) {
  const state = { files: files.map(f => ({ ownedByMe: true, trashed: false, ...f })), calls: [], rootName };
  const view = f => ({ id: f.id, name: f.name, parents: f.parents, ownedByMe: f.ownedByMe, appProperties: f.appProperties });
  const drive = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET';
    state.calls.push({ method, path: u.pathname, search: u.searchParams, body: init.body });
    if (method === 'GET' && u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q');
      if (q === gatherQuery()) return Response.json({ files: state.files.filter(f => !f.trashed && f.parents[0] === DRIVE_ROOT && gatherKindOf(f)).map(view) });
      assert.equal(q, renameQuery(ROOT), '이름 맞추기 쿼리는 맨 위·맨 위 앱 폴더 바로 아래만');
      return Response.json({ files: state.files.filter(f => !f.trashed && [DRIVE_ROOT, ROOT].includes(f.parents[0]) && gatherKindOf(f)).map(view) });
    }
    const id = decodeURIComponent(u.pathname.split('/').at(-1));
    if (method === 'GET' && id === ROOT) return Response.json({ id: ROOT, name: state.rootName, mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, trashed: false, permissions: rootPerms });
    if (method === 'PATCH') {
      const b = JSON.parse(init.body);
      if (patchFail.has(id)) return Response.json({ error: {} }, { status: 403 });
      if (!u.searchParams.get('addParents')) {
        // 이름 맞추기: 이름(+표식)만, 부모는 그대로.
        assert.deepEqual(Object.keys(b).filter(k => k !== 'appProperties'), ['name'], '이름 맞추기는 이름·표식만');
        assert.equal(u.searchParams.get('removeParents'), null);
        if (id === ROOT) { state.rootName = b.name; return Response.json({ id, name: b.name }); }
        const f = state.files.find(x => x.id === id);
        if (!f) return Response.json({ error: {} }, { status: 404 });
        f.name = b.name;
        if (b.appProperties) f.appProperties = { ...f.appProperties, ...b.appProperties };
        return Response.json({ id, name: f.name });
      }
      const f = state.files.find(x => x.id === id);
      if (!f) return Response.json({ error: {} }, { status: 403 });
      assert.equal(u.searchParams.get('addParents'), ROOT);
      assert.equal(u.searchParams.get('removeParents'), f.parents[0]);
      assert.deepEqual(Object.keys(b).filter(k => k !== 'appProperties'), [], '옮기기는 부모·표식만 바꾼다(이름·휴지통 안 건드림)');
      f.parents = [ROOT];
      if (b.appProperties) f.appProperties = { ...f.appProperties, ...b.appProperties };
      return Response.json({ id, parents: f.parents });
    }
    throw new Error('unexpected ' + method + ' ' + url);
  };
  return { drive, state };
}

const SCENE = () => [
  { id: 'basket-folder-01', name: 'Web2 바구니', parents: [DRIVE_ROOT] },
  { id: 'record-backup-01', name: '노조+ 백업', parents: [DRIVE_ROOT], appProperties: { kptu_backup: 'root' } },
  { id: 'edit-backup-0001', name: '노조+ 편집 백업', parents: [DRIVE_ROOT] },
  { id: 'copy-folder-0001', name: '노조+ 읽기용 사본', parents: [DRIVE_ROOT], appProperties: { kptu_summary: 'folder', kptu_workspace: 'kptu-work' } },
  { id: 'telegram-folder1', name: 'Telegram업무자료', parents: [DRIVE_ROOT] },
  { id: 'library-folder01', name: '자료실', parents: [ROOT] },
  { id: 'person-folder-01', name: 'Web2 메모', parents: [DRIVE_ROOT] },
  { id: 'person-folder-02', name: '노조+ 자료', parents: [ROOT] },
];
const ROOT_URL = `https://drive.google.com/drive/folders/${ROOT}`;

test('[모으기] 세기 → 옮기기 → 이름 맞추기: 앱 폴더 4개만 옮기고, 맨 위 앱 폴더와 앱 폴더의 옛 이름을 새 이름으로(S69-41)', async () => {
  const { drive, state } = fakeDrive({ files: SCENE() });
  const plan = await gatherFolders({ drive, rootId: ROOT, dryRun: true });
  assert.deepEqual(plan, { root_name: '웹2', root_url: ROOT_URL, count: 4, kinds: { basket: 1, record_backup: 1, edit_backup: 1, copy: 1 }, rename: 5 });
  assert.equal(state.calls.some(c => c.method === 'PATCH'), false, '세기는 아무것도 바꾸지 않는다');
  const r = await gatherFolders({ drive, rootId: ROOT });
  assert.deepEqual(r, { root_name: 'WORK ON+', root_url: ROOT_URL, moved: 4, failed: 0, left: 0, kinds: { basket: 1, record_backup: 1, edit_backup: 1, copy: 1 }, renamed: 5, rename_failed: 0, rename_left: 0 });
  const byId = Object.fromEntries(state.files.map(f => [f.id, f]));
  for (const id of ['basket-folder-01', 'record-backup-01', 'edit-backup-0001', 'copy-folder-0001']) assert.deepEqual(byId[id].parents, [ROOT], id);
  assert.deepEqual(byId['telegram-folder1'].parents, [DRIVE_ROOT], '앱 코드 밖 폴더는 그대로');
  assert.equal(byId['basket-folder-01'].appProperties.kptu_app_folder, 'basket');
  assert.equal(byId['edit-backup-0001'].appProperties.kptu_app_folder, 'edit_backup');
  assert.equal(byId['record-backup-01'].appProperties.kptu_app_folder, undefined, '기존 표식 폴더에는 새 표식을 붙이지 않는다');
  assert.equal(state.rootName, 'WORK ON+');
  assert.deepEqual(['basket-folder-01', 'record-backup-01', 'edit-backup-0001', 'copy-folder-0001'].map(id => byId[id].name),
    ['WORK ON+ 바구니', 'WORK ON+ 백업', 'WORK ON+ 편집 백업', 'WORK ON+ 읽기용 사본']);
  for (const id of ['telegram-folder1', 'library-folder01', 'person-folder-01', 'person-folder-02']) assert.equal(byId[id].name, SCENE().find(f => f.id === id).name, '사람·앱 밖 폴더 이름은 그대로: ' + id);
  assert.equal(byId['person-folder-01'].appProperties, undefined, '사람 폴더에 표식을 붙이지 않는다');
  assert.equal(state.calls.some(c => c.method === 'DELETE' || /trashed/.test(c.body || '')), false, '지우지 않는다');
  // 이어서 다시 눌러도 이미 옮기고 바꾼 것은 다시 하지 않는다(→ 화면 '모아 둠').
  const again = await gatherFolders({ drive, rootId: ROOT });
  assert.deepEqual(again, { root_name: 'WORK ON+', root_url: ROOT_URL, moved: 0, failed: 0, left: 0, kinds: {}, renamed: 0, rename_failed: 0, rename_left: 0 });
  assert.deepEqual(await gatherFolders({ drive, rootId: ROOT, dryRun: true }), { root_name: 'WORK ON+', root_url: ROOT_URL, count: 0, kinds: {}, rename: 0 });
});

test('[이름 맞추기] 사람이 바꾼 이름(표식 있는 앱 폴더·맨 위 앱 폴더)은 그대로, 이미 안에 있는 옛 이름 폴더는 바꾼다, 실패는 세기만', async () => {
  const { drive, state } = fakeDrive({ rootName: '내 업무 폴더', patchFail: new Set(['edit-backup-0002']), files: [
    { id: 'record-backup-02', name: '내가 정한 백업', parents: [ROOT], appProperties: { kptu_backup: 'root' } },
    { id: 'basket-folder-02', name: 'Web2 바구니', parents: [ROOT], appProperties: { kptu_app_folder: 'basket' } },
    { id: 'edit-backup-0002', name: 'Web2 편집 백업', parents: [ROOT], appProperties: { kptu_app_folder: 'edit_backup' } },
    { id: 'copy-folder-0002', name: '노조+ 읽기용 사본', parents: [ROOT], appProperties: { kptu_summary: 'folder', kptu_workspace: 'other' } },
  ] });
  assert.equal((await gatherFolders({ drive, rootId: ROOT, dryRun: true })).rename, 2);
  const r = await gatherFolders({ drive, rootId: ROOT });
  assert.deepEqual([r.root_name, r.moved, r.renamed, r.rename_failed, r.rename_left], ['내 업무 폴더', 0, 1, 1, 0]);
  const byId = Object.fromEntries(state.files.map(f => [f.id, f]));
  assert.equal(state.rootName, '내 업무 폴더', '맨 위 앱 폴더를 사람이 바꾼 이름은 그대로');
  assert.equal(byId['record-backup-02'].name, '내가 정한 백업');
  assert.equal(byId['basket-folder-02'].name, 'WORK ON+ 바구니');
  assert.equal(byId['edit-backup-0002'].name, 'Web2 편집 백업', '실패하면 그대로(다음에 다시)');
  assert.equal(byId['copy-folder-0002'].name, '노조+ 읽기용 사본', '다른 작업공간 표식 사본은 앱 폴더로 보지 않는다');
});

test('[모으기] 한 번에 정해진 개수까지, 남으면 left — 다시 부르면 이어서 한다. 실패는 세기만', async () => {
  const files = Array.from({ length: GATHER_MAX_MOVES + 3 }, (_, i) => ({ id: `basket-extra-${String(i).padStart(3, '0')}`, name: 'Web2 바구니', parents: [DRIVE_ROOT] }));
  const { drive } = fakeDrive({ files, patchFail: new Set(['basket-extra-000']) });
  const first = await gatherFolders({ drive, rootId: ROOT });
  assert.deepEqual([first.moved, first.failed, first.left, first.renamed], [GATHER_MAX_MOVES - 1, 1, 3, 0], '옮기기가 남으면 이름 맞추기는 다음에');
  const second = await gatherFolders({ drive, rootId: ROOT });
  assert.deepEqual([second.moved, second.failed, second.left], [3, 1, 0]);
  assert.equal(second.renamed + second.rename_failed + second.rename_left, 1 + GATHER_MAX_MOVES + 3, '맨 위 앱 폴더 1 + 바구니 13개(옮기지 못한 1개도 이름은 맞춤 대상)');
  assert.equal(second.rename_left, GATHER_MAX_MOVES + 3 - RENAME_MAX);
});

test('[모으기] 맨 위 앱 폴더가 공유돼 있거나 없거나 못 읽으면 아무것도 옮기지 않는다', async () => {
  const shared = fakeDrive({ files: SCENE(), rootPerms: [{ type: 'user', role: 'owner' }, { type: 'anyone', role: 'reader' }] });
  await assert.rejects(gatherFolders({ drive: shared.drive, rootId: ROOT }), e => e instanceof GatherError && e.code === 'app_root_shared' && e.status === 409);
  assert.equal(shared.state.calls.some(c => c.method === 'PATCH'), false);
  await assert.rejects(gatherFolders({ drive: shared.drive, rootId: '' }), e => e.code === 'app_root_missing');
  const broken = async () => Response.json({}, { status: 404 });
  await assert.rejects(gatherFolders({ drive: broken, rootId: ROOT }), e => e.code === 'app_root_unreadable');
});

test('[모으기] 맨 위 앱 폴더 자신·남의 폴더·부모가 여럿인 폴더는 후보가 아니다', async () => {
  const { drive, state } = fakeDrive({ rootName: 'WORK ON+', files: [
    { id: ROOT, name: 'Web2 바구니', parents: [DRIVE_ROOT] },
    { id: 'not-mine-folder1', name: 'Web2 바구니', parents: [DRIVE_ROOT], ownedByMe: false },
  ] });
  const r = await gatherFolders({ drive, rootId: ROOT });
  assert.equal(r.moved, 0);
  assert.equal(r.renamed, 0);
  assert.equal(state.calls.some(c => c.method === 'PATCH'), false);
});

// ---- 바구니(_shared/drive-upload.ts): 저장한 id로 찾고, 맨 위 앱 폴더 아래로 옮겨도 새로 만들지 않는다 ----
function fakeAdmin(settings) {
  const writes = [];
  const q = () => {
    const b = { select: () => b, eq: () => b, is: () => b, maybeSingle: async () => ({ data: settings, error: null }),
      upsert: async v => { writes.push(['upsert', v]); return { error: null }; }, update: v => { writes.push(['update', v]); return b; } };
    return b;
  };
  return { admin: { from: q }, writes };
}
function basketDrive(folders) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url)), method = init.method || 'GET';
    calls.push({ method, path: u.pathname, q: u.searchParams.get('q'), body: init.body });
    if (method === 'GET' && u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q');
      const parents = [...q.matchAll(/'([^']+)' in parents/g)].map(m => m[1] === 'root' ? DRIVE_ROOT : m[1]);
      return Response.json({ files: folders.filter(f => parents.includes(f.parents[0])) });
    }
    if (method === 'GET') { const id = u.pathname.split('/').at(-1); const f = folders.find(x => x.id === id); return f ? Response.json(f) : Response.json({}, { status: 404 }); }
    if (method === 'POST' && u.pathname === '/drive/v3/files') {
      const b = JSON.parse(init.body); const f = { id: 'new-basket-0001', name: b.name, mimeType: b.mimeType, ownedByMe: true, trashed: false, parents: b.parents.map(p => p === 'root' ? DRIVE_ROOT : p), permissions: [{ type: 'user', role: 'owner' }], appProperties: b.appProperties };
      folders.push(f); return Response.json({ id: f.id });
    }
    throw new Error('unexpected ' + method + ' ' + url);
  };
  return { fetch, calls };
}
const basketFolder = (parent, id = 'basket-folder-01') => ({ id, name: 'Web2 바구니', mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, trashed: false, parents: [parent], permissions: [{ type: 'user', role: 'owner' }] });

test('바구니: 저장한 폴더가 맨 위 앱 폴더 아래로 옮겨져도 그대로 쓰고, 새로 만들지 않는다', async () => {
  const { admin } = fakeAdmin({ basket_folder_id: 'basket-folder-01', root_folder_id: ROOT });
  const d = basketDrive([basketFolder(ROOT)]);
  const up = createDriveUpload(admin, { fetch: d.fetch, log: () => {} });
  assert.equal(await up.ensurePrivateRootFolder('ws-1', 'token'), 'basket-folder-01');
  assert.equal(d.calls.some(c => c.method === 'POST'), false);
  assert.match(d.calls.find(c => c.q).q, /\('root' in parents or 'app-root-folder-1' in parents\)/);
  // 맨 위 앱 폴더를 모르면(옛 설정) 옮긴 폴더는 맨 위가 아니라서 지금처럼 거절(공유 폴더로 넘어가지 않음).
  const old = createDriveUpload(fakeAdmin({ basket_folder_id: 'basket-folder-01', root_folder_id: null }).admin, { fetch: basketDrive([basketFolder(ROOT)]).fetch, log: () => {} });
  await assert.rejects(old.ensurePrivateRootFolder('ws-1', 'token'), e => e.code === 'drive_folder_not_private_root');
  // 다른 폴더(맨 위도 앱 폴더도 아닌 곳) 아래면 거절.
  const elsewhere = createDriveUpload(admin, { fetch: basketDrive([basketFolder('some-other-folder')]).fetch, log: () => {} });
  await assert.rejects(elsewhere.ensurePrivateRootFolder('ws-1', 'token'), e => e.code === 'drive_folder_not_private_root');
});

test('바구니: 처음 만들 때는 맨 위 앱 폴더 아래에 표식과 함께, 모르면 지금처럼 맨 위', async () => {
  for (const [root, parent] of [[ROOT, ROOT], [null, 'root']]) {
    const { admin } = fakeAdmin({ basket_folder_id: null, root_folder_id: root });
    const d = basketDrive([]);
    const up = createDriveUpload(admin, { fetch: d.fetch, log: () => {} });
    await up.ensurePrivateRootFolder('ws-1', 'token').catch(() => null); // 저장 단계는 가짜 admin이라 결과만 본다
    const post = JSON.parse(d.calls.find(c => c.method === 'POST').body);
    assert.deepEqual(post.parents, [parent]);
    assert.deepEqual(post.appProperties, { kptu_app_folder: 'basket' });
  }
});

// S69-41: 드라이브 검색 조건을 실제처럼 따지는 가짜(부모 + 바구니 조건: 표식 또는 알려진 이름).
function strictBasketFolders(folders, q) {
  const parents = [...q.matchAll(/'([^']+)' in parents/g)].map(m => m[1] === 'root' ? DRIVE_ROOT : m[1]);
  assert.ok(q.includes(basketFolderClause()), '바구니는 표식 또는 알려진 이름으로 찾는다');
  return folders.filter(f => parents.includes(f.parents[0]) && (f.appProperties?.kptu_app_folder === 'basket' || BASKET_NAMES.includes(f.name)));
}

test('S69-41: [한곳으로 모으기]로 이름을 바꾼 뒤에도 바구니 올리기·원본 보호가 같은 폴더를 찾는다, 표식 없는 사람 폴더는 바구니가 아니다', async () => {
  const { drive, state } = fakeDrive({ files: [{ id: 'basket-folder-01', name: 'Web2 바구니', parents: [DRIVE_ROOT] }] });
  await gatherFolders({ drive, rootId: ROOT });
  const renamed = state.files[0];
  assert.deepEqual([renamed.name, renamed.parents, renamed.appProperties], ['WORK ON+ 바구니', [ROOT], { kptu_app_folder: 'basket' }]);
  const asDrive = f => ({ ...f, mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, trashed: false, permissions: [{ type: 'user', role: 'owner' }] });
  const folders = [asDrive(renamed)];
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if ((init.method || 'GET') !== 'GET') throw new Error('바구니 찾기는 읽기만');
    if (u.pathname === '/drive/v3/files') return Response.json({ files: strictBasketFolders(folders, u.searchParams.get('q')) });
    const id = u.pathname.split('/').at(-1);
    if (id === 'photo-file-0001') return Response.json({ id, trashed: false, parents: ['basket-folder-01'] });
    const f = folders.find(x => x.id === id); return f ? Response.json(f) : Response.json({}, { status: 404 });
  };
  // 저장한 id로(이미 쓰던 사람) 같은 폴더. 저장한 id 없이 찾기로(처음)도 새로 만들지 않고 이 폴더를 고른다(저장 단계는 가짜 admin이라 쓰기만 본다).
  const up0 = createDriveUpload(fakeAdmin({ basket_folder_id: 'basket-folder-01', root_folder_id: ROOT }).admin, { fetch, log: () => {} });
  assert.equal(await up0.ensurePrivateRootFolder('ws-1', 'token'), 'basket-folder-01');
  const first = fakeAdmin({ basket_folder_id: null, root_folder_id: ROOT });
  await createDriveUpload(first.admin, { fetch, log: () => {} }).ensurePrivateRootFolder('ws-1', 'token').catch(() => null);
  assert.ok(first.writes.some(([, v]) => JSON.stringify(v).includes('basket-folder-01')), '찾은 폴더 id를 저장하려 한다(새 폴더 없음)');
  const rows = { app_workspace_members: [{ workspace_id: 'ws-1', role: 'owner' }], app_notes: [], app_drive_settings: [{ basket_folder_id: 'basket-folder-01', root_folder_id: ROOT }] };
  const deps = { readPage: async path => { const r = rows[path.split('?')[0]] || []; return { rows: r, contentRange: r.length ? `0-${r.length - 1}/${r.length}` : '*/0' }; }, driveToken: async () => 'token', fetch };
  assert.equal((await inspectBasketOriginal({ userId: 'user-1', workspaceId: 'ws-1', fileId: 'photo-file-0001' }, deps)).reason, 'private_basket_original');
  // 표식도 알려진 이름도 아닌 폴더(사람이 만든 폴더·사람이 이름을 바꾼 옛 폴더)는 바구니로 받지 않는다.
  folders[0] = asDrive({ id: 'basket-folder-01', name: '내 바구니', parents: [ROOT] });
  const up = createDriveUpload(fakeAdmin({ basket_folder_id: 'basket-folder-01', root_folder_id: ROOT }).admin, { fetch, log: () => {} });
  await assert.rejects(up.ensurePrivateRootFolder('ws-1', 'token'), e => e.code === 'drive_folder_not_private_root');
  assert.equal(isBasketFolder({ name: '내 바구니' }), false);
  assert.equal(isBasketFolder({ name: '내 바구니', appProperties: { kptu_app_folder: 'basket' } }), true);
});

test('바구니 원본 보호: 맨 위 앱 폴더 아래로 옮긴 바구니 폴더의 파일도 원본으로 지킨다', async () => {
  const rows = {
    app_workspace_members: [{ workspace_id: 'ws-1', role: 'owner' }],
    app_notes: [],
    app_drive_settings: [{ basket_folder_id: 'basket-folder-01', root_folder_id: ROOT }],
  };
  const deps = (folders) => ({
    readPage: async path => { const t = path.split('?')[0]; const r = rows[t] || []; return { rows: r, contentRange: r.length ? `0-${r.length - 1}/${r.length}` : '*/0' }; },
    driveToken: async () => 'token',
    fetch: async url => {
      const u = new URL(String(url));
      if (u.pathname === '/drive/v3/files') {
        const parents = [...u.searchParams.get('q').matchAll(/'([^']+)' in parents/g)].map(m => m[1] === 'root' ? DRIVE_ROOT : m[1]);
        return Response.json({ files: folders.filter(f => parents.includes(f.parents[0])) });
      }
      const id = u.pathname.split('/').at(-1);
      if (id === 'photo-file-0001') return Response.json({ id, trashed: false, parents: ['basket-folder-01'] });
      const f = folders.find(x => x.id === id); return f ? Response.json(f) : Response.json({}, { status: 404 });
    },
  });
  const r = await inspectBasketOriginal({ userId: 'user-1', workspaceId: 'ws-1', fileId: 'photo-file-0001' }, deps([basketFolder(ROOT)]));
  assert.deepEqual(r, { preserveDrive: true, reason: 'private_basket_original', trashed: false });
  const still = await inspectBasketOriginal({ userId: 'user-1', workspaceId: 'ws-1', fileId: 'photo-file-0001' }, deps([basketFolder(DRIVE_ROOT)]));
  assert.equal(still.reason, 'private_basket_original', '맨 위에 그대로 있어도 같은 판단');
});

// ---- 전수: 서버 코드에서 내 드라이브 맨 위('root' in parents)를 이름으로 찾는 곳이 남지 않았는지 ----
test('전수: 앱 폴더를 맨 위에서 이름으로만 찾는 곳이 없다(맨 위 조건은 app-folders.mjs 한 곳)', () => {
  const base = fileURLToPath(new URL('../supabase/functions/', import.meta.url));
  const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|mjs|js)$/.test(n) ? [p] : []; });
  const hits = [];
  for (const file of walk(base)) {
    const rel = relative(base, file).split('\\').join('/');
    const src = readFileSync(file, 'utf8');
    if (/'root' in parents/.test(src)) hits.push(rel);
  }
  // app-folders.mjs: 부모 조건·모으기 쿼리. drive-summary/core.mjs: 안쪽 문서 외 예전 맨 위 조건 한 줄(맨 위 사본 폴더는 자리 조건 없이 표식만).
  // library-files/drive-import.mjs(S69-25b): 앱 폴더를 찾는 곳이 아니라 [드라이브에서 가져오기]에서 고를 '내 드라이브' 맨 위 내 폴더 목록을 읽는 곳.
  //   앱 폴더는 이름이 아니라 저장한 id·표식으로 빼고(checkFolder·planImport), 이름은 표식 없는 옛 폴더를 빼는 보조로만 쓴다.
  assert.deepEqual(hits.sort(), ['_shared/app-folders.mjs', 'drive-summary/core.mjs', 'library-files/drive-import.mjs']);
  const summary = readFileSync(join(base, 'drive-summary/core.mjs'), 'utf8');
  assert.match(summary, /kind === 'folder' \? '' :/);
});

// ---- 화면(app/drive-folders-panel.js, S69-41: 자료실에서 내 프로필 '구글 드라이브' 칸으로 옮김): 세기 → 확인창 → 옮기기·이름 맞추기(남으면 이어서) ----
test('화면 [한곳으로 모으기]: 세기 → 확인 → 옮기기·이름 맞추기를 이어서, 결과 한 줄', async () => {
  const { gatherAppFolders, gatherAskText, gatherResultText } = await import('../app/drive-folders-panel.js');
  assert.equal(gatherAskText({ count: 0 }), null);
  assert.equal(gatherAskText({ count: 0, rename: 0 }), null);
  assert.deepEqual(gatherAskText({ count: 3, root_name: '웹2', kinds: { basket: 1, edit_backup: 2 } }), {
    text: "앱 폴더 3개를 '웹2' 아래로 모을까요?", note: '바구니 · 편집 백업 2. 삭제하지 않고 자리·이름만 바꿔요. 링크는 그대로예요. 내가 만든 폴더와 직접 바꾼 이름은 그대로 둬요.',
  });
  assert.equal(gatherAskText({ count: 3, rename: 5, root_name: '웹2', kinds: {} }).text, "앱 폴더 3개를 '웹2' 아래로 모으고, 옛 이름 5개를 새 이름으로 바꿀까요?");
  assert.equal(gatherAskText({ count: 0, rename: 2, root_name: 'WORK ON+', kinds: {} }).text, '앱 폴더의 옛 이름 2개를 새 이름으로 바꿀까요?');
  assert.match(gatherAskText({ count: 1, root_name: 'WORK ON+', root_new: true, kinds: {} }).note, /'WORK ON\+' 폴더를 새로 만들어/);
  const calls = [], said = [];
  const answers = [
    { ok: true, root_name: '웹2', count: 12, kinds: { basket: 12 }, rename: 13 },
    { ok: true, root_name: '웹2', moved: 10, failed: 0, left: 2, renamed: 0, rename_failed: 0, rename_left: 0 },
    { ok: true, root_name: 'WORK ON+', moved: 2, failed: 0, left: 0, renamed: 10, rename_failed: 0, rename_left: 3 },
    { ok: true, root_name: 'WORK ON+', moved: 0, failed: 0, left: 0, renamed: 3, rename_failed: 0, rename_left: 0 },
  ];
  const api = async (path, init) => { calls.push([path, init]); return answers.shift(); };
  const r = await gatherAppFolders({ api, ask: async () => true, say: (t, o) => said.push([t, !!o?.error]) });
  assert.deepEqual(r, { moved: 12, failed: 0, left: 0, renamed: 13, renameFailed: 0, renameLeft: 0, where: 'WORK ON+' });
  assert.deepEqual(calls.map(c => [c[0], c[1].method, JSON.stringify(c[1].body)]), [
    ['/functions/v1/workspace-drive?action=gather-folders', 'POST', '{"dry_run":true}'],
    ['/functions/v1/workspace-drive?action=gather-folders', 'POST', '{}'],
    ['/functions/v1/workspace-drive?action=gather-folders', 'POST', '{}'],
    ['/functions/v1/workspace-drive?action=gather-folders', 'POST', '{}'],
  ]);
  assert.deepEqual(said, [["앱 폴더 12개를 'WORK ON+' 아래로 모았어요 · 이름 13개를 새 이름으로 바꿨어요.", false]]);
  assert.deepEqual(gatherResultText({ renamed: 2, renameFailed: 1 }), { text: '이름 2개를 새 이름으로 바꿨어요 · 1개는 하지 못했어요 — 다시 눌러 주세요.', error: true });
  // 취소하면 옮기지 않는다. 없으면 확인창 없이 한 줄.
  const c2 = [];
  assert.equal(await gatherAppFolders({ api: async (p, i) => { c2.push(i.body); return { count: 2, root_name: '웹2', kinds: {} }; }, ask: async () => false, say: () => {} }), null);
  assert.deepEqual(c2, [{ dry_run: true }]);
  const s3 = [];
  assert.equal(await gatherAppFolders({ api: async () => ({ count: 0, rename: 0 }), ask: async () => { throw new Error('ask'); }, say: t => s3.push(t) }), null);
  assert.match(s3[0], /이미 모아 뒀어요/);
  // 서버 실패는 오류 한 줄.
  const s4 = [];
  assert.equal(await gatherAppFolders({ api: async () => { throw new Error('x'); }, ask: async () => true, say: (t, o) => s4.push(!!o?.error) }), null);
  assert.deepEqual(s4, [true]);
});

test('화면: 자료실 위 줄에는 [앱 폴더 모으기]가 없고(저장 위치·열기만), 내 프로필 칸이 그 기능의 유일한 자리', async () => {
  const code = f => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code('library-drive-line.js'), /lu-drive-gather|앱 폴더 모으기|gather-folders/);
  const { driveLineHtml } = await import('../app/library-drive-line.js');
  const html = driveLineHtml({ url: 'https://drive.google.com/drive/folders/abcdefghij12', path: ['웹2', '자료실'] }, v => String(v));
  assert.match(html, /열기 ↗/);
  assert.doesNotMatch(html, /<button/);
  const { driveFoldersHtml, cleanPlan } = await import('../app/drive-folders-panel.js');
  const p = cleanPlan({ ok: true, root_name: 'WORK ON+', root_url: 'https://drive.google.com/drive/folders/abcdefghij12', count: 0, rename: 0 });
  assert.match(driveFoldersHtml(p), /앱이 쓰는 드라이브 폴더:.*내 드라이브 › WORK ON\+.*열기 ↗.*모아 둠/);
  assert.match(driveFoldersHtml({ ...p, rename: 1 }), /data-dfp-gather[^>]*>한곳으로 모으기</);
  assert.equal(cleanPlan({ ok: true, root_name: 'x', root_url: 'https://evil.example/drive/folders/abcdefghij12', count: 0 }).url, null, '드라이브 주소가 아니면 링크를 그리지 않는다');
  assert.equal(cleanPlan(null), null);
  const users = readdirSync(fileURLToPath(new URL('../app/', import.meta.url))).filter(n => /\.(js|mjs)$/.test(n))
    .filter(n => code(n).includes('gather-folders'));
  assert.deepEqual(users, ['drive-folders-panel.js'], '모으기 서버 부름은 이 칸 한 곳');
});
