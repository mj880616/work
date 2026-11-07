// S50-27 FILES-내PC드라이브 ②: 바구니 PC 앱 문 답 → [파일] 줄 모양, 경로 검사(PC 앱 PcPath.Parse와 같은 규칙), 위치 줄, 상태 글, 문 다리(가짜 fetch). 화면·실제 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pcSegs, pcNorm, pcParent, pcChild, pcPathOk, pcDriveRows, pcListRows, pcTrail, pcHelloOk, pcCode, pcStateText, pcErrorText, pcDeviceOk, pcOffRowName,
  PC_SOURCE, PC_PORTS, pcDoorOrigin, pcCanList, pcCanXfer, pcCanEdit, pcXferWhy, PC_READONLY_TEXT, PC_PIECE} from '../app/pc-files-model.mjs';
import {createPcFiles} from '../app/pc-files.js';
import {errorText, SOURCE_NAME, SOURCES, rowKey, trailNames, placeOf} from '../app/files-model.mjs';
import {PC_DOOR, WEB2_CSP} from '../cloudflare/web2-csp.mjs';
import {readFileSync} from 'node:fs';

test('경로 검사: 드라이브 뿌리 아래만, ..·끝 점·금지 글자·장치 이름 거절(PC 앱과 같음)', () => {
  assert.deepEqual(pcSegs('C:\\'), ['C:']);
  assert.deepEqual(pcSegs('c:'), ['C:']);
  assert.deepEqual(pcSegs('D:\\자료\\가짜 문서 (2).hwpx'), ['D:', '자료', '가짜 문서 (2).hwpx']);
  for (const bad of ['', 'C', 'C:foo', '\\\\server\\x', 'C:\\a\\\\b', 'C:\\..', 'C:\\a\\..\\b', 'C:\\a.', 'C:\\a ', 'C:\\a:b', 'C:\\a/b', 'C:\\con', 'C:\\NUL.txt',
    'C:\\a\u0001', '1:\\a', 'C:\\' + 'x'.repeat(256), null, undefined, 5]) assert.equal(pcPathOk(bad), false, JSON.stringify(bad));
  assert.equal(pcNorm('c:\\문서\\'), 'C:\\문서');
  assert.equal(pcParent('C:\\문서\\a.txt'), 'C:\\문서');
  assert.equal(pcParent('C:\\문서'), 'C:\\');
  assert.equal(pcParent('C:\\'), null);
  assert.equal(pcChild('C:\\', '문서'), 'C:\\문서');
  assert.equal(pcChild('C:\\문서', '..'), null);
});

test('드라이브 답 → 나무 맨 위 줄(이름표·종류), 틀린·겹친 뿌리는 버림', () => {
  const rows = pcDriveRows({drives: [{root: 'C:\\', label: '', kind: 'fixed'}, {root: 'D:\\', label: '자료', kind: 'fixed'}, {root: 'E:\\', label: '', kind: 'removable'},
    {root: 'C:\\', label: 'x'}, {root: 'C:\\Windows'}, {root: 'zz'}, null]});
  assert.deepEqual(rows.map(r => [r.item_id, r.name, r.is_folder, r.parent_id]),
    [['C:\\', '로컬 디스크 (C:)', true, null], ['D:\\', '자료 (D:)', true, null], ['E:\\', '이동식 디스크 (E:)', true, null]]);
  assert.equal(rows[0].source, PC_SOURCE);
  assert.deepEqual(pcDriveRows(null), []);
});

test('목록 답 → 줄(클라우드 줄과 같은 모양). 물어본 폴더와 답 폴더가 다르면 버림, 이상한 이름 줄은 버림', () => {
  const rows = pcListRows({path: 'C:\\문서', truncated: false, entries: [
    {name: '견적', dir: true, size: 0, modified: '2026-11-03T01:00:00.0000000+00:00'},
    {name: '가짜.hwpx', dir: false, size: 2100, modified: '2026-11-05T00:14:00Z'},
    {name: '..', dir: true}, {name: 'a\\b', dir: false}, {name: '', dir: false}, null]}, 'c:\\문서\\');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], {source: 'pc', item_id: 'C:\\문서\\가짜.hwpx', parent_id: 'C:\\문서', name: '가짜.hwpx', is_folder: false, size_bytes: 2100,
    modified_at: '2026-11-05T00:14:00.000Z', mime: null, folder_path: 'C: › 문서', starred: false, library_doc_id: null, hash: null});
  assert.equal(rows[0].size_bytes, null);
  assert.equal(rowKey(rows[1]), 'pc:C:\\문서\\가짜.hwpx');
  assert.equal(pcListRows({path: 'C:\\다른', entries: []}, 'C:\\문서'), null);
});

test('위치 줄: 내 PC › C: › 문서, 주소창 자리에는 PC 경로를 적지 않음', () => {
  const trail = pcTrail('C:\\문서\\견적');
  assert.deepEqual(trail, [{item_id: 'C:\\', name: 'C:', depth: 2}, {item_id: 'C:\\문서', name: '문서', depth: 1}, {item_id: 'C:\\문서\\견적', name: '견적', depth: 0}]);
  assert.deepEqual(trailNames('pc', trail), ['내 PC', 'C:', '문서', '견적']);
  assert.equal(SOURCE_NAME.pc, '내 PC');
  assert.equal(SOURCES.includes('pc'), false, '서버 색인·맞추기 출처에는 넣지 않는다');
  assert.deepEqual(placeOf({source: 'pc', parent: 'C:\\문서'}), {at: 'pc'});
  assert.deepEqual(placeOf({source: 'pc', parent: null}), {at: 'pc'});
});

test('상태 글·오류 글: 정해 둔 말만, errorText가 pc_ 앞머리를 받는다', () => {
  assert.equal(pcHelloOk({app: 'basket-pc', door: 1, can: ['drives', 'list', 'open']}), true);
  assert.equal(pcHelloOk({app: 'other', door: 1, can: ['list']}), false);
  assert.equal(pcCode(403, 'other_user'), 'other_user');
  assert.equal(pcCode(403, '<script>'), 'blocked');
  assert.equal(pcCode(401), 'bad_token');
  assert.match(pcStateText('off'), /웹2에서 이 PC 보기/);
  assert.match(pcStateText('other_user'), /다른 계정/);
  assert.match(pcStateText('ask'), /허용/);
  assert.equal(errorText('pc_blocked'), pcErrorText('blocked'));
  assert.match(errorText('pc_pc_signed_out'), /로그아웃/);
  assert.equal(pcOffRowName('off'), '내 PC · 꺼짐');
  assert.equal(pcOffRowName('ask'), '내 PC · 눌러서 연결');
});

test('그릴 곳: 윈도우 PC 브라우저만(폰 앱·폰 브라우저·안드로이드 큰 화면·맥은 아님)', () => {
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36';
  assert.equal(pcDeviceOk({ua: win, kind: 'pc'}), true);
  assert.equal(pcDeviceOk({ua: win, kind: 'phone'}), false);
  assert.equal(pcDeviceOk({ua: 'Mozilla/5.0 (Linux; Android 14; SM-F956N) Chrome/142.0', kind: 'pc'}), false);
  assert.equal(pcDeviceOk({ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', kind: 'pc'}), false);
});

test('CSP connect-src에 문 주소 3개(문 번호와 같음)', () => {
  assert.deepEqual([...PC_DOOR], PC_PORTS.map(pcDoorOrigin));
  for (const o of PC_DOOR) assert.ok(WEB2_CSP.includes(o), o);
});

// 가짜 문: 번호마다 답을 정한다. 요청 머리·본문을 적어 둔다.
function fakeWin({doors = {}, perm = 'unknown'} = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({port: Number(u.port), path: u.pathname + u.search, method: init.method, auth: init.headers.Authorization, body: init.body, credentials: init.credentials});
    const door = doors[u.port];
    if (!door) throw new TypeError('Failed to fetch');
    const [status, body, head = {}] = door(u, init);
    const bytes = body instanceof Uint8Array ? body : null;
    return {ok: status >= 200 && status < 300, status, json: async () => body, arrayBuffer: async () => (bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : new ArrayBuffer(0)),
      headers: {get: n => head[String(n).toLowerCase()] ?? null}};
  };
  const permissions = perm === 'unknown' ? undefined : {query: async ({name}) => { if (name === 'loopback-network') return {state: perm}; throw new TypeError('bad'); }};
  return {win: {fetch, navigator: {permissions}}, calls};
}
const helloOk = () => [200, {app: 'basket-pc', version: '0.3.0', door: 1, can: ['drives', 'list', 'open', 'reveal']}];

test('문 다리: 번호를 차례로 두드려 찾고, 매 요청 로그인 토큰을 머리에만 싣는다(쿠키 없음)', async () => {
  const {win, calls} = fakeWin({doors: {47621: (u, init) => {
    if (u.pathname === '/v1/hello') return helloOk();
    if (u.pathname === '/v1/drives') return [200, {drives: [{root: 'C:\\', label: '', kind: 'fixed'}]}];
    if (u.pathname === '/v1/list') return [200, {path: u.searchParams.get('path'), entries: [{name: 'a.txt', dir: false, size: 1, modified: '2026-11-05T00:00:00Z'}]}];
    if (u.pathname === '/v1/open') return [200, {done: JSON.parse(init.body).path.endsWith('.exe') ? 'revealed' : 'opened'}];
    return [404, {error: 'not_found'}];
  }}});
  const pc = createPcFiles(win, {token: async () => 'TOKEN'});
  const seen = [];
  pc.on(s => seen.push(s.ok));
  const s = await pc.hello();
  assert.equal(s.ok, true); assert.equal(s.port, 47621);
  assert.deepEqual(calls.map(c => c.port), [47620, 47621]);
  assert.deepEqual(seen, [true]);
  assert.deepEqual((await pc.list(null)).map(r => r.item_id), ['C:\\']);
  assert.deepEqual((await pc.list('C:\\')).map(r => r.item_id), ['C:\\a.txt']);
  assert.equal(await pc.open('C:\\a.txt'), 'opened');
  assert.equal(await pc.open('C:\\x.exe'), 'revealed');
  for (const c of calls) { assert.equal(c.auth, 'Bearer TOKEN'); assert.equal(c.credentials, 'omit'); }
  assert.equal(calls.at(-1).body, JSON.stringify({path: 'C:\\x.exe'}));
  await assert.rejects(pc.list('C:\\..'), /pc_bad_path/);
});

test('문 다리: 다른 계정·로그아웃이면 그 까닭으로 멈춤(다른 번호를 두드리지 않음), 답 없으면 off', async () => {
  const other = fakeWin({doors: {47620: () => [403, {error: 'other_user'}], 47621: helloOk}});
  const a = await createPcFiles(other.win, {token: async () => 'T'}).hello();
  assert.deepEqual([a.ok, a.why], [false, 'other_user']);
  assert.equal(other.calls.length, 1);
  const none = fakeWin();
  const b = await createPcFiles(none.win, {token: async () => 'T'}).hello();
  assert.deepEqual([b.ok, b.why], [false, 'off']);
  assert.equal(none.calls.length, 3);
  const noTok = fakeWin({doors: {47620: helloOk}});
  const c = await createPcFiles(noTok.win, {token: async () => ''}).hello();
  assert.deepEqual([c.ok, c.why, noTok.calls.length], [false, 'no_token', 0]);
});

test('문 다리: 크롬 허락이 아직이면 화면을 열 때 저절로 두드리지 않고(허락 창 안 띄움), 누르면 두드림. 막혀 있으면 denied', async () => {
  const w = fakeWin({doors: {47620: helloOk}, perm: 'prompt'});
  const pc = createPcFiles(w.win, {token: async () => 'T'});
  const a = await pc.hello({auto: true});
  assert.deepEqual([a.ok, a.why, w.calls.length], [false, 'ask', 0]);
  const b = await pc.hello();
  assert.deepEqual([b.ok, w.calls.length], [true, 1]);
  const d = fakeWin({doors: {47620: helloOk}, perm: 'denied'});
  const c = await createPcFiles(d.win, {token: async () => 'T'}).hello();
  assert.deepEqual([c.ok, c.why, d.calls.length], [false, 'denied', 0]);
});

test('문 다리: 쓰던 문이 사라지면 상태가 off로 바뀌고 알린다. 꺼진 다리는 부르지 않음', async () => {
  let up = true;
  const w = fakeWin({doors: {47620: (u) => { if (!up) throw new TypeError('x'); return u.pathname === '/v1/hello' ? helloOk() : [200, {drives: []}]; }}});
  // fakeWin의 door가 throw하면 fetch가 실패로 돈다.
  const pc = createPcFiles(w.win, {token: async () => 'T'});
  await pc.hello();
  const seen = [];
  pc.on(s => seen.push(s.why));
  up = false;
  await assert.rejects(pc.list(null), /pc_unreached/);
  assert.equal(pc.state.ok, false); assert.deepEqual(seen, ['off']);
  await assert.rejects(pc.list(null), /pc_off/);
  const off = createPcFiles(w.win, {enabled: false});
  assert.equal(off.usable, false);
  assert.equal((await off.hello()).ok, false);
});

test('내 PC 다리·계산은 브라우저 저장소·서버를 쓰지 않는다(화면 메모리만)', () => {
  for (const f of ['../app/pc-files.js', '../app/pc-files-model.mjs']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /Storage|indexed[D]B|cache[s]\.|document\.cookie|\/rest\/v1|functions\/v1/, f);
  }
});

// ---- S52-41 FILES-내PC클라우드옮기기 ----
test('문이 아는 일(can): 정해 둔 말만 남기고, 읽기·쓰기·휴지통을 모두 알아야 복사·옮기기', () => {
  assert.deepEqual(pcCanList({can: ['list', 'read', 'write', 'trash', 'format_c', 5]}), ['list', 'read', 'write', 'trash']);
  assert.deepEqual(pcCanList(null), []);
  assert.equal(pcCanXfer(['drives', 'list', 'open', 'reveal']), false);
  assert.equal(pcCanXfer(['read', 'write']), false);
  assert.equal(pcCanXfer(['read', 'write', 'trash']), true);
});

test('내 PC가 낀 복사·옮기기: 내 PC ↔ 클라우드만, 옛 문·섞기·내 PC 안끼리·이 폰 사이·드라이브 목록은 한 줄로 막음', () => {
  const can = ['drives', 'list', 'read', 'write', 'trash'];
  const pcFile = {source: 'pc', item_id: 'C:\\문서\\a.txt', is_folder: false}, odFile = {source: 'od', item_id: 'OD!1', is_folder: false}, phFile = {source: 'ph', item_id: 'x'};
  assert.equal(pcXferWhy([odFile], {source: 'gd', parent: null}, {can}), ''); // 내 PC가 안 낌
  assert.equal(pcXferWhy([pcFile], {source: 'od', parent: null}, {can}), '');
  assert.equal(pcXferWhy([odFile], {source: 'pc', parent: 'C:\\문서'}, {can}), '');
  assert.equal(pcXferWhy([pcFile], {source: 'od', parent: null}, {can: ['list']}), PC_READONLY_TEXT);
  assert.equal(pcXferWhy([pcFile], null, {can}), ''); // 받을 곳을 아직 고르지 않음
  assert.match(pcXferWhy([pcFile, odFile], null, {can}), /따로/);
  assert.match(pcXferWhy([pcFile], {source: 'pc', parent: 'D:\\'}, {can}), /새 판\(0\.5\.0\)/);
  // S52-43 ① FILES-내PC쓰기: 0.5.0+ 문(edit)이면 내 PC 안끼리도 된다(드라이브 맨 위 목록은 받을 곳 아님).
  const edit = [...can, 'edit'];
  assert.equal(pcXferWhy([pcFile], {source: 'pc', parent: 'D:\\'}, {can: edit}), '');
  assert.match(pcXferWhy([pcFile], {source: 'pc', parent: null}, {can: edit}), /드라이브나 폴더/);
  assert.match(pcXferWhy([pcFile], {source: 'ph', parent: null}, {can: edit}), /원드라이브·구글 드라이브로/);
  assert.equal(pcCanEdit(edit), true);
  assert.equal(pcCanEdit(['edit']), false);
  assert.deepEqual(pcCanList({can: [...edit, 'zz']}), ['drives', 'list', 'read', 'write', 'trash', 'edit']);
  assert.match(pcXferWhy([pcFile], {source: 'ph', parent: null}, {can}), /원드라이브·구글 드라이브로/);
  assert.match(pcXferWhy([phFile], {source: 'pc', parent: 'C:\\'}, {can}), /원드라이브·구글 드라이브 파일/);
  assert.match(pcXferWhy([odFile], {source: 'pc', parent: null}, {can}), /드라이브나 폴더/);
  assert.match(pcXferWhy([odFile], {source: 'pc', parent: 'C:\\..'}, {can}), /드라이브나 폴더/);
});

test('쓰기 오류 글: 정해 둔 말만(덮어쓰기 없음·프로그램 파일 거절)', () => {
  assert.match(pcErrorText('exists'), /같은 이름/);
  assert.match(pcErrorText('risky_kind'), /프로그램 파일/);
  assert.equal(errorText('pc_no_space'), pcErrorText('no_space'));
});

const helloWrite = () => [200, {app: 'basket-pc', version: '0.4.0', door: 1, can: ['drives', 'list', 'open', 'reveal', 'read', 'write', 'trash']}];
test('문 다리 읽기: 4MB 조각으로 차례로 읽어 Blob, 크기가 바뀌면 멈춤. 옛 문은 canXfer가 거짓', async () => {
  const size = PC_PIECE + 10, data = new Uint8Array(size).fill(7);
  const {win, calls} = fakeWin({doors: {47620: u => {
    if (u.pathname === '/v1/hello') return helloWrite();
    if (u.pathname === '/v1/read') { const at = Number(u.searchParams.get('at')), len = Number(u.searchParams.get('len')); return [200, data.subarray(at, at + len), {'x-pc-size': String(size)}]; }
    return [404, {error: 'not_found'}];
  }}});
  const pc = createPcFiles(win, {token: async () => 'T'});
  await pc.hello();
  assert.equal(pc.canXfer, true);
  const seen = [];
  const blob = await pc.read('C:\\문서\\큰.bin', {size, onProgress: (a, b) => seen.push([a, b])});
  assert.equal(blob.size, size);
  assert.deepEqual(calls.filter(c => c.path.startsWith('/v1/read')).map(c => new URL('http://x' + c.path).searchParams.get('at')), ['0', String(PC_PIECE)]);
  assert.deepEqual(seen.at(-1), [size, size]);
  await assert.rejects(pc.read('C:\\문서\\큰.bin', {size: 5}), /pc_bad_range/);
  const old = fakeWin({doors: {47620: helloOk}});
  const o = createPcFiles(old.win, {token: async () => 'T'});
  await o.hello();
  assert.equal(o.canXfer, false);
});

test('문 다리 쓰기: start → 조각 차례로 → finish(numbered), 실패하면 cancel. 휴지통은 경로 하나', async () => {
  let got = 0, fail = false;
  const {win, calls} = fakeWin({doors: {47620: (u, init) => {
    if (u.pathname === '/v1/hello') return helloWrite();
    if (u.pathname === '/v1/write/start') return [200, {id: 'w1'}];
    if (u.pathname === '/v1/write/piece') { if (fail) return [500, {error: 'write_failed'}]; got += init.body.size; return [200, {at: got}]; }
    if (u.pathname === '/v1/write/finish') return [200, {name: JSON.parse(init.body).numbered ? 'a (2).txt' : 'a.txt'}];
    if (u.pathname === '/v1/write/cancel') return [200, {done: 'cancelled'}];
    if (u.pathname === '/v1/trash') return [200, {done: 'trashed'}];
    return [404, {error: 'not_found'}];
  }}});
  const pc = createPcFiles(win, {token: async () => 'T'});
  await pc.hello();
  const blob = new Blob([new Uint8Array(PC_PIECE * 2 + 3)]);
  assert.equal(await pc.save('c:\\문서\\', 'a.txt', blob, {numbered: true}), 'a (2).txt');
  assert.equal(got, blob.size);
  assert.deepEqual(JSON.parse(calls.find(c => c.path === '/v1/write/start').body), {dir: 'C:\\문서', name: 'a.txt', size: blob.size});
  assert.equal(calls.filter(c => c.path.startsWith('/v1/write/piece')).length, 3);
  assert.deepEqual(JSON.parse(calls.find(c => c.path === '/v1/write/finish').body), {id: 'w1', numbered: true});
  fail = true;
  await assert.rejects(pc.save('C:\\문서', 'b.txt', blob), /pc_write_failed/);
  assert.equal(calls.at(-1).path, '/v1/write/cancel');
  await assert.rejects(pc.save('C:\\..', 'b.txt', blob), /pc_bad_path/);
  assert.equal(await pc.trash('C:\\문서\\a.txt'), true);
  assert.equal(calls.at(-1).body, JSON.stringify({path: 'C:\\문서\\a.txt'}));
});
