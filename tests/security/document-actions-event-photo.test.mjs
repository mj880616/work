// CAL-일정첨부 요청 6번 '사업 보고로 넘기기'(S59-23, 설계 docs/design/event-attach.md 5절): document-actions `link-event-photo`와
// 그렇게 이은 자료를 지울 때의 규칙(자료 행만 지우고 Drive 원본은 둔다)을 실제 처리 코드(index.ts + _shared 도우미)로 확인한다.
// Google 캘린더·Drive·Supabase는 시험 쪽 흉내(가짜 이름·가짜 id)다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { readBoundedJson } from '../../supabase/functions/_shared/bounded-json.mjs';
import { inspectBasketOriginal } from '../../supabase/functions/_shared/basket-file-origin.ts';
import { createHwpEdit, HwpEditError } from '../../supabase/functions/_shared/hwp-edit.ts';
import { EVENT_ATTACH_FOLDER } from '../../supabase/functions/_shared/event-attach-file.ts';
import { calendarAccessToken, CalendarTokenError } from '../../supabase/functions/_shared/google-calendar-token.ts';
import { withEdgeShared } from './helpers/edge-shared.mjs';

const read = rel => readFileSync(new URL('../../supabase/functions/' + rel, import.meta.url), 'utf8');
const source = stripTypeScriptTypes(withEdgeShared(read('document-actions/index.ts')), { mode: 'strip' })
  .replace(/^import .*(?:basket-file-origin\.ts|bounded-json\.mjs|hwp-edit\.ts|document-text\.ts|file-rename\.ts|file-trash\.ts|dev-inbox\.ts).*;\s*$/gm, '');

const MEETING = '20000000-0000-4000-8000-000000000001', OTHER_MEETING = '20000000-0000-4000-8000-000000000002';
const PHOTO = 'ev-photo_1', LIB = 'lib-folder-1', EVENT_FOLDER = 'event-folder-1';
const CAL = 'qa-cal+group', EVENT = 'evt_example_1';
const FUTURE = '2099-01-01T00:00:00.000Z';

function harness(o = {}) {
  const state = {
    ownerRows: [{ workspace_id: 'ws-1', role: 'owner' }],
    memberRole: 'owner',
    meetings: [{ id: MEETING, workspace_id: 'ws-1', project_id: 'proj-1', business_area_id: 'area-1', deleted_at: null }],
    calendar: { user_id: 'owner-1', access_token: 'cal-access', refresh_token: 'cal-refresh', token_expires_at: FUTURE },
    event: { id: EVENT, status: 'confirmed', attachments: [
      { fileId: PHOTO, fileUrl: 'https://drive.google.com/file/d/ev-photo_1/view', title: '예시 현장.jpg', mimeType: 'image/jpeg' },
      { fileId: 'ev-doc_1', fileUrl: 'https://drive.google.com/file/d/ev-doc_1/view', title: '예시 안내문.pdf', mimeType: 'application/pdf' },
    ] },
    settings: { library_folder_id: LIB, basket_folder_id: null },
    drive: {
      [PHOTO]: { id: PHOTO, name: '예시 현장.jpg', mimeType: 'image/jpeg', size: '2048', webViewLink: 'https://drive.google.com/file/d/ev-photo_1/view', trashed: false, ownedByMe: true, parents: [EVENT_FOLDER] },
      'ev-doc_1': { id: 'ev-doc_1', name: '예시 안내문.pdf', mimeType: 'application/pdf', size: '10', trashed: false, ownedByMe: true, parents: [EVENT_FOLDER] },
      'lib-photo_2': { id: 'lib-photo_2', name: '예시 자료 사진.jpg', mimeType: 'image/jpeg', size: '30', trashed: false, ownedByMe: true, parents: [LIB] },
      [EVENT_FOLDER]: { id: EVENT_FOLDER, name: EVENT_ATTACH_FOLDER, mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, parents: [LIB] },
      [LIB]: { id: LIB, name: '자료실', mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, parents: ['my-root'] },
    },
    documents: [],
    driveStatus: {},
    ...o,
  };
  const calls = [];
  let handler, seq = 0;
  const fetchMock = async (url, init = {}) => {
    const u = new URL(String(url)), method = init.method || 'GET';
    const headers = new Headers(init.headers);
    calls.push({ host: u.host, path: u.pathname + u.search, method, auth: headers.get('Authorization') || '', body: typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : String(init.body ?? '') });
    if (u.pathname === '/auth/v1/user') return Response.json({ id: 'owner-1' });
    if (u.host === 'oauth2.googleapis.com') {
      const form = new URLSearchParams(String(init.body));
      if (form.get('refresh_token') === 'cal-refresh') return state.calendarRefresh ?? Response.json({ access_token: 'cal-fresh' });
      return Response.json({ access_token: 'drive-token' });
    }
    const table = u.pathname.startsWith('/rest/v1/') ? u.pathname.split('/').at(-1) : null;
    const eq = name => { const v = u.searchParams.get(name); return v?.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : null; };
    if (table === 'public_policy_drive_config') return Response.json([{ google_client_id: 'c', google_client_secret: 's' }]);
    if (table === 'app_drive_connections') return Response.json([{ workspace_id: 'ws-1', google_refresh_token: 'r' }]);
    if (table === 'app_workspace_members') {
      if (u.searchParams.has('workspace_id')) return Response.json(state.memberRole ? [{ role: state.memberRole }] : []);
      return Response.json(state.ownerRows, { headers: { 'Content-Range': state.ownerRows.length ? `0-${state.ownerRows.length - 1}/${state.ownerRows.length}` : '*/0' } });
    }
    if (table === 'app_meetings') return Response.json(state.meetings.filter(m => m.id === eq('id') && (!u.searchParams.has('deleted_at') || m.deleted_at == null)));
    if (table === 'app_google_calendar_connections') {
      if (method !== 'GET') throw Error('calendar connection must not be written');
      return Response.json(state.calendar && state.calendar.user_id === eq('user_id') ? [state.calendar] : []);
    }
    if (table === 'app_drive_settings') {
      if (state.settingsStatus) return Response.json({ message: 'x' }, { status: state.settingsStatus });
      const rows = state.settings ? [{ workspace_id: 'ws-1', ...state.settings }] : [];
      return Response.json(rows, { headers: { 'Content-Range': rows.length ? '0-0/1' : '*/0' } });
    }
    if (table === 'app_notes') return Response.json([], { headers: { 'Content-Range': '*/0' } });
    if (table === 'app_drive_download_tokens') return new Response(null, { status: 204 });
    if (table === 'app_documents') {
      if (method === 'GET') {
        const id = eq('id');
        if (id) return Response.json(state.documents.filter(d => d.id === id));
        return Response.json(state.documents.filter(d => d.workspace_id === eq('workspace_id') && d.file_id === eq('file_id') && (!u.searchParams.has('meeting_id') || d.meeting_id === eq('meeting_id'))).slice(0, 1).map(({ id, title }) => ({ id, title })));
      }
      if (method === 'POST') {
        if (state.insertStatus) return Response.json({ message: 'x' }, { status: state.insertStatus });
        const row = { id: 'doc-new-' + (++seq), ...JSON.parse(init.body) };
        state.documents.push(row);
        return Response.json([{ id: row.id, title: row.title, workspace_id: row.workspace_id, file_id: row.file_id }], { status: 201 });
      }
      if (method === 'DELETE') {
        const id = eq('id'), removed = state.documents.filter(d => d.id === id);
        state.documents = state.documents.filter(d => d.id !== id);
        return Response.json(removed.map(({ id }) => ({ id })));
      }
    }
    if (u.host === 'www.googleapis.com' && u.pathname.startsWith('/calendar/v3/calendars/')) {
      if (method !== 'GET') throw Error('calendar must not be written');
      if (state.eventStatus) return Response.json({ error: { code: state.eventStatus } }, { status: state.eventStatus });
      const [, , , , cal, , ev] = u.pathname.split('/');
      if (decodeURIComponent(cal) !== CAL || decodeURIComponent(ev) !== EVENT) return Response.json({ error: { code: 404 } }, { status: 404 });
      return Response.json(state.event);
    }
    if (u.pathname === '/drive/v3/files') return Response.json({ files: [] });
    if (u.pathname.startsWith('/drive/v3/files/')) {
      const id = decodeURIComponent(u.pathname.split('/').at(-1));
      if (method !== 'GET') { if (state.drive[id]) state.drive[id].trashed = true; return Response.json({ id, trashed: true }); }
      if (state.driveStatus[id]) return Response.json({}, { status: state.driveStatus[id] });
      return state.drive[id] ? Response.json(state.drive[id]) : Response.json({ error: { code: 404 } }, { status: 404 });
    }
    throw Error(`Unexpected ${method} ${u.host}${u.pathname}`);
  };
  const Deno = { env: { get: k => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k] }, serve: fn => { handler = fn; } };
  new Function('Deno', 'fetch', 'console', 'inspectBasketOriginal', 'readBoundedJson', 'createHwpEdit', 'HwpEditError', 'createDocumentText', source)(
    Deno, fetchMock, { error() {} }, inspectBasketOriginal, readBoundedJson, createHwpEdit, HwpEditError, () => { throw Error('document-text not used here'); });
  return {
    state, calls,
    send: async body => {
      const r = await handler(new Request('https://sb.example/functions/v1/document-actions', { method: 'POST', headers: { Authorization: 'Bearer user-token' }, body: JSON.stringify(body) }));
      return { status: r.status, body: await r.json() };
    },
  };
}
const link = (h, extra = {}) => h.send({ action: 'link-event-photo', meeting_id: MEETING, calendar_id: CAL, event_id: EVENT, drive_file_id: PHOTO, category: '회의', document_date: '2026-11-12', ...extra });
const posts = h => h.calls.filter(c => c.path.startsWith('/rest/v1/app_documents') && c.method === 'POST');
const driveWrites = h => h.calls.filter(c => c.path.startsWith('/drive/') && c.method !== 'GET');
const calendarCalls = h => h.calls.filter(c => c.path.startsWith('/calendar/'));

test('넘기기: 고른 일정 사진이 같은 Drive 원본을 가리키는 자료 행으로 그 사업 보고에 이어진다(올리기·복사·Drive 쓰기 없음)', async () => {
  const h = harness();
  const r = await link(h);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, result: 'created', document: { id: 'doc-new-1', title: '예시 현장' } });
  assert.equal(posts(h).length, 1);
  assert.deepEqual(posts(h)[0].body, {
    workspace_id: 'ws-1', project_id: 'area-1', meeting_id: MEETING, title: '예시 현장', category: '회의', source: null, document_date: '2026-11-12', description: null, tags: [],
    drive_url: 'https://drive.google.com/file/d/ev-photo_1/view', file_id: PHOTO, file_name: '예시 현장.jpg', mime_type: 'image/jpeg', file_size: 2048,
    visibility: 'private', uploaded_by: 'owner-1', auto_classified: false, classification_note: '일정에 붙인 사진에서 사업 보고로(같은 Drive 원본)',
  });
  assert.deepEqual(driveWrites(h), []);
  // 일정은 부른 사람 자기 캘린더 토큰으로 한 번 읽기만 했다(Google 캘린더 쓰기 없음).
  assert.deepEqual(calendarCalls(h).map(c => [c.method, c.auth]), [['GET', 'Bearer cal-access']]);
  assert.match(calendarCalls(h)[0].path, /\/calendar\/v3\/calendars\/qa-cal%2Bgroup\/events\/evt_example_1\?fields=id%2Cstatus%2Cattachments$/);
  // 캘린더 연결은 부른 사람(owner-1) 행만 읽는다.
  assert.ok(h.calls.some(c => c.path.startsWith('/rest/v1/app_google_calendar_connections?user_id=eq.owner-1&')));
});

test('넘기기: 사업영역이 없으면 사업 보고의 프로젝트, 종류·날짜를 안 보내면 기타·빈 값', async () => {
  const h = harness({ meetings: [{ id: MEETING, workspace_id: 'ws-1', project_id: 'proj-1', business_area_id: null, deleted_at: null }] });
  const r = await h.send({ action: 'link-event-photo', meeting_id: MEETING, calendar_id: CAL, event_id: EVENT, drive_file_id: PHOTO });
  assert.equal(r.body.result, 'created');
  assert.equal(posts(h)[0].body.project_id, 'proj-1');
  assert.equal(posts(h)[0].body.category, '기타');
  assert.equal(posts(h)[0].body.document_date, null);
});

test('넘기기: 같은 보고에 같은 원본이 이미 있으면 새로 만들지 않고, 다른 보고·자료실에 있던 같은 원본이면 이 보고에 하나 더 잇는다', async () => {
  const had = harness({ documents: [{ id: 'doc-had', title: '이미 넣음', workspace_id: 'ws-1', file_id: PHOTO, meeting_id: MEETING }] });
  assert.deepEqual((await link(had)).body, { ok: true, result: 'exists', document: { id: 'doc-had', title: '이미 넣음' } });
  assert.equal(posts(had).length, 0);
  const elsewhere = harness({ documents: [{ id: 'doc-other', title: '다른 보고', workspace_id: 'ws-1', file_id: PHOTO, meeting_id: OTHER_MEETING }, { id: 'doc-lib', title: '자료실', workspace_id: 'ws-1', file_id: PHOTO, meeting_id: null }] });
  const r = await link(elsewhere);
  assert.equal(r.body.result, 'created');
  assert.equal(posts(elsewhere)[0].body.meeting_id, MEETING);
});

test('넘기기: 서버가 사업 보고·작업공간·일정 첨부·파일 정보를 정한다 — 화면이 보낸 값은 쓰지 않는다', async () => {
  const h = harness();
  await link(h, { workspace_id: 'ws-evil', file_name: 'evil.exe', mime_type: 'text/html', title: 'x', visibility: 'public', project_id: 'proj-evil', uploaded_by: 'someone' });
  const row = posts(h)[0].body;
  assert.equal(row.workspace_id, 'ws-1');
  assert.equal(row.file_name, '예시 현장.jpg');
  assert.equal(row.mime_type, 'image/jpeg');
  assert.equal(row.visibility, 'private');
  assert.equal(row.project_id, 'area-1');
  assert.equal(row.uploaded_by, 'owner-1');
});

test('넘기기 거절: 남의·휴지통·없는 사업 보고, 소유자 아님, 모양이 틀린 요청 — 아무것도 쓰지 않고 캘린더·Drive도 부르지 않는다', async () => {
  const cases = [
    [{ meetings: [] }, {}, 'MEETING_NOT_FOUND'],
    [{ meetings: [{ id: MEETING, workspace_id: 'ws-1', project_id: null, business_area_id: null, deleted_at: '2026-11-11T00:00:00Z' }] }, {}, 'MEETING_NOT_FOUND'],
    [{ meetings: [{ id: MEETING, workspace_id: 'ws-other', project_id: null, business_area_id: null, deleted_at: null }] }, {}, 'FORBIDDEN'],
    [{ ownerRows: [] }, {}, 'FORBIDDEN'],
    [{ ownerRows: [{ workspace_id: 'ws-1', role: 'owner' }, { workspace_id: 'ws-2', role: 'owner' }] }, {}, 'FORBIDDEN'],
    [{}, { meeting_id: 'not-a-uuid' }, 'INVALID_REQUEST'],
    [{}, { drive_file_id: '../x' }, 'INVALID_REQUEST'],
    [{}, { drive_file_id: '' }, 'INVALID_REQUEST'],
    [{}, { event_id: '' }, 'INVALID_REQUEST'],
    [{}, { event_id: 'a/b' }, 'INVALID_REQUEST'],
    [{}, { calendar_id: 'x y' }, 'INVALID_REQUEST'],
    [{}, { category: 'x'.repeat(61) }, 'INVALID_REQUEST'],
    [{}, { category: '줄\n바꿈' }, 'INVALID_REQUEST'],
    [{}, { document_date: '2026-13-45' }, 'INVALID_REQUEST'],
    [{}, { document_date: '2026-02-30' }, 'INVALID_REQUEST'],
    [{}, { document_date: 'yesterday' }, 'INVALID_REQUEST'],
  ];
  for (const [o, extra, code] of cases) {
    const h = harness(o);
    const r = await link(h, extra);
    assert.equal(r.status, 400, JSON.stringify([o, extra]));
    assert.equal(r.body.code, code, JSON.stringify([o, extra]));
    assert.equal(posts(h).length, 0);
    assert.deepEqual(calendarCalls(h), [], JSON.stringify([o, extra]));
    assert.equal(h.calls.some(c => c.path.startsWith('/drive/')), false);
  }
});

test('넘기기 거절: 그 일정의 사진 첨부가 아니면(없는 일정·남의 일정·붙지 않은 파일·사진 아님·연결 없음) 아무것도 쓰지 않는다', async () => {
  const cases = [
    [{ eventStatus: 404 }, {}, 'EVENT_NOT_FOUND'],
    [{ eventStatus: 403 }, {}, 'EVENT_NOT_FOUND'],
    [{ eventStatus: 410 }, {}, 'EVENT_NOT_FOUND'],
    [{ event: { id: EVENT, status: 'cancelled', attachments: [] } }, {}, 'EVENT_NOT_FOUND'],
    [{ eventStatus: 401 }, {}, 'CALENDAR_AUTH'],
    [{ eventStatus: 500 }, {}, 'CALENDAR_UNAVAILABLE'],
    [{}, { event_id: 'evt_someone_else' }, 'EVENT_NOT_FOUND'],
    [{}, { drive_file_id: 'not-attached_9' }, 'ATTACHMENT_NOT_FOUND'],
    [{ event: { id: EVENT, status: 'confirmed' } }, {}, 'ATTACHMENT_NOT_FOUND'],
    [{}, { drive_file_id: 'ev-doc_1' }, 'NOT_PHOTO'],
    [{ calendar: null }, {}, 'CALENDAR_NOT_CONNECTED'],
    [{ calendar: { user_id: 'owner-1', access_token: '', refresh_token: '', token_expires_at: null } }, {}, 'CALENDAR_AUTH'],
    [{ calendar: { user_id: 'owner-1', access_token: 'old', refresh_token: 'cal-refresh', token_expires_at: '2000-01-01T00:00:00Z' }, calendarRefresh: Response.json({ error: 'invalid_grant' }, { status: 400 }) }, {}, 'CALENDAR_AUTH'],
  ];
  for (const [o, extra, code] of cases) {
    const h = harness(o);
    const r = await link(h, extra);
    assert.equal(r.status, 400, JSON.stringify([o, extra]));
    assert.equal(r.body.code, code, JSON.stringify([o, extra]));
    assert.equal(posts(h).length, 0);
    assert.deepEqual(driveWrites(h), []);
    assert.equal(h.calls.some(c => c.path.startsWith('/drive/')), false, '일정 확인이 Drive보다 먼저');
  }
});

test('넘기기: 캘린더 접근 토큰이 만료됐으면 갱신 열쇠로 새로 받아 쓰고, 연결 행에는 쓰지 않는다', async () => {
  const h = harness({ calendar: { user_id: 'owner-1', access_token: 'old', refresh_token: 'cal-refresh', token_expires_at: '2000-01-01T00:00:00Z' } });
  const r = await link(h);
  assert.equal(r.body.result, 'created');
  assert.deepEqual(calendarCalls(h).map(c => c.auth), ['Bearer cal-fresh']);
  assert.equal(h.calls.filter(c => c.path.startsWith('/rest/v1/app_google_calendar_connections') && c.method !== 'GET').length, 0);
});

test('넘기기 거절: \'자료실 › 일정 첨부\' 폴더의 원본이 아니면(Google 앱에서 붙인 다른 Drive 파일 등) 넘기지 않는다', async () => {
  const outside = (patch) => { const h = harness(); Object.assign(h.state.drive[PHOTO], patch); return h; };
  const cases = [
    [outside({ parents: [LIB] }), 'NOT_EVENT_FILE'],
    [outside({ parents: ['someone-folder'] }), 'NOT_EVENT_FILE'],
    [outside({ parents: [] }), 'NOT_EVENT_FILE'],
    [outside({ parents: [EVENT_FOLDER, LIB] }), 'NOT_EVENT_FILE'],
    [(() => { const h = harness(); h.state.drive[EVENT_FOLDER].name = '다른 폴더'; return h; })(), 'NOT_EVENT_FILE'],
    [(() => { const h = harness(); h.state.drive[EVENT_FOLDER].parents = ['my-root']; return h; })(), 'NOT_EVENT_FILE'],
    [(() => { const h = harness(); h.state.drive[EVENT_FOLDER].ownedByMe = false; return h; })(), 'NOT_EVENT_FILE'],
    [harness({ settings: null }), 'NOT_EVENT_FILE'],
    [harness({ driveStatus: { [PHOTO]: 404 } }), 'DRIVE_FILE_MISSING'],
    [harness({ driveStatus: { [PHOTO]: 500 } }), 'EVENT_ORIGIN_UNKNOWN'],
    [harness({ driveStatus: { [EVENT_FOLDER]: 500 } }), 'EVENT_ORIGIN_UNKNOWN'],
    [harness({ settingsStatus: 500 }), 'EVENT_ORIGIN_UNKNOWN'],
  ];
  for (const [h, code] of cases) {
    const r = await link(h);
    assert.equal(r.status, 400, code);
    assert.equal(r.body.code, code);
    assert.equal(posts(h).length, 0);
    assert.deepEqual(driveWrites(h), []);
  }
  // 휴지통의 원본·내 것이 아닌 원본은 등록 단계(registerDriveDocument)가 거절한다.
  for (const [patch, code] of [[{ trashed: true }, 'DRIVE_FILE_TRASHED'], [{ ownedByMe: false }, 'DRIVE_FILE_INVALID']]) {
    const h = outside(patch);
    const r = await link(h);
    assert.equal(r.body.code, code);
    assert.equal(posts(h).length, 0);
  }
});

test('넘기기: 쓰기 결과를 모르면 503으로 한 번만 알리고 다시 보내지 않는다', async () => {
  const h = harness({ insertStatus: 503 });
  const r = await link(h);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'RESULT_UNKNOWN');
  assert.equal(posts(h).length, 1);
});

test('지우기: 사업 보고로 넘긴 일정 사진 자료를 지우면 자료 행만 지우고 Drive 원본은 둔다(일정 첨부가 계속 열림)', async () => {
  const h = harness();
  const made = await link(h);
  const r = await h.send({ action: 'delete', document_id: made.body.document.id });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, drive_result: 'preserved', drive_preserved: true, reason: 'event_attachment' });
  assert.deepEqual(driveWrites(h), []);
  assert.equal(h.state.drive[PHOTO].trashed, false);
  assert.deepEqual(h.state.documents, []);
});

test('지우기: \'일정 첨부\' 폴더 원본이면 어떤 길로 등록된 자료든 Drive 원본을 두고, 그 밖의 자료실 원본은 지금처럼 휴지통으로', async () => {
  const eventDoc = { id: 'doc-ev', workspace_id: 'ws-1', file_id: PHOTO, meeting_id: null, title: '예시', classification_note: '사용자 수정' };
  const kept = harness({ documents: [eventDoc] });
  const r1 = await kept.send({ action: 'delete', document_id: 'doc-ev' });
  assert.equal(r1.body.reason, 'event_attachment');
  assert.deepEqual(driveWrites(kept), []);
  const plainDoc = { id: 'doc-lib', workspace_id: 'ws-1', file_id: 'lib-photo_2', meeting_id: MEETING, title: '예시 자료 사진' };
  const plain = harness({ documents: [plainDoc] });
  const r2 = await plain.send({ action: 'delete', document_id: 'doc-lib' });
  assert.deepEqual(r2.body, { ok: true, drive_result: 'trashed', drive_preserved: false, reason: 'ordinary_library' });
  assert.equal(driveWrites(plain).length, 1);
  assert.match(driveWrites(plain)[0].path, /\/drive\/v3\/files\/lib-photo_2$/);
  // 자료실 폴더가 없는 작업공간(일정 첨부 폴더도 없음)은 Drive를 더 부르지 않고 지금처럼.
  const noLib = harness({ documents: [plainDoc], settings: { library_folder_id: null, basket_folder_id: null } });
  const r3 = await noLib.send({ action: 'delete', document_id: 'doc-lib' });
  assert.equal(r3.body.drive_result, 'trashed');
});

test('지우기: 일정 첨부 원본인지 확인하지 못하면 자료 행도 Drive도 그대로 두고 멈춘다', async () => {
  for (const o of [{ driveStatus: { [EVENT_FOLDER]: 500 } }, { settings: { library_folder_id: '../bad', basket_folder_id: null } }]) {
    const h = harness({ ...o, documents: [{ id: 'doc-ev', workspace_id: 'ws-1', file_id: PHOTO, meeting_id: MEETING, title: '예시' }] });
    const r = await h.send({ action: 'delete', document_id: 'doc-ev' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'EVENT_ORIGIN_UNKNOWN');
    assert.deepEqual(driveWrites(h), []);
    assert.equal(h.state.documents.length, 1);
    assert.equal(h.calls.some(c => c.path.startsWith('/rest/v1/app_documents') && c.method === 'DELETE'), false);
  }
});

test('공용 도우미: 일정 첨부 폴더 이름은 google-calendar가 올리는 폴더와 같고, 캘린더 토큰은 남의 행·빈 id를 읽지 않는다', async () => {
  assert.match(read('google-calendar/event-files.ts'), new RegExp(`EVENT_FILES_FOLDER = "${EVENT_ATTACH_FOLDER}"`));
  const asked = [];
  const reader = { rest: async path => { asked.push(path); return []; } };
  await assert.rejects(calendarAccessToken(reader, '', { fetch: () => { throw Error('no fetch'); } }), e => e instanceof CalendarTokenError && e.code === 'calendar_not_connected');
  await assert.rejects(calendarAccessToken(reader, 'a&user_id=eq.b', { fetch: () => { throw Error('no fetch'); } }), e => e.code === 'calendar_not_connected');
  assert.deepEqual(asked, []);
  // 다른 사람 행이 돌아와도 쓰지 않는다.
  const other = { rest: async () => [{ user_id: 'someone', access_token: 'x', token_expires_at: FUTURE }] };
  await assert.rejects(calendarAccessToken(other, 'owner-1', { fetch: () => { throw Error('no fetch'); } }), e => e.code === 'calendar_not_connected');
  // 이 함수의 index.ts에는 앱 값 행(id=1)을 직접 읽는 줄이 없다(공용 도우미로만).
  assert.doesNotMatch(read('document-actions/index.ts'), /public_policy_drive_config/);
});
