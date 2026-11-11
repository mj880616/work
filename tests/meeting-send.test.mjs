// BIZ-저장먼저닫기: 사업 보고 사진·자료 한 묶음 올리기(app/meeting-send.mjs) — 화면·서버 없이 본다(가짜 파일·가짜 이름).
import test from 'node:test';
import assert from 'node:assert/strict';
import {bindAppJobs, createAppHandoff, createMeetingSend, sendDoneLine, sendFailLine, sendHandedLine, sendHandingLine, sendLiveLine} from '../app/meeting-send.mjs';

const file = (name, type = 'application/octet-stream') => ({name, type, size: 10});
const photo = n => file(`p${n}.jpg`, 'image/jpeg');
const isPhoto = f => /^image\//.test(f.type);
const target = {id: 'm1', project_id: '', kind: 'meeting', day: '2026-11-11'};

// 공용 뒤 줄 흉내: 앞 일이 끝나야 다음 일을 부른다.
function makeLine() {
  let tail = Promise.resolve();
  const line = work => (tail = tail.then(work, work));
  return {line, idle: () => tail};
}
function makeJob(file) {
  let cancelled = false;
  return {file, phase: 'waiting', failed: '', fails: 0, start() { this.phase = 'sending'; }, fail(m) { this.fails++; this.phase = 'failed'; this.failed = m || 'x'; }, cancel() { cancelled = true; }, cancelled: () => cancelled};
}
function setup(over = {}) {
  const {line, idle} = makeLine();
  const sent = [], events = [], jobs = [];
  let active = 0, most = 0;
  const upload = over.upload || (async (t, f) => { sent.push(f.name); return {id: 'd-' + f.name}; });
  const send = createMeetingSend({
    line, isPhoto,
    track: f => { const j = makeJob(f); jobs.push(j); return j; },
    report: e => events.push(e),
    ...over,
    upload: async (...a) => { active++; most = Math.max(most, active); try { return await upload(...a); } finally { active--; } },
  });
  return {send, sent, events, jobs, idle, most: () => most};
}

test('글: 다 올림 · 못 올림 · 올리는 중', () => {
  assert.equal(sendDoneLine({photos: 7, files: 1}), '사진 7장·자료 1개 올렸어요');
  assert.equal(sendDoneLine({photos: 2}), '사진 2장 올렸어요');
  assert.equal(sendDoneLine({files: 3}), '자료 3개 올렸어요');
  assert.equal(sendDoneLine({}), '');
  assert.equal(sendLiveLine({photos: 7, files: 1}), '사진 7장·자료 1개 올리는 중');
  assert.equal(sendFailLine({okPhotos: 5, okFiles: 1, badPhotos: 2}), '사진 2장 못 올렸어요 · 사진 5장·자료 1개 올렸어요');
  assert.equal(sendFailLine({badPhotos: 1, badFiles: 1}), '사진 1장·자료 1개 못 올렸어요');
  assert.equal(sendFailLine({okPhotos: 1}), '사진 1장 올렸어요');
});

test('사진 7장 + 자료 1개: 고른 순서대로, 한 번에 하나씩, 그 사업 보고로 끝까지', async () => {
  const s = setup();
  const files = [...Array.from({length: 7}, (_, i) => photo(i + 1)), file('자료.hwp')];
  const batch = s.send.send(target, files);
  assert.equal(s.send.going('m1'), true);
  assert.equal(s.send.has('m1', files[3]), true);
  assert.equal(s.send.has('m2', files[3]), false);
  await batch.settled;
  assert.deepEqual(s.sent, files.map(f => f.name));
  assert.equal(s.most(), 1, '한 번에 하나만 보낸다');
  const done = s.events.at(-1);
  assert.equal(done.type, 'done');
  assert.deepEqual([done.okPhotos, done.okFiles, done.badPhotos, done.badFiles, done.sent], [7, 1, 0, 0, 8]);
  assert.equal(done.retry, false);
  assert.equal(s.send.going('m1'), false);
  assert.equal(s.send.has('m1', files[0]), false, '다 올라간 묶음은 메모리에서 놓는다');
  assert.equal(s.events[0].type, 'queued');
  assert.deepEqual([s.events[0].openPhotos, s.events[0].openFiles], [7, 1]);
});

test('올리는 중에 또 저장하면 같은 줄 뒤에 선다(묶음 사이에도 한 번에 하나)', async () => {
  const s = setup();
  const a = s.send.send(target, [photo(1), photo(2)]);
  const b = s.send.send({...target, id: 'm2'}, [file('b.pdf')]);
  await Promise.all([a.settled, b.settled]);
  assert.deepEqual(s.sent, ['p1.jpg', 'p2.jpg', 'b.pdf']);
  assert.equal(s.most(), 1);
});

test('못 올린 파일만 [다시 올리기]: 올라간 것은 다시 보내지 않는다', async () => {
  let broken = true;
  const s = setup({upload: async (t, f) => { if (f.name === 'p2.jpg' && broken) throw Object.assign(new Error('서버 오류'), {status: 500}); return {id: f.name}; },
    classify: e => ({kind: 'error', message: '파일을 업로드하지 못했어요.'})});
  const files = [photo(1), photo(2), file('a.pdf')];
  const batch = s.send.send(target, files);
  await batch.settled;
  const done = s.events.at(-1);
  assert.deepEqual([done.okPhotos, done.okFiles, done.badPhotos, done.badFiles, done.retry], [1, 1, 1, 0, true]);
  assert.equal(done.message, '파일을 업로드하지 못했어요.');
  assert.equal(s.send.has('m1', files[1]), true, '못 올린 파일은 [다시 올리기]를 위해 남는다');
  assert.equal(s.send.has('m1', files[0]), false);
  broken = false;
  let calls = 0;
  const before = s.jobs.length;
  assert.equal(await s.send.retry(batch), true);
  await batch.settled;
  calls = s.jobs.length - before;
  assert.equal(calls, 1, '못 올린 파일 하나만 다시 표시를 만든다');
  assert.equal(s.jobs[1].cancelled(), true, "옛 '실패' 표시는 지운다(같은 파일이 실패·대기 두 줄로 겹치지 않게)");
  assert.deepEqual([s.jobs[0].cancelled(), s.jobs[2].cancelled()], [false, false]);
  const again = s.events.at(-1);
  assert.deepEqual([again.okPhotos, again.okFiles, again.badPhotos, again.sent, again.retry], [2, 1, 0, 1, false]);
  assert.equal(await s.send.retry(batch), false, '다 올라간 묶음은 다시 올리지 않는다');
});

test('멈춰야 하는 실패(로그인 만료 등) 뒤 남은 파일은 보내지 않고 [다시 올리기]로 남긴다', async () => {
  const seen = [];
  const s = setup({upload: async (t, f) => { seen.push(f.name); if (f.name === 'p1.jpg') throw Object.assign(new Error('x'), {status: 401}); return {}; },
    classify: () => ({kind: 'error', stop: true, message: '로그인 세션이 만료됐습니다.'})});
  const batch = s.send.send(target, [photo(1), photo(2), file('a.pdf')]);
  await batch.settled;
  assert.deepEqual(seen, ['p1.jpg']);
  const done = s.events.at(-1);
  assert.deepEqual([done.badPhotos, done.badFiles, done.okPhotos, done.retry], [2, 1, 0, true]);
  assert.equal(done.message, '로그인 세션이 만료됐습니다.');
  assert.deepEqual(s.jobs.map(j => j.fails), [1, 1, 1], '못 올린 파일·서 있던 파일의 표시가 모두 실패로 바뀐다(한 번씩)');
  assert.deepEqual(s.jobs.map(j => j.failed), Array(3).fill('로그인 세션이 만료됐습니다.'));
});

test('올리기 길이 이미 실패로 바꾼 표시는 다시 건드리지 않는다 · 보내기 전에 멈춘 실패(읽지 못함)는 여기서 실패로 바꾼다', async () => {
  const s = setup({upload: async (t, f, {job}) => { if (f.name === 'a.pdf') job.fail('길이 표시한 까닭'); throw Object.assign(new Error('x'), {code: f.name === 'a.pdf' ? 'http_500' : 'file_read_failed'}); },
    classify: e => ({kind: 'error', message: e.code === 'file_read_failed' ? '파일을 읽지 못했어요.' : '서버 오류', retry: e.code !== 'file_read_failed'})});
  const batch = s.send.send(target, [file('a.pdf'), file('b.pdf')]);
  await batch.settled;
  assert.deepEqual(s.jobs.map(j => [j.phase, j.fails, j.failed]), [['failed', 1, '길이 표시한 까닭'], ['failed', 1, '파일을 읽지 못했어요.']]);
  assert.deepEqual(s.jobs.map(j => j.phase === 'sending'), [false, false], "끝없이 '올리는 중'으로 남는 표시가 없다");
});

test('결과를 확인하지 못한 파일은 저절로 다시 보내지 않는다 — 확인을 받은 것만', async () => {
  let ask = false, asked = 0, n = 0;
  const s = setup({upload: async (t, f) => { n++; if (n === 1) throw Object.assign(new Error('끊김'), {code: 'network_error'}); return {}; },
    classify: e => (e.code === 'network_error' ? {kind: 'unknown', stop: true, message: '결과를 확인하지 못했어요.'} : {kind: 'error'}),
    confirmUnknown: async count => { asked = count; return ask; }});
  const files = [file('a.pdf'), file('b.pdf')];
  const batch = s.send.send(target, files);
  await batch.settled;
  assert.equal(s.events.at(-1).unknown, 1);
  // 확인을 거절: 불명 파일은 빼고, 서 있던 파일만 다시 보낸다.
  assert.equal(await s.send.retry(batch), true);
  await batch.settled;
  assert.equal(asked, 1);
  assert.equal(n, 2);
  assert.equal(s.events.at(-1).unknown, 1);
  // 확인을 받음: 그 파일도 보낸다.
  ask = true;
  assert.equal(await s.send.retry(batch), true);
  await batch.settled;
  assert.equal(n, 3);
  assert.deepEqual([s.events.at(-1).okFiles, s.events.at(-1).badFiles], [2, 0]);
});

test('✕로 취소한 파일(대기·보내는 중)은 건너뛰고 다음 파일을 이어서 올린다', async () => {
  const s = setup({upload: async (t, f) => { if (f.name === 'p1.jpg') throw Object.assign(new Error('취소'), {code: 'upload_cancelled'}); s.sent.push(f.name); return {}; }});
  const files = [photo(1), photo(2), photo(3)];
  const batch = s.send.send(target, files);
  s.jobs[1].cancel(); // 아직 차례가 오지 않은 파일의 ✕
  await batch.settled;
  assert.deepEqual(s.sent, ['p3.jpg']);
  const done = s.events.at(-1);
  assert.deepEqual([done.okPhotos, done.badPhotos, done.cancelled, done.retry], [1, 0, 2, true], '취소한 것은 못 올린 것과 따로 센다');
  assert.equal(await s.send.retry(batch), true, '못 올린 것이 없으면 취소한 파일을 [다시 올리기]로 다시 보낼 수 있다');
});

test('✕로 취소한 파일은 못 올린 파일과 섞어 다시 보내지 않는다', async () => {
  let broken = true;
  const s = setup({upload: async (t, f) => { if (f.name === 'p3.jpg' && broken) throw Object.assign(new Error('x'), {status: 500}); s.sent.push(f.name); return {}; },
    classify: () => ({kind: 'error', message: '실패'})});
  const batch = s.send.send(target, [photo(1), photo(2), photo(3)]);
  s.jobs[1].cancel(); // 잘못 고른 사진을 뺌
  await batch.settled;
  assert.deepEqual(s.sent, ['p1.jpg']);
  assert.deepEqual([s.events.at(-1).badPhotos, s.events.at(-1).cancelled], [1, 1]);
  broken = false;
  assert.equal(await s.send.retry(batch), true);
  await batch.settled;
  assert.deepEqual(s.sent, ['p1.jpg', 'p3.jpg'], '못 올린 사진만 다시 — 뺀 사진은 보내지 않는다');
  const done = s.events.at(-1);
  assert.deepEqual([done.okPhotos, done.badPhotos, done.cancelled, done.retry], [2, 0, 1, true], '뺀 사진은 취소로 남고, 원하면 그것만 다시 올릴 수 있다');
  assert.equal(await s.send.retry(batch), true);
  await batch.settled;
  assert.deepEqual(s.sent, ['p1.jpg', 'p3.jpg', 'p2.jpg']);
});

test('계정·작업공간이 바뀌면 남은 파일을 보내지 않고 알리지도 않는다', async () => {
  let who = 'u1';
  const s = setup({scope: () => who, gone: scope => scope !== who,
    upload: async (t, f) => { s.sent.push(f.name); who = 'u2'; return {}; }});
  const batch = s.send.send(target, [photo(1), photo(2)]);
  await batch.settled;
  assert.deepEqual(s.sent, ['p1.jpg']);
  assert.equal(s.events.some(e => e.type === 'done'), false);
  assert.equal(s.send.going('m1'), false);
  assert.equal(await s.send.retry(batch), false);
});

test('다시 골라야 하는 파일(빈 파일·읽지 못함)은 [다시 올리기]에 넣지 않는다', async () => {
  const s = setup({preflight: f => (f.size ? null : {message: '빈 파일은 업로드할 수 없어요.'}),
    upload: async (t, f) => { if (f.name === 'r.pdf') throw Object.assign(new Error('읽기'), {code: 'file_read_failed'}); return {}; },
    classify: () => ({kind: 'error', retry: false, message: '파일을 읽지 못했어요.'})});
  const batch = s.send.send(target, [{name: 'e.pdf', type: '', size: 0}, file('r.pdf'), file('ok.pdf')]);
  await batch.settled;
  const done = s.events.at(-1);
  assert.deepEqual([done.okFiles, done.badFiles, done.retry], [1, 2, false]);
  assert.equal(await s.send.retry(batch), false);
});

test('폰 앱 다리가 받으면(handoff ok) 화면 안 올리기를 건너뛴다 · 못 받으면 지금 길 그대로', async () => {
  const got = [];
  const yes = setup({handoff: async (t, items) => { got.push({t, items}); return {ok: true, id: 'job1'}; }, fields: f => ({title: f.name})});
  const files = [photo(1), file('a.pdf')];
  const batch = yes.send.send(target, files);
  await batch.settled;
  assert.deepEqual(yes.sent, []);
  assert.equal(got[0].t, target);
  assert.deepEqual(got[0].items, [{file: files[0], fields: {title: 'p1.jpg'}}, {file: files[1], fields: undefined}]);
  assert.equal(yes.events.at(-1).type, 'handed');
  const no = setup({handoff: async () => ({ok: false})});
  const b2 = no.send.send(target, files);
  await b2.settled;
  assert.deepEqual(no.sent, ['p1.jpg', 'a.pdf']);
  const broke = setup({handoff: async () => { throw new Error('다리 없음'); }});
  await broke.send.send(target, files).settled;
  assert.deepEqual(broke.sent, ['p1.jpg', 'a.pdf']);
});

test('파일이 없으면 줄을 세우지 않는다 · forget은 못 올린 파일을 놓는다(그 뒤 다시 올리기 없음)', async () => {
  const s = setup({upload: async () => { throw new Error('x'); }, classify: () => ({kind: 'error', message: '실패'})});
  const empty = s.send.send(target, []);
  await empty.settled;
  assert.equal(s.events.length, 0);
  const f = file('a.pdf');
  const batch = s.send.send(target, [f]);
  await batch.settled;
  assert.equal(s.send.has('m1', f), true);
  s.send.forget(batch);
  assert.equal(s.send.has('m1', f), false);
  assert.equal(await s.send.retry(batch), false);
});

test('화면 알림: 올리는 동안 새로 고침은 먼저 묻고, 계정이 바뀌면 못 올린 파일을 놓는다', async () => {
  const listeners = new Map(), win = {addEventListener: (type, fn) => listeners.set(type, fn)};
  let who = 'u1', hold = null;
  const s = setup({scope: () => who, gone: scope => scope !== who,
    upload: async (t, f) => { if (f.name === 'slow.pdf') await new Promise(r => { hold = r; }); else throw new Error('x'); return {}; },
    classify: () => ({kind: 'error', message: '실패'})});
  s.send.watch(win);
  const ask = () => { const detail = {otherDraft: false}; listeners.get('kptu:before-reload')({detail}); return detail.otherDraft; };
  assert.equal(ask(), false);
  const bad = file('bad.pdf'), failed = s.send.send(target, [bad]);
  await failed.settled;
  assert.equal(ask(), false, '못 올린 것만 남아 있을 때는 묻지 않는다');
  const going = s.send.send(target, [file('slow.pdf')]);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(ask(), true, '올리는 동안은 먼저 묻는다');
  hold(); await going.settled;
  assert.equal(ask(), false);
  assert.equal(s.send.has('m1', bad), true);
  listeners.get('kptu:session-changed')(); // 같은 사람: 그대로
  assert.equal(s.send.has('m1', bad), true);
  who = 'u2'; listeners.get('kptu:session-changed')();
  assert.equal(s.send.has('m1', bad), false, '다른 계정이 되면 못 올린 파일을 놓는다');
});

// ── APP-뒤에서올리기 PR-2(S58-12): 폰 앱에 넘긴 파일의 끝 · 화면으로 돌아오면 다시 ──
const handJob = (over = {}) => { const j = makeJob(over.file); j.hands = []; j.hand = state => { j.phase = 'handed'; j.hands.push(state || {}); }; j.done = () => { j.phase = 'done'; }; return j; };

test('앱에 넘김: 넘긴 파일은 앱의 끝 알림(handedJob)으로 올림·못 올림이 되고, 다 끝나야 묶음의 끝을 알린다', async () => {
  const s = setup({track: f => handJob({file: f}), handedText: code => `까닭:${code}`,
    handoff: async (t, items, opts) => { assert.equal(opts.alive(), true); return {ok: true, jobs: [{id: 'jobA', count: items.length}]}; }});
  const files = [photo(1), photo(2), file('a.pdf')];
  const batch = s.send.send(target, files);
  await batch.settled;
  assert.deepEqual(s.sent, [], '화면 안에서는 보내지 않는다');
  assert.deepEqual(batch.entries.map(e => e.state), ['handed', 'handed', 'handed']);
  assert.deepEqual(batch.entries.map(e => e.job.phase), ['handed', 'handed', 'handed']);
  const handed = s.events.at(-1);
  assert.equal(handed.type, 'handed'); assert.equal(handed.count, 3); assert.equal(handed.handedPhotos, 2); assert.equal(handed.handedFiles, 1);
  assert.equal(s.send.has('m1', files[0]), true, '상세의 올리는 줄이 넘긴 파일도 찾는다');
  assert.equal(s.send.any(), false, '앱이 맡은 파일은 새로 고침 물음에 세지 않는다');
  assert.equal(s.send.handedJob({id: 'other', state: 'done', docs: ['x'], errors: ['']}), false, '이 화면이 넘기지 않은 묶음');
  // 올리는 중: 끝난 파일부터 올림으로(그때그때)
  assert.equal(s.send.handedJob({id: 'jobA', state: 'run', docs: ['d1', '', ''], errors: ['', '', '']}), true);
  assert.deepEqual(batch.entries.map(e => e.state), ['done', 'handed', 'handed']);
  assert.equal(s.events.at(-1).type, 'file'); assert.equal(s.events.at(-1).entry.byApp, true);
  assert.equal(s.events.some(e => e.type === 'done'), false, '넘긴 파일이 남아 있으면 끝을 알리지 않는다');
  // 끝: 둘째는 실패(다시 보낼 수 있음), 셋째는 올림
  s.send.handedJob({id: 'jobA', state: 'done', docs: ['d1', '', 'd3'], errors: ['', 'server', '']});
  assert.deepEqual(batch.entries.map(e => e.state), ['done', 'failed', 'done']);
  assert.equal(batch.entries[1].message, '까닭:server');
  const done = s.events.at(-1);
  assert.equal(done.type, 'done'); assert.equal(done.sent, 2); assert.equal(done.okPhotos, 1); assert.equal(done.okFiles, 1); assert.equal(done.badPhotos, 1); assert.equal(done.retry, true);
  // 같은 끝 알림이 또 와도(앱에 다시 물을 때마다 온다) 두 번 세지 않는다
  assert.equal(s.send.handedJob({id: 'jobA', state: 'done', docs: ['d1', '', 'd3'], errors: ['', 'server', '']}), false);
  assert.equal(s.events.filter(e => e.type === 'done').length, 1);
});

test('앱에 넘김: 결과를 적지 못한 파일·unknown은 결과 불명, 너무 큼·권한 없음은 다시 올리기 대상이 아니다', async () => {
  const s = setup({track: f => handJob({file: f}), handoff: async (t, items) => ({ok: true, jobs: [{id: 'jobB', count: items.length}]})});
  const batch = s.send.send(target, [photo(1), photo(2), photo(3), photo(4)]);
  await batch.settled;
  s.send.handedJob({id: 'jobB', state: 'done', docs: ['', '', '', ''], errors: ['unknown', 'too_big', 'forbidden', '']});
  assert.deepEqual(batch.entries.map(e => e.state), ['unknown', 'failed', 'failed', 'unknown']);
  assert.deepEqual(batch.entries.map(e => !!e.fixed), [false, true, true, false]);
  const done = s.events.at(-1);
  assert.equal(done.type, 'done'); assert.equal(done.unknown, 2); assert.equal(done.sent, 0);
});

test('앱에 넘김: 20개씩 나눠 넘기다 뒤 묶음을 못 넘기면 앞은 앱이, 뒤는 지금 길로 올린다', async () => {
  const s = setup({track: f => handJob({file: f}), handoff: async () => ({ok: true, jobs: [{id: 'jobC', count: 2}]})});
  const files = [photo(1), photo(2), photo(3)];
  const batch = s.send.send(target, files);
  await batch.settled;
  assert.deepEqual(s.sent, ['p3.jpg']);
  assert.deepEqual(batch.entries.map(e => e.state), ['handed', 'handed', 'done']);
  assert.deepEqual(batch.entries.map(e => e.hand?.index), [0, 1, undefined]);
  // 화면이 올린 쪽의 결과는 앱을 기다리지 않고 먼저 알린다(앱이 맡은 것은 아직 남아 있다).
  const first = s.events.at(-1);
  assert.equal(first.type, 'done'); assert.equal(first.sent, 1); assert.equal(first.handedPhotos, 2);
  s.send.handedJob({id: 'jobC', state: 'done', docs: ['d1', 'd2'], errors: ['', '']});
  const done = s.events.at(-1);
  assert.equal(done.type, 'done'); assert.equal(done.sent, 2, '앞에서 센 파일을 또 세지 않는다'); assert.equal(done.okPhotos, 3); assert.equal(done.handedPhotos, 0);
});

test('앱에 넘김: 일부만 넘긴 묶음에서 화면이 못 올린 파일은 앱을 기다리지 않고 바로 알리고 [다시 올리기]를 준다', async () => {
  const s = setup({track: f => handJob({file: f}), handoff: async () => ({ok: true, jobs: [{id: 'jobP', count: 1}]}),
    upload: async () => { throw new Error('x'); }, classify: () => ({kind: 'error', message: '실패'})});
  const batch = s.send.send(target, [photo(1), photo(2)]);
  await batch.settled;
  const first = s.events.at(-1);
  assert.equal(first.type, 'done'); assert.equal(first.badPhotos, 1); assert.equal(first.handedPhotos, 1); assert.equal(first.retry, true);
  assert.equal(s.send.has('m1', batch.entries[1].file), true);
});

test('앱에 넘김: 차례를 기다리는 사이·앱에 묻는 사이 ✕로 뺀 파일은 앱에도 넘기지 않고, 넘기는 동안에는 줄이 넘기는 중으로 바뀐다', async () => {
  const got = [];
  let jobs = [];
  const s = setup({track: f => { const j = handJob({file: f}); j.unhand = () => { j.phase = 'waiting'; }; jobs.push(j); return j; },
    handoff: async (t, items, opts) => {
      jobs[2].cancel();                      // 앱에 묻는 사이(답을 기다리는 동안) 셋째를 뺌
      opts.started();
      got.push(...items.map(i => i.file.name));
      assert.deepEqual(jobs.map(j => j.hands.at(-1)), [undefined, {handing: true}, undefined, {handing: true}], '넘기는 줄만 넘기는 중(✕ 없음)');
      opts.took({id: 'jobX', count: items.length});
      return {ok: true, jobs: [{id: 'jobX', count: items.length}]};
    }});
  const files = [photo(1), photo(2), photo(3), photo(4)];
  const batch = s.send.send(target, files);
  jobs[0].cancel();                          // 차례를 기다리는 사이 첫째를 뺌
  await batch.settled;
  assert.deepEqual(got, ['p2.jpg', 'p4.jpg']);
  assert.deepEqual(batch.entries.map(e => e.state), ['cancelled', 'handed', 'cancelled', 'handed']);
  assert.deepEqual(batch.entries.map(e => e.hand?.index), [undefined, 0, undefined, 1], '앱이 알려 주는 순서는 넘긴 목록 기준');
  assert.deepEqual(s.sent, []);
  s.send.handedJob({id: 'jobX', state: 'done', docs: ['d2', 'd4'], errors: ['', '']});
  assert.deepEqual(batch.entries.map(e => e.doc?.id), [undefined, 'd2', undefined, 'd4']);
  // 못 넘기면 줄이 대기로 돌아와 지금 길로 올라간다(✕가 다시 보인다)
  jobs = [];
  const f = setup({track: file => { const j = handJob({file}); j.unhand = () => { j.phase = 'waiting'; j.unhanded = true; }; jobs.push(j); return j; },
    handoff: async (t, items, opts) => { opts.started(); return {ok: false, error: 'space'}; }});
  await f.send.send(target, [photo(1)]).settled;
  assert.equal(jobs[0].unhanded, true);
  assert.deepEqual(f.sent, ['p1.jpg']);
  assert.deepEqual(f.events.map(e => e.type).slice(0, 3), ['queued', 'handing', 'handing-failed']);
});

test('앱에 넘김: 답을 못 받아 앱이 맡았는지 알 수 없는 파일(unsure)은 결과 불명 — 화면이 저절로 또 올리지 않는다', async () => {
  const s = setup({track: f => handJob({file: f}), handedText: code => `까닭:${code}`,
    handoff: async (t, items, opts) => { opts.started(); opts.took({id: 'jobU', count: 1}); return {ok: true, jobs: [{id: 'jobU', count: 1}], error: 'timeout', unsure: 1}; }});
  const batch = s.send.send(target, [photo(1), photo(2), photo(3)]);
  await batch.settled;
  assert.deepEqual(batch.entries.map(e => e.state), ['handed', 'unknown', 'done']);
  assert.equal(batch.entries[1].message, '까닭:unknown');
  assert.deepEqual(s.sent, ['p3.jpg'], '알 수 없는 파일은 보내지 않고, 넘기지 않은 뒤 파일만 지금 길로');
  const first = s.events.at(-1);
  assert.equal(first.type, 'done'); assert.equal(first.unknown, 1); assert.equal(first.handedPhotos, 1);
  // 하나도 못 넘기고 알 수 없을 때도 같다
  const none = setup({handoff: async (t, items, opts) => { opts.started(); return {ok: false, error: 'timeout', unsure: items.length}; }});
  const b2 = none.send.send(target, [photo(1), photo(2)]);
  await b2.settled;
  assert.deepEqual(none.sent, []);
  assert.deepEqual(b2.entries.map(e => e.state), ['unknown', 'unknown']);
  assert.equal(none.events.at(-1).type, 'done'); assert.equal(none.events.at(-1).unknown, 2);
});

test('회의자료 놓기 줄의 한 개짜리 묶음(quiet)은 앱에 넘기지 않는다(지금 길 — 같은 뒤 줄에서 하나씩)', async () => {
  let asked = 0;
  const s = setup({handoff: async () => { asked++; return {ok: true, jobs: [{id: 'jobQ', count: 1}]}; }});
  const batch = s.send.send(target, [file('a.pdf')], {quiet: true});
  await batch.settled;
  assert.equal(asked, 0);
  assert.deepEqual(s.sent, ['a.pdf']);
  assert.equal(batch.quiet, true);
  assert.equal(batch.entries[0].state, 'done');
});

test('돌아와 다시 보내기 전에 서버에 이미 붙었는지 본다: 붙어 있으면 다시 보내지 않고, 확인하지 못하면 결과 불명으로 둔다', async () => {
  const away = {kind: 'error', away: true, stop: true, message: '멈췄어요', unsure: '확인하지 못했어요'};
  // ① 이미 붙어 있음(마지막 조각까지 나갔던 것): 다시 보내지 않고 올린 것으로
  let tries = 0, asked = null;
  const there = setup({back: async () => {}, classify: () => away,
    verify: async (t, f, skip) => { asked = {t, name: f.name, skip}; return {id: 'found-1'}; },
    upload: async (t, f) => { if (f.name === 'p2.jpg') { tries++; throw new Error('끊김'); } return {id: 'd-' + f.name}; }});
  const b1 = there.send.send(target, [photo(1), photo(2), photo(3)]);
  await b1.settled;
  assert.equal(tries, 1, '다시 보내지 않는다');
  assert.deepEqual(b1.entries.map(e => [e.state, e.doc?.id]), [['done', 'd-p1.jpg'], ['done', 'found-1'], ['done', 'd-p3.jpg']]);
  assert.equal(b1.entries[1].found, true);
  assert.deepEqual(asked, {t: target, name: 'p2.jpg', skip: ['d-p1.jpg']}, '같은 묶음에서 방금 올린 자료는 빼고 찾는다');
  assert.equal(there.events.some(e => e.type === 'resumed'), false);
  assert.equal(there.events.at(-1).sent, 3);
  // ② 붙어 있지 않음: 한 번 다시 보낸다
  let n = 0;
  const absent = setup({back: async () => {}, classify: () => away, verify: async () => null,
    upload: async (t, f) => { if (++n === 1) throw new Error('끊김'); return {id: 'd-' + f.name}; }});
  const b2 = absent.send.send(target, [photo(1)]);
  await b2.settled;
  assert.equal(n, 2); assert.equal(b2.entries[0].state, 'done');
  assert.equal(absent.events.some(e => e.type === 'resumed'), true);
  // ③ 확인하지 못함: 결과 불명으로 두고(다시 보내지 않음) 뒤 파일도 세운다
  let m = 0;
  const blind = setup({back: async () => {}, classify: () => away, verify: async () => { throw new Error('확인 실패'); },
    upload: async () => { m++; throw new Error('끊김'); }});
  const b3 = blind.send.send(target, [photo(1), photo(2)]);
  await b3.settled;
  assert.equal(m, 1);
  assert.deepEqual(b3.entries.map(e => [e.state, e.message]), [['unknown', '확인하지 못했어요'], ['held', '확인하지 못했어요']]);
  assert.equal(blind.events.at(-1).unknown, 1);
});

test('폰 앱: 답을 기다리는 사이 앱이 먼저 끝을 알려 와도 남의 묶음으로 지우지 않고, 그 파일을 화면이 또 올리지 않는다', async () => {
  // 맡고도 답을 못 보낸 묶음(muteGo)이 답을 기다리는 사이 다 올라가 끝 알림이 먼저 온다
  const a = await withApp({muteGo: 1});
  const files = [blob('p1.jpg'), blob('p2.jpg')];
  const batch = a.send.send(appTarget, files);
  await wait(60); // up:go 답을 기다리는 중(시간 제한 200ms 안)
  assert.equal(a.send.handing(), true);
  a.shell.finish(1, [docId(1), docId(2)]);
  a.shell.job(appJob(1, {docs: [docId(1), docId(2)], errors: ['', '']}));
  await batch.settled;
  await wait();
  assert.deepEqual(a.orphans, [], '넘기는 중에 온 묶음을 남의 것으로 알리지 않는다');
  assert.deepEqual(a.screen, [], '앱이 올린 파일을 화면이 또 올리지 않는다');
  assert.deepEqual(batch.entries.map(e => e.state), ['done', 'done']);
  assert.equal(a.shell.sent.filter(m => m.startsWith('up:seen:')).length, 1, '줄에 옮긴 뒤에야 앱 기록을 지운다');
  assert.equal(a.events.filter(e => e.type === 'done').length, 1);
  a.stop();
  // 다시 물어도 답이 없으면(앱이 맡았는지 모름) 결과 불명으로 둔다 — 화면이 저절로 올리지 않는다
  const {createAppUpload} = await import('../app/app-upload.js');
  const shell = fakeShell(), bridge = shell.win.KPTUAppShell, post = bridge.postMessage;
  let mute = false;
  bridge.postMessage = m => { if (String(m) === 'up:go') mute = true; if (mute) { shell.sent.push(String(m)); return; } post(m); };
  const up = createAppUpload(shell.win, {helloMs: 40, stepMs: 60});
  assert.deepEqual(await createAppHandoff(up, {ids: t => ({meeting: t.id, project: ''})})(appTarget, [{file: blob('p.jpg')}, {file: blob('q.jpg')}]), {ok: false, error: 'timeout', unsure: 2});
});


test('앱에 넘김: 앱이 멈췄으면(stopped) 넘긴 채로 두고 까닭을 알린다 — 다시 이으면 끝까지', async () => {
  const s = setup({track: f => handJob({file: f}), handoff: async (t, items) => ({ok: true, jobs: [{id: 'jobD', count: items.length}]})});
  const batch = s.send.send(target, [photo(1), photo(2)]);
  await batch.settled;
  s.send.handedJob({id: 'jobD', state: 'stopped', reason: 'signed_out', docs: ['d1', ''], errors: ['', '']});
  assert.deepEqual(batch.entries.map(e => e.state), ['done', 'handed']);
  assert.deepEqual(batch.entries[1].job.hands.at(-1), {stopped: true, reason: 'signed_out'});
  const stopped = s.events.at(-1);
  assert.equal(stopped.type, 'handed-stopped'); assert.equal(stopped.job.reason, 'signed_out'); assert.equal(stopped.handedPhotos, 1);
  assert.equal(await s.send.retry(batch), false, '앱이 맡은 파일은 화면이 다시 보내지 않는다');
  s.send.handedJob({id: 'jobD', state: 'run', docs: ['d1', ''], errors: ['', '']});
  assert.deepEqual(batch.entries[1].job.hands.at(-1), {});
  s.send.handedJob({id: 'jobD', state: 'done', docs: ['d1', 'd2'], errors: ['', '']});
  assert.equal(s.events.at(-1).type, 'done'); assert.equal(s.events.at(-1).sent, 2);
});

test('앱에 넘김: 넘기는 사이 계정이 바뀌면 알리지 않고 놓는다', async () => {
  let who = 'u1';
  const s = setup({scope: () => who, gone: scope => scope !== who, track: f => handJob({file: f}),
    handoff: async (t, items, opts) => { who = 'u2'; assert.equal(opts.alive(), false); return {ok: true, jobs: [{id: 'jobE', count: items.length}]}; }});
  const f = photo(1), batch = s.send.send(target, [f]);
  await batch.settled;
  assert.deepEqual(s.sent, []);
  assert.equal(s.events.some(e => e.type === 'handed' || e.type === 'done'), false);
  assert.equal(s.send.has('m1', f), false);
});

test('화면을 벗어나 다 보내기 전에 끊긴 파일: 돌아오면 그 자리에서 한 번 저절로 다시 보낸다(뒤 파일이 앞지르지 않음)', async () => {
  let tries = 0, comeBack = null;
  const s = setup({back: () => new Promise(r => { comeBack = r; }),
    upload: async (t, f) => { if (f.name === 'p1.jpg' && ++tries === 1) throw Object.assign(new Error('끊김'), {away: true}); return {id: 'd-' + f.name}; },
    classify: e => (e.away ? {kind: 'error', away: true, stop: true, message: '화면을 벗어나 멈췄어요'} : {kind: 'error', message: '실패'})});
  const batch = s.send.send(target, [photo(1), photo(2)]);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(s.events.at(-1).type, 'paused');
  assert.deepEqual(batch.entries.map(e => e.state), ['sending', 'waiting'], '돌아올 때까지 줄은 서 있다');
  assert.equal(s.jobs[0].failed, '화면을 벗어나 멈췄어요');
  assert.equal(s.send.any(), true);
  comeBack();
  await batch.settled;
  assert.equal(tries, 2);
  assert.deepEqual(batch.entries.map(e => e.state), ['done', 'done']);
  assert.equal(s.events.some(e => e.type === 'resumed'), true);
  assert.equal(s.jobs.filter(j => j.file.name === 'p1.jpg').length, 2, '옛 실패 표시는 지우고 새 표시로 다시');
  const done = s.events.at(-1);
  assert.equal(done.type, 'done'); assert.equal(done.sent, 2); assert.equal(done.badPhotos, 0);
  assert.equal(s.most(), 1);
});

test('돌아와 다시 보내도 안 되면 보통 실패([다시 올리기]) · 결과 불명·돌아옴을 모르는 곳은 저절로 다시 보내지 않는다', async () => {
  let tries = 0;
  const away = {kind: 'error', away: true, stop: true, message: '화면을 벗어나 멈췄어요'};
  const s = setup({back: async () => {}, upload: async () => { tries++; throw Object.assign(new Error('끊김'), {away: true}); }, classify: () => away});
  const batch = s.send.send(target, [photo(1), photo(2)]);
  await batch.settled;
  assert.equal(tries, 2, '한 번만 저절로 다시');
  assert.deepEqual(batch.entries.map(e => e.state), ['failed', 'held']);
  const done = s.events.at(-1);
  assert.equal(done.type, 'done'); assert.equal(done.badPhotos, 2); assert.equal(done.retry, true); assert.equal(done.message, '화면을 벗어나 멈췄어요');
  // 결과 불명(다 보낸 뒤 끊김)은 away가 아니다 → 다시 보내지 않는다
  let n = 0;
  const u = setup({back: async () => {}, upload: async () => { n++; throw new Error('모름'); }, classify: () => ({kind: 'unknown', stop: true, message: '확인하지 못했어요'})});
  const b2 = u.send.send(target, [photo(1)]);
  await b2.settled;
  assert.equal(n, 1); assert.equal(b2.entries[0].state, 'unknown');
  // back이 없으면(돌아옴을 알 수 없음) 지금처럼 바로 실패
  let m = 0;
  const w = setup({upload: async () => { m++; throw new Error('끊김'); }, classify: () => away});
  const b3 = w.send.send(target, [photo(1)]);
  await b3.settled;
  assert.equal(m, 1); assert.equal(b3.entries[0].state, 'failed');
});

test('글: 앱이 뒤에서 올리는 중', () => {
  assert.equal(sendHandedLine({photos: 7, files: 1}), '사진 7장·자료 1개 앱이 뒤에서 올리는 중');
  assert.equal(sendHandedLine({}), '');
});

// ── 앱 다리 흉내(가짜 KPTUAppShell): 진짜 app-upload.js + createAppHandoff + bindAppJobs + 올리는 중 표시(upload-progress.js)를 이어서 본다 ──
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.5.7';
const MEETING = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', PROJECT = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const docId = n => `cccccccc-0000-4ccc-8ddd-${String(n).padStart(12, '0')}`;
const batchId = n => `batch_${String(n).padStart(4, '0')}_abcdefghij`;
const blob = (name, type = 'image/jpeg', n = 5) => Object.assign(new Blob([new Uint8Array(n).fill(65)], {type}), {name});
// 지어낸 앱: know=false 옛 앱(답 없음) · on=false 위젯 로그인 없음 · failAt = 그 번째 묶음의 up:go를 거절. 묶음마다 다른 이름을 준다.
// quickDone = 맡자마자(다음 묶음을 받기 전에) 그 묶음의 끝을 알림 · muteGo = 그 번째 묶음은 맡고도 답을 못 보냄(넘긴 직후 화면이 멈춘 때).
function fakeShell({know = true, on = true, failAt = 0, jobs = [], quickDone = false, muteGo = 0} = {}) {
  const sent = [], listeners = [], started = [];
  jobs = [...jobs];
  const say = data => setTimeout(() => listeners.forEach(fn => fn({data})), 0);
  const bridge = {
    postMessage(m) {
      m = String(m); sent.push(m.startsWith('up:part:') ? 'up:part' : m);
      if (!know) return;
      const step = m.slice(3).split(':')[0];
      if (step === 'hello') return say(`up:state:${JSON.stringify({v: 1, on, kinds: ['meeting'], jobs})}`);
      if (step === 'cancel' || step === 'seen') return;
      if (step === 'start') started.push(JSON.parse(m.slice('up:start:'.length)));
      const n = started.length, count = started.at(-1)?.count || 0;
      if (step === 'go' && muteGo === n) { jobs.push({id: batchId(n), kind: 'meeting', target: started.at(-1).meeting, total: count, left: count, state: 'run', reason: '', docs: Array(count).fill(''), errors: Array(count).fill('')}); return; }
      const ok = !(step === 'go' && failAt === n), id = ok && (step === 'start' || step === 'go') ? `,"id":"${batchId(n)}"` : '';
      say(`up:ack:{"ok":${ok},"step":"${step}","error":"${ok ? '' : 'space'}"${id}}`);
      if (step === 'go' && ok && quickDone) say(`up:job:${JSON.stringify({id: batchId(n), kind: 'meeting', target: started.at(-1).meeting, total: count, left: 0, state: 'done', reason: '', docs: Array.from({length: count}, (_, i) => docId(n * 100 + i)), errors: Array(count).fill('')})}`);
    },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
  };
  const doc = {visibilityState: 'visible', addEventListener() {}};
  const finish = (n, docs) => { const job = jobs.find(j => j.id === batchId(n)); if (job) Object.assign(job, {state: 'done', left: 0, docs, errors: docs.map(() => '')}); };
  return {sent, started, say, finish, job: v => say(`up:job:${JSON.stringify(v)}`), win: {navigator: {userAgent: ANDROID}, KPTUAppShell: bridge, document: doc}};
}
const appJob = (n, over = {}) => ({id: batchId(n), kind: 'meeting', target: MEETING, total: 2, left: 0, state: 'done', reason: '', docs: [], errors: [], ...over});
const wait = (ms = 10) => new Promise(r => setTimeout(r, ms));
async function withApp(opts = {}, over = {}) {
  const [{createAppUpload, uploadReasonText}, {trackUpload, uploadJobs, summaryText}] = await Promise.all([import('../app/app-upload.js'), import('../app/upload-progress.js')]);
  const shell = fakeShell(opts), up = createAppUpload(shell.win, {helloMs: 40, stepMs: 200});
  const {line} = makeLine(), screen = [], events = [], orphans = [];
  const send = createMeetingSend({line, isPhoto, upload: async (t, f) => { screen.push(f.name); return {id: 'd-' + f.name}; },
    track: f => trackUpload({file: f, waiting: true}), report: e => events.push(e), handedText: uploadReasonText,
    handoff: createAppHandoff(up, {ids: t => ({meeting: t.id, project: t.project_id || ''})}), fields: f => ({title: f.name.replace(/\.\w+$/, ''), category: '사진', document_date: '2026-11-11'}), ...over});
  const stop = bindAppJobs(up, send, {orphan: job => orphans.push(job)});
  const rows = files => uploadJobs().filter(j => files.includes(j.file));
  return {shell, up, send, screen, events, orphans, stop, rows, summaryText, uploadReasonText};
}
const appTarget = {id: MEETING, project_id: PROJECT, kind: 'meeting', day: '2026-11-11'};

test('폰 앱(가짜 KPTUAppShell): 사진·자료 묶음을 앱에 넘기고 화면은 보내지 않는다 — 넘기는 것은 파일·대상 id·사진 칸뿐', async () => {
  const a = await withApp();
  const files = [blob('사진 1.jpg'), blob('사진 2.jpg'), blob('자료.pdf', 'application/pdf')];
  const batch = a.send.send(appTarget, files);
  await batch.settled;
  assert.deepEqual(a.screen, [], '화면 안 올리기를 건너뛴다');
  assert.deepEqual(a.shell.started, [{kind: 'meeting', meeting: MEETING, project: PROJECT, count: 3}]);
  const begins = a.shell.sent.filter(m => m.startsWith('up:begin:')).map(m => JSON.parse(m.slice('up:begin:'.length)));
  assert.deepEqual(begins[0], {name: '사진 1.jpg', mime: 'image/jpeg', size: 5, title: '사진 1', category: '사진', date: '2026-11-11'});
  assert.deepEqual(begins[2], {name: '자료.pdf', mime: 'application/pdf', size: 5}, '사진이 아닌 자료에는 사진 칸을 싣지 않는다');
  assert.equal(a.shell.sent.at(-1), 'up:go');
  assert.equal(a.shell.sent.some(m => /token|bearer|authorization|workspace/i.test(m)), false);
  assert.deepEqual(batch.entries.map(e => e.state), ['handed', 'handed', 'handed']);
  assert.deepEqual(a.rows(files).map(j => j.phase), ['handed', 'handed', 'handed'], "그 줄은 '앱이 올리는 중'");
  assert.equal(a.summaryText(a.rows(files)), '앱이 뒤에서 올리는 중 3개');
  assert.equal(a.events.at(-1).type, 'handed');
  a.stop();
});

test('폰 앱: 끝 알림(up:job done) → 올린 줄은 완료, 못 올린 줄은 까닭 + 다시 올리기 대상 · 반영한 묶음은 앱 기록을 지운다(up:seen)', async () => {
  const a = await withApp();
  const files = [blob('p1.jpg'), blob('p2.jpg')];
  const batch = a.send.send(appTarget, files);
  await batch.settled;
  a.shell.job(appJob(1, {state: 'run', left: 1, docs: [docId(1), ''], errors: ['', '']}));
  await wait();
  assert.deepEqual(batch.entries.map(e => e.state), ['done', 'handed'], '올라간 사진부터 그때그때');
  assert.equal(a.shell.sent.some(m => m.startsWith('up:seen:')), false, '올리는 중에는 기록을 지우지 않는다');
  a.shell.job(appJob(1, {docs: [docId(1), ''], errors: ['', 'network']}));
  await wait();
  assert.deepEqual(batch.entries.map(e => e.state), ['done', 'failed']);
  assert.equal(batch.entries[1].message, a.uploadReasonText('network'));
  assert.equal(a.rows([files[1]])[0].phase, 'failed');
  const done = a.events.at(-1);
  assert.equal(done.type, 'done'); assert.equal(done.sent, 1); assert.equal(done.badPhotos, 1); assert.equal(done.retry, true);
  assert.equal(a.shell.sent.at(-1), `up:seen:${batchId(1)}`);
  assert.deepEqual(a.orphans, []);
  // [다시 올리기]: 못 올린 사진만 다시 앱에 넘긴다(새 묶음)
  assert.equal(await a.send.retry(batch), true);
  await batch.settled;
  assert.deepEqual(a.shell.started.at(-1), {kind: 'meeting', meeting: MEETING, project: PROJECT, count: 1});
  assert.equal(batch.entries[1].hand.id, batchId(2));
  a.shell.job(appJob(2, {docs: [docId(2)], errors: ['']}));
  await wait();
  assert.deepEqual(batch.entries.map(e => e.state), ['done', 'done']);
  assert.deepEqual(a.screen, []);
  a.stop();
});

test('폰 앱: 멈춤(up:job stopped) → 넘긴 줄은 멈춤으로 보이고 화면이 다시 보내지 않는다 · 앱이 이으면 끝까지', async () => {
  const a = await withApp();
  const files = [blob('p1.jpg'), blob('p2.jpg')];
  const batch = a.send.send(appTarget, files);
  await batch.settled;
  a.shell.job(appJob(1, {state: 'stopped', reason: 'signed_out', left: 2, docs: ['', ''], errors: ['', '']}));
  await wait();
  assert.deepEqual(batch.entries.map(e => e.state), ['handed', 'handed']);
  assert.deepEqual(a.rows(files).map(j => [j.phase, j.stopped]), [['handed', true], ['handed', true]]);
  assert.equal(a.summaryText(a.rows(files)), '앱이 멈춤 2개');
  const stopped = a.events.at(-1);
  assert.equal(stopped.type, 'handed-stopped'); assert.equal(a.uploadReasonText(stopped.job.reason), '위젯 로그인이 풀렸어요');
  assert.equal(a.shell.sent.some(m => m.startsWith('up:seen:')), false);
  assert.deepEqual(a.screen, []);
  a.shell.job(appJob(1, {docs: [docId(1), docId(2)], errors: ['', '']}));
  await wait();
  assert.deepEqual(batch.entries.map(e => e.state), ['done', 'done']);
  assert.equal(a.events.at(-1).type, 'done'); assert.equal(a.events.at(-1).sent, 2);
  a.stop();
});

test('다리가 없거나 못 넘기면 지금 길 그대로: 옛 앱 · 위젯 로그인 없음 · 넘기다 실패({ok:false})', async () => {
  for (const opts of [{know: false}, {on: false}, {failAt: 1}]) {
    const a = await withApp(opts);
    const batch = a.send.send(appTarget, [blob('p1.jpg'), blob('a.pdf', 'application/pdf')]);
    await batch.settled;
    assert.deepEqual(a.screen, ['p1.jpg', 'a.pdf'], JSON.stringify(opts));
    assert.deepEqual(batch.entries.map(e => e.state), ['done', 'done']);
    assert.equal(a.events.at(-1).type, 'done');
    if (opts.failAt) assert.equal(a.shell.sent.includes('up:cancel'), true, '받다 만 묶음은 버린다');
    a.stop();
  }
  // PC·폰 브라우저(다리 없음): 앱에 묻지도 않는다
  const {createAppUpload} = await import('../app/app-upload.js');
  const up = createAppUpload({navigator: {userAgent: 'Mozilla/5.0 Chrome/141.0'}});
  assert.deepEqual(await createAppHandoff(up)(appTarget, [{file: blob('p.jpg')}]), {ok: false, error: 'off'});
});

test('폰 앱: 20개를 넘는 묶음은 20개씩 나눠 넘기고, 뒤 묶음을 못 넘기면 그 뒤만 지금 길로 올린다', async () => {
  const files = Array.from({length: 22}, (_, i) => blob(`p${i + 1}.jpg`));
  const a = await withApp();
  const batch = a.send.send(appTarget, files);
  await batch.settled;
  assert.deepEqual(a.shell.started.map(s => s.count), [20, 2]);
  assert.deepEqual(batch.entries.map(e => e.hand.id), [...Array(20).fill(batchId(1)), batchId(2), batchId(2)]);
  assert.deepEqual([batch.entries[19].hand.index, batch.entries[20].hand.index], [19, 0]);
  a.shell.job(appJob(1, {total: 20, docs: Array.from({length: 20}, (_, i) => docId(i + 1)), errors: Array(20).fill('')}));
  await wait();
  assert.equal(a.events.some(e => e.type === 'done'), false, '둘째 묶음이 남아 있다');
  a.shell.job(appJob(2, {docs: [docId(21), docId(22)], errors: ['', '']}));
  await wait();
  assert.equal(a.events.at(-1).type, 'done'); assert.equal(a.events.at(-1).okPhotos, 22);
  a.stop();
  const b = await withApp({failAt: 2});
  const b2 = b.send.send(appTarget, files);
  await b2.settled;
  assert.deepEqual(b.screen, ['p21.jpg', 'p22.jpg']);
  assert.equal(b2.entries.filter(e => e.state === 'handed').length, 20);
  b.stop();
});

test('폰 앱: 화면이 닫혀 있던 동안 끝났거나 멈춘 묶음은 다음 물음(up:hello)의 답으로 와서 한 번만 알린다', async () => {
  const a = await withApp({jobs: [appJob(7, {docs: [docId(1), ''], errors: ['', 'server']}), appJob(8, {state: 'stopped', reason: 'network', docs: [''], errors: ['']}), appJob(9, {state: 'run', docs: [''], errors: ['']})]});
  assert.equal(await a.up.ready(), true);
  await wait();
  assert.deepEqual(a.orphans.map(j => [j.id, j.state]), [[batchId(7), 'done'], [batchId(8), 'stopped']], '올리는 중인 묶음은 알리지 않는다');
  assert.deepEqual(a.shell.sent.filter(m => m.startsWith('up:seen:')), [`up:seen:${batchId(7)}`], '끝난 묶음만 기록을 지운다');
  await a.up.ready();
  await wait();
  assert.equal(a.orphans.filter(j => j.id === batchId(8)).length, 1, '멈춘 묶음을 물을 때마다 또 알리지 않는다');
  a.stop();
  // 올리기 부품이 나중에 붙어도(앱이 이미 알려 둔 묶음) 한 번 본다
  const late = await withApp({jobs: [appJob(7, {docs: [docId(1)], errors: ['']})]});
  late.stop();
  await late.up.ready();
  const seen = [];
  bindAppJobs(late.up, late.send, {orphan: job => seen.push(job.id)});
  assert.deepEqual(seen, [batchId(7)]);
});

test('폰 앱: 넘기기 시작을 알리고(handing), 못 넘기면 그 알림을 거둔다 · 답이 없던 옛 앱에는 다시 묻지 않는다', async () => {
  const a = await withApp();
  await a.send.send(appTarget, [blob('p1.jpg'), blob('a.pdf', 'application/pdf')]).settled;
  assert.deepEqual(a.events.map(e => e.type), ['queued', 'handing', 'handed']);
  assert.equal(sendHandingLine({photos: a.events[1].openPhotos, files: a.events[1].openFiles}), '사진 1장·자료 1개 앱에 넘기는 중');
  a.stop();
  const failed = await withApp({failAt: 1});
  await failed.send.send(appTarget, [blob('p1.jpg')]).settled;
  assert.deepEqual(failed.events.map(e => e.type), ['queued', 'handing', 'handing-failed', 'file', 'file', 'done']);
  failed.stop();
  const old = await withApp({know: false});
  await old.send.send(appTarget, [blob('p1.jpg')]).settled;
  await old.send.send(appTarget, [blob('p2.jpg')]).settled;
  assert.equal(old.shell.sent.filter(m => m === 'up:hello').length, 1, '올리기가 매번 답을 기다리느라 늦어지지 않는다');
  assert.deepEqual(old.screen, ['p1.jpg', 'p2.jpg']);
  assert.equal(old.events.some(e => e.type === 'handing'), false);
  old.stop();
  // 위젯 로그인이 없는 앱(바로 답함)에는 올릴 때마다 다시 묻는다(그사이 로그인이 생길 수 있다)
  const off = await withApp({on: false});
  await off.send.send(appTarget, [blob('p1.jpg')]).settled;
  await off.send.send(appTarget, [blob('p2.jpg')]).settled;
  assert.equal(off.shell.sent.filter(m => m === 'up:hello').length, 2);
  off.stop();
});

test('폰 앱: 뒤 묶음을 넘기는 사이 앞 묶음의 끝이 와도 그 줄을 찾는다(남의 묶음으로 보고 기록을 지우지 않는다)', async () => {
  const a = await withApp({quickDone: true});
  const files = Array.from({length: 21}, (_, i) => blob(`p${i + 1}.jpg`));
  const batch = a.send.send(appTarget, files);
  await batch.settled;
  await wait();
  assert.deepEqual(a.orphans, [], '넘긴 묶음을 모르는 묶음으로 알리지 않는다');
  assert.deepEqual(batch.entries.map(e => e.state), Array(21).fill('done'));
  assert.deepEqual(a.screen, []);
  const done = a.events.filter(e => e.type === 'done');
  assert.equal(done.length, 1); assert.equal(done[0].okPhotos, 21); assert.equal(done[0].sent, 21);
  a.stop();
});

test('폰 앱: 넘긴 직후 답을 못 받았어도 앱이 그 묶음을 맡았으면 화면에서 또 올리지 않는다(두 번 붙지 않게) · 맡지 않았으면 지금 길', async () => {
  const a = await withApp({muteGo: 1});
  const files = [blob('p1.jpg'), blob('p2.jpg')];
  const batch = a.send.send(appTarget, files);
  await batch.settled;
  assert.deepEqual(a.screen, [], '앱이 맡은 파일을 화면이 또 보내지 않는다');
  assert.deepEqual(batch.entries.map(e => [e.state, e.hand?.id]), [['handed', batchId(1)], ['handed', batchId(1)]]);
  a.shell.job(appJob(1, {docs: [docId(1), docId(2)], errors: ['', '']}));
  await wait();
  assert.deepEqual(batch.entries.map(e => e.state), ['done', 'done']);
  a.stop();
  // 답도 없고 앱에 새 묶음도 없으면(앱이 받지 못함) 지금 길로 올린다
  const {createAppUpload} = await import('../app/app-upload.js');
  const shell = fakeShell(), bridge = shell.win.KPTUAppShell, post = bridge.postMessage;
  bridge.postMessage = m => { if (String(m) === 'up:go') { shell.sent.push('up:go'); return; } post(m); };
  const up = createAppUpload(shell.win, {helloMs: 40, stepMs: 60});
  assert.deepEqual(await createAppHandoff(up, {ids: t => ({meeting: t.id, project: ''})})(appTarget, [{file: blob('p.jpg')}]), {ok: false, error: 'timeout'}, '앱이 답했고 새 묶음이 없다 = 받지 못함');
});
