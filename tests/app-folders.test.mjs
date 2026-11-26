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
import { GATHER_MAX_MOVES, GatherError, NEW_ROOT_ROUNDS, RENAME_MAX, gatherFolders, gatherIntoNewRoot, parseGatherRequest } from '../supabase/functions/_shared/gather-folders.mjs';
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
      // S69-42: 이름을 바꾸기 전 '같은 자리에 같은 이름 폴더가 있나'(sameNameQuery). 맨 위 앱 폴더(ROOT)도 내 드라이브 맨 위에 있는 폴더로 본다.
      const same = /^name = '(.+)' and '([^']+)' in parents and mimeType = 'application\/vnd.google-apps.folder' and trashed = false$/.exec(q);
      if (same) {
        const all = [...state.files, { id: ROOT, name: state.rootName, parents: [DRIVE_ROOT] }];
        return Response.json({ files: all.filter(f => !f.trashed && f.name === same[1] && f.parents[0] === same[2]).map(f => ({ id: f.id })) });
      }
      assert.equal(q, renameQuery(ROOT), '이름 맞추기 쿼리는 맨 위·맨 위 앱 폴더 바로 아래만');
      return Response.json({ files: state.files.filter(f => !f.trashed && [DRIVE_ROOT, ROOT].includes(f.parents[0]) && gatherKindOf(f)).map(view) });
    }
    const id = decodeURIComponent(u.pathname.split('/').at(-1));
    if (method === 'GET' && id === ROOT) return Response.json({ id: ROOT, name: state.rootName, parents: [DRIVE_ROOT], mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, trashed: false, permissions: rootPerms });
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
  assert.deepEqual(plan, { root_name: '웹2', root_url: ROOT_URL, count: 4, kinds: { basket: 1, record_backup: 1, edit_backup: 1, copy: 1 }, rename: 5, rename_dup: 0 });
  assert.equal(state.calls.some(c => c.method === 'PATCH'), false, '세기는 아무것도 바꾸지 않는다');
  const r = await gatherFolders({ drive, rootId: ROOT });
  assert.deepEqual(r, { root_name: 'WORK ON+', root_url: ROOT_URL, moved: 4, failed: 0, left: 0, kinds: { basket: 1, record_backup: 1, edit_backup: 1, copy: 1 }, renamed: 5, rename_failed: 0, rename_left: 0, rename_dup: 0 });
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
  assert.deepEqual(again, { root_name: 'WORK ON+', root_url: ROOT_URL, moved: 0, failed: 0, left: 0, kinds: {}, renamed: 0, rename_failed: 0, rename_left: 0, rename_dup: 0 });
  assert.deepEqual(await gatherFolders({ drive, rootId: ROOT, dryRun: true }), { root_name: 'WORK ON+', root_url: ROOT_URL, count: 0, kinds: {}, rename: 0, rename_dup: 0 });
});

test('[이름 맞추기] 사람이 바꾼 이름(표식 있는 앱 폴더·맨 위 앱 폴더)은 그대로, 이미 안에 있는 옛 이름 폴더는 바꾼다, 실패는 세기만', async () => {
  const { drive, state } = fakeDrive({ rootName: '내 업무 폴더', patchFail: new Set(['edit-backup-0002']), files: [
    { id: 'record-backup-02', name: '내가 정한 백업', parents: [ROOT], appProperties: { kptu_backup: 'root' } },
    { id: 'basket-folder-02', name: 'Web2 바구니', parents: [ROOT], appProperties: { kptu_app_folder: 'basket' } },
    { id: 'edit-backup-0002', name: 'Web2 편집 백업', parents: [ROOT], appProperties: { kptu_app_folder: 'edit_backup' } },
    { id: 'copy-folder-0002', name: '노조+ 읽기용 사본', parents: [ROOT], appProperties: { kptu_summary: 'folder', kptu_workspace: 'other' } },
  ] });
  // 세기는 바꿀 수 있는지만 본다(실패할 PATCH는 모름) — 바구니·편집 백업 둘.
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
  // S69-42: 같은 자리(맨 위 앱 폴더 아래)에 바구니가 여럿이면 하나만 새 이름이 되고, 나머지는 합치지 않고 그대로(rename_dup).
  // 옮기지 못한 1개는 다른 자리(내 드라이브 맨 위)라 새 이름으로 바뀐다.
  assert.equal(second.renamed + second.rename_failed + second.rename_dup + second.rename_left, 1 + GATHER_MAX_MOVES + 3, '맨 위 앱 폴더 1 + 바구니 13개');
  assert.equal(second.rename_left, GATHER_MAX_MOVES + 3 - RENAME_MAX);
  assert.ok(second.rename_dup >= 1, '같은 자리 두 번째 바구니부터는 같은 이름이 있어 그대로');
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

// S69-42(명진 11/24 15:49 "중단없이 꾸준히 … 폴더명을 바꿔서 기능이 고장나면 안되고"): 바구니를 쓸 때 옛 이름('Web2 바구니')이면 이름만 새 이름으로.
test('S69-42: 바구니를 쓸 때 옛 이름은 새 이름으로(같은 id, 안 파일 그대로), 같은 자리에 새 이름이 있으면 그대로, 바꾼 뒤에도 같은 폴더', async () => {
  const world = (extra = []) => {
    const folders = [{ ...basketFolder(ROOT), appProperties: { kptu_app_folder: 'basket' } }, ...extra];
    const calls = [];
    const fetch = async (url, init = {}) => {
      const u = new URL(String(url)), method = init.method || 'GET';
      calls.push({ method, path: u.pathname, body: init.body, auth: init.headers?.Authorization });
      if (method === 'GET' && u.pathname === '/drive/v3/files') {
        const q = u.searchParams.get('q');
        const same = /^name = '(.+)' and '([^']+)' in parents and /.exec(q);
        if (same) return Response.json({ files: folders.filter(f => f.name === same[1] && f.parents[0] === same[2]).map(f => ({ id: f.id })) });
        return Response.json({ files: strictBasketFolders(folders, q) });
      }
      const id = u.pathname.split('/').at(-1), f = folders.find(x => x.id === id);
      if (method === 'GET') return f ? Response.json(f) : Response.json({}, { status: 404 });
      if (method === 'PATCH' && f) {
        const b = JSON.parse(init.body);
        assert.deepEqual(Object.keys(b), ['name'], '이름만 바꾼다(부모·휴지통·권한 그대로)');
        f.name = b.name; return Response.json({ id, name: f.name });
      }
      throw new Error('unexpected ' + method + ' ' + url);
    };
    return { folders, calls, fetch };
  };
  const settings = { basket_folder_id: 'basket-folder-01', root_folder_id: ROOT };
  const w = world();
  const up = createDriveUpload(fakeAdmin(settings).admin, { fetch: w.fetch, log: () => {} });
  assert.equal(await up.ensurePrivateRootFolder('ws-1', 'token'), 'basket-folder-01');
  assert.equal(w.folders[0].name, 'WORK ON+ 바구니');
  assert.deepEqual(w.folders[0].parents, [ROOT], '자리 그대로');
  assert.ok(w.calls.filter(c => c.method === 'PATCH').every(c => c.auth === 'Bearer token'), '내 토큰으로만');
  // 바꾼 뒤에도 같은 폴더(저장한 id), 이름을 다시 바꾸지 않는다.
  assert.equal(await up.ensurePrivateRootFolder('ws-1', 'token'), 'basket-folder-01');
  assert.equal(w.calls.filter(c => c.method === 'PATCH').length, 1);
  // 같은 자리에 'WORK ON+ 바구니'(사람이 만든 폴더)가 이미 있으면 합치지 않고 옛 이름 그대로 쓴다.
  const d = world([{ ...basketFolder(ROOT, 'person-made-0001'), name: 'WORK ON+ 바구니' }]);
  const up2 = createDriveUpload(fakeAdmin(settings).admin, { fetch: d.fetch, log: () => {} });
  assert.equal(await up2.ensurePrivateRootFolder('ws-1', 'token'), 'basket-folder-01');
  assert.equal(d.folders[0].name, 'Web2 바구니');
  assert.equal(d.calls.some(c => c.method === 'PATCH'), false);
  // 드라이브가 이름 바꾸기를 거절해도 바구니는 그대로 쓴다.
  const broken = world();
  const fetchFail = async (url, init = {}) => (init.method === 'PATCH' ? Response.json({}, { status: 500 }) : broken.fetch(url, init));
  const up3 = createDriveUpload(fakeAdmin(settings).admin, { fetch: fetchFail, log: () => {} });
  assert.equal(await up3.ensurePrivateRootFolder('ws-1', 'token'), 'basket-folder-01');
  assert.equal(broken.folders[0].name, 'Web2 바구니');
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
  // (S70-73: [드라이브에서 가져오기]의 '내 드라이브' 맨 위 폴더 목록(library-files/drive-import.mjs)은 지웠다 — 자동 등록은 자료실 나무만 훑는다.)
  assert.deepEqual(hits.sort(), ['_shared/app-folders.mjs', 'drive-summary/core.mjs']);
  const summary = readFileSync(join(base, 'drive-summary/core.mjs'), 'utf8');
  assert.match(summary, /kind === 'folder' \? '' :/);
});

// ---- S70-29(2026-11-25 명진 '다 없애 1회용 기능'·조사 문서 7번 '자동으로 바꿈'): [한곳으로 모으기] 버튼 대신 서버가 맨 위 앱 폴더를 처음 만들 때 저절로 ----
test('맨 위 앱 폴더를 처음 만들 때 저절로: gatherIntoNewRoot가 앱 폴더를 옮기고 옛 이름을 맞춘다(이어서, 사람 폴더는 그대로), 실패해도 throw 없음', async () => {
  const { drive, state } = fakeDrive({ files: SCENE() });
  const r = await gatherIntoNewRoot({ drive, rootId: ROOT });
  assert.deepEqual(r, { moved: 4, failed: 0, renamed: 5 });
  const byId = Object.fromEntries(state.files.map(f => [f.id, f]));
  for (const id of ['basket-folder-01', 'record-backup-01', 'edit-backup-0001', 'copy-folder-0001']) assert.deepEqual(byId[id].parents, [ROOT], id);
  for (const id of ['telegram-folder1', 'person-folder-01']) assert.deepEqual(byId[id].parents, [DRIVE_ROOT], '앱 밖·사람 폴더는 그대로: ' + id);
  // 10개 넘게 남으면 이어서(한 번에 GATHER_MAX_MOVES개씩, NEW_ROOT_ROUNDS번까지).
  const many = Array.from({ length: GATHER_MAX_MOVES + 3 }, (_, i) => ({ id: `edit-backup-${String(i).padStart(4, '0')}x`, name: '노조+ 편집 백업', parents: [DRIVE_ROOT], appProperties: { kptu_app_folder: 'edit_backup' } }));
  const big = fakeDrive({ files: many });
  const r2 = await gatherIntoNewRoot({ drive: big.drive, rootId: ROOT });
  assert.equal(r2.moved, GATHER_MAX_MOVES + 3);
  assert.ok(NEW_ROOT_ROUNDS >= 2);
  // 맨 위 앱 폴더 확인 실패·잘못된 값이면 조용히 null(올리기 같은 원래 일은 멈추지 않음).
  assert.equal(await gatherIntoNewRoot({ drive: async () => { throw new Error('down'); }, rootId: ROOT }), null);
  assert.equal(await gatherIntoNewRoot({ drive, rootId: 'root' }), null);
  assert.equal(await gatherIntoNewRoot({ drive: null, rootId: ROOT }), null);
});

test('서버가 맨 위 앱 폴더를 새로 만드는 곳 모두 만든 바로 뒤 gatherIntoNewRoot를 부른다(그 밖에는 부르지 않음)', () => {
  const base = fileURLToPath(new URL('../supabase/functions/', import.meta.url));
  const read = f => readFileSync(join(base, f), 'utf8');
  for (const f of ['workspace-drive/index.ts', 'library-files/index.ts']) {
    const src = read(f);
    assert.match(src, /root_folder_id:d\.id,updated_at:new Date\(\)\.toISOString\(\)\}\);await gatherIntoNewRoot\(\{drive:tokenDrive\(token\),rootId:d\.id\}\);return d\.id/, f);
    assert.match(src, /import \{[^}]*gatherIntoNewRoot[^}]*\} from '\.\.\/_shared\/gather-folders\.mjs'/, f);
  }
  // S71-02: 회의 두 함수(meeting-files·meeting-transcribe)는 드라이브 자리 규칙 _shared/meeting-drive-place.mjs 한 곳이 맨 위 앱 폴더를 만들고
  // 바로 뒤 부르는 쪽이 넣은 gather(= gatherIntoNewRoot)를 부른다(시험 tests/security/meeting-drive-place.test.mjs '새 사용자').
  const place = read('_shared/meeting-drive-place.mjs');
  assert.match(place, /root = await createFolder\(ctx\.drive, ROOT_FOLDER_NAME, null\);\n\s*await ctx\.db\.save\(\{ root_folder_id: root \}\);\n\s*try \{ await ctx\.gather\?\.\(root\); \}/);
  assert.match(read('meeting-files/index.ts'), /gather:\(rootId:string\)=>gatherIntoNewRoot\(\{drive,rootId\}\)/);
  assert.match(read('meeting-transcribe/index.ts'), /gather: \(rootId: string\) => gatherIntoNewRoot\(\{ drive, rootId \}\)/);
  // 맨 위 앱 폴더(root_folder_id)를 새로 적는 곳은 이 셋뿐 — 다른 곳이 생기면 이 시험이 알린다.
  const writers = [];
  const walk = d => { for (const n of readdirSync(join(base, d), { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walk(p); else if (/\.(ts|mjs)$/.test(n.name) && /upsert\(\{\s*workspace_id:\s*workspaceId,\s*root_folder_id|save\(\{\s*root_folder_id/.test(read(p))) writers.push(p); } };
  walk('.');
  assert.deepEqual(writers.sort(), ['_shared/meeting-drive-place.mjs', 'library-files/index.ts', 'workspace-drive/index.ts']);
});

test('화면: 자료실(S71-46 위치 줄 없음)·내 프로필 칸 모두 [한곳으로 모으기] 버튼이 없고(S70-29), 내 프로필 칸은 위치와 [열기 ↗]만', async () => {
  const code = f => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code('library-drive-line.js'), /lu-drive-gather|앱 폴더 모으기|gather-folders/);
  // S71-46: 자료실 저장 위치 줄은 없앴다(드라이브 열기는 자료실 ⋯ — 시험 tests/library-drive-place.test.mjs).
  const lineMod = await import('../app/library-drive-line.js');
  assert.equal(lineMod.driveLineHtml, undefined);
  assert.equal(lineMod.noteLineHtml('', v => String(v)), '', '평소엔 줄 없음');
  const mod = await import('../app/drive-folders-panel.js');
  for (const name of ['gatherAppFolders', 'gatherAskText', 'gatherResultText']) assert.equal(mod[name], undefined, name);
  const { driveFoldersHtml, cleanPlan } = mod;
  const p = cleanPlan({ ok: true, root_name: 'WORK ON+', root_url: 'https://drive.google.com/drive/folders/abcdefghij12', count: 3, rename: 2 });
  assert.match(driveFoldersHtml(p), /앱이 쓰는 드라이브 폴더:.*내 드라이브 › WORK ON\+.*열기 ↗/);
  assert.doesNotMatch(driveFoldersHtml(p), /<button|data-dfp-gather|한곳으로 모으기|모아 둠/, '모을 것이 남아도 버튼 없음');
  assert.match(driveFoldersHtml(cleanPlan({ ok: true, root_name: 'WORK ON+', count: 0, rename: 0, rename_dup: 2 })), /class="dfp-dup"[^>]*>같은 이름 있어 그대로 2</, 'S69-42: 같은 이름이 있어 둔 것은 작게 한 마디');
  assert.doesNotMatch(driveFoldersHtml(p), /dfp-dup/);
  assert.equal(cleanPlan({ ok: true, root_name: 'x', root_url: 'https://evil.example/drive/folders/abcdefghij12', count: 0 }).url, null, '드라이브 주소가 아니면 링크를 그리지 않는다');
  assert.equal(cleanPlan(null), null);
  const users = readdirSync(fileURLToPath(new URL('../app/', import.meta.url))).filter(n => /\.(js|mjs)$/.test(n))
    .filter(n => code(n).includes('gather-folders'));
  assert.deepEqual(users, ['drive-folders-panel.js'], '세기(위치 읽기)는 이 칸 한 곳');
  assert.doesNotMatch(code('drive-folders-panel.js'), /body: \{\}|method: 'POST', body: \{(?!dry_run: true\})/, '화면은 세기(dry_run:true)만 보낸다');
});
