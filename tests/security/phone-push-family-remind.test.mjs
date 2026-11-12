// FAMILY-기억알림 ②: phone-push 15분 예약(quarter)이 서울 월요일 08시 이후 '가족 · 이번 주 기억할 것 n'을 주 1회 보낸다.
// - 줄 고르기는 홈 칸과 같은 규칙(app/family-remind-model.mjs — 서버는 바이트 사본), 보낸 뒤 노트 metadata.remind를 같은 규칙으로 갱신.
// - 끄기(skipped_off)·조용한 시간(held_quiet → 끝난 뒤)·같은 주 한 번(열쇠 rem:<월요일>). 본문은 family 종류만(다른 종류는 지금처럼 본문 없음).
// 네트워크 없음, 모두 지어낸 값(가짜 글).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
const H = await import('../../supabase/functions/phone-push/handler.ts');
const R = await import('../../supabase/functions/phone-push/family-remind.ts');
const F = await import('../../supabase/functions/_shared/fcm-send.ts');
const M = await import('../../app/family-remind-model.mjs');
const root = new URL('../../', import.meta.url).pathname;
const read = f => readFileSync(root + f, 'utf8');

const SB = 'https://synthetic.supabase.test', SERVICE = 'synthetic-service-role-key', SECRET = 'synthetic-phone-push-cron-secret-0123456789';
const WS = 'a0000000-0000-4000-8000-000000000001', USER = 'b0000000-0000-4000-8000-000000000001';
const NOTE_ID = 'e0000000-0000-4000-8000-000000000001';
const FN = 'https://synthetic.supabase.test/functions/v1/phone-push';
const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const SA = JSON.stringify({type: 'service_account', project_id: 'web2-phone-test', client_email: 'push-sender@web2-phone-test.iam.gserviceaccount.com', private_key: privateKey.export({type: 'pkcs8', format: 'pem'})});
const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const para = text => ({type: 'paragraph', content: [{type: 'text', text}]});
const LINES = ['☐ 가짜 줄 하나 우산 챙기기', '가짜 줄 둘 화분 물 주기', '가짜 줄 셋 택배 찾기', '가짜 줄 넷 전등 갈기', '가짜 줄 다섯 영수증 정리'];
const DOC = {v: 'ed1', doc: {type: 'doc', content: LINES.map(para)}};
const MON9 = Date.parse('2026-11-16T00:00:00Z');   // 월 09:00 KST
const MON7 = Date.parse('2026-11-15T22:30:00Z');   // 월 07:30 KST
const TUE9 = Date.parse('2026-11-17T00:00:00Z');   // 화 09:00 KST

function harness({now, note = {id: NOTE_ID, doc: DOC, updated_at: '2026-11-10T01:00:00.000000+00:00', metadata: {family_list: true, folder: '가족'}}, prefs = null, log = [], patchOk = true} = {}) {
  const state = {log: structuredClone(log), fcm: [], rest: [], patches: [], note: structuredClone(note)};
  const fetcher = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET';
    if (u.origin === 'https://oauth2.googleapis.com') return reply(200, {access_token: 'ya29.synthetic'});
    if (u.origin === 'https://fcm.googleapis.com') { state.fcm.push(JSON.parse(init.body)); return reply(200, {name: 'projects/x/messages/1'}); }
    assert.equal(u.origin, SB);
    const table = u.pathname.slice('/rest/v1/'.length), q = u.searchParams, body = init.body ? JSON.parse(init.body) : undefined;
    state.rest.push({method, table, q: Object.fromEntries(q)});
    const ws = q.get('workspace_id')?.replace('eq.', '');
    if (table === 'app_push_log' && method === 'DELETE') return reply(200, []);
    if (table === 'app_push_devices' && method === 'GET') return reply(200, [{id: 'c0000000-0000-4000-8000-0000000000a1', workspace_id: WS, fcm_token: 'devTokenAAAA_bbbb:cccc-000111'}]);
    if (table === 'app_family_notes') return reply(200, []);
    if (table === 'app_notes' && method === 'GET') {
      assert.equal(q.get('select'), 'id,doc,updated_at,metadata');
      assert.equal(q.get('metadata->>family_list'), 'eq.true');
      assert.equal(q.get('ai_export_allowed'), 'is.false');
      assert.equal(q.get('deleted_at'), 'is.null');
      assert.equal(ws, WS);
      return reply(200, state.note ? [state.note] : []);
    }
    if (table === 'app_notes' && method === 'PATCH') {
      assert.deepEqual(Object.keys(body), ['metadata']);
      state.patches.push({q: Object.fromEntries(q), body});
      return patchOk ? reply(204) : reply(409, {});
    }
    if (table === 'app_workspace_members') return reply(200, [{user_id: USER}]);
    if (table === 'app_profiles') return reply(200, [{notify_prefs: prefs}]);
    if (table === 'app_push_log' && method === 'GET') {
      const kind = q.get('kind')?.replace('eq.', ''), ref = decodeURIComponent(q.get('ref_key')?.replace('eq.', '') ?? '');
      return reply(200, state.log.filter(r => r.workspace_id === ws && r.kind === kind && r.ref_key === ref));
    }
    if (table === 'app_push_log' && method === 'POST') {
      assert.deepEqual(Object.keys(body).sort(), ['day', 'kind', 'ref_key', 'status', 'workspace_id'], '기록에는 제목·본문이 없다');
      const i = state.log.findIndex(r => r.workspace_id === body.workspace_id && r.kind === body.kind && r.ref_key === body.ref_key && r.day === body.day);
      if (i >= 0) state.log[i] = {...state.log[i], ...body}; else state.log.push(body);
      return reply(201);
    }
    if (table === 'app_push_devices' && method === 'PATCH') return reply(204);
    throw new Error('unexpected ' + method + ' ' + table);
  };
  const logs = [];
  const handler = H.createPhonePushHandler({env: n => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE, PHONE_PUSH_CRON_SECRET: SECRET, FCM_SERVICE_ACCOUNT_JSON: SA})[n], fetch: fetcher, now: () => now, log: (c, d) => logs.push(JSON.stringify([c, d]))});
  const cron = slot => handler(new Request(`${FN}?action=run&slot=${slot}`, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-phone-push-cron-secret': SECRET}, body: '{}'}));
  return {cron, state, logs};
}

test('서버 줄 고르기 규칙은 앱 규칙 파일의 바이트 사본이다(규칙 한 곳)', () => {
  for (const f of ['family-remind-model.mjs', 'ed-schema.mjs']) {
    const banner = `// Source of truth: app/${f}.\n// Deployment-local copy; the regression compares everything below this banner byte for byte.\n`;
    const copy = read(`supabase/functions/_shared/${f}`);
    assert.ok(copy.startsWith(banner), f);
    assert.equal(copy.slice(banner.length), read(`app/${f}`), f);
  }
});

test('월요일 09시: 한 번 보낸다 — 제목·본문(홈과 같은 3줄), 누르면 잊지 말기, 본 기록 갱신, 같은 주 두 번 안 감', async () => {
  const h = harness({now: MON9});
  const out = await (await h.cron('quarter')).json();
  assert.equal(out.remind.sent, 1);
  assert.equal(h.state.fcm.length, 1);
  const data = h.state.fcm[0].message.data;
  // 홈 칸과 같은 셈(app/family-remind-model.mjs pickToday)으로 고른 3줄.
  const expect = M.pickToday(M.remindLines(DOC), M.readRemind({}), '2026-11-16');
  const text = M.pushText(expect.picks);
  assert.deepEqual(data, {kind: 'family', title: '가족 · 이번 주 기억할 것 3', open: R.REMIND_OPEN, body: text.body});
  assert.equal(data.open, '/work/app/?view=basket');
  assert.match(data.body, /우산 챙기기 · 가짜 줄 둘/);
  assert.doesNotMatch(data.body, /☐/);
  assert.equal(h.state.fcm[0].message.android.priority, 'normal');
  assert.deepEqual(h.state.log.map(l => [l.kind, l.ref_key, l.day, l.status]), [['family', 'rem:2026-11-16', '2026-11-16', 'sent']]);
  // 본 기록: 같은 3줄의 열쇠, 다른 metadata 칸 그대로, 읽은 판 그대로일 때만.
  assert.equal(h.state.patches.length, 1);
  const p = h.state.patches[0];
  assert.deepEqual(p.body.metadata, {family_list: true, folder: '가족', remind: expect.next});
  assert.deepEqual(p.body.metadata.remind.picks, expect.picks.map(l => l.key));
  assert.equal(p.q.updated_at, 'eq.2026-11-10T01:00:00.000000+00:00');
  assert.equal(p.q.metadata, 'eq.' + JSON.stringify({family_list: true, folder: '가족'}));
  assert.equal(p.q.ai_export_allowed, 'is.false');
  assert.equal(p.q.deleted_at, 'is.null');
  assert.equal(p.q.id, `eq.${NOTE_ID}`);
  assert.ok(!('updated_at' in p.body), '고친 날은 그대로');
  // 로그에는 줄 글이 없다.
  assert.doesNotMatch(h.logs.join('\n'), /가짜 줄/);
  // 같은 주: 다시 돌아도(같은 날·다음 날) 안 간다.
  await h.cron('quarter');
  assert.equal(h.state.fcm.length, 1);
  const again = harness({now: TUE9, log: h.state.log});
  await again.cron('quarter');
  assert.equal(again.state.fcm.length, 0);
});

test('월요일 08시 전·다른 요일·다른 예약이면 노트를 읽지도 보내지도 않는다', async () => {
  for (const [now, slot] of [[MON7, 'quarter'], [TUE9, 'quarter'], [MON9, 'morning'], [MON9, 'evening'], [MON9, 'friday']]) {
    const h = harness({now});
    await h.cron(slot);
    assert.equal(h.state.fcm.length, 0, `${now} ${slot}`);
    assert.ok(h.state.rest.every(c => c.table !== 'app_notes'), `${now} ${slot}`);
  }
});

test('조용한 시간이면 held_quiet로 남기고 끝난 뒤 그날 보낸다. 끄면 skipped_off. 줄이 없으면 아무것도 안 남김', async () => {
  const quiet = {quiet: {from: '08:00', to: '10:00'}};
  const held = harness({now: MON9, prefs: quiet});
  await held.cron('quarter');
  assert.equal(held.state.fcm.length, 0);
  assert.deepEqual(held.state.log.map(l => l.status), ['held_quiet']);
  assert.equal(held.state.patches.length, 0);
  const later = harness({now: Date.parse('2026-11-16T01:30:00Z'), prefs: quiet, log: held.state.log}); // 10:30 KST
  await later.cron('quarter');
  assert.equal(later.state.fcm.length, 1);
  assert.deepEqual(later.state.log.map(l => l.status), ['sent']);

  const off = harness({now: MON9, prefs: {kinds: {family: false}}});
  await off.cron('quarter');
  assert.equal(off.state.fcm.length, 0);
  assert.deepEqual(off.state.log.map(l => [l.ref_key, l.status]), [['rem:2026-11-16', 'skipped_off']]);
  await off.cron('quarter');
  assert.equal(off.state.fcm.length, 0);

  for (const note of [null, {id: NOTE_ID, doc: {v: 'ed1', doc: {type: 'doc', content: [{type: 'paragraph'}]}}, updated_at: 'x', metadata: {family_list: true}}]) {
    const none = harness({now: MON9, note});
    await none.cron('quarter');
    assert.equal(none.state.fcm.length, 0);
    assert.equal(none.state.log.length, 0);
  }
});

test('줄이 3개보다 적으면 그 수, 본 기록 쓰기가 막혀도(그사이 바뀐 노트) 알림 기록은 남는다', async () => {
  const two = {v: 'ed1', doc: {type: 'doc', content: [para('가짜 하나'), para('가짜 둘')]}};
  const h = harness({now: MON9, note: {id: NOTE_ID, doc: two, updated_at: 'u1', metadata: {family_list: true}}, patchOk: false});
  const out = await (await h.cron('quarter')).json();
  assert.equal(out.remind.sent, 1);
  assert.equal(h.state.fcm[0].message.data.title, '가족 · 이번 주 기억할 것 2');
  assert.equal(h.state.fcm[0].message.data.body, '가짜 하나 · 가짜 둘');
  assert.deepEqual(h.state.log.map(l => l.status), ['sent']);
  assert.equal(h.state.patches.length, 1);
});

test('fcm-send: 본문은 family 종류만, 한 줄 120자. 다른 종류는 body를 넘겨도 kind·title·open 세 칸 그대로', () => {
  assert.deepEqual(F.BODY_KINDS, ['family']);
  for (const kind of ['test', 'task_due', 'commitment', 'meeting_done', 'collect_stall', 'morning', 'evening', 'next_week', 'quiet_digest']) {
    assert.deepEqual(F.fcmData({kind, title: '제목', open: '/work/app/', urgent: false, body: '가짜 본문'}), {kind, title: '제목', open: '/work/app/'}, kind);
  }
  assert.deepEqual(F.fcmData({kind: 'family', title: '잊지 말기 2건', open: '/work/app/', urgent: false}), {kind: 'family', title: '잊지 말기 2건', open: '/work/app/'});
  assert.deepEqual(F.fcmData({kind: 'family', title: 't', open: '/work/app/', urgent: false, body: '  \n '}), {kind: 'family', title: 't', open: '/work/app/'});
  const long = F.fcmData({kind: 'family', title: 't', open: '/work/app/', urgent: false, body: '가\n'.repeat(200)}).body;
  assert.equal([...long].length, F.BODY_MAX);
  assert.ok(long.endsWith('…'));
  assert.doesNotMatch(long, /\n/);
});

test('remindWeek: 서울 월요일 날짜, 08시부터 그날만', () => {
  assert.deepEqual(R.remindWeek(MON9), {monday: '2026-11-16', due: true});
  assert.deepEqual(R.remindWeek(MON7), {monday: '2026-11-16', due: false});
  assert.deepEqual(R.remindWeek(TUE9), {monday: '2026-11-16', due: false});
  assert.deepEqual(R.remindWeek(Date.parse('2026-11-15T14:59:00Z')), {monday: '2026-11-09', due: false}); // 일 23:59 KST
  assert.deepEqual(R.remindWeek(Date.parse('2026-11-16T14:59:00Z')), {monday: '2026-11-16', due: true}); // 월 23:59 KST
});
