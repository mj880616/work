// PRIVACY-백업안내(S66-01): Edge record-backup의 경계를 고정한다. 값은 모두 가짜(운영 값 없음).
// - 로그인·owner 작업공간 하나가 아니면 거절, 작업공간·사용자는 서버가 정함(몸통의 다른 키 거절).
// - 기록 표는 사용자 토큰 + anon 키로만 읽고(서비스 역할 키를 기록 읽기에 쓰지 않음), 모든 읽기에 내 작업공간(프로필은 내 user_id) 조건이 붙는다.
// - 드라이브는 그 작업공간 연결만, '노조+ 백업/날짜' 폴더에 csv·읽기용 문서, 최근 4주만 남기고 오래된 날짜 폴더는 휴지통.
// - 응답·로그에 기록 내용이 실리지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const H = await import('../../supabase/functions/record-backup/handler.ts');
const M = await import('../../supabase/functions/record-backup/model.mjs');

const SB = 'https://synthetic.supabase.test', ANON = 'anon-synthetic', SERVICE = 'service-synthetic';
const USER = '20000000-0000-4000-8000-000000000001', WS = '10000000-0000-4000-8000-00000000000a', OTHER_WS = '10000000-0000-4000-8000-00000000000b';
const SECRET = '가짜 비밀 노트 본문';

function world({ connected = true, owner = WS, oldDays = [], features = [], rootName = null, appRoot = undefined, rootParent = 'root' } = {}) {
  const calls = [], logs = [], drive = { files: [], perms: {} };
  let n = 0;
  const id = () => `f${++n}`;
  if (rootName) drive.files.push({ id: id(), name: rootName, parents: [rootParent], appProperties: { kptu_backup: 'root' }, trashed: false });
  for (const d of oldDays) drive.files.push({ id: id(), name: d, parents: ['ROOT?'], appProperties: { kptu_backup: 'day', kptu_backup_date: d }, trashed: false });
  const rows = { app_notes: [{ id: 'n1', workspace_id: WS, title: '가짜 노트', body: SECRET }], app_profiles: [{ user_id: USER, display_name: '가짜 이름' }], app_suborganization_updates: [{ id: 'u1', raw_text: '가짜 보고', o: { workspace_id: WS } }] };
  async function fetch(url, init = {}) {
    url = String(url); const method = init.method || 'GET', h = init.headers || {};
    calls.push({ url, method, headers: h, body: init.body });
    if (url === `${SB}/auth/v1/user`) return h.Authorization === 'Bearer good' ? Response.json({ id: USER }) : new Response('{}', { status: 401 });
    if (url === `${SB}/rest/v1/rpc/app_my_features`) return features === 'fail' ? new Response('{}', { status: 500 }) : Response.json(features);
    if (url.startsWith(`${SB}/rest/v1/`)) {
      const u = new URL(url), table = u.pathname.split('/').pop();
      if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Range': `0-0/${(rows[table] || []).length}` } });
      return Response.json(Number(u.searchParams.get('offset')) > 0 ? [] : (rows[table] || []));
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?') && method === 'GET') {
      const qy = new URL(url).searchParams.get('q');
      // S69-42: 이름 바꾸기 전 '같은 자리에 같은 이름 폴더가 있나'(app-folders.mjs sameNameQuery).
      const same = /^name = '(.+)' and '([^']+)' in parents and /.exec(qy);
      if (same) return Response.json({ files: drive.files.filter(f => !f.trashed && f.name === same[1] && f.parents[0] === same[2]).map(f => ({ id: f.id })) });
      // S69-22: 맨 위 백업 폴더는 ('root' in parents or '<맨 위 앱 폴더>' in parents) — 부모 후보를 모두 본다.
      const kind = /value='(\w+)'/.exec(qy)[1], parents = [...qy.matchAll(/'([^']+)' in parents/g)].map(m => m[1]), parent = parents[0];
      const root = drive.files.find(f => f.appProperties.kptu_backup === 'root' && !f.trashed);
      const files = drive.files.filter(f => !f.trashed && f.appProperties.kptu_backup === kind && (parents.includes(f.parents[0]) || (f.parents[0] === 'ROOT?' && root && parent === root.id)));
      return Response.json({ files });
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?') && method === 'POST') {
      const b = JSON.parse(init.body); const f = { id: id(), ...b, trashed: false }; drive.files.push(f); return Response.json(f);
    }
    if (/\/permissions\?/.test(url)) return Response.json({ permissions: drive.perms[url.split('/files/')[1].split('/')[0]] || [{ type: 'user' }] });
    if (/drive\/v3\/files\/[^/?]+\?/.test(url) && method === 'PATCH') {
      const fid = decodeURIComponent(url.split('/files/')[1].split('?')[0]); const f = drive.files.find(x => x.id === fid); const b = JSON.parse(init.body);
      if (b.trashed) f.trashed = true; if (b.appProperties) Object.assign(f.appProperties, b.appProperties); if (b.name) f.name = b.name;
      return Response.json({ id: fid, name: f.name });
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      const meta = JSON.parse(String(init.body).split('\r\n\r\n')[1].split('\r\n--')[0]);
      drive.files.push({ id: id(), ...meta, content: String(init.body), trashed: false }); return Response.json({ id: `u${n}` });
    }
    throw new Error('unexpected ' + method + ' ' + url);
  }
  const handler = H.createRecordBackupHandler({
    env: k => ({ SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE })[k],
    ownerWorkspace: async u => u === USER ? owner : null,
    driveToken: async w => { if (w !== WS) throw Object.assign(new Error('x'), { code: 'drive_failed' }); if (!connected) throw Object.assign(new Error('x'), { code: 'drive_not_connected' }); return 'drive-token-A'; },
    fetch, now: () => Date.parse('2026-11-18T01:00:00Z'), log: c => logs.push(c),
    ...(appRoot === undefined ? {} : { appRootId: async w => { assert.equal(w, WS); if (appRoot === 'fail') throw new Error('db'); return appRoot; } }),
  });
  const ask = (action, body, auth = 'Bearer good', method = action === 'status' ? 'GET' : 'POST') => handler(new Request(`${SB}/functions/v1/record-backup?action=${action}`, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined }));
  return { ask, calls, logs, drive };
}

test('거절: 로그인 없음·틀린 로그인·owner 아님·모르는 입구·GET·잘못된 몸통', async () => {
  const w = world();
  assert.equal((await w.ask('status', undefined, '')).status, 401);
  assert.equal((await w.ask('status', undefined, 'Bearer bad')).status, 401);
  assert.equal((await world({ owner: null }).ask('status')).status, 403);
  assert.equal((await w.ask('delete')).status, 400);
  assert.equal((await w.ask('status', undefined, 'Bearer good', 'POST')).status, 405);
  assert.equal((await w.ask('run', undefined, 'Bearer good', 'GET')).status, 405);
  for (const body of [null, {}, { kinds: [] }, { kinds: ['nope'] }, { kinds: ['notes', 'notes'] }, { kinds: ['notes'], workspace_id: OTHER_WS }, { kinds: 'notes' }]) {
    const r = await w.ask('run', body); assert.equal(r.status, 400, JSON.stringify(body)); assert.equal((await r.json()).error, 'BAD_KINDS');
  }
  assert.equal(w.drive.files.length, 0, '거절된 요청은 드라이브에 아무것도 만들지 않는다');
});

test('기록 읽기는 사용자 토큰 + anon 키, 내 작업공간 조건만(서비스 역할 키 안 씀)', async () => {
  const w = world();
  const r = await w.ask('run', { kinds: M.KINDS });
  assert.equal(r.status, 200);
  const reads = w.calls.filter(c => c.url.startsWith(`${SB}/rest/v1/`) && !c.url.startsWith(`${SB}/rest/v1/rpc/`));
  assert.ok(reads.length >= M.CATEGORIES.flatMap(c => c.tables).length);
  for (const c of reads) {
    assert.equal(c.headers.apikey, ANON); assert.equal(c.headers.Authorization, 'Bearer good');
    assert.ok(!JSON.stringify(c.headers).includes(SERVICE));
    const u = new URL(c.url), t = u.pathname.split('/').pop();
    const table = M.CATEGORIES.flatMap(x => x.tables).find(x => x.name === t);
    assert.ok(table, '목록에 없는 표를 읽지 않는다: ' + t);
    if (table.by === 'user') assert.equal(u.searchParams.get('user_id'), `eq.${USER}`);
    else if (table.by === 'join') assert.equal(u.searchParams.get(`${table.alias}.workspace_id`), `eq.${WS}`);
    else assert.equal(u.searchParams.get('workspace_id'), `eq.${WS}`);
  }
  assert.ok(!JSON.stringify(w.calls).includes(OTHER_WS));
});

test('드라이브: 노조+ 백업/날짜 폴더, csv·읽기용 문서, 같은 날 다시 하면 그날 폴더 교체, 응답·로그에 내용 없음', async () => {
  const w = world({ features: ['nojo_words'] });
  const r = await w.ask('run', { kinds: ['notes', 'reports', 'ledger'] });
  const body = await r.json();
  assert.equal(r.status, 200); assert.equal(body.date, '2026-11-18'); assert.equal(body.count, 3);
  const root = w.drive.files.find(f => f.appProperties?.kptu_backup === 'root');
  assert.equal(root.name, 'WORK ON+ 백업'); assert.deepEqual(root.parents, ['root']); // S69-41: 새로 만들 때 늘 새 이름
  assert.equal(root.appProperties.kptu_backup_last_count, '3');
  const day = w.drive.files.find(f => f.appProperties?.kptu_backup === 'day');
  assert.equal(day.name, '2026-11-18'); assert.deepEqual(day.parents, [root.id]);
  const inDay = w.drive.files.filter(f => f.parents?.[0] === day.id);
  assert.ok(inDay.some(f => f.name === '노트 - 노트.csv' && f.content.includes(SECRET)));
  assert.ok(inDay.some(f => f.name === '노트 (읽기용)' && f.mimeType === 'application/vnd.google-apps.document'));
  assert.ok(!inDay.some(f => /^회의/.test(f.name)), '고르지 않은 종류는 넣지 않는다');
  const csv = inDay.find(f => f.name === '조직 보고 · 사업 보고 - 조직 보고.csv').content;
  assert.ok(!csv.includes('"o"') && !/,o\r?\n/.test(csv), '붙여 읽은 부모 칸은 빼고 저장');
  assert.ok(!JSON.stringify(body).includes(SECRET)); assert.ok(!w.logs.join().includes(SECRET));
  await w.ask('run', { kinds: ['notes'] });
  const days = w.drive.files.filter(f => f.appProperties?.kptu_backup === 'day');
  assert.equal(days.filter(f => !f.trashed).length, 1); assert.equal(days.filter(f => f.trashed).length, 1);
});

test('최근 4주만 남기고 오래된 날짜 폴더는 휴지통(영구 삭제 없음)', async () => {
  const w = world({ oldDays: ['2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11'] });
  await w.ask('run', { kinds: ['notes'] });
  const days = w.drive.files.filter(f => f.appProperties?.kptu_backup === 'day');
  assert.deepEqual(days.filter(f => !f.trashed).map(f => f.appProperties.kptu_backup_date).sort(), ['2026-10-28', '2026-11-04', '2026-11-11', '2026-11-18']);
  assert.ok(!w.calls.some(c => c.method === 'DELETE'));
});

test('드라이브 연결 없음: 상태는 개수만, 실행은 409 DRIVE_NOT_CONNECTED', async () => {
  const w = world({ connected: false });
  const s = await (await w.ask('status')).json();
  assert.equal(s.connected, false); assert.equal(s.last_at, null);
  assert.deepEqual(s.kinds.map(k => k.key), M.KINDS);
  assert.equal(s.kinds.find(k => k.key === 'notes').count, 1);
  assert.ok(!JSON.stringify(s).includes(SECRET));
  const r = await w.ask('run', { kinds: ['notes'] });
  assert.equal(r.status, 409); assert.equal((await r.json()).error, 'DRIVE_NOT_CONNECTED');
});

test('공유가 걸린 백업 폴더에는 쓰지 않는다', async () => {
  const w = world();
  await w.ask('run', { kinds: ['notes'] });
  const root = w.drive.files.find(f => f.appProperties?.kptu_backup === 'root');
  w.drive.perms[root.id] = [{ type: 'anyone' }];
  const before = w.drive.files.length;
  const r = await w.ask('run', { kinds: ['notes'] });
  assert.equal(r.status, 409); assert.equal((await r.json()).error, 'DRIVE_PUBLIC_SHARING_FOUND');
  assert.equal(w.drive.files.length, before);
});

test('모델: 비밀값 표를 담지 않고, CSV는 수식 시작 글자를 막는다, 자동 차례는 7일', () => {
  const names = M.CATEGORIES.flatMap(c => c.tables.map(t => t.name));
  for (const bad of ['app_drive_connections', 'app_onedrive_connections', 'app_push_devices', 'app_operator_features', 'app_workspace_members', 'app_feed_items']) assert.ok(!names.includes(bad), bad);
  assert.match(M.toCsv([{ a: '=1+1', b: 'x,"y"' }]), /"'=1\+1","x,""y"""/);
  const now = Date.parse('2026-11-18T00:00:00Z');
  assert.equal(M.autoDue(false, null, now), false); assert.equal(M.autoDue(true, null, now), true);
  assert.equal(M.autoDue(true, '2026-11-12T00:00:00Z', now), false); assert.equal(M.autoDue(true, '2026-11-11T00:00:00Z', now), true);
});

test('함수 입구: verify_jwt=true 신규 함수로 표에 등록, 서비스 역할 키는 기록 읽기에 쓰지 않음', () => {
  const index = readFileSync(new URL('../../supabase/functions/record-backup/index.ts', import.meta.url), 'utf8');
  const handler = readFileSync(new URL('../../supabase/functions/record-backup/handler.ts', import.meta.url), 'utf8');
  assert.match(index, /withWebCors\(createRecordBackupHandler/);
  assert.ok(!/SERVICE_ROLE/.test(handler), 'handler는 서비스 역할 키를 모른다');
  const doc = readFileSync(new URL('../../docs/web2-env6b-edge-source.md', import.meta.url), 'utf8');
  assert.match(doc, /\| 46 \| `record-backup` \|[^\n]*\| \*\*true\*\* \|/);
});

// S68-02·S69-42: 맨 위 폴더 이름 — 새로 만들 때 'WORK ON+ 백업'. 이미 있는 옛 이름('노조+ 백업') 폴더는 같은 폴더(id)를 쓰고 이름만 새 이름으로.
test('S68-02·S69-42: 새로 만드는 백업 폴더 이름, 이미 있는 옛 이름 폴더는 같은 폴더를 쓰고 이름만 바꿈', async () => {
  const fresh = world();
  const r = await (await fresh.ask('run', { kinds: ['notes'] })).json();
  const root = fresh.drive.files.find(f => f.appProperties?.kptu_backup === 'root');
  assert.equal(root.name, 'WORK ON+ 백업'); assert.equal(r.root_name, 'WORK ON+ 백업');
  const rpc = fresh.calls.find(c => c.url === `${SB}/rest/v1/rpc/app_my_features`);
  assert.equal(rpc.method, 'POST'); assert.equal(rpc.headers.apikey, ANON); assert.equal(rpc.headers.Authorization, 'Bearer good');
  assert.ok(!JSON.stringify(rpc.headers).includes(SERVICE), '기능 확인은 로그인 토큰으로(서비스 역할 키 안 씀)');
  const failed = world({ features: 'fail' });
  await failed.ask('run', { kinds: ['notes'] });
  assert.equal(failed.drive.files.find(f => f.appProperties?.kptu_backup === 'root').name, 'WORK ON+ 백업', 'S69-41: 확인 실패여도 새로 만들 때는 새 이름');
  const kept = world({ rootName: '노조+ 백업' });
  const k = await (await kept.ask('run', { kinds: ['notes'] })).json();
  const roots = kept.drive.files.filter(f => f.appProperties?.kptu_backup === 'root');
  assert.equal(roots.length, 1, '새 폴더를 만들지 않는다'); assert.equal(roots[0].name, 'WORK ON+ 백업'); assert.equal(k.root_name, 'WORK ON+ 백업');
  assert.equal(kept.calls.filter(c => c.method === 'PATCH' && /"name"/.test(String(c.body))).length, 1, '이름 바꾸기는 한 번');
  assert.ok(kept.drive.files.some(f => f.appProperties?.kptu_backup === 'day' && f.parents[0] === roots[0].id), '백업은 그 폴더(같은 id) 안에');
  const again = await (await kept.ask('run', { kinds: ['notes'] })).json();
  assert.equal(again.root_name, 'WORK ON+ 백업');
  assert.equal(kept.calls.filter(c => c.method === 'PATCH' && /"name"/.test(String(c.body))).length, 1, '새 이름이면 다시 바꾸지 않는다');
  // S68-21: 폴더가 있어도 읽기용 문서 첫 줄의 앱 이름 때문에 기능 확인은 실행마다 한 번(로그인 토큰, 폴더 이름은 그대로).
  assert.equal(kept.calls.filter(c => c.url.includes('/rpc/app_my_features')).length, 2, '기능 확인은 실행마다 한 번');
  const s = await (await kept.ask('status')).json();
  assert.equal(s.folder_name, 'WORK ON+ 백업');
  // 같은 자리에 새 이름 폴더가 이미 있으면(사람이 만든 폴더) 합치지 않고 옛 이름 그대로.
  const dup = world({ rootName: '노조+ 백업' });
  dup.drive.files.push({ id: 'person-made', name: 'WORK ON+ 백업', parents: ['root'], appProperties: {}, trashed: false });
  const d = await (await dup.ask('run', { kinds: ['notes'] })).json();
  assert.equal(d.root_name, '노조+ 백업');
  assert.ok(!dup.calls.some(c => c.method === 'PATCH' && /"name"/.test(String(c.body))));
});

// S68-21·S69-42: 새로 만드는 읽기용 문서 첫 줄의 앱 이름 — 누구나 'WORK ON+'(nojo_words·확인 실패여도).
test('S68-21: 백업 읽기용 문서 첫 줄 앱 이름', async () => {
  const docOf = w => w.drive.files.find(f => f.name === '노트 (읽기용)').content;
  const fresh = world({ rootName: '노조+ 백업' });
  await fresh.ask('run', { kinds: ['notes'] });
  assert.match(docOf(fresh), /WORK ON\+가 내 드라이브에 만든 백업입니다/);
  assert.ok(!/노조/.test(docOf(fresh)), '새 사용자 문서에 노조 글자 없음');
  const nojo = world({ features: ['nojo_words'] });
  await nojo.ask('run', { kinds: ['notes'] });
  assert.match(docOf(nojo), /WORK ON\+가 내 드라이브에 만든 백업입니다/);
  const failed = world({ features: 'fail' });
  await failed.ask('run', { kinds: ['notes'] });
  assert.match(docOf(failed), /WORK ON\+가 내 드라이브에 만든 백업입니다/);
  assert.match(M.readableHtml({ label: 'x' }, [], '2026-11-22'), /WORK ON\+가/, '기본값도 새 이름');
  assert.match(M.readableHtml({ label: 'x' }, [], '2026-11-22', 'WORK ON+'), /WORK ON\+가/);
});

// S69-22: 백업 맨 위 폴더는 표식으로 찾고, 맨 위 앱 폴더 아래로 옮겨도 같은 폴더(새로 만들지 않음). 새로 만들 때는 맨 위 앱 폴더 아래.
test('S69-22: 맨 위 앱 폴더 아래로 옮겨진 백업 폴더를 그대로 쓰고, 없으면 맨 위 앱 폴더 아래에 만든다', async () => {
  const ROOT = 'app-root-folder-1';
  const moved = world({ appRoot: ROOT, rootName: '노조+ 백업', rootParent: ROOT });
  assert.equal((await moved.ask('run', { kinds: ['notes'] })).status, 200);
  assert.equal(moved.drive.files.filter(f => f.appProperties?.kptu_backup === 'root').length, 1, '새 맨 위 백업 폴더를 또 만들지 않는다');
  const q = moved.calls.find(c => c.url.startsWith('https://www.googleapis.com/drive/v3/files?') && c.method === 'GET');
  assert.match(new URL(q.url).searchParams.get('q'), /\('root' in parents or 'app-root-folder-1' in parents\)/);
  const fresh = world({ appRoot: ROOT });
  assert.equal((await fresh.ask('run', { kinds: ['notes'] })).status, 200);
  assert.deepEqual(fresh.drive.files.find(f => f.appProperties?.kptu_backup === 'root').parents, [ROOT]);
  // 맨 위 앱 폴더를 모르거나 못 읽으면 지금처럼 내 드라이브 맨 위.
  for (const appRoot of [null, 'fail', 'bad id']) {
    const w = world({ appRoot });
    assert.equal((await w.ask('run', { kinds: ['notes'] })).status, 200);
    assert.deepEqual(w.drive.files.find(f => f.appProperties?.kptu_backup === 'root').parents, ['root'], String(appRoot));
  }
});
