// CALL-개인통화함 3단계: 화면의 데이터 규칙(app/feed-data.js)과 순수 규칙(app/feed-model.mjs), 업무 읽기 경로가 개인 표를 안 읽는 정적 시험.
// 이름·내용은 모두 지어낸 것이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {readFeed, readPersonal, readPersonalRaw, setPersonalHidden, moveCall, readLedgerSeen, PERSONAL_FIELDS} from '../app/feed-data.js';
import {splitPersonal, legacyFilteredNote, moveToPersonalWarning, moveDoneText, moveErrorText, MOVE_ERRORS} from '../app/feed-model.mjs';

const WS = '10000000-0000-4000-8000-000000000001', ID = '60000000-0000-4000-8000-000000000009';
function fakeRt(handler) {
  const calls = [];
  return {calls, context:{read:() => ({user:{id:'u'}, workspace:{id:WS}})}, api:async (path, opt = {}) => { calls.push({path, ...opt}); return handler(path, opt); }};
}

test('업무 읽기(readFeed)는 개인 표를 부르지 않고, 개인 읽기는 개인 표만 부른다', async () => {
  const rt = fakeRt(() => []);
  await readFeed('call', rt, '2026-10-25');
  assert.ok(rt.calls.every(c => c.path.includes('/app_feed_items?') && !c.path.includes('app_call_personal')));
  const rt2 = fakeRt(() => []);
  await readPersonal(rt2, '2026-10-25');
  assert.equal(rt2.calls.length, 1);
  assert.match(rt2.calls[0].path, /^\/rest\/v1\/app_call_personal\?workspace_id=eq\./);
  assert.match(rt2.calls[0].path, /kind=in\.\(personal,unsure\)&hidden_at=is\.null/);
  assert.ok(!/raw_text/.test(rt2.calls[0].path) && !PERSONAL_FIELDS.includes('raw_text'), '목록은 전문을 읽지 않는다');
  assert.ok(!/organization_id|project_id|pinned_at/.test(PERSONAL_FIELDS), '개인 표에는 연결·고정 칸이 없다');
});

test('개인 읽기: 다른 작업공간·알 수 없는 kind 줄은 버리고 box 표시를 단다', async () => {
  const good = {id:ID, workspace_id:WS, kind:'unsure', day:'2026-10-25', occurred_at:'2026-10-25T01:00:00Z', title:'가상 통화'};
  const rt = fakeRt(() => [good, {...good, id:'x1', workspace_id:'other'}, {...good, id:'x2', kind:'work'}]);
  const rows = await readPersonal(rt, '2026-10-25');
  assert.deepEqual(rows.map(r => [r.id, r.box]), [[ID, 'personal']]);
});

test('개인 지우기·전문 읽기는 개인 표의 허용된 칸만 쓴다', async () => {
  const rt = fakeRt((p, o) => o.method === 'PATCH' ? [{id:ID, workspace_id:WS, kind:'personal'}] : [{id:ID, raw_text:'가상', speaker_split:false}]);
  const saved = await setPersonalHidden(ID, true, rt);
  assert.equal(saved.box, 'personal');
  const patch = rt.calls[0];
  assert.match(patch.path, /app_call_personal\?id=eq\./);
  assert.deepEqual(Object.keys(patch.body).sort(), ['hidden_at', 'updated_at']);
  assert.equal((await readPersonalRaw(ID, rt)).raw_text, '가상');
});

test('옮기기: app_call_move 한 번, 대상은 work|personal만, 오류는 종류로 나눈다', async () => {
  const ok = fakeRt(() => ({ok:true, changed:true, needs_refill:true}));
  assert.deepEqual(await moveCall(ID, 'work', ok), {ok:true, changed:true, needsRefill:true});
  assert.equal(ok.calls[0].path, '/rest/v1/rpc/app_call_move');
  assert.deepEqual(ok.calls[0].body, {p_id:ID, p_to:'work'});
  assert.equal((await moveCall(ID, 'unsure', ok)).error, 'REFUSED');
  assert.equal(ok.calls.length, 1, '잘못된 대상은 서버에 보내지 않는다');
  const fail = (status, message) => fakeRt(() => { throw Object.assign(new Error(message), {status}); });
  assert.equal((await moveCall(ID, 'personal', fail(400, 'CALL_NOT_FOUND'))).error, 'GONE');
  assert.equal((await moveCall(ID, 'personal', fail(409, 'duplicate'))).error, 'DUPLICATE');
  assert.equal((await moveCall(ID, 'personal', fail(404, 'PGRST202 Could not find the function'))).error, 'UNAVAILABLE');
  assert.equal((await moveCall(ID, 'personal', fail(400, 'CALL_MOVE_TARGET'))).error, 'REFUSED');
  assert.equal((await moveCall(ID, 'personal', fail(503, 'down'))).error, 'UNKNOWN');
  assert.equal((await moveCall(ID, 'personal', fakeRt(() => ({ok:false})))).error, 'UNKNOWN');
});

test('원장에 이미 쓰였는지: 있음/없음/모름', async () => {
  assert.equal(await readLedgerSeen(ID, fakeRt(() => [{source_id:ID}])), true);
  assert.equal(await readLedgerSeen(ID, fakeRt(() => [])), false);
  assert.equal(await readLedgerSeen(ID, fakeRt(() => { throw Error('x'); })), null);
  const rt = fakeRt(() => []);
  await readLedgerSeen(ID, rt);
  assert.match(rt.calls[0].path, /app_ledger_auto_sources\?workspace_id=eq\.[^&]+&source_kind=eq\.call&source_id=eq\./);
});

test('순수 규칙: 개인·애매 나누기, 옛 안내 한 줄, 옮기기 문구', () => {
  const rows = [{id:'a', kind:'personal'}, {id:'b', kind:'unsure'}, {id:'c', kind:'personal'}, {id:'d'}];
  const s = splitPersonal(rows);
  assert.deepEqual([s.personal.map(r => r.id), s.unsure.map(r => r.id)], [['a', 'c'], ['b']]);
  const days = [{source:'call', day:'2026-10-24', personal_count:2, unsure_count:1, failed_count:1}];
  assert.match(legacyFilteredNote(days, '2026-10-25'), /^목록 도입 전 걸러진 3건은 개수만 있어요\..*판정 실패 1건$/);
  assert.equal(legacyFilteredNote([], '2026-10-25'), '');
  assert.match(moveToPersonalWarning({ledger:true}), /원장 기록은 지워지지 않아요/);
  assert.match(moveToPersonalWarning({ledger:null}), /확인하지 못했어요/);
  assert.match(moveToPersonalWarning({ledger:false, linked:true}), /고정과 조직 연결은/);
  assert.equal(moveToPersonalWarning({ledger:false, linked:false}), '');
  assert.equal(moveDoneText('work', 'personal'), '개인 통화함으로 옮겼어요.');
  assert.equal(moveDoneText('unsure', 'personal'), '개인 통화로 정했어요.');
  assert.equal(moveDoneText('personal', 'work'), '업무 통화로 옮겼어요.');
  for (const k of Object.keys(MOVE_ERRORS)) assert.equal(moveErrorText(k), MOVE_ERRORS[k]);
  assert.equal(moveErrorText('??'), MOVE_ERRORS.REFUSED);
});

const walk = dir => readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
test('정적: 앱에서 개인 표 이름은 feed-data.js 한 곳뿐, 검색·홈·원장 읽기는 개인 표와 통화 표를 읽지 않는다', () => {
  const app = new URL('../app/', import.meta.url).pathname;
  const hits = walk(app).filter(f => /\.(js|mjs|html|css)$/.test(f) && readFileSync(f, 'utf8').includes('app_call_personal')).map(f => f.slice(app.length));
  assert.deepEqual(hits, ['feed-data.js']);
  const feedData = readFileSync(app + 'feed-data.js', 'utf8');
  const readFeedSrc = feedData.slice(feedData.indexOf('export async function readFeed'), feedData.indexOf('export async function readDays'));
  assert.ok(!readFeedSrc.includes('app_call_personal'));
  for (const f of walk(app).filter(f => /global-search|ledger-/.test(f) && /\.(js|mjs)$/.test(f))) assert.ok(!/app_call_personal/.test(readFileSync(f, 'utf8')), f);
  // 개인 상세에는 조직 연결·고정을 만들지 않는다: 개인 줄의 메뉴는 to-work/to-personal/copy/drive/hide만.
  const screen = readFileSync(app + 'call-feed.js', 'utf8');
  const personalMenu = screen.slice(screen.indexOf("return `<button type=\"button\" data-cf-act=\"to-work\">"), screen.indexOf('onAction'));
  assert.ok(!/data-cf-act="(pin|link)"/.test(personalMenu));
  assert.ok(!new RegExp(['local', 'session'].map(k => k + 'Storage').join('|')).test(screen), '브라우저 저장소를 쓰지 않는다');
});
