import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planImport, checkAddable, checkFolder, pickableFolders, parseImportRequest, registeredIds, appFolderIdsFrom, createDriveImport, isPersonalName, scopeCanList, ADD_MAX,
} from '../../supabase/functions/library-files/drive-import.mjs';

// S69-25 LIB-드라이브에서가져오기: 내 드라이브에만 있고 자료실에 없는 파일만 목록으로, 등록은 복사 없이 같은 드라이브 id로. 네트워크 없음.
const id = s => (s + '__________').slice(0, 12);
const F = 'application/vnd.google-apps.folder';
const file = (name, over = {}) => ({ id: id(name.replace(/[^A-Za-z0-9]/g, 'x')), name, mimeType: 'application/pdf', size: '100', modifiedTime: '2026-11-01T00:00:00Z', parents: [id('root')], ...over });
const folder = (key, name, parent = id('root'), over = {}) => ({ id: id(key), name, mimeType: F, parents: [parent], ...over });

test('planImport: 자료실에 없는 파일만, 앱 폴더·스크립트·바로가기·0바이트·폴더 자체는 뺀다', () => {
  const files = [
    folder('work', '업무'), folder('sub', '회의', id('work')),
    file('a.pdf', { parents: [id('sub')] }),
    file('registered.pdf', { id: id('reg') }),
    file('prev.pdf', { id: id('prev') }),
    folder('basket', 'Web2 바구니'), file('basket.pdf', { parents: [id('basket')] }),
    folder('backup', '아무 이름', id('root'), { appProperties: { kptu_backup: 'root' } }), folder('day', '2026-11-01', id('backup')),
    file('deep.txt', { mimeType: 'text/plain', parents: [id('day')] }),
    folder('meet', '회의 폴더'), file('rec.m4a', { mimeType: 'audio/mp4', parents: [id('meet')] }),
    file('marked.pdf', { appProperties: { kptu_summary: '1' } }),
    file('script', { mimeType: 'application/vnd.google-apps.script', size: undefined }),
    file('short', { mimeType: 'application/vnd.google-apps.shortcut', size: undefined }),
    file('form', { mimeType: 'application/vnd.google-apps.form', size: undefined }),
    file('empty.txt', { size: '0' }),
    file('memo doc', { mimeType: 'application/vnd.google-apps.document', size: undefined }),
    file('editbak.hwp', { parents: [id('eb')] }), folder('eb', 'WORK ON+ 편집 백업'),
    file('shared.pdf', { parents: [id('others')] }),
  ];
  const registered = registeredIds([{ file_id: id('reg'), previous_files: [{ file_id: id('prev') }] }]);
  const appFolderIds = appFolderIdsFrom({ workspace_id: 'w', root_folder_id: id('work'), library_folder_id: id('lib'), meetings_folder_id: id('meet'), basket_folder_id: null });
  const r = planImport({ files, registered, appFolderIds, rootId: id('root') });
  const names = r.items.map(x => x.name).sort();
  assert.deepEqual(names, ['a.pdf', 'memo doc', 'shared.pdf']);
  const a = r.items.find(x => x.name === 'a.pdf');
  assert.equal(a.path, '내 드라이브 › 업무 › 회의');
  assert.equal(a.kind, 'file'); assert.equal(a.size, 100); assert.equal(a.modified, '2026-11-01');
  assert.equal(r.items.find(x => x.name === 'memo doc').kind, 'link');
  assert.equal(r.items.find(x => x.name === 'memo doc').size, null);
  assert.equal(r.items.find(x => x.name === 'shared.pdf').path, '다른 사람 폴더');
  assert.deepEqual(r.skipped, { registered: 2, app: 5, secret: 0, not_file: 3, empty: 1 });
  assert.equal(r.total, 3); assert.equal(r.more, false);
});

test('자료실·맨 위 폴더는 앱 폴더로 빼지 않는다(그 안의 미등록 파일은 가져올 대상)', () => {
  const ids = appFolderIdsFrom({ root_folder_id: id('r1'), library_folder_id: id('l1'), meetings_folder_id: id('m1'), basket_folder_id: id('b1'), workspace_id: 'x' });
  assert.deepEqual([...ids].sort(), [id('b1'), id('m1')].sort());
});

test('개인 서류로 보이는 이름·사진은 표시만(목록에는 나옴)', () => {
  for (const n of ['주민등록증 사본.jpg', '운전면허증.pdf', '여권 스캔.png', 'Passport.pdf', '가족관계증명서.pdf', '통장사본.pdf']) assert.equal(isPersonalName(n), true, n);
  for (const n of ['2026 교섭 요구안.hwp', '회의록.docx']) assert.equal(isPersonalName(n), false, n);
  const r = planImport({ files: [file('여권.pdf'), file('photo.jpg', { mimeType: 'image/jpeg' })], rootId: id('root') });
  assert.equal(r.items.find(x => x.name === '여권.pdf').personal, true);
  assert.equal(r.items.find(x => x.name === 'photo.jpg').media, true);
});

test('checkAddable: 화면이 보낸 id를 믿지 않고 다시 확인', () => {
  const ctx = { registered: new Set([id('reg')]), appFolderIds: new Set([id('basket')]) };
  const ok = file('ok.pdf', { ownedByMe: true, trashed: false });
  assert.equal(checkAddable(ok, ctx), 'ok');
  assert.equal(checkAddable({ ...ok, id: id('reg') }, ctx), 'exists');
  assert.equal(checkAddable({ ...ok, ownedByMe: false }, ctx), 'unreadable');
  assert.equal(checkAddable({ ...ok, trashed: true }, ctx), 'unreadable');
  assert.equal(checkAddable({ ...ok, size: '0' }, ctx), 'unreadable');
  assert.equal(checkAddable({ ...ok, mimeType: 'application/vnd.google-apps.script' }, ctx), 'unreadable');
  assert.equal(checkAddable({ ...ok, parents: [id('basket')] }, ctx), 'unreadable');
  assert.equal(checkAddable({ ...ok, appProperties: { kptu_backup: 'file' } }, ctx), 'unreadable');
  assert.equal(checkAddable(null, ctx), 'unreadable');
});

test('parseImportRequest: 모양이 정확할 때만(S69-25b: 목록·가져오기는 고른 폴더 id가 꼭 있어야)', () => {
  const D = id('pick');
  assert.deepEqual(parseImportRequest({ action: 'drive-import-folders' }), { action: 'folders' });
  assert.equal(parseImportRequest({ action: 'drive-import-folders', parent: 'root' }), null);
  assert.deepEqual(parseImportRequest({ action: 'drive-import-list', folder_id: D }), { action: 'list', folderId: D });
  assert.equal(parseImportRequest({ action: 'drive-import-list' }), null, '드라이브 전체 목록은 더 없음');
  assert.equal(parseImportRequest({ action: 'drive-import-list', folder_id: 'root' }), null);
  assert.equal(parseImportRequest({ action: 'drive-import-list', folder_id: "x' or 'a' in parents" }), null);
  assert.equal(parseImportRequest({ action: 'drive-import-list', folder_id: D, workspace_id: 'x' }), null);
  assert.deepEqual(parseImportRequest({ action: 'drive-import-add', folder_id: D, file_ids: [id('a')] }), { action: 'add', folderId: D, ids: [id('a')] });
  assert.equal(parseImportRequest({ action: 'drive-import-add', file_ids: [id('a')] }), null);
  assert.equal(parseImportRequest({ action: 'drive-import-add', folder_id: D, file_ids: [] }), null);
  assert.equal(parseImportRequest({ action: 'drive-import-add', folder_id: D, file_ids: [id('a'), id('a')] }), null);
  assert.equal(parseImportRequest({ action: 'drive-import-add', folder_id: D, file_ids: ['../x'] }), null);
  assert.equal(parseImportRequest({ action: 'drive-import-add', folder_id: D, file_ids: Array.from({ length: ADD_MAX + 1 }, (_, i) => id('f' + i)) }), null);
  assert.equal(parseImportRequest({ action: 'drive-import-add', folder_id: D, file_ids: [id('a')], workspace_id: 'w' }), null);
});

test('S69-25b planImport(고른 폴더): 그 폴더 아래(하위 포함)만, 경로 머리는 그 폴더 이름, 남이 올린 파일은 뺀다', () => {
  const P = id('pick');
  const files = [
    folder('weekly', '주간보고', P), folder('w11', '11월', id('weekly')),
    file('in.pdf', { parents: [P], ownedByMe: true }),
    file('deep.hwp', { parents: [id('w11')], ownedByMe: true }),
    file('others.pdf', { parents: [id('weekly')], ownedByMe: false }),
    file('outside.pdf', { parents: [id('root')], ownedByMe: true }),        // 고른 폴더 밖(같은 응답에 섞여도)
    folder('elsewhere', '다른 폴더'), file('far.pdf', { parents: [id('elsewhere')], ownedByMe: true }),
    file('two.pdf', { parents: [id('elsewhere'), id('weekly')], ownedByMe: true }), // 부모 둘 중 하나가 안쪽
  ];
  const r = planImport({ files, rootId: P, rootName: '가상 노조 폴더' });
  assert.deepEqual(r.items.map(x => x.name).sort(), ['deep.hwp', 'in.pdf', 'two.pdf']);
  assert.equal(r.items.find(x => x.name === 'in.pdf').path, '가상 노조 폴더');
  assert.equal(r.items.find(x => x.name === 'deep.hwp').path, '가상 노조 폴더 › 주간보고 › 11월');
  assert.equal(r.items.find(x => x.name === 'two.pdf').path, '가상 노조 폴더 › 주간보고');
  assert.equal(r.skipped.others, 1);
});

test('S69-25b checkFolder·pickableFolders: 내 소유 폴더만, 앱 폴더·휴지통·남의 폴더는 고를 수 없음', () => {
  const ctx = { appFolderIds: new Set([id('meet')]) };
  const ok = { id: id('pick'), name: '가상 노조 폴더', mimeType: F, ownedByMe: true, trashed: false };
  assert.equal(checkFolder(ok, ctx), 'ok');
  assert.equal(checkFolder({ ...ok, mimeType: 'application/pdf' }, ctx), 'invalid');
  assert.equal(checkFolder({ ...ok, ownedByMe: false }, ctx), 'invalid');
  assert.equal(checkFolder({ ...ok, trashed: true }, ctx), 'invalid');
  assert.equal(checkFolder({ ...ok, id: id('meet') }, ctx), 'invalid');
  assert.equal(checkFolder({ ...ok, name: 'Web2 바구니' }, ctx), 'invalid');
  assert.equal(checkFolder({ ...ok, appProperties: { kptu_backup: 'root' } }, ctx), 'invalid');
  assert.equal(checkFolder(null, ctx), 'invalid');
  const list = pickableFolders([{ ...ok, id: id('z'), name: '하' }, ok, { ...ok, id: id('bk'), name: '원장 백업' }, { ...ok, id: id('mine2'), name: '가' }], ctx);
  assert.deepEqual(list.map(f => f.name), ['가', '가상 노조 폴더', '하']);
  assert.deepEqual(Object.keys(list[0]).sort(), ['id', 'name']);
});

test('scopeCanList: drive 전체 권한만(drive.file은 앱이 만든 파일만 보여 안 됨)', () => {
  assert.equal(scopeCanList('openid https://www.googleapis.com/auth/drive.file'), false);
  assert.equal(scopeCanList('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive'), true);
  assert.equal(scopeCanList(undefined), false);
});

// 가짜 admin(supabase-js 모양 일부)과 가짜 Google.
function harness({ scope = 'https://www.googleapis.com/auth/drive', driveFiles = [], docs = [], settings = {}, getFile = null, insertError = null } = {}) {
  const calls = { inserts: [], fetch: [], tables: [] };
  const admin = {
    from(table) {
      calls.tables.push(table);
      const b = {
        _f: [],
        select() { return b; }, eq(k, v) { b._f.push([k, v]); return b; },
        range: async () => ({ data: table === 'app_documents' ? docs.filter(d => b._f.every(([k, v]) => d[k] === v)) : [], error: null }),
        maybeSingle: async () => ({ data: table === 'app_drive_settings' ? settings : null, error: null }),
        insert: async row => { if (insertError) return { error: insertError }; calls.inserts.push(row); docs.push(row); return { error: null }; },
      };
      return b;
    },
  };
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = String(url);
    calls.fetch.push({ url: u, method: init.method || 'GET' });
    if (u.startsWith('https://oauth2.googleapis.com/tokeninfo')) return json({ scope });
    if (u.endsWith('/files/root?fields=id')) return json({ id: id('root') });
    if (u.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      const q = new URL(u).searchParams.get('q') || '';
      if (q.startsWith("'root' in parents")) return json({ files: driveFiles.filter(f => f.mimeType === F && (f.parents || []).includes(id('root'))) });
      const parents = [...q.matchAll(/'([A-Za-z0-9_-]+)' in parents/g)].map(m => m[1]);
      return json({ files: driveFiles.filter(f => (f.parents || []).some(p => parents.includes(p))) });
    }
    const m = u.match(/\/files\/([^?]+)\?fields=/);
    if (m) { const f = (getFile || (x => driveFiles.find(y => y.id === x)))(decodeURIComponent(m[1])); return f ? json(f) : json({}, 404); }
    throw new Error('unexpected ' + u);
  };
  const imp = createDriveImport({ admin, fetch, token: 'tok', workspaceId: 'w1', userId: 'u1', titleFor: n => n.replace(/\.[^.]+$/, ''), classify: () => ({ category: '기타', source: null, tags: [], document_date: null }), log: () => {} });
  return { imp, calls, docs };
}

const P = id('pick');
const pickFolder = folder('pick', '가상 노조 폴더', id('root'), { ownedByMe: true, trashed: false });

test('list·folders: 권한(drive.file뿐)이 없으면 scope_missing, 드라이브 목록을 부르지 않음', async () => {
  const h = harness({ scope: 'https://www.googleapis.com/auth/drive.file' });
  assert.deepEqual(await h.imp.list(P), { ok: false, code: 'scope_missing' });
  assert.deepEqual(await h.imp.folders(), { ok: false, code: 'scope_missing' });
  assert.equal(h.calls.fetch.some(c => c.url.includes('/drive/v3/files')), false);
});

test('folders: 내 드라이브 바로 아래 내 폴더만(앱 폴더 빼고), id·이름만', async () => {
  const h = harness({ driveFiles: [pickFolder, folder('basket', 'Web2 바구니', id('root'), { ownedByMe: true }), folder('meet', '회의 녹음', id('root'), { ownedByMe: true }), folder('sub', '하위', P, { ownedByMe: true })], settings: { meetings_folder_id: id('meet') } });
  const r = await h.imp.folders();
  assert.deepEqual(r, { ok: true, folders: [{ id: P, name: '가상 노조 폴더' }] });
  const q = new URL(h.calls.fetch.find(c => c.url.startsWith('https://www.googleapis.com/drive/v3/files?')).url).searchParams.get('q');
  assert.equal(q, "'root' in parents and mimeType = 'application/vnd.google-apps.folder' and 'me' in owners and trashed = false");
});

test('list(S69-25b): 고른 폴더 아래(하위 포함)만 묻고, 그 밖 파일은 목록에 없음 — 서버 단위', async () => {
  const driveFiles = [
    pickFolder, folder('weekly', '주간보고', P), folder('w11', '11월', id('weekly')),
    file('new.pdf', { parents: [P], ownedByMe: true }), file('deep.hwp', { parents: [id('w11')], ownedByMe: true }),
    file('old.pdf', { id: id('old'), parents: [P], ownedByMe: true }),
    file('outside.pdf', { parents: [id('root')], ownedByMe: true }),
    folder('else', '다른 폴더'), file('far.pdf', { parents: [id('else')], ownedByMe: true }),
  ];
  const h = harness({ driveFiles, docs: [{ workspace_id: 'w1', file_id: id('old'), previous_files: [] }, { workspace_id: 'w2', file_id: id('newxpdf') }] });
  const r = await h.imp.list(P);
  assert.equal(r.ok, true);
  assert.deepEqual(r.folder, { id: P, name: '가상 노조 폴더' });
  assert.deepEqual(r.items.map(x => [x.name, x.path]), [['new.pdf', '가상 노조 폴더'], ['deep.hwp', '가상 노조 폴더 › 주간보고 › 11월']]); // 남의 작업공간 행은 비교에 쓰지 않음
  const qs = h.calls.fetch.filter(c => c.url.startsWith('https://www.googleapis.com/drive/v3/files?')).map(c => new URL(c.url).searchParams.get('q'));
  assert.deepEqual(qs, [`('${P}' in parents) and trashed = false`, `('${id('weekly')}' in parents) and trashed = false`, `('${id('w11')}' in parents) and trashed = false`]);
  assert.equal(qs.some(q => q.includes("'me' in owners and trashed = false") && !q.includes('in parents')), false, '드라이브 전체를 묻지 않음');
  // 쓰기·내용 받기 없음
  assert.equal(h.calls.fetch.some(c => c.method !== 'GET' && !c.url.includes('tokeninfo')), false);
  assert.equal(h.calls.fetch.some(c => c.url.includes('alt=media') || c.url.includes('/export')), false);
});

test('list·add: 고를 수 없는 폴더(남의 폴더·앱 폴더·파일·없는 id)는 folder_invalid로 거절, 아무것도 넣지 않음', async () => {
  const notMine = folder('nm', '남의 폴더', id('root'), { ownedByMe: false });
  const basket = folder('basket', 'Web2 바구니', id('root'), { ownedByMe: true });
  const pdf = file('a.pdf', { ownedByMe: true });
  const h = harness({ driveFiles: [notMine, basket, pdf] });
  for (const fid of [notMine.id, basket.id, pdf.id, id('missing')]) {
    await assert.rejects(h.imp.list(fid), e => e.code === 'folder_invalid' && e.status === 400, fid);
    await assert.rejects(h.imp.add(fid, [pdf.id]), e => e.code === 'folder_invalid', fid);
  }
  assert.equal(h.calls.inserts.length, 0);
});

test('add: 복사·업로드 없이 같은 드라이브 id로 자료 행만, 이미 있음·못 읽음·고른 폴더 밖은 건너뜀', async () => {
  const sub = folder('weekly', '주간보고', P, { ownedByMe: true });
  const a = file('a.pdf', { parents: [id('weekly')], ownedByMe: true, trashed: false, webViewLink: 'https://drive.google.com/file/d/A/view' });
  const g = file('memo', { parents: [P], mimeType: 'application/vnd.google-apps.document', size: undefined, ownedByMe: true, trashed: false, webViewLink: 'https://docs.google.com/document/d/G/edit' });
  const other = file('other.pdf', { parents: [P], ownedByMe: false });
  const outside = file('outside.pdf', { parents: [id('root')], ownedByMe: true, trashed: false });
  const h = harness({ driveFiles: [pickFolder, sub, a, g, other, outside, { id: id('root'), name: '내 드라이브', mimeType: F, parents: [] }], docs: [{ workspace_id: 'w1', file_id: id('old'), previous_files: [] }] });
  const r = await h.imp.add(P, [a.id, g.id, other.id, outside.id, id('old'), id('missing')]);
  assert.deepEqual(r, { ok: true, added: 2, exists: 1, unreadable: 3, failed: 0 });
  assert.equal(h.calls.inserts.length, 2);
  assert.equal(h.calls.inserts.some(x => x.file_id === outside.id), false, '고른 폴더 밖 파일은 넣지 않음');
  const ra = h.calls.inserts.find(x => x.file_id === a.id);
  assert.equal(ra.workspace_id, 'w1'); assert.equal(ra.uploaded_by, 'u1'); assert.equal(ra.visibility, 'private');
  assert.equal(ra.drive_url, a.webViewLink); assert.equal(ra.file_size, 100); assert.equal(ra.title, 'a'); assert.equal(ra.project_id, null);
  const rg = h.calls.inserts.find(x => x.file_id === g.id);
  assert.equal(rg.file_size, null); assert.equal(rg.mime_type, 'application/vnd.google-apps.document');
  assert.equal(h.calls.fetch.some(c => c.url.includes('/upload/') || c.url.includes('/copy') || c.method === 'POST' && c.url.includes('/drive/') || c.method === 'PATCH' || c.method === 'DELETE'), false);
});

test('add: 같은 요청을 다시 보내면 모두 이미 있음(두 번 등록 안 함)', async () => {
  const a = file('a.pdf', { parents: [P], ownedByMe: true, trashed: false });
  const h = harness({ driveFiles: [pickFolder, a] });
  assert.equal((await h.imp.add(P, [a.id])).added, 1);
  assert.deepEqual(await h.imp.add(P, [a.id]), { ok: true, added: 0, exists: 1, unreadable: 0, failed: 0 });
});

test('index.ts: 가져오기 갈래는 로그인 → 내 owner 작업공간 → 내 구글 연결 순서이고 화면 값(작업공간)을 받지 않는다', () => {
  const src = readFileSync(new URL('../../supabase/functions/library-files/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf("input?.action==='drive-import-folders'");
  assert.ok(at > 0);
  const part = src.slice(at, at + 900);
  assert.match(part, /parseImportRequest\(input\)/);
  assert.match(part, /workspaceFor\(user\.id\)/);
  assert.match(part, /driveToken\(wmImport\.workspace_id\)/);
  assert.doesNotMatch(part, /input\.workspace_id|input\.user_id|input\.folder_id/);
  assert.match(part, /imp\.list\(req2\.folderId\)/);
  assert.match(part, /imp\.add\(req2\.folderId,req2\.ids\)/);
});

// S70-69 LIB-드라이브가져오기 빼기 목록(★급★): 폰 앱 서명 열쇠·그 비밀번호 파일·앱 임시 문서(OCR)·운영 문서(요청함)가 목록에 기본 체크로 나왔다.
// 서버가 목록·가져오기·고를 폴더에서 아예 뺀다(화면 숨김 아님). 이름은 모두 가상.
test('S70-69 planImport: 열쇠·비밀번호 파일·비밀값 보관 폴더 안·앱 임시 문서·운영 문서는 목록에 없고, 보통 파일은 나온다', () => {
  const R = id('appRoot');
  const files = [
    folder('keybak', 'web2-phone-key-백업', R, { ownedByMe: true }),
    file('release.keystore', { parents: [id('keybak')], mimeType: 'application/octet-stream', ownedByMe: true }),
    file('memo.txt', { parents: [id('keybak')], mimeType: 'text/plain', ownedByMe: true }), // 보관 폴더 안이면 이름과 상관없이 뺌
    file('upload.jks', { parents: [R], mimeType: 'application/octet-stream', ownedByMe: true }),
    file('signCert.der', { parents: [R], mimeType: 'application/octet-stream', ownedByMe: true }),
    file('cert.p12', { parents: [R], mimeType: 'application/x-pkcs12', ownedByMe: true }),
    file('server.pem', { parents: [R], mimeType: 'text/plain', ownedByMe: true }),
    file('키 비밀번호.txt', { id: id('pwtxt'), parents: [R], mimeType: 'text/plain', ownedByMe: true }),
    file('keystore-password.txt', { parents: [R], mimeType: 'text/plain', ownedByMe: true }),
    file('client_secret_x.json', { parents: [R], mimeType: 'application/json', ownedByMe: true }),
    file('Web2 OCR abc', { id: id('ocr1'), parents: [R], mimeType: 'application/vnd.google-apps.document', size: undefined, appProperties: { web2_ocr: '1', note: 'n' }, ownedByMe: true }),
    file('이름 바꾼 임시본', { id: id('ocr2'), parents: [R], mimeType: 'application/vnd.google-apps.document', size: undefined, appProperties: { web2_ocr: '1' }, ownedByMe: true }),
    file('Web2 OCR old', { id: id('ocr3'), parents: [R], mimeType: 'application/vnd.google-apps.document', size: undefined, ownedByMe: true }),
    file('Web2 요청함', { id: id('req'), parents: [R], mimeType: 'application/vnd.google-apps.document', size: undefined, ownedByMe: true }),
    file('2026 사업계획.hwp', { parents: [R], mimeType: 'application/x-hwp', ownedByMe: true }),
    file('회의록 키워드 정리.pdf', { parents: [R], ownedByMe: true }),
    file('주민등록증 사본.jpg', { parents: [R], mimeType: 'image/jpeg', ownedByMe: true }),
  ];
  const r = planImport({ files, rootId: R, rootName: 'WORK ON+' });
  assert.deepEqual(r.items.map(x => x.name).sort(), ['2026 사업계획.hwp', '주민등록증 사본.jpg', '회의록 키워드 정리.pdf'].sort());
  assert.equal(r.skipped.secret, 9);
  assert.equal(r.skipped.app, 4);
  assert.equal(r.items.find(x => x.name === '주민등록증 사본.jpg').personal, true, '개인 서류는 목록에 남고 기본 체크만 해제(기존대로)');
});

test('S70-69 checkAddable·checkFolder: 가져오기 때 다시 확인해 비밀값 파일·앱 임시·운영 문서는 거절, 보관 폴더는 고를 수 없음', () => {
  const base = { ownedByMe: true, trashed: false, parents: [id('x')] };
  const deps = { registered: new Set(), appFolderIds: new Set() };
  for (const f of [file('a.keystore', base), file('b.key', base), file('비번.txt', { ...base, mimeType: 'text/plain' }), file('API Key 메모.txt', { ...base, mimeType: 'text/plain' }),
    file('Web2 OCR z', { ...base, mimeType: 'application/vnd.google-apps.document', size: undefined }), file('x', { ...base, mimeType: 'application/vnd.google-apps.document', size: undefined, appProperties: { web2_text_tmp: '1' } }),
    file('Web2 요청함', { ...base, mimeType: 'application/vnd.google-apps.document', size: undefined })]) assert.equal(checkAddable(f, deps), 'unreadable', f.name);
  assert.equal(checkAddable(file('보통 자료.pdf', base), deps), 'ok');
  assert.equal(checkFolder(folder('kb', 'web2-phone-key-백업', id('root'), { ownedByMe: true, trashed: false }), { appFolderIds: new Set() }), 'invalid');
  assert.equal(checkFolder(folder('ok', '사업 자료', id('root'), { ownedByMe: true, trashed: false }), { appFolderIds: new Set() }), 'ok');
});

test('S70-69 list·add(서버 단위): 고른 폴더 아래 열쇠 백업 폴더·비밀번호 파일·OCR 임시 문서는 목록에도 없고 id를 보내도 넣지 않음', async () => {
  const kb = folder('keybak', 'web2-phone-key-백업', P, { ownedByMe: true });
  const key = file('release.keystore', { parents: [id('keybak')], mimeType: 'application/octet-stream', ownedByMe: true, trashed: false });
  const note = file('memo.txt', { parents: [id('keybak')], mimeType: 'text/plain', ownedByMe: true, trashed: false });
  const pw = file('키 비밀번호.txt', { id: id('pwtxt'), parents: [P], mimeType: 'text/plain', ownedByMe: true, trashed: false });
  const ocr = file('Web2 OCR abc', { id: id('ocr1'), parents: [P], mimeType: 'application/vnd.google-apps.document', size: undefined, appProperties: { web2_ocr: '1' }, ownedByMe: true, trashed: false });
  const ok = file('보통.pdf', { parents: [P], ownedByMe: true, trashed: false });
  const h = harness({ driveFiles: [pickFolder, kb, key, note, pw, ocr, ok] });
  const r = await h.imp.list(P);
  assert.deepEqual(r.items.map(x => x.name), ['보통.pdf']);
  assert.equal(r.skipped.secret, 3); assert.equal(r.skipped.app, 1);
  const a = await h.imp.add(P, [key.id, note.id, pw.id, ocr.id, ok.id]);
  assert.deepEqual(a, { ok: true, added: 1, exists: 0, unreadable: 4, failed: 0 });
  assert.deepEqual(h.calls.inserts.map(x => x.file_id), [ok.id]);
  await assert.rejects(h.imp.list(kb.id), e => e.code === 'folder_invalid', '보관 폴더를 직접 골라도 거절');
});
