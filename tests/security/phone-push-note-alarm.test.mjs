// S69-97 노트 알림 ②: phone-push 15분 예약(quarter)이 노트에 건 알림 시각(metadata.alarm.at)이 지난 36시간 안에 지난 노트마다
// '노트 다시 보기' 하나를 보낸다(본문 없음, 누르면 그 노트). 읽는 칸은 id·workspace_id·alarm뿐(제목·글 없음).
// 같은 열쇠(note:<id>:<시각>)는 한 번, 끄기(kinds.note=false → skipped_off), 조용한 시간에도 보냄, 노트에는 쓰지 않음.
// 네트워크 없음, 모두 지어낸 값.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
const H = await import('../../supabase/functions/phone-push/handler.ts');
const N = await import('../../supabase/functions/phone-push/note-alarm.ts');
const F = await import('../../supabase/functions/_shared/fcm-send.ts');

const SB = 'https://synthetic.supabase.test', SERVICE = 'synthetic-service-role-key', SECRET = 'synthetic-phone-push-cron-secret-0123456789';
const WS = 'a0000000-0000-4000-8000-000000000001', WS2 = 'a0000000-0000-4000-8000-000000000002', USER = 'b0000000-0000-4000-8000-000000000001';
const FN = 'https://synthetic.supabase.test/functions/v1/phone-push';
const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const SA = JSON.stringify({type: 'service_account', project_id: 'web2-phone-test', client_email: 'push-sender@web2-phone-test.iam.gserviceaccount.com', private_key: privateKey.export({type: 'pkcs8', format: 'pem'})});
const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const NOW = Date.parse('2026-11-26T15:00:00.000Z'); // 서울 11/27 00:00 — 기본 조용한 시간(22~07시) 안
const id = n => `e0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const SECRET_TITLE = '가상노트제목표식';
const note = (n, at, ws = WS, extra = {}) => ({id: id(n), workspace_id: ws, kind: 'note', deleted_at: null, title: SECRET_TITLE, doc: {secret: SECRET_TITLE}, metadata: {alarm: at === undefined ? undefined : {at}, folder: 'x', ...extra}});

function harness({notes = [], prefs = null, log = [], devicesFor = [WS, WS2], fcm = true, now = NOW} = {}) {
  const state = {log: structuredClone(log), fcm: [], rest: [], notesRead: [], writes: []};
  const fetcher = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET';
    if (u.origin === 'https://oauth2.googleapis.com') return reply(200, {access_token: 'ya29.synthetic'});
    if (u.origin === 'https://fcm.googleapis.com') { state.fcm.push(JSON.parse(init.body)); return reply(200, {name: 'projects/x/messages/1'}); }
    assert.equal(u.origin, SB);
    const table = u.pathname.slice('/rest/v1/'.length), q = u.searchParams, body = init.body ? JSON.parse(init.body) : undefined;
    state.rest.push({method, table, select: q.get('select')});
    const ws = q.get('workspace_id')?.replace('eq.', '');
    if (table === 'app_push_log' && method === 'DELETE') return reply(200, []);
    if (table === 'app_push_devices' && method === 'GET') {
      const all = devicesFor.map((w, i) => ({id: `c0000000-0000-4000-8000-0000000000a${i}`, workspace_id: w, fcm_token: `devToken${i}AAAA_bbbb:cccc-000111`}));
      return reply(200, ws ? all.filter(d => d.workspace_id === ws) : all);
    }
    if (table === H.FAMILY_TABLE) return reply(200, []);
    if (table === 'app_notes') {
      if (method !== 'GET') { state.writes.push({method, body}); return reply(204); }
      if (q.get('select') !== N.NOTE_SELECT) return reply(200, []); // 가족 노트(월요일 알림) 읽기 — 이 시험과 무관
      state.notesRead.push(Object.fromEntries(q));
      assert.equal(q.get('kind'), 'eq.note');
      assert.equal(q.get('deleted_at'), 'is.null');
      const allowed = q.get('workspace_id').replace(/^in\.\(|\)$/g, '').split(',');
      // 지어낸 DB: 창 거르기(글자 비교)·작업공간·휴지통을 PostgREST처럼 적용하고, 고른 칸만 돌려준다.
      const [gte, lte] = q.getAll('metadata->alarm->>at').map(v => v.replace(/^(gte|lte)\./, ''));
      return reply(200, notes.filter(r => allowed.includes(r.workspace_id) && r.kind === 'note' && !r.deleted_at
        && typeof r.metadata?.alarm?.at === 'string' && r.metadata.alarm.at >= gte && r.metadata.alarm.at <= lte)
        .map(r => ({id: r.id, workspace_id: r.workspace_id, alarm: r.metadata.alarm})));
    }
    if (table === 'app_workspace_members') return reply(200, [{user_id: USER}]);
    if (table === 'app_profiles') return reply(200, [{notify_prefs: prefs}]);
    if (table === 'app_push_log' && method === 'GET') {
      const kind = q.get('kind')?.replace('eq.', ''), raw = q.get('ref_key') ?? '';
      const refs = raw.startsWith('in.(') ? raw.slice(4, -1).split(',').map(s => s.replace(/^"|"$/g, '')) : [raw.replace('eq.', '')];
      return reply(200, state.log.filter(r => r.workspace_id === ws && r.kind === kind && refs.includes(r.ref_key)));
    }
    if (table === 'app_push_log' && method === 'POST') {
      assert.deepEqual(Object.keys(body).sort(), ['day', 'kind', 'ref_key', 'status', 'workspace_id'], '기록에는 제목·본문이 없다');
      const i = state.log.findIndex(r => r.workspace_id === body.workspace_id && r.kind === body.kind && r.ref_key === body.ref_key && r.day === body.day);
      if (i >= 0) state.log[i] = {...state.log[i], ...body}; else state.log.push(body);
      return reply(201);
    }
    if (table === 'app_push_devices' && method === 'PATCH') return reply(204);
    if (table.startsWith('rpc/')) return reply(200, null);
    throw new Error('unexpected ' + method + ' ' + table);
  };
  const logs = [];
  const handler = H.createPhonePushHandler({env: n => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE, PHONE_PUSH_CRON_SECRET: SECRET, ...(fcm ? {FCM_SERVICE_ACCOUNT_JSON: SA} : {})})[n], fetch: fetcher, now: () => now, log: (c, d) => logs.push(JSON.stringify([c, d]))});
  const cron = slot => handler(new Request(`${FN}?action=run&slot=${slot}`, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-phone-push-cron-secret': SECRET}, body: '{}'}));
  return {cron, state, logs};
}
const noteLog = s => s.log.filter(l => l.kind === 'note').map(l => [l.workspace_id, l.ref_key, l.status]);

test('창 안(지금−36시간, 지금]만 보낸다 — 미래·36시간 넘은 것·모양이 틀린 시각은 넘김', async () => {
  const notes = [
    note(1, '2026-11-26T15:00:00.000Z'),          // 지금 정각 — 보냄
    note(2, '2026-11-26T03:00:00.000Z'),          // 12시간 전 — 보냄
    note(3, '2026-11-26T15:15:00.000Z'),          // 15분 뒤 — 아직
    note(4, '2026-11-25T03:00:00.000Z'),          // 36시간 정확히 전 — 창 밖
    note(5, '2026-11-26T14:00:00.000Z', WS, {}),  // 보냄
    {...note(6, 'not-a-date'), metadata: {alarm: {at: '2026-11-26T1x:00:00.000Z'}}},
    {...note(7, undefined), metadata: {}},         // 알림 없음
    {...note(8, '2026-11-26T14:30:00.000Z'), deleted_at: '2026-11-26T00:00:00Z'}, // 휴지통
  ];
  const h = harness({notes});
  const out = await (await h.cron('quarter')).json();
  assert.deepEqual(out.note, {sent: 3, off: 0, failed: 0});
  assert.equal(out.sent, 3);
  // 오래된 시각부터, 노트마다 하나.
  assert.deepEqual(h.state.fcm.map(m => m.message.data.open), [id(2), id(5), id(1)].map(N.noteOpen));
  assert.deepEqual(noteLog(h.state).map(l => l[1]), [
    `note:${id(2)}:2026-11-26T03:00:00.000Z`, `note:${id(5)}:2026-11-26T14:00:00.000Z`, `note:${id(1)}:2026-11-26T15:00:00.000Z`]);
  assert.ok(noteLog(h.state).every(l => l[0] === WS && l[2] === 'sent'));
  assert.ok(h.state.log.every(l => l.day === '2026-11-27'), '기록 날짜는 서울 날짜');
  // 서버 재검사: DB 거르기를 지나온 이상한 값도 다시 본다.
  assert.equal(N.alarmAt({at: '2026-11-26T15:00:00.000Z'}, NOW), '2026-11-26T15:00:00.000Z');
  assert.equal(N.alarmAt({at: '2026-11-27T00:00+09:00'}, NOW), '2026-11-26T15:00:00.000Z');
  for (const bad of [null, 'x', [], {at: 1}, {at: ''}, {at: '2026-11-26'}, {at: '2026-13-40T99:00:00Z'}, {at: '2026-11-26T15:01:00.000Z'}, {at: '2026-11-25T03:00:00.000Z'}, {at: 'x'.repeat(50)}]) {
    assert.equal(N.alarmAt(bad, NOW), null, JSON.stringify(bad));
  }
});

test('읽는 칸은 id·workspace_id·alarm뿐(제목·글 없음), 노트에는 아무것도 쓰지 않는다, 로그·응답에 노트 id·제목 없음', async () => {
  const h = harness({notes: [note(1, '2026-11-26T14:45:00.000Z'), note(2, '2026-11-26T14:45:00.000Z', WS2)]});
  const out = await (await h.cron('quarter')).json();
  assert.equal(out.note.sent, 2);
  assert.equal(h.state.notesRead.length, 1, '기기가 있는 작업공간을 한 번에 읽는다');
  const r = h.state.notesRead[0];
  assert.equal(r.select, 'id,workspace_id,alarm:metadata->alarm');
  assert.doesNotMatch(r.select, /title|doc|body|text/);
  assert.equal(r.workspace_id, `in.(${WS},${WS2})`);
  assert.deepEqual(h.state.writes, [], '노트 updated_at·metadata 그대로');
  const all = JSON.stringify(out) + h.logs.join('\n') + JSON.stringify(h.state.fcm) + JSON.stringify(h.state.log);
  assert.doesNotMatch(all, new RegExp(SECRET_TITLE));
  assert.doesNotMatch(JSON.stringify(out) + h.logs.join('\n'), /e0000000-/, '응답·로그에 노트 id 없음');
});

test('보낼 글: 종류 note, 제목 노트 다시 보기, 본문 없음, 급하지 않음, 여는 주소는 그 노트', async () => {
  const h = harness({notes: [note(1, '2026-11-26T14:59:00.000Z')], devicesFor: [WS]});
  await h.cron('quarter');
  assert.equal(h.state.fcm.length, 1);
  const m = h.state.fcm[0].message;
  assert.deepEqual(m.data, {kind: 'note', title: '노트 다시 보기', open: `/work/app/?view=basket&pane=note&doc=${id(1)}`});
  assert.equal(m.android.priority, 'normal');
  assert.match(m.data.open, F.OPEN_PATH);
  assert.ok(!F.BODY_KINDS.includes('note'), '노트 알림은 본문을 싣지 않는다');
  assert.deepEqual(F.fcmData({kind: 'note', title: 't', open: m.data.open, urgent: false, body: '가짜 본문'}), {kind: 'note', title: 't', open: m.data.open});
});

test('같은 열쇠는 한 번(sent·failed·skipped_off 기록이 있으면 넘김), 시각을 바꾸면 새로 한 번', async () => {
  const n1 = note(1, '2026-11-26T14:00:00.000Z');
  const h = harness({notes: [n1]});
  await h.cron('quarter');
  await h.cron('quarter');
  assert.equal(h.state.fcm.length, 1);
  for (const status of ['sent', 'failed', 'skipped_off']) {
    const again = harness({notes: [n1], log: [{workspace_id: WS, kind: 'note', ref_key: `note:${id(1)}:2026-11-26T14:00:00.000Z`, day: '2026-11-26', status}]});
    await again.cron('quarter');
    assert.equal(again.state.fcm.length, 0, status);
  }
  const moved = harness({notes: [note(1, '2026-11-26T14:30:00.000Z')], log: h.state.log});
  await moved.cron('quarter');
  assert.equal(moved.state.fcm.length, 1);
});

test('끄면(kinds.note=false) 보내지 않고 skipped_off로 남긴다 — 다음 실행에서도 안 감', async () => {
  const h = harness({notes: [note(1, '2026-11-26T14:00:00.000Z'), note(2, '2026-11-26T14:10:00.000Z')], prefs: {kinds: {note: false}}, devicesFor: [WS]});
  const out = await (await h.cron('quarter')).json();
  assert.deepEqual(out.note, {sent: 0, off: 2, failed: 0});
  assert.equal(h.state.fcm.length, 0);
  assert.deepEqual(noteLog(h.state).map(l => l[2]), ['skipped_off', 'skipped_off']);
  await h.cron('quarter');
  assert.equal(h.state.fcm.length, 0);
  assert.equal(noteLog(h.state).length, 2);
  // 다른 종류를 꺼도 노트 알림은 간다.
  assert.equal(N.noteDecision({kinds: {family: false, task_due: false}}), 'send');
  assert.equal(N.noteDecision(null), 'send');
});

test('조용한 시간에도 보낸다(사람이 직접 고른 시각) — 기본 22~07시·직접 정한 조용한 시간 모두', async () => {
  for (const prefs of [null, {quiet: {from: '00:00', to: '23:59'}}]) {
    const h = harness({notes: [note(1, '2026-11-26T14:50:00.000Z')], prefs, devicesFor: [WS]});
    const out = await (await h.cron('quarter')).json();
    assert.equal(out.note.sent, 1, JSON.stringify(prefs));
    assert.deepEqual(noteLog(h.state).map(l => l[2]), ['sent']);
    assert.ok(!h.state.log.some(l => l.status === 'held_quiet'));
  }
});

test('한 작업공간에 한 실행 20개까지, 넘치면 다음 실행', async () => {
  const notes = Array.from({length: 23}, (_, i) => note(i + 1, new Date(NOW - (30 - i) * 60000).toISOString()));
  const h = harness({notes, devicesFor: [WS]});
  assert.equal((await (await h.cron('quarter')).json()).note.sent, 20);
  assert.equal((await (await h.cron('quarter')).json()).note.sent, 3);
  assert.equal(h.state.fcm.length, 23);
  assert.equal(new Set(h.state.fcm.map(m => m.message.data.open)).size, 23);
});

test('FCM 비밀값이 없거나 다른 예약이면 노트를 읽지도 보내지도 않는다', async () => {
  for (const [fcm, slot] of [[false, 'quarter'], [true, 'morning'], [true, 'evening']]) {
    const h = harness({notes: [note(1, '2026-11-26T14:00:00.000Z')], fcm});
    await h.cron(slot);
    assert.equal(h.state.fcm.length, 0, slot);
    assert.equal(h.state.notesRead.length, 0, slot);
  }
});

test('읽기 경로: 창 거르기·작업공간 목록·칸 셋', () => {
  const p = new URL('https://x/rest/v1/' + N.noteAlarmPath([WS, WS2], NOW));
  assert.equal(p.searchParams.get('select'), N.NOTE_SELECT);
  assert.deepEqual(p.searchParams.getAll('metadata->alarm->>at'), ['gte.2026-11-25T03:00:00.000Z', 'lte.2026-11-26T15:01:00.000Z']);
  assert.equal(p.searchParams.get('kind'), 'eq.note');
  assert.equal(p.searchParams.get('deleted_at'), 'is.null');
  assert.ok(N.noteRef(id(1), '2026-11-26T15:00:00.000Z').length <= 80);
  assert.match(N.noteRef(id(1), '2026-11-26T15:00:00.000Z'), /^[A-Za-z0-9_.:-]{1,80}$/, 'app_push_log_ref_check 모양');
});
