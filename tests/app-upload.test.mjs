// APP-뒤에서올리기 1단계(요청함 11/11 06:56): 폰 앱 안 올리기 = 앱 다리(app/app-upload.js) → 앱이 뒤에서 올림. 다리 있을 때·없을 때.
// 시험 자료는 모두 지어낸 값이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAppUpload, uploadReasonText, UP_PART, UP_MAX, UP_FILE_MAX} from '../app/app-upload.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.5.7';
const MEETING = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', PROJECT = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const DOC = 'cccccccc-0000-4ccc-8ddd-000000000001', BATCH = 'abcdefghijklmnop_-012345';
const blob = (n, type = 'image/jpeg', name = 'a.jpg') => Object.assign(new Blob([new Uint8Array(n).fill(65)], {type}), {name});
const target = {kind: 'meeting', meeting: MEETING, project: ''};
const job = (over = {}) => ({id: BATCH, kind: 'meeting', target: MEETING, total: 2, left: 2, state: 'run', reason: '', docs: ['', ''], errors: ['', ''], ...over});

// 지어낸 앱: know=false면 옛 앱(up:hello에 답하지 않음). on=false면 위젯 로그인 없음. fail = 그 걸음에서 거절. silent = 그 걸음에 답 없음.
function fakeApp({know = true, on = true, ua = ANDROID, fail = '', error = 'failed', silent = '', jobs = [], kinds = ['meeting']} = {}) {
  const sent = [], listeners = [];
  const say = data => setTimeout(() => listeners.forEach(fn => fn({data})), 0);
  const bridge = {
    postMessage(m) {
      m = String(m); sent.push(m.startsWith('up:part:') ? 'up:part' : m);
      if (!m.startsWith('up:') || !know) return;
      const step = m.slice(3).split(':')[0];
      if (step === silent) return;
      if (step === 'hello') return say(`up:state:${JSON.stringify({v: 1, on, kinds, jobs})}`);
      if (step === 'cancel' || step === 'seen') return;
      const ok = step !== fail, id = ok && (step === 'start' || step === 'go') ? `,"id":"${BATCH}"` : '';
      say(`up:ack:{"ok":${ok},"step":"${step}","error":"${ok ? '' : error}"${id}}`);
    },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
  };
  return {sent, say, win: {navigator: {userAgent: ua}, KPTUAppShell: bridge}};
}
const make = (opts, timing = {helloMs: 50, stepMs: 200}) => { const app = fakeApp(opts); return {...app, up: createAppUpload(app.win, timing)}; };
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

test('다리 없음(PC·폰 브라우저)·앱 표시 없음: 넘기지 않고 off → 부른 곳이 지금 길로 올린다', async () => {
  for (const win of [{navigator: {userAgent: 'Mozilla/5.0 Chrome/141.0'}}, fakeApp({ua: 'Mozilla/5.0 Chrome/141.0'}).win, {navigator: {userAgent: ANDROID}}, undefined]) {
    const up = createAppUpload(win, {helloMs: 30});
    assert.equal(up.usable, false);
    assert.equal(await up.ready(), false);
    assert.deepEqual(await up.send(target, [{file: blob(5)}]), {ok: false, error: 'off'});
    assert.equal(up.seen(BATCH), false);
  }
});

test('옛 앱(up:hello에 답 없음)·위젯 로그인 없음(on:false): 파일을 넘기지 않는다', async () => {
  const old = make({know: false});
  assert.equal(await old.up.ready(), false);
  assert.equal(old.up.known(), false);
  assert.deepEqual(await old.up.send(target, [{file: blob(5)}]), {ok: false, error: 'off'});
  assert.deepEqual(old.sent, ['up:hello']);
  const off = make({on: false});
  assert.equal(await off.up.ready(), false);
  assert.equal(off.up.known(), true);
  assert.equal(off.up.on(), false);
  assert.deepEqual(await off.up.send(target, [{file: blob(5)}]), {ok: false, error: 'off'});
  assert.deepEqual(off.sent, ['up:hello']);
  // 이 판이 모르는 대상(다음 단계의 자료실 등)도 넘기지 않는다.
  const app = make();
  assert.equal(await app.up.ready(), true);
  assert.equal(app.up.can('meeting'), true);
  assert.equal(app.up.can('library'), false);
  assert.deepEqual(await app.up.send({kind: 'library', meeting: MEETING}, [{file: blob(5)}]), {ok: false, error: 'off'});
  assert.deepEqual(await app.up.send({kind: 'meeting', meeting: 'x'}, [{file: blob(5)}]), {ok: false, error: 'off'});
  assert.deepEqual(await app.up.send({kind: 'meeting', meeting: MEETING, project: 'x'}, [{file: blob(5)}]), {ok: false, error: 'off'});
  assert.deepEqual(app.sent, ['up:hello']);
});

test('넘기기: 대상 → 파일마다 시작·조각·끝 → 맡김. 넘기는 것은 파일·대상 id·사진 칸뿐', async () => {
  const {sent, up} = make();
  assert.equal(await up.ready(), true);
  const photo = blob(UP_PART + 10, 'image/jpeg', '사진 1.jpg'), doc = blob(7, 'application/pdf', '자료.pdf');
  const r = await up.send({kind: 'meeting', meeting: MEETING.toUpperCase(), project: PROJECT}, [
    {file: photo, fields: {title: '사진 1', category: '사진', document_date: '2026-11-11'}},
    {file: doc},
  ]);
  assert.deepEqual(r, {ok: true, id: BATCH, count: 2});
  assert.deepEqual(sent, [
    'up:hello',
    `up:start:{"kind":"meeting","meeting":"${MEETING}","project":"${PROJECT}","count":2}`,
    `up:begin:{"name":"사진 1.jpg","mime":"image/jpeg","size":${UP_PART + 10},"title":"사진 1","category":"사진","date":"2026-11-11"}`,
    'up:part', 'up:part', 'up:end',
    'up:begin:{"name":"자료.pdf","mime":"application/pdf","size":7}',
    'up:part', 'up:end',
    'up:go',
  ]);
  // 로그인 정보·토큰·작업공간은 어떤 글에도 없다.
  for (const m of sent) assert.doesNotMatch(m, /token|bearer|authorization|apikey|workspace|session/i);
});

test('조각은 base64 384KB씩, 날짜 모양이 아니면 싣지 않는다', async () => {
  const app = fakeApp();
  const parts = [], begins = [];
  const post = app.win.KPTUAppShell.postMessage;
  app.win.KPTUAppShell.postMessage = m => { if (String(m).startsWith('up:part:')) parts.push(String(m).slice(8)); if (String(m).startsWith('up:begin:')) begins.push(JSON.parse(String(m).slice(9))); post(m); };
  const up = createAppUpload(app.win, {helloMs: 50, stepMs: 200});
  await up.ready();
  assert.equal((await up.send(target, [{file: blob(UP_PART * 2 + 3), fields: {title: '  ', category: '가'.repeat(60), document_date: '11/11'}}])).ok, true);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map(p => Buffer.from(p, 'base64').length), [UP_PART, UP_PART, 3]);
  assert.ok(parts.every(p => p.length <= 700000 && p.length % 4 === 0));
  assert.deepEqual(Object.keys(begins[0]), ['name', 'mime', 'size', 'category']);
  assert.equal(begins[0].category.length, 40);
});

test('앱이 걸음을 거절하거나 답이 없으면 받다 만 묶음을 버리게 하고 ok:false(부른 곳이 지금 길로)', async () => {
  for (const [opts, error] of [[{fail: 'start', error: 'off'}, 'off'], [{fail: 'begin', error: 'space'}, 'space'], [{fail: 'part'}, 'failed'], [{fail: 'end'}, 'failed'], [{fail: 'go'}, 'failed'], [{silent: 'part'}, 'timeout']]) {
    const {sent, up} = make(opts, {helloMs: 50, stepMs: 60});
    await up.ready();
    assert.deepEqual(await up.send(target, [{file: blob(5)}]), {ok: false, error}, JSON.stringify(opts));
    assert.equal(sent.at(-1), 'up:cancel', JSON.stringify(opts));
    assert.equal(sent.includes('up:go'), opts.fail === 'go');
  }
  // 화면이 바뀌었으면(alive false) 넘기다 그만둔다.
  const {sent, up} = make();
  await up.ready();
  let n = 0;
  assert.deepEqual(await up.send(target, [{file: blob(5)}, {file: blob(5)}], {alive: () => n++ < 1}), {ok: false, error: 'failed'});
  assert.equal(sent.at(-1), 'up:cancel');
  assert.equal(sent.filter(m => m.startsWith('up:begin:')).length, 1);
});

test('한도: 20개·한 개 100MB·빈 파일·앞 넘기기가 아직이면 넘기지 않는다', async () => {
  const {sent, up} = make();
  await up.ready();
  assert.deepEqual(await up.send(target, []), {ok: false, error: 'none'});
  assert.deepEqual(await up.send(target, [{file: blob(0)}]), {ok: false, error: 'none'});
  assert.deepEqual(await up.send(target, Array.from({length: UP_MAX + 1}, () => ({file: blob(1)}))), {ok: false, error: 'too_many'});
  assert.deepEqual(await up.send(target, [{file: {size: UP_FILE_MAX + 1, name: 'big.bin', type: ''}}]), {ok: false, error: 'too_big'});
  assert.deepEqual(sent, ['up:hello']);
  const first = up.send(target, [{file: blob(5)}]);
  assert.deepEqual(await up.send(target, [{file: blob(5)}]), {ok: false, error: 'busy'});
  assert.equal((await first).ok, true);
  assert.equal((await up.send(target, [{file: blob(5)}])).ok, true);
});

test('묶음 알림: 올리는 중 → 끝. 화면이 닫혀 있던 동안 끝난 것은 다음 up:hello 답으로 안다', async () => {
  const {sent, say, up} = make({jobs: [job({id: 'zzzzzzzzzzzzzzzz_-999999', total: 1, left: 0, state: 'done', docs: [DOC], errors: ['']})]});
  const got = [];
  const off = up.onJob(j => got.push(`${j.id}:${j.state}:${j.left}`));
  assert.equal(await up.ready(), true);
  assert.deepEqual(got, ['zzzzzzzzzzzzzzzz_-999999:done:0']);
  assert.deepEqual(up.jobs()[0].docs, [DOC]);
  say(`up:job:${JSON.stringify(job({left: 1, docs: [DOC.toUpperCase(), '']}))}`);
  say(`up:job:${JSON.stringify(job({left: 0, state: 'done', docs: [DOC, ''], errors: ['', 'too_big']}))}`);
  await tick();
  assert.deepEqual(got.slice(1), [`${BATCH}:run:1`, `${BATCH}:done:0`]);
  const done = up.jobs(MEETING.toUpperCase()).find(j => j.id === BATCH);
  assert.deepEqual(done, {id: BATCH, kind: 'meeting', target: MEETING, total: 2, left: 0, state: 'done', reason: '', docs: [DOC, ''], errors: ['', 'too_big']});
  assert.deepEqual(up.jobs('dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee'), []);
  // 모양이 다른 알림은 버린다.
  for (const bad of ['up:job:{', 'up:job:{"id":"x","state":"done"}', `up:job:{"id":"${BATCH}","state":"weird"}`, 'up:job:null']) say(bad);
  await tick();
  assert.equal(got.length, 3);
  // 반영했으면 앱 기록을 지우게 한다.
  assert.equal(up.seen(BATCH), true);
  assert.equal(sent.at(-1), `up:seen:${BATCH}`);
  assert.equal(up.jobs().some(j => j.id === BATCH), false);
  assert.equal(up.seen('../x'), false);
  off();
  say(`up:job:${JSON.stringify(job())}`);
  await tick();
  assert.equal(got.length, 3);
});

test('화면으로 돌아오면 앱에 다시 묻는다(뒤에 있는 동안 끝난 묶음·멈춘 묶음 다시 걸기)', async () => {
  const app = fakeApp();
  const handlers = [];
  app.win.document = {visibilityState: 'hidden', addEventListener: (type, fn) => { if (type === 'visibilitychange') handlers.push(fn); }};
  const up = createAppUpload(app.win, {helloMs: 50, stepMs: 200});
  assert.equal(await up.ready(), true);
  assert.equal(await up.ready(), true);
  assert.equal(handlers.length, 1);
  const before = app.sent.filter(m => m === 'up:hello').length;
  handlers[0]();
  assert.equal(app.sent.filter(m => m === 'up:hello').length, before);
  app.win.document.visibilityState = 'visible';
  handlers[0]();
  await tick();
  assert.equal(app.sent.filter(m => m === 'up:hello').length, before + 1);
});

test('실패 까닭 문구: 인터넷 탓일 때만 인터넷이라고 쓴다', () => {
  assert.match(uploadReasonText('network'), /인터넷/);
  for (const code of ['server', 'signed_out', 'too_big', 'forbidden', 'gone', 'unknown', 'missing', 'internal', 'refused', '', undefined]) {
    assert.doesNotMatch(uploadReasonText(code), /인터넷|네트워크/, String(code));
    assert.ok(uploadReasonText(code).length > 0);
  }
});

test('모듈은 로그인 정보·기기 저장소를 만지지 않고, 앱 규칙과 같은 한도·글을 쓴다', () => {
  const src = read('app/app-upload.js');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  // 기기 저장소 이름은 이어 붙여 적는다(저장소 사용 검사가 이 시험 파일을 '사용'으로 세지 않게).
  const stores = ['local', 'session'].map(k => k + 'Storage').concat('indexed' + 'DB');
  for (const bad of ['access_token', 'refresh_token', 'KPTURuntime', ...stores, 'fetch(', 'XMLHttpRequest', 'console.']) assert.equal(code.includes(bad), false, bad);
  assert.doesNotMatch(src, /\?v=/);
  const rules = read('android-app/app/src/main/java/kr/or/kptu/work/BackUploadRules.kt');
  // 웹이 보내는 글머리는 모두 앱 규칙이 읽는 것이다.
  for (const head of ['up:hello', 'up:start:', 'up:begin:', 'up:part:', 'up:end', 'up:go', 'up:cancel', 'up:seen:']) {
    assert.ok(code.includes(head.replace(/:$/, '')), head);
    assert.ok(rules.includes(`"${head}"`), head);
  }
  assert.ok(rules.includes('const val PART_MAX = 700_000'));
  assert.ok(Math.ceil(UP_PART / 3) * 4 <= 700000);
  assert.equal(UP_MAX, 20);
  assert.equal(UP_FILE_MAX, 100 * 1024 * 1024);
  // 실패 까닭 코드는 앱과 같은 이름이다.
  for (const c of ['network', 'server', 'signed_out', 'too_big', 'forbidden', 'gone', 'unknown', 'missing', 'internal']) {
    assert.ok(rules.includes(`= "${c}"`), c);
    assert.ok(code.includes(`'${c}'`), c);
  }
});
