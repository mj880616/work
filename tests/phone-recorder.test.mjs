// MTG-폰녹음: 폰 앱 [녹음]의 웹 쪽 연결(app/phone-recorder-core.mjs·phone-recorder.js). 앱(안드로이드)은 가짜 다리로 흉내 낸다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readMessage, failWire, pendingList, pieceHeaders, createPhoneRecorder} from '../app/phone-recorder-core.mjs';

const SID = '11111111-2222-4333-8444-555555555555';
const RID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const WS = '99999999-8888-4777-8666-555555555555';
const tick = ms => new Promise(r => setTimeout(r, Math.min(ms, 5)));
const until = async (fn, n = 400) => { for (let i = 0; i < n; i++) { if (fn()) return; await tick(1); } throw new Error('기다림 초과'); };

// 앱 흉내: 다리 글을 받아 RecordHub·MainActivity와 같은 답을 준다.
function setup({failPieceOnce = false, discardStatus = 0} = {}) {
  const st = {state:'idle', session_id:'', started_at:'', elapsed_ms:0, queued:0, auto_finish:false, discard:false, want_start:false};
  let pieces = [], seq = 0, core = null;
  const sent = [], calls = [], notes = [], drafts = [];
  const reply = t => queueMicrotask(() => core.receive(t));
  const state = () => reply('rec:state:' + JSON.stringify({...st, queued:pieces.length}));
  const add = () => { seq++; pieces.push({no:1, id:RID, seq, seconds:seq * 60, size:100, token:`tok${seq}xxxxxxxxxxxxxxxxxxxx`}); };
  const send = t => {
    sent.push(t);
    if (t === 'rec:hello') state();
    else if (t === 'rec:prepare') reply('rec:ready');
    else if (t.startsWith('rec:begin:')) { const b = JSON.parse(t.slice(10)); Object.assign(st, {state:'recording', session_id:b.session_id, started_at:b.started_at, workspace_id:b.workspace_id}); add(); state(); }
    else if (t === 'rec:next') reply('rec:next:' + JSON.stringify(pieces.length ? {kind:'piece', ...pieces[0]} : st.state === 'recording' ? {kind:'idle'} : st.state === 'idle' ? {kind:'none'} : {kind:'drained'}));
    else if (t.startsWith('rec:sent:')) { const [, , no, s] = t.split(':'); if (pieces[0] && String(pieces[0].seq) === s && no === '1') pieces.shift(); }
    else if (t.startsWith('rec:failed:')) reply('rec:wait:0');
    else if (t === 'rec:stop' || t === 'rec:discard') { st.state = 'stopped'; st.discard = t === 'rec:discard'; add(); state(); }
    else if (t === 'rec:clear') { st.state = 'idle'; st.session_id = ''; pieces = []; state(); }
  };
  let failed = !failPieceOnce;
  const call = async (action, body, extra = {}) => {
    calls.push({action, body, extra});
    if (action === 'rec_start') return {recording_id:RID, session_id:SID, segment_no:1, piece_seconds:300, segment_seconds:3540};
    if (action === 'rec_piece') { if (!failed) { failed = true; const e = new Error('잠시 뒤'); e.status = 503; throw e; } return {ok:true}; }
    if (action === 'rec_finish') return {segments:[{segment_no:1, status:'combined', job_id:'job-1', duration_sec:120}]};
    if (action === 'transcribe') return {text:'회의를 시작합니다.'};
    if (action === 'rec_pending') return {sessions:[]};
    if (action === 'rec_discard') { if (discardStatus) { const e = new Error(''); e.status = discardStatus; throw e; } return {ok:true}; }
    if (action === 'rec_restore') return {ok:true};
    throw new Error('모르는 호출 ' + action);
  };
  core = createPhoneRecorder({
    send, call, sleep:tick, workspace:() => WS,
    fetchPiece:async token => ({size:100, token}),
    openDraft:async d => { drafts.push(d); },
    notify:(text, opts) => notes.push({text, opts}),
  });
  return {core, st, sent, calls, notes, drafts, pieces:() => pieces, state};
}

test('앱 글 읽기: 상태·다음 일·기다림만, 그 밖은 버린다', () => {
  assert.deepEqual(readMessage('rec:state:{"state":"recording"}'), {kind:'state', data:{state:'recording'}});
  assert.deepEqual(readMessage('rec:next:{"kind":"idle"}'), {kind:'next', data:{kind:'idle'}});
  assert.deepEqual(readMessage('rec:wait:3000'), {kind:'wait', data:3000});
  assert.deepEqual(readMessage('rec:ready'), {kind:'ready', data:null});
  assert.deepEqual(readMessage('rec:error:start'), {kind:'error', data:'start'});
  assert.equal(readMessage('rec:state:{bad'), null);
  assert.equal(readMessage('widget:status:on'), null);
  assert.equal(readMessage(null), null);
});

test('올리기 실패 갈래: 가득 참은 full, 서버가 닫음은 stop, 나머지는 retry', () => {
  assert.equal(failWire({message:'이 녹음 구간이 가득 찼어요. 새 구간으로 이어 주세요.', status:413}), 'full');
  assert.equal(failWire({message:'이 녹음 구간은 이미 닫혔어요.', status:409}), 'stop');
  assert.equal(failWire({status:404}), 'stop');
  assert.equal(failWire({status:503}), 'retry');
  assert.equal(failWire({status:0}), 'retry');
  assert.equal(failWire({code:'session_required'}), 'retry');
});

test('조각 머리글은 노트북과 같은 rec_piece 규칙(ogg)', () => {
  assert.deepEqual(pieceHeaders({id:RID, seq:3, seconds:180}), {'Content-Type':'audio/ogg', 'x-recording-id':RID, 'x-piece-seq':'3', 'x-duration-sec':'180'});
});

test('끝나지 않은 녹음 줄: 이 폰 녹음 먼저, 서버 목록에서 같은 녹음·녹음 중인 것은 뺀다', () => {
  const native = {state:'interrupted', session_id:SID, started_at:'2026-10-30T05:00:00.000Z', elapsed_ms:125000};
  const server = [{session_id:SID}, {session_id:'other'}, {session_id:'live'}];
  assert.deepEqual(pendingList(native, server, 'live').map(s => [s.session_id, !!s.local]), [[SID, true], ['other', false]]);
  assert.equal(pendingList(native, server)[0].duration_sec, 125);
  // 알림 [멈추고 정리]로 멈춘 것(자동 정리)은 줄에 넣지 않는다.
  assert.deepEqual(pendingList({...native, state:'stopped', auto_finish:true}, []), []);
  assert.deepEqual(pendingList({state:'idle'}, [{session_id:'x'}]).map(s => s.session_id), ['x']);
});

test('녹음 → 조각 올리기(재시도 포함) → 멈추고 정리 → 회의 초안', async () => {
  const t = setup({failPieceOnce:true});
  await t.core.hello();
  assert.equal(t.core.view.supported, true);
  await t.core.start();
  assert.equal(t.core.view.state, 'recording');
  const begin = JSON.parse(t.sent.find(s => s.startsWith('rec:begin:')).slice(10));
  assert.equal(begin.session_id, SID);
  assert.equal(begin.piece_seconds, 300);
  assert.equal(t.calls.find(c => c.action === 'rec_start').body.mime, 'audio/ogg');
  // 첫 조각: 한 번 실패 → 앱에 알리고(재시도 간격은 앱이 정함) 같은 번호로 다시.
  await until(() => t.sent.includes('rec:sent:1:1'));
  assert.ok(t.sent.includes('rec:failed:1:1:retry'));
  const pieceCalls = t.calls.filter(c => c.action === 'rec_piece');
  assert.equal(pieceCalls.length, 2);
  assert.equal(pieceCalls[1].extra.headers['x-piece-seq'], '1');
  await t.core.stopAndFinish();
  assert.ok(t.sent.includes('rec:stop'));
  assert.ok(t.sent.includes('rec:sent:1:2'), '멈춘 뒤 마지막 조각까지 올린다');
  const order = t.calls.map(c => c.action);
  assert.ok(order.indexOf('rec_finish') > order.lastIndexOf('rec_piece'));
  assert.ok(t.sent.indexOf('rec:clear') > t.sent.indexOf('rec:sent:1:2'), 'rec_finish 뒤 앱 임시 파일 지우기');
  assert.equal(t.drafts.length, 1);
  assert.match(t.drafts[0].text, /회의를 시작합니다/);
  assert.deepEqual(t.drafts[0].jobs, ['job-1']);
  assert.equal(t.core.view.state, 'done');
});

test('알림줄 [멈추고 정리]: 앱이 멈춘 상태(auto_finish)를 알리면 화면이 바로 정리한다', async () => {
  const t = setup();
  Object.assign(t.st, {state:'stopped', session_id:SID, started_at:'2026-10-30T05:00:00.000Z', auto_finish:true, elapsed_ms:300000});
  await t.core.hello();
  await until(() => t.core.view.state === 'done');
  assert.ok(t.sent.includes('rec:finishing'));
  assert.ok(t.calls.some(c => c.action === 'rec_finish' && c.body.session_id === SID));
  assert.equal(t.drafts[0].minutes, 5);
});

test('앱이 죽은 뒤 다시 열면 이어서 정리 줄 → 누르면 남은 조각을 올리고 정리', async () => {
  const t = setup();
  Object.assign(t.st, {state:'interrupted', session_id:SID, started_at:'2026-10-30T05:00:00.000Z', elapsed_ms:60000});
  await t.core.hello();
  await until(() => t.core.view.pending.length === 1);
  assert.equal(t.core.view.pending[0].local, true);
  t.core.resume(SID);
  await until(() => t.core.view.state === 'done');
  assert.ok(t.sent.includes('rec:clear'));
});

test('녹음 중 [버리기]: 멈추고 남은 조각을 마저 올린 뒤 rec_discard, 앱 임시 파일 지움, 되돌리기 알림', async () => {
  const t = setup();
  await t.core.hello();
  await t.core.start();
  await t.core.discardLive();
  assert.ok(t.sent.includes('rec:discard'));
  assert.ok(t.sent.includes('rec:clear'));
  assert.ok(t.calls.some(c => c.action === 'rec_discard' && c.body.session_id === SID));
  assert.equal(t.calls.some(c => c.action === 'rec_finish' || c.action === 'transcribe'), false, '전사·초안 없음');
  assert.equal(t.drafts.length, 0);
  const note = t.notes.at(-1);
  assert.equal(note.text, '녹음을 버렸어요');
  assert.equal((await note.opts.undo()).status, 'restored');
  assert.ok(t.calls.some(c => c.action === 'rec_restore'));
});

test('끝나지 않은 폰 녹음이 있으면 새 녹음을 시작하지 않는다', async () => {
  const t = setup();
  Object.assign(t.st, {state:'interrupted', session_id:SID});
  await t.core.hello();
  await t.core.start();
  assert.equal(t.calls.some(c => c.action === 'rec_start'), false);
  assert.match(t.notes.at(-1).text, /끝나지 않은 폰 녹음/);
});

test('옛 앱(다리 답 없음)이면 [녹음]을 보이지 않는다', async () => {
  const core = createPhoneRecorder({send:() => {}, call:async () => ({}), sleep:tick, workspace:() => WS, fetchPiece:async () => null, openDraft:async () => {}});
  const r = await core.hello();
  assert.equal(r, null);
  assert.equal(core.view.supported, false);
});

test('화면 연결: 폰 앱에서만 불러오고, 노트북 녹음과 따로 그리며, 브라우저 저장 공간을 쓰지 않는다', () => {
  const loader = readFileSync(new URL('../app/loader-v2.js', import.meta.url), 'utf8');
  assert.match(loader, /if\(\/KPTUAndroid\/i\.test\(navigator\.userAgent\|\|''\)\)import\('\.\/phone-recorder\.js'\)/);
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  // [녹음] 자리: [+ 사업 보고]·사업 보고 목록이 index.html에 있어야 이 모듈이 그 앞에 붙인다.
  assert.match(html, /<button id="newMeetingBtn"/);
  assert.match(html, /<div id="meetingList"/);
  for (const f of ['phone-recorder.js', 'phone-recorder-core.mjs']) {
    const src = readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(src, /#reportRecordBtn|#recBand|#recPendingLine/, '노트북 녹음 자리를 건드리지 않음');
    assert.doesNotMatch(src, /console\.(log|info)\(/);
  }
  const ui = readFileSync(new URL('../app/phone-recorder.js', import.meta.url), 'utf8');
  assert.match(ui, /\/KPTUAndroid\/i\.test/);
  assert.match(ui, /__rec\//);
  assert.match(ui, /b\.id='phoneRecordBtn'[^\n]*add\.before\(b\)/);
  assert.match(ui, /d\.id='phoneRecPendingLine'[^\n]*list\.before\(d\)/);
});
