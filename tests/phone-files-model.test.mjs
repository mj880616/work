// S49-51 FILES-통합 3단계 '이 폰': 앱 다리 줄 → [파일] 줄 모양, 경로 검사(앱 PhoneFilesRules와 같은 규칙), 위치 줄, [최근] 섞기(H-7), 상태 글. 화면·네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import {phonePathOk, phoneRow, phoneRows, phoneTrail, phoneState, phoneErrorText, phoneDone, phoneSaved, phoneWriteText, PHONE_SOURCE} from '../app/phone-files-model.mjs';
import {createPhoneFiles} from '../app/phone-files.js';
import {errorText, SOURCE_NAME, SOURCES, rowKey, folderKey, trailNames} from '../app/files-model.mjs';

const KEY = 'abcdefghijklmnopqrstuvwxyzABCDEF';

test('경로 검사: 뿌리 안 상대 경로만, 숨김·Android/data·obb·../ 거절(앱 규칙과 같음)', () => {
  for (const ok of ['Download', 'Download/가짜 문서 (2).hwp', 'Android/media/x', 'a/b/c']) assert.equal(phonePathOk(ok), true, ok);
  for (const bad of ['', '/a', 'a/', 'a//b', '../x', 'a/../b', 'a/./b', '.hidden', 'a/.thumbnails/x', 'a\\b', 'a\u0000b', 'a\nb',
    'Android/data', 'android/DATA/x', 'Android/obb/x', 'x'.repeat(256), Array(41).fill('a').join('/')]) assert.equal(phonePathOk(bad), false, JSON.stringify(bad));
});

test('다리 줄 → 화면 줄(클라우드 색인 줄과 같은 모양), 모양이 틀린 줄은 버림', () => {
  const r = phoneRow({p: 'Download/가짜.pdf', n: '가짜.pdf', d: false, s: 10, m: Date.parse('2026-10-06T00:00:00Z'), t: 'application/pdf'});
  assert.deepEqual(r, {source: 'ph', item_id: 'Download/가짜.pdf', parent_id: 'Download', name: '가짜.pdf', is_folder: false, size_bytes: 10,
    modified_at: '2026-10-06T00:00:00.000Z', mime: 'application/pdf', folder_path: 'Download', starred: false, library_doc_id: null, hash: null});
  assert.equal(rowKey(r), 'ph:Download/가짜.pdf');
  const dir = phoneRow({p: 'Download', n: 'Download', d: true, s: 0, m: 0});
  assert.equal(dir.is_folder, true); assert.equal(dir.parent_id, null); assert.equal(dir.size_bytes, null); assert.equal(dir.modified_at, null); assert.equal(dir.folder_path, '');
  assert.equal(phoneRow({p: 'Android/data/x', n: 'x'}), null);
  assert.equal(phoneRow({p: 'a/b', n: 'c'}), null); // 이름이 경로 끝과 다름
  assert.equal(phoneRow(null), null);
  assert.equal(phoneRows([{p: 'a', n: 'a', d: true}, {p: '../x'}, 'x']).length, 1);
  assert.equal(phoneRows('x').length, 0);
});

test('위치 줄: 지금 폴더가 depth 0, 이름은 "이 폰 › …"', () => {
  const t = phoneTrail('Download/회의/2026');
  assert.deepEqual(t, [{item_id: 'Download', name: 'Download', depth: 2}, {item_id: 'Download/회의', name: '회의', depth: 1}, {item_id: 'Download/회의/2026', name: '2026', depth: 0}]);
  assert.deepEqual(trailNames(PHONE_SOURCE, t), ['이 폰', 'Download', '회의', '2026']);
  assert.deepEqual(phoneTrail(null), []);
  assert.deepEqual(phoneTrail('../x'), []);
  assert.equal(folderKey('ph', 'Download/회의'), 'ph:Download/회의');
});

test('상태 글: 열쇠는 켜져 있을 때만, 모양이 틀리면 null', () => {
  assert.deepEqual(phoneState(`pfiles:state:{"v":1,"can":true,"all":true,"key":"${KEY}"}`), {known: true, can: true, all: true, key: KEY, write: false, del: false});
  assert.deepEqual(phoneState(`pfiles:state:{"v":2,"write":true,"can":true,"all":true,"key":"${KEY}"}`), {known: true, can: true, all: true, key: KEY, write: true, del: false});
  assert.deepEqual(phoneState('pfiles:state:{"v":1,"can":true,"all":false}'), {known: true, can: true, all: false, key: '', write: false, del: false});
  assert.deepEqual(phoneState('pfiles:state:{"all":true,"key":"short"}'), {known: true, can: false, all: false, key: '', write: false, del: false});
  assert.equal(phoneState('photos:state:{}'), null);
  assert.equal(phoneState('pfiles:state:nope'), null);
});

test('실패 글: 폰 실패는 정해 둔 한 줄, 클라우드 출처 목록에는 이 폰을 넣지 않음', () => {
  assert.equal(errorText('phone_permission'), phoneErrorText('permission'));
  assert.equal(errorText('phone_whatever'), '폰 파일을 읽지 못했어요');
  assert.equal(SOURCE_NAME.ph, '이 폰');
  assert.deepEqual([...SOURCES], ['od', 'gd']);
});

test('다리: 폰 앱이 아니면 쓰지 않고, 켜진 뒤에만 열쇠 주소로 읽는다(서버로 나가지 않음)', async () => {
  const none = createPhoneFiles({navigator: {userAgent: 'Mozilla/5.0 Chrome'}, KPTUAppShell: {postMessage() {}, addEventListener() {}}});
  assert.equal(none.usable, false);
  assert.equal(none.ask(), false);
  const listeners = [], sent = [], fetched = [];
  const win = {
    navigator: {userAgent: 'Mozilla/5.0 Android KPTUAndroid/0.5.0'},
    document: {baseURI: 'https://bokdoong.com/work/app/'},
    KPTUAppShell: {postMessage(m) { sent.push(m); if (m === 'pfiles:hello') setTimeout(() => listeners.forEach(fn => fn({data: `pfiles:state:{"v":1,"can":true,"all":true,"key":"${KEY}"}`})), 0); }, addEventListener(t, fn) { listeners.push(fn); }},
    fetch: async (u, opt) => { fetched.push({u, opt}); return {ok: true, json: async () => ({items: [{p: 'Download', n: 'Download', d: true}]})}; },
  };
  const ph = createPhoneFiles(win);
  await assert.rejects(ph.list(null), /phone_permission/);
  assert.equal(fetched.length, 0);
  const st = await ph.hello();
  assert.equal(st.all, true);
  const rows = await ph.list(null);
  assert.equal(rows[0].item_id, 'Download');
  assert.equal(fetched[0].u, `https://bokdoong.com/work/app/__phone/${KEY}/files/list`);
  assert.equal(fetched[0].opt.credentials, 'omit');
  await ph.list('Download/회의');
  assert.equal(fetched[1].u, `https://bokdoong.com/work/app/__phone/${KEY}/files/list?dir=Download%2F%ED%9A%8C%EC%9D%98`);
  await assert.rejects(ph.list('Android/data'), /phone_blocked/);
  await assert.rejects(ph.blob('../x'), /phone_blocked/);
  assert.equal(fetched.length, 2);
  // 열쇠가 틀렸다고 하면 새 열쇠를 다시 묻는다.
  win.fetch = async () => ({ok: false, json: async () => ({error: 'key'})});
  await assert.rejects(ph.list(), /phone_key/);
  assert.equal(sent.filter(m => m === 'pfiles:hello').length, 2);
});

test('쓰기 답 모양: 정해 둔 짧은 글만, 경로는 검사한 것만', () => {
  assert.deepEqual(phoneDone('pfiles:done:{"ok":true,"op":"mkdir","path":"Download/x","count":1}'), {ok: true, op: 'mkdir', path: 'Download/x', count: 1, error: ''});
  assert.deepEqual(phoneDone('pfiles:done:{"ok":false,"op":"trash","count":0,"error":"<b>x</b>"}'), {ok: false, op: 'trash', path: '', count: 0, error: ''});
  assert.equal(phoneDone('pfiles:done:{"ok":true,"path":"Android/data/x"}').path, '');
  assert.equal(phoneDone('pfiles:save:{}'), null);
  assert.deepEqual(phoneSaved('pfiles:save:{"ok":true,"step":"end","got":5,"path":"a (2).pdf"}'), {ok: true, step: 'end', got: 5, path: 'a (2).pdf', error: ''});
  assert.equal(phoneWriteText('exists'), '같은 이름이 이미 있어요');
  assert.equal(phoneWriteText('zzz'), '폰에 쓰지 못했어요. 다시 해 보고, 또 안 되면 폰 앱을 껐다 켜 주세요');
});

// S53-7 FILES-이폰지우기: 폰 앱 0.5.4(del)는 휴지통이 문서까지 되고 못 한 이유를 준다. 막연한 '폰에 쓰지 못했어요'만 보이지 않게.
test('휴지통 못 한 이유: 앱이 준 이유마다 할 일 한 줄, 옛 앱은 새 판 안내', () => {
  assert.deepEqual(phoneState(`pfiles:state:{"v":2,"write":true,"del":true,"can":true,"all":true,"key":"${KEY}"}`), {known: true, can: true, all: true, key: KEY, write: true, del: true});
  assert.match(phoneWriteText('refused'), /확인 창에서 그만둬서/);
  assert.match(phoneWriteText('direct'), /내 파일' 앱에서 지워/);
  assert.match(phoneWriteText('missing'), /잠시 뒤 다시/);
  assert.match(phoneWriteText('permission'), /모든 파일 접근/);
  assert.match(phoneWriteText('write', {del: false}), /새 판으로 올리면/);
  assert.doesNotMatch(phoneWriteText('write', {del: true}), /새 판/);
  for (const c of ['refused', 'direct', 'missing', 'write', 'permission', 'timeout']) assert.notEqual(phoneWriteText(c, {del: true}), '폰에 쓰지 못했어요');
  assert.deepEqual(phoneDone('pfiles:done:{"ok":true,"op":"trash","count":2,"error":"direct"}'), {ok: true, op: 'trash', path: '', count: 2, error: 'direct'});
});

test('다리 쓰기: confirm:true를 붙이고, 받기는 begin → 384KB 조각 → end, 옛 앱(쓰기 모름)은 보내지 않음', async () => {
  const listeners = [], sent = [];
  let write = false;
  const reply = d => setTimeout(() => listeners.forEach(fn => fn({data: d})), 0);
  const win = {
    navigator: {userAgent: 'KPTUAndroid/0.5.0'}, document: {baseURI: 'https://bokdoong.com/work/app/'}, btoa: s => Buffer.from(s, 'binary').toString('base64'),
    KPTUAppShell: {
      postMessage(m) {
        sent.push(m.length > 80 ? m.slice(0, 80) : m);
        if (m === 'pfiles:hello') reply(`pfiles:state:{"v":2,"write":${write},"can":true,"all":true,"key":"${KEY}"}`);
        if (m.startsWith('pfiles:op:')) reply('pfiles:done:{"ok":true,"op":"mkdir","path":"Download/x","count":1}');
        if (m.startsWith('pfiles:save:begin:')) reply('pfiles:save:{"ok":true,"step":"begin","got":0}');
        if (m.startsWith('pfiles:save:part:')) reply(`pfiles:save:{"ok":true,"step":"part","got":${Buffer.from(m.slice(17), 'base64').length}}`);
        if (m === 'pfiles:save:end') reply('pfiles:save:{"ok":true,"step":"end","got":0,"path":"Download/a.bin"}');
      },
      addEventListener(t, fn) { listeners.push(fn); },
    },
  };
  const ph = createPhoneFiles(win);
  await ph.hello();
  assert.deepEqual(await ph.op({op: 'mkdir', dir: 'Download', name: 'x'}), {ok: false, op: 'mkdir', path: '', count: 0, error: 'permission'});
  assert.equal(sent.filter(m => m.startsWith('pfiles:op:')).length, 0);
  write = true; await ph.hello();
  const d = await ph.op({op: 'mkdir', dir: 'Download', name: 'x'});
  assert.equal(d.ok, true);
  assert.equal(sent.at(-1), 'pfiles:op:{"op":"mkdir","dir":"Download","name":"x","confirm":true}');
  const blob = new Blob([new Uint8Array(384 * 1024 + 10)]);
  const steps = [];
  const r = await ph.save('Download', 'a.bin', blob, got => steps.push(got));
  assert.equal(r.ok, true); assert.equal(r.path, 'Download/a.bin');
  assert.deepEqual(steps, [384 * 1024, 10]);
  assert.equal(sent.filter(m => m.startsWith('pfiles:save:part:')).length, 2);
  assert.ok(sent.some(m => m.startsWith('pfiles:save:begin:{"dir":"Download","name":"a.bin","size":393226,"confirm":true}')));
  assert.equal((await ph.save('Android/data', 'a', blob)).error, 'blocked');
});
