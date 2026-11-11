import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createEventFiles, MAX_EVENT_FILES, driveLink } from '../../supabase/functions/google-calendar/event-files.ts';
import { withEdgeShared } from './helpers/edge-shared.mjs';

// CAL-일정첨부: 실제 google-calendar 처리(index.ts + event-files.ts + _shared Drive 올리기·휴지통)를 가짜 Google 캘린더·Drive·Supabase에
// 돌린다. 네트워크 없음. 값은 모두 지어낸 것이다. 확인하는 것:
// - 원본 위치: 파일은 작업공간 Drive '자료실 › 일정 첨부'에, 일정에는 Google 캘린더 첨부(supportsAttachments=true)로만 붙는다(Web2 표 없음).
// - 일정 쓰기는 읽은 판(etag)일 때만(If-Match). 그 사이 바뀌면 한 번 다시 읽어 남의 변경을 지우지 않는다.
// - 붙이지 못한 것이 확실하면 이번에 올린 파일만 지운다. [빼기]는 Drive를 건드리지 않는다. [삭제]는 '일정 첨부' 폴더의 내 파일만 휴지통(영구 삭제 없음).
// - 로그인·작업공간 소유자 확인은 그대로, Google 요청 범위(scope)는 넓히지 않는다. Drive 공유 설정은 바꾸지 않는다.
const RAW = readFileSync(new URL('../../supabase/functions/google-calendar/index.ts', import.meta.url), 'utf8');
const SOURCE = stripTypeScriptTypes(withEdgeShared(RAW).replace(/^import .*$/gm, ''), { mode: 'strip' });
const WS = '11111111-1111-4111-8111-111111111111', USER = '22222222-2222-4222-8222-222222222222';
const LIB = 'library-folder', FOLDER = '일정 첨부';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function harness({ attachments = [], readOnly = false, conflicts = 0, used = {}, member = 'owner', library = LIB, eventFolder = true, files = [] } = {}) {
  const ev = { id: 'event-1', etag: '"e1"', status: 'confirmed', attachments: attachments.map(a => ({ ...a })) };
  let etagNo = 1, pendingConflicts = conflicts, nextId = 1;
  const cal = { calls: [] };
  const drive = { files: new Map(), calls: [], uploads: 0, deleted: [], patches: [] };
  if (eventFolder) drive.files.set('event-folder', { id: 'event-folder', name: FOLDER, mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, trashed: false, parents: [library], permissions: [{ type: 'user', role: 'owner' }] });
  for (const f of files) drive.files.set(f.id, { mimeType: 'image/jpeg', ownedByMe: true, trashed: false, parents: ['event-folder'], size: '3', ...f });
  const single = data => { const b = { select: () => b, eq: () => b, limit: () => b, maybeSingle: async () => ({ data, error: null }), single: async () => ({ data, error: null }), then: (ok, f) => Promise.resolve({ data: data ? [data] : [], error: null }).then(ok, f) }; return b; };
  const userReads = [];
  const admin = {
    auth: { getUser: async token => token === 'token-a' ? { data: { user: { id: USER } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT', status: 401 } } },
    from: table => {
      if (table === 'app_workspace_members') return single(member ? { workspace_id: WS, role: member } : null);
      if (table === 'app_google_calendar_connections') return single({ user_id: USER, access_token: 'calendar-token', refresh_token: 'r', token_expires_at: new Date(Date.now() + 86400000).toISOString() });
      if (table === 'public_policy_drive_config') return single({ google_client_id: 'cid', google_client_secret: 'secret' });
      if (table === 'app_drive_connections') return single({ google_refresh_token: 'refresh' });
      if (table === 'app_drive_settings') return single(library ? { library_folder_id: library } : null);
      throw new Error('service role must not touch ' + table);
    }
  };
  // 내 로그인 토큰(RLS)으로 읽는 '다른 기록이 이 파일을 쓰나'. 그 밖의 표는 만지지 않는다.
  const userDb = authorization => ({
    from: table => {
      assert.equal(authorization, 'Bearer token-a');
      assert.ok(['app_documents', 'app_task_attachments', 'app_notes'].includes(table), 'unexpected user table ' + table);
      userReads.push(table);
      const b = { select: () => b, eq: () => b, contains: () => b, limit: () => b, then: (ok, f) => Promise.resolve({ data: used[table] ? [{ id: 'x' }] : [], error: null }).then(ok, f) };
      return b;
    }
  });
  const fetchMock = async (url, init = {}) => {
    const u = new URL(String(url)), method = init.method || 'GET', auth = init.headers?.Authorization;
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') return json({ access_token: 'drive-token', expires_in: 3600 });
    if (u.pathname.startsWith('/calendar/v3/')) {
      assert.equal(auth, 'Bearer calendar-token', 'Calendar calls use the calendar token');
      cal.calls.push({ method, path: decodeURIComponent(u.pathname), search: u.search, ifMatch: init.headers?.['If-Match'] || null, body: init.body ? JSON.parse(init.body) : null });
      if (u.pathname === '/calendar/v3/colors') return json({ event: {} });
      const m = u.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/);
      if (!m || decodeURIComponent(m[2]) !== ev.id) return json({ error: { code: 404 } }, 404);
      if (method === 'GET') return json({ id: ev.id, etag: ev.etag, status: ev.status, attachments: ev.attachments.map(a => ({ ...a })) });
      if (method === 'PATCH') {
        assert.equal(u.searchParams.get('supportsAttachments'), 'true');
        if (init.headers?.['If-Match'] !== ev.etag) return json({ error: { code: 412 } }, 412);
        if (pendingConflicts > 0) { pendingConflicts--; ev.attachments.push({ fileUrl: 'https://drive.google.com/file/d/other-device/view', fileId: 'other-device', title: '다른 기기.pdf', mimeType: 'application/pdf' }); ev.etag = '"e' + (++etagNo) + '"'; return json({ error: { code: 412 } }, 412); }
        if (readOnly) return json({ error: { code: 403, message: 'Forbidden' } }, 403);
        const body = JSON.parse(init.body);
        ev.attachments = body.attachments.map(a => ({ ...a, fileId: a.fileUrl.match(/\/d\/([^/]+)\//)?.[1] }));
        ev.etag = '"e' + (++etagNo) + '"';
        return json({ id: ev.id, etag: ev.etag, attachments: ev.attachments });
      }
      throw new Error('unexpected calendar call ' + method);
    }
    if (u.hostname === 'www.googleapis.com') {
      assert.equal(auth || 'Bearer drive-token', 'Bearer drive-token', 'Drive calls use the Drive token');
      drive.calls.push({ method, path: u.pathname });
      if (u.pathname === '/drive/v3/files' && method === 'GET') {
        const q = u.searchParams.get('q');
        return json({ files: [...drive.files.values()].filter(f => f.mimeType === 'application/vnd.google-apps.folder' && q.includes(`name = '${f.name}'`) && q.includes(`'${f.parents[0]}' in parents`) && !f.trashed) });
      }
      if (u.pathname === '/drive/v3/files' && method === 'POST') {
        const body = JSON.parse(init.body), id = 'new-folder-' + nextId++;
        drive.files.set(id, { id, name: body.name, mimeType: body.mimeType, ownedByMe: true, trashed: false, parents: body.parents, permissions: [{ type: 'user', role: 'owner' }] });
        return json({ id });
      }
      if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
        const meta = JSON.parse(init.body); drive.pendingParent = meta.parents[0]; drive.pendingName = meta.name;
        return new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=u' + nextId++ } });
      }
      if (u.pathname === '/upload/drive/v3/files' && method === 'PUT') {
        drive.uploads++; const id = 'file' + nextId++;
        drive.files.set(id, { id, name: drive.pendingName, parents: [drive.pendingParent], mimeType: 'image/jpeg', ownedByMe: true, trashed: false });
        return json({ id });
      }
      const one = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
      if (one && method === 'GET' && u.searchParams.get('fields')?.includes('thumbnailLink')) { const f = drive.files.get(one[1]); return f ? json({ ...f, thumbnailLink: 'https://lh3.googleusercontent.com/thumb-' + f.id + '=s220' }) : json({ error: { code: 404 } }, 404); }
      if (one && method === 'GET') { const f = drive.files.get(one[1]); return f ? json(f) : json({ error: { code: 404 } }, 404); }
      if (one && method === 'DELETE') { drive.deleted.push(one[1]); drive.files.delete(one[1]); return new Response(null, { status: 204 }); }
      if (one && method === 'PATCH') {
        const f = drive.files.get(one[1]); if (!f) return json({ error: { code: 404 } }, 404);
        const body = JSON.parse(init.body); drive.patches.push({ id: one[1], body }); Object.assign(f, body); return json({ id: f.id, name: f.name, trashed: f.trashed });
      }
      throw new Error('unexpected Drive call ' + method + ' ' + url);
    }
    if (u.hostname === 'lh3.googleusercontent.com') { drive.thumbs = [...(drive.thumbs || []), u.pathname]; return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }); }
    throw new Error('unexpected fetch ' + url);
  };
  let handler = null;
  const Deno = { env: { get: key => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' }[key]) }, serve: fn => { handler = fn; } };
  const createClient = (_url, key, opts) => key === 'service' ? admin : userDb(opts?.global?.headers?.Authorization || '');
  const quiet = { log: () => {}, error: () => {}, warn: () => {} };
  new Function('Deno', 'createClient', 'createEventFiles', 'fetch', 'console', SOURCE)(Deno, createClient, createEventFiles, fetchMock, quiet);
  const send = async req => { const r = await handler(req); return { status: r.status, body: await r.json() }; };
  const post = (action, body = {}, token = 'token-a') => send(new Request('https://sb.example/functions/v1/google-calendar', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ action, calendar_id: 'primary', event_id: 'event-1', ...body }) }));
  const attach = ({ file = new File(['abc'], '현장.jpg', { type: 'image/jpeg' }), token = 'token-a', eventId = 'event-1' } = {}) => {
    const fd = new FormData(); fd.append('calendar_id', 'primary'); if (eventId) fd.append('event_id', eventId); if (file) fd.append('file', file);
    return send(new Request('https://sb.example/functions/v1/google-calendar?action=attach-file', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: fd }));
  };
  const getEvent = () => send(new Request('https://sb.example/functions/v1/google-calendar?action=event&eventId=event-1&calendarId=primary', { headers: { Authorization: 'Bearer token-a' } }));
  const photo = (fileId, token = 'token-a') => handler(new Request('https://sb.example/functions/v1/google-calendar?' + new URLSearchParams({ action: 'file-photo', calendarId: 'primary', eventId: 'event-1', fileId, size: 'small' }), { headers: token ? { Authorization: 'Bearer ' + token } : {} }));
  return { ev, cal, drive, userReads, post, attach, getEvent, photo };
}
const ref = (id, title, mimeType = 'image/jpeg') => ({ fileUrl: 'https://drive.google.com/file/d/' + id + '/view?usp=drivesdk', fileId: id, title, mimeType, iconLink: 'https://icons.example/' + id });

test('붙이기: 파일은 Drive 자료실 › 일정 첨부에 한 번, 일정에는 Google 캘린더 첨부로(읽은 판일 때만, 다른 첨부는 그대로)', async () => {
  const h = harness({ attachments: [ref('kept-1', '안내문.pdf', 'application/pdf')] });
  const r = await h.attach();
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(h.drive.uploads, 1);
  assert.equal(h.drive.pendingParent, 'event-folder');
  assert.deepEqual(r.body.file, { drive_file_id: 'file2', file_name: '현장.jpg', mime_type: 'image/jpeg' });
  assert.deepEqual(r.body.files.map(f => f.drive_file_id), ['kept-1', 'file2']);
  const patch = h.cal.calls.find(c => c.method === 'PATCH');
  assert.equal(patch.ifMatch, '"e1"');
  assert.deepEqual(patch.body.attachments[1], { fileUrl: driveLink('file2'), title: '현장.jpg', mimeType: 'image/jpeg' });
  assert.equal(patch.body.attachments[0].fileUrl, ref('kept-1').fileUrl, '이미 있던 첨부는 그대로 보낸다');
  // 공유 범위를 넓히지 않는다: Drive 권한(permissions) 쓰기가 없다.
  assert.equal(h.drive.calls.some(c => c.path.includes('/permissions')), false);
});

test('붙이기: 없던 일정 첨부 폴더는 자료실 아래에 비공개로 만든다', async () => {
  const h = harness({ eventFolder: false });
  const r = await h.attach();
  assert.equal(r.status, 200);
  const folder = [...h.drive.files.values()].find(f => f.name === FOLDER);
  assert.deepEqual(folder.parents, [LIB]);
  assert.equal(h.drive.pendingParent, folder.id);
});

test('붙이기: 그 사이 다른 곳에서 일정이 바뀌면(412) 다시 읽어 그 변경을 지우지 않고 붙인다', async () => {
  const h = harness({ conflicts: 1 });
  const r = await h.attach();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.files.map(f => f.drive_file_id), ['other-device', 'file2']);
  assert.equal(h.cal.calls.filter(c => c.method === 'PATCH').length, 2);
  assert.equal(h.drive.uploads, 1, '다시 쓸 때 파일을 다시 올리지 않는다');
});

test('붙이기: Google이 거절하면(고칠 수 없는 일정) 이번에 올린 파일만 지운다', async () => {
  const h = harness({ readOnly: true, files: [{ id: 'kept-1', name: '안내문.pdf' }] });
  const r = await h.attach();
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'event_read_only');
  assert.deepEqual(h.drive.deleted, ['file2']);
  assert.ok(h.drive.files.has('kept-1'));
});

test(`붙이기: 일정 첨부가 ${MAX_EVENT_FILES}개면 올리기 전에 멈춘다`, async () => {
  const h = harness({ attachments: Array.from({ length: MAX_EVENT_FILES }, (_, i) => ref('f' + i, i + '.jpg')) });
  const r = await h.attach();
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'too_many_files');
  assert.equal(h.drive.uploads, 0);
});

test('붙이기: 없는 일정이면 올리지 않는다 · 파일 없음·빈 파일 거절', async () => {
  const h = harness();
  assert.equal((await h.attach({ eventId: 'missing' })).status, 404);
  assert.equal(h.drive.uploads, 0);
  assert.equal((await h.attach({ file: null })).body.code, 'file_missing');
  assert.equal((await h.attach({ file: new File([], 'a.jpg', { type: 'image/jpeg' }) })).body.code, 'file_empty');
});

test('일정 읽기: 첨부는 Drive 파일만, 세 칸(id·이름·종류)만 준다', async () => {
  const h = harness({ attachments: [ref('a1', '사진.jpg'), { fileUrl: 'https://example.com/x', title: '바깥 주소' }, ref('bad id', 'x')] });
  const r = await h.getEvent();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.event.files, [{ drive_file_id: 'a1', file_name: '사진.jpg', mime_type: 'image/jpeg' }]);
});

test('빼기: 일정에서만 떼고 Drive 파일은 그대로 · 이미 빠졌으면 404', async () => {
  const h = harness({ attachments: [ref('a1', '사진.jpg'), ref('a2', '안내.pdf', 'application/pdf')], files: [{ id: 'a1', name: '사진.jpg' }] });
  const r = await h.post('detach-file', { drive_file_id: 'a1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.files.map(f => f.drive_file_id), ['a2']);
  assert.equal(h.drive.calls.length, 0, 'Drive를 부르지 않는다');
  assert.equal((await h.post('detach-file', { drive_file_id: 'a1' })).status, 404);
});

test('삭제: 떼고 일정 첨부 폴더의 내 파일을 Drive 휴지통으로(영구 삭제 아님) · 되돌리기는 꺼내고 다시 붙임', async () => {
  const h = harness({ attachments: [ref('a1', '사진.jpg')], files: [{ id: 'a1', name: '사진.jpg' }] });
  const r = await h.post('trash-file', { drive_file_id: 'a1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.drive, 'trashed');
  assert.deepEqual(r.body.files, []);
  assert.equal(h.drive.files.get('a1').trashed, true);
  assert.equal(h.drive.deleted.length, 0);
  assert.deepEqual(h.userReads.sort(), ['app_documents', 'app_notes', 'app_task_attachments']);
  const back = await h.post('restore-file', { drive_file_id: 'a1' });
  assert.equal(back.status, 200);
  assert.equal(back.body.restored, true);
  assert.equal(h.drive.files.get('a1').trashed, false);
  assert.deepEqual(back.body.files.map(f => f.drive_file_id), ['a1']);
});

test('삭제: 다른 기록(자료)이 같은 파일을 쓰면 Drive는 그대로 · 다른 폴더 파일은 휴지통에 보내지 않음', async () => {
  const kept = harness({ attachments: [ref('a1', '사진.jpg')], files: [{ id: 'a1', name: '사진.jpg' }], used: { app_documents: true } });
  const r = await kept.post('trash-file', { drive_file_id: 'a1' });
  assert.equal(r.body.drive, 'kept');
  assert.equal(kept.drive.files.get('a1').trashed, false);
  const other = harness({ attachments: [ref('a1', '사진.jpg')], files: [{ id: 'a1', name: '사진.jpg', parents: ['somewhere-else'] }] });
  const o = await other.post('trash-file', { drive_file_id: 'a1' });
  assert.equal(o.body.drive, 'not_ours');
  assert.equal(other.drive.files.get('a1').trashed, false);
  assert.deepEqual(o.body.files, [], '떼기는 된다');
});

test('되돌리기: 일정 첨부 폴더 밖 파일은 다시 붙이지 않는다', async () => {
  const h = harness({ files: [{ id: 'x1', name: '남의.jpg', parents: ['somewhere-else'], trashed: true }] });
  const r = await h.post('restore-file', { drive_file_id: 'x1' });
  assert.equal(r.status, 403);
  assert.equal(h.cal.calls.length, 0);
});

test('이름 수정: 확장자는 그대로, Drive 이름과 일정 첨부 이름을 함께 바꾼다 · 규칙 밖 이름·폴더 밖 파일 거절', async () => {
  const h = harness({ attachments: [ref('a1', '사진.jpg')], files: [{ id: 'a1', name: '사진.jpg' }] });
  const r = await h.post('rename-file', { drive_file_id: 'a1', base: '현장 사진' });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, '현장 사진.jpg');
  assert.equal(r.body.event_synced, true);
  assert.equal(h.drive.files.get('a1').name, '현장 사진.jpg');
  assert.equal(h.ev.attachments[0].title, '현장 사진.jpg');
  assert.equal((await h.post('rename-file', { drive_file_id: 'a1', base: 'a/b' })).status, 400);
  const other = harness({ attachments: [ref('a1', '사진.jpg')], files: [{ id: 'a1', name: '사진.jpg', parents: ['somewhere-else'] }] });
  assert.equal((await other.post('rename-file', { drive_file_id: 'a1', base: '새 이름' })).status, 403);
  assert.equal(other.drive.patches.length, 0);
});

test('인증 경계 그대로: 로그인 없으면 401, 작업공간 소유자가 아니면 403 — Google·Drive를 부르지 않는다', async () => {
  const h = harness();
  assert.equal((await h.attach({ token: null })).status, 401);
  assert.equal((await h.post('trash-file', { drive_file_id: 'a1' }, null)).status, 401);
  const n = harness({ member: 'viewer' });
  assert.equal((await n.attach()).status, 403);
  assert.equal((await n.post('detach-file', { drive_file_id: 'a1' })).status, 403);
  assert.equal(h.cal.calls.length + n.cal.calls.length + h.drive.calls.length + n.drive.calls.length, 0);
});

test('Google 요청 범위는 그대로(달력 연결에 Drive 범위를 더하지 않음)', () => {
  assert.ok(RAW.includes("scope:'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly'"));
  assert.equal(/auth\/drive/.test(RAW), false);
  const files = readFileSync(new URL('../../supabase/functions/google-calendar/event-files.ts', import.meta.url), 'utf8');
  assert.equal(/permissions/.test(files.replace(/permissions_unavailable/g, '')), false, 'Drive 공유 설정을 건드리지 않는다');
});

test('작은 그림: 그 일정에 붙어 있는 내 사진만 Drive 썸네일로(저장 없음) · 안 붙은 파일·사진 아닌 파일은 거절', async () => {
  const h = harness({ attachments: [ref('a1', '사진.jpg'), ref('d1', '안내.pdf', 'application/pdf')], files: [{ id: 'a1', name: '사진.jpg' }, { id: 'd1', name: '안내.pdf', mimeType: 'application/pdf' }, { id: 'loose', name: '다른.jpg' }] });
  const ok = await h.photo('a1');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [1, 2, 3]);
  assert.deepEqual(h.drive.thumbs, ['/thumb-a1=s480']);
  assert.equal((await h.photo('loose')).status, 404, '그 일정에 붙지 않은 파일은 보이지 않는다');
  assert.equal((await h.photo('d1')).status, 415);
  assert.equal((await h.photo('a1', null)).status, 401);
});
