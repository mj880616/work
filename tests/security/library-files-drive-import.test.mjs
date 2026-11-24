import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planImport, checkAddable, parseImportRequest, registeredIds, appFolderIdsFrom, createDriveImport, isPersonalName, scopeCanList, ADD_MAX,
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
  assert.deepEqual(r.skipped, { registered: 2, app: 5, not_file: 3, empty: 1 });
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

test('parseImportRequest: 모양이 정확할 때만', () => {
  assert.deepEqual(parseImportRequest({ action: 'drive-import-list' }), { action: 'list' });
  assert.equal(parseImportRequest({ action: 'drive-import-list', workspace_id: 'x' }), null);
  assert.deepEqual(parseImportRequest({ action: 'drive-import-add', file_ids: [id('a')] }), { action: 'add', ids: [id('a')] });
  assert.equal(parseImportRequest({ action: 'drive-import-add', file_ids: [] }), null);
  assert.equal(parseImportRequest({ action: 'drive-import-add', file_ids: [id('a'), id('a')] }), null);
  assert.equal(parseImportRequest({ action: 'drive-import-add', file_ids: ['../x'] }), null);
  assert.equal(parseImportRequest({ action: 'drive-import-add', file_ids: Array.from({ length: ADD_MAX + 1 }, (_, i) => id('f' + i)) }), null);
  assert.equal(parseImportRequest({ action: 'drive-import-add', file_ids: [id('a')], workspace_id: 'w' }), null);
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
    if (u.startsWith('https://www.googleapis.com/drive/v3/files?')) return json({ files: driveFiles });
    const m = u.match(/\/files\/([^?]+)\?fields=/);
    if (m) { const f = (getFile || (x => driveFiles.find(y => y.id === x)))(decodeURIComponent(m[1])); return f ? json(f) : json({}, 404); }
    throw new Error('unexpected ' + u);
  };
  const imp = createDriveImport({ admin, fetch, token: 'tok', workspaceId: 'w1', userId: 'u1', titleFor: n => n.replace(/\.[^.]+$/, ''), classify: () => ({ category: '기타', source: null, tags: [], document_date: null }), log: () => {} });
  return { imp, calls, docs };
}

test('list: 권한(drive.file뿐)이 없으면 scope_missing, 드라이브 목록을 부르지 않음', async () => {
  const h = harness({ scope: 'https://www.googleapis.com/auth/drive.file' });
  assert.deepEqual(await h.imp.list(), { ok: false, code: 'scope_missing' });
  assert.equal(h.calls.fetch.some(c => c.url.includes('/drive/v3/files')), false);
});

test('list: 내 작업공간 자료와 비교해 없는 것만, 목록은 내 소유·휴지통 아님 조건으로 부름', async () => {
  const h = harness({ driveFiles: [file('new.pdf'), file('old.pdf', { id: id('old') })], docs: [{ workspace_id: 'w1', file_id: id('old'), previous_files: [] }, { workspace_id: 'w2', file_id: id('newxpdf') }] });
  const r = await h.imp.list();
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(x => x.name), ['new.pdf']); // 남의 작업공간 행은 비교에 쓰지 않음
  const listCall = h.calls.fetch.find(c => c.url.startsWith('https://www.googleapis.com/drive/v3/files?'));
  const q = new URL(listCall.url).searchParams.get('q');
  assert.equal(q, "'me' in owners and trashed = false");
  // 쓰기·내용 받기 없음
  assert.equal(h.calls.fetch.some(c => c.method !== 'GET' && !c.url.includes('tokeninfo')), false);
  assert.equal(h.calls.fetch.some(c => c.url.includes('alt=media') || c.url.includes('/export')), false);
});

test('add: 복사·업로드 없이 같은 드라이브 id로 자료 행만, 이미 있음·못 읽음은 건너뜀', async () => {
  const a = file('a.pdf', { ownedByMe: true, trashed: false, webViewLink: 'https://drive.google.com/file/d/A/view' });
  const g = file('memo', { mimeType: 'application/vnd.google-apps.document', size: undefined, ownedByMe: true, trashed: false, webViewLink: 'https://docs.google.com/document/d/G/edit' });
  const other = file('other.pdf', { ownedByMe: false });
  const h = harness({ driveFiles: [a, g, other], docs: [{ workspace_id: 'w1', file_id: id('old'), previous_files: [] }] });
  const r = await h.imp.add([a.id, g.id, other.id, id('old'), id('missing')]);
  assert.deepEqual(r, { ok: true, added: 2, exists: 1, unreadable: 2, failed: 0 });
  assert.equal(h.calls.inserts.length, 2);
  const ra = h.calls.inserts.find(x => x.file_id === a.id);
  assert.equal(ra.workspace_id, 'w1'); assert.equal(ra.uploaded_by, 'u1'); assert.equal(ra.visibility, 'private');
  assert.equal(ra.drive_url, a.webViewLink); assert.equal(ra.file_size, 100); assert.equal(ra.title, 'a'); assert.equal(ra.project_id, null);
  const rg = h.calls.inserts.find(x => x.file_id === g.id);
  assert.equal(rg.file_size, null); assert.equal(rg.mime_type, 'application/vnd.google-apps.document');
  assert.equal(h.calls.fetch.some(c => c.url.includes('/upload/') || c.url.includes('/copy') || c.method === 'POST' && c.url.includes('/drive/') || c.method === 'PATCH' || c.method === 'DELETE'), false);
});

test('add: 같은 요청을 다시 보내면 모두 이미 있음(두 번 등록 안 함)', async () => {
  const a = file('a.pdf', { ownedByMe: true, trashed: false });
  const h = harness({ driveFiles: [a] });
  assert.equal((await h.imp.add([a.id])).added, 1);
  assert.deepEqual(await h.imp.add([a.id]), { ok: true, added: 0, exists: 1, unreadable: 0, failed: 0 });
});

test('index.ts: 가져오기 갈래는 로그인 → 내 owner 작업공간 → 내 구글 연결 순서이고 화면 값(작업공간)을 받지 않는다', () => {
  const src = readFileSync(new URL('../../supabase/functions/library-files/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf("input?.action==='drive-import-list'");
  assert.ok(at > 0);
  const part = src.slice(at, at + 900);
  assert.match(part, /parseImportRequest\(input\)/);
  assert.match(part, /workspaceFor\(user\.id\)/);
  assert.match(part, /driveToken\(wmImport\.workspace_id\)/);
  assert.doesNotMatch(part, /input\.workspace_id|input\.user_id/);
});
