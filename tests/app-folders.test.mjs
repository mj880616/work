// S69-22(명진 11/24 08:54 "앱과 자동 수집이 쓰고 있는것좀 한 폴더에 몰아두면 안되니"):
// 앱 드라이브 폴더를 맨 위 앱 폴더 한 곳 아래로 모으기 — 찾기는 저장한 id·표식, [모으기]는 부모만 바꿈(가짜 드라이브, 네트워크 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_FOLDER_MARK, GATHER_KINDS, NOT_GATHERED, createParentFor, gatherKindOf, gatherQuery, isDriveId, markFor, placedAtTop, privateOwnedFolder, topParents, topParentsClause,
} from '../supabase/functions/_shared/app-folders.mjs';
import { GATHER_MAX_MOVES, GatherError, gatherFolders, parseGatherRequest } from '../supabase/functions/workspace-drive/gather-folders.mjs';
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

// 가짜 드라이브: 맨 위(DRIVE_ROOT)·맨 위 앱 폴더(ROOT)와 그 안 폴더들. 목록 쿼리는 'root' in parents만(모으기 쿼리).
function fakeDrive({ files, rootPerms = [{ type: 'user', role: 'owner' }], patchFail = new Set() } = {}) {
  const state = { files: files.map(f => ({ ownedByMe: true, trashed: false, ...f })), calls: [] };
  const drive = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET';
    state.calls.push({ method, path: u.pathname, search: u.searchParams, body: init.body });
    if (method === 'GET' && u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q');
      assert.equal(q, gatherQuery());
      const list = state.files.filter(f => !f.trashed && f.parents[0] === DRIVE_ROOT && gatherKindOf(f));
      return Response.json({ files: list.map(f => ({ id: f.id, name: f.name, parents: f.parents, ownedByMe: f.ownedByMe, appProperties: f.appProperties })) });
    }
    const id = decodeURIComponent(u.pathname.split('/').at(-1));
    if (method === 'GET' && id === ROOT) return Response.json({ id: ROOT, name: '웹2', mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, trashed: false, permissions: rootPerms });
    if (method === 'PATCH') {
      const f = state.files.find(x => x.id === id);
      if (!f || patchFail.has(id)) return Response.json({ error: {} }, { status: 403 });
      assert.equal(u.searchParams.get('addParents'), ROOT);
      assert.equal(u.searchParams.get('removeParents'), f.parents[0]);
      const b = JSON.parse(init.body);
      assert.deepEqual(Object.keys(b).filter(k => k !== 'appProperties'), [], '부모 말고는 표식만 바꾼다(이름·휴지통 안 건드림)');
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
];

test('[모으기] 세기 → 옮기기: 앱 폴더 4개만 맨 위 앱 폴더 아래로(부모만 바꿈), 표식 없던 옛 폴더는 표식을 붙인다', async () => {
  const { drive, state } = fakeDrive({ files: SCENE() });
  const plan = await gatherFolders({ drive, rootId: ROOT, dryRun: true });
  assert.deepEqual(plan, { root_name: '웹2', count: 4, kinds: { basket: 1, record_backup: 1, edit_backup: 1, copy: 1 } });
  assert.equal(state.calls.some(c => c.method === 'PATCH'), false, '세기는 아무것도 바꾸지 않는다');
  const r = await gatherFolders({ drive, rootId: ROOT });
  assert.deepEqual(r, { root_name: '웹2', moved: 4, failed: 0, left: 0, kinds: { basket: 1, record_backup: 1, edit_backup: 1, copy: 1 } });
  const byId = Object.fromEntries(state.files.map(f => [f.id, f]));
  for (const id of ['basket-folder-01', 'record-backup-01', 'edit-backup-0001', 'copy-folder-0001']) assert.deepEqual(byId[id].parents, [ROOT], id);
  assert.deepEqual(byId['telegram-folder1'].parents, [DRIVE_ROOT], '앱 코드 밖 폴더는 그대로');
  assert.equal(byId['basket-folder-01'].appProperties.kptu_app_folder, 'basket');
  assert.equal(byId['edit-backup-0001'].appProperties.kptu_app_folder, 'edit_backup');
  assert.equal(byId['edit-backup-0001'].name, '노조+ 편집 백업', '이름은 바꾸지 않는다');
  assert.equal(byId['record-backup-01'].appProperties.kptu_app_folder, undefined, '기존 표식 폴더에는 새 표식을 붙이지 않는다');
  assert.equal(state.calls.some(c => c.method === 'DELETE' || /trashed/.test(c.body || '')), false, '지우지 않는다');
  // 이어서 다시 눌러도 이미 옮긴 것은 다시 찾지 않는다.
  const again = await gatherFolders({ drive, rootId: ROOT });
  assert.deepEqual(again, { root_name: '웹2', moved: 0, failed: 0, left: 0, kinds: {} });
});

test('[모으기] 한 번에 정해진 개수까지, 남으면 left — 다시 부르면 이어서 한다. 실패는 세기만', async () => {
  const files = Array.from({ length: GATHER_MAX_MOVES + 3 }, (_, i) => ({ id: `basket-extra-${String(i).padStart(3, '0')}`, name: 'Web2 바구니', parents: [DRIVE_ROOT] }));
  const { drive } = fakeDrive({ files, patchFail: new Set(['basket-extra-000']) });
  const first = await gatherFolders({ drive, rootId: ROOT });
  assert.deepEqual([first.moved, first.failed, first.left], [GATHER_MAX_MOVES - 1, 1, 3]);
  const second = await gatherFolders({ drive, rootId: ROOT });
  assert.deepEqual([second.moved, second.failed, second.left], [3, 1, 0]);
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
  const { drive, state } = fakeDrive({ files: [
    { id: ROOT, name: 'Web2 바구니', parents: [DRIVE_ROOT] },
    { id: 'not-mine-folder1', name: 'Web2 바구니', parents: [DRIVE_ROOT], ownedByMe: false },
  ] });
  const r = await gatherFolders({ drive, rootId: ROOT });
  assert.equal(r.moved, 0);
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

// ---- 화면(app/library-drive-line.js): 세기 → 확인창 → 옮기기(남으면 이어서). 자동으로는 돌지 않는다 ----
test('화면 [앱 폴더 모으기]: 세기 → 확인 → 옮기기를 이어서, 결과 몇 개를 알린다', async () => {
  const { gatherAppFolders, gatherAskText } = await import('../app/library-drive-line.js');
  assert.equal(gatherAskText({ count: 0 }), null);
  assert.deepEqual(gatherAskText({ count: 3, root_name: '웹2', kinds: { basket: 1, edit_backup: 2 } }), {
    text: "앱 폴더 3개를 '웹2' 아래로 모을까요?", note: '바구니 · 편집 백업 2. 삭제하지 않고 자리만 옮겨요. 링크는 그대로예요.',
  });
  assert.match(gatherAskText({ count: 1, root_name: 'WORK ON+', root_new: true, kinds: {} }).note, /'WORK ON\+' 폴더를 새로 만들어/);
  const calls = [], said = [];
  const answers = [{ ok: true, root_name: '웹2', count: 12, kinds: { basket: 12 } }, { ok: true, root_name: '웹2', moved: 10, failed: 0, left: 2 }, { ok: true, root_name: '웹2', moved: 2, failed: 0, left: 0 }];
  const api = async (path, init) => { calls.push([path, init]); return answers.shift(); };
  const r = await gatherAppFolders({ api, ask: async () => true, say: (t, o) => said.push([t, !!o?.error]) });
  assert.deepEqual(r, { moved: 12, failed: 0, left: 0 });
  assert.deepEqual(calls.map(c => [c[0], c[1].method, JSON.stringify(c[1].body)]), [
    ['/functions/v1/workspace-drive?action=gather-folders', 'POST', '{"dry_run":true}'],
    ['/functions/v1/workspace-drive?action=gather-folders', 'POST', '{}'],
    ['/functions/v1/workspace-drive?action=gather-folders', 'POST', '{}'],
  ]);
  assert.deepEqual(said, [["앱 폴더 12개를 '웹2' 아래로 모았어요.", false]]);
  // 취소하면 옮기지 않는다. 없으면 확인창 없이 한 줄.
  const c2 = [];
  assert.equal(await gatherAppFolders({ api: async (p, i) => { c2.push(i.body); return { count: 2, root_name: '웹2', kinds: {} }; }, ask: async () => false, say: () => {} }), null);
  assert.deepEqual(c2, [{ dry_run: true }]);
  const s3 = [];
  assert.equal(await gatherAppFolders({ api: async () => ({ count: 0 }), ask: async () => { throw new Error('ask'); }, say: t => s3.push(t) }), null);
  assert.match(s3[0], /모을 앱 폴더가 없어요/);
  // 서버 실패는 오류 한 줄.
  const s4 = [];
  assert.equal(await gatherAppFolders({ api: async () => { throw new Error('x'); }, ask: async () => true, say: (t, o) => s4.push(!!o?.error) }), null);
  assert.deepEqual(s4, [true]);
});
