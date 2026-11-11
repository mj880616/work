// BIZ-저장먼저닫기: 사업 보고 사진·자료 한 묶음 올리기(app/meeting-send.mjs) — 화면·서버 없이 본다(가짜 파일·가짜 이름).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeetingSend, sendDoneLine, sendFailLine, sendLiveLine} from '../app/meeting-send.mjs';

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
