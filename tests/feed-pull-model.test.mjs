// S52-46 FEED-최신화즉시수집 3/3: [최신화] 순수 규칙(feed-pull-model.mjs)과 부품 흐름(feed-pull.js, 가짜 런타임·기다림 없음). 값은 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pullFailText, pullErrorCode, pullAccepted, pullFinished, pullDoneText, PULL_TEXT, PULL_POLL_MAX, PULL_PATH} from '../app/feed-pull-model.mjs';
import {createFeedPull} from '../app/feed-pull.js';

const REQ = '2026-11-08T01:00:00Z';
const status = (src, at, up = '2026-11-08T00:55:00Z') => ({ok:true, collectors:{telegram:{last_at:up, count:null, reported_at:at}, transcript:{last_at:up, count:null, reported_at:at}, [src + '_send']:{last_at:at, state:'ok', reported_at:at}}});

test('model: fail lines, codes, accepted, finished, done line', () => {
  assert.equal(pullFailText('PULL_COOLDOWN'), '방금 눌렀어요 · 3분 뒤에 다시 누를 수 있어요');
  assert.match(pullFailText('PULL_DAILY_LIMIT'), /하루 20번/);
  assert.equal(pullFailText('NOT_OPERATOR'), '이 작업공간에서는 쓸 수 없어요');
  assert.match(pullFailText('anything'), /보내지 못했어요/);
  // S53-11: 까닭별 한 줄 — 설정 안 됨 / 거절 / 응답 없음 / 너무 자주(남은 시간) / 오늘 다 씀. 서로 다른 문장이어야 한다.
  assert.equal(pullFailText('PULL_COOLDOWN', 150), '방금 눌렀어요 · 3분 뒤에 다시 누를 수 있어요');
  assert.equal(pullFailText('PULL_COOLDOWN', 61), '방금 눌렀어요 · 2분 뒤에 다시 누를 수 있어요');
  assert.equal(pullFailText('PULL_COOLDOWN', 40), '방금 눌렀어요 · 40초 뒤에 다시 누를 수 있어요');
  assert.equal(pullFailText('PULL_COOLDOWN', 9999), '방금 눌렀어요 · 3분 뒤에 다시 누를 수 있어요', '이상한 값은 3분');
  assert.equal(pullFailText('PULL_COOLDOWN', '40'), '방금 눌렀어요 · 3분 뒤에 다시 누를 수 있어요');
  assert.match(pullFailText('SERVER_CONFIG_MISSING'), /연결 설정이 아직 안 끝났어요 · 지금은 눌러도 소용없어요/);
  assert.equal(pullFailText('PULL_NOT_READY'), pullFailText('SERVER_CONFIG_MISSING'));
  assert.match(pullFailText('PULL_WAKE_REFUSED'), /거절했어요 · Supabase와 앱 스크립트의 COLLECTOR_PULL_SECRET 값이 서로 달라요/);
  assert.match(pullFailText('PULL_WAKE_TIMEOUT'), /10초 안에 답하지 않았어요 · 3분 뒤 다시/);
  assert.match(pullFailText('PULL_WAKE_UNREACHABLE'), /닿지 못했어요 · 3분 뒤 다시/);
  assert.match(pullFailText('PULL_WAKE_HTTP'), /웹 앱 배포/);
  assert.match(pullFailText('PULL_WAKE_FAILED'), /깨우지 못했어요/, '앞 서버 판 코드');
  const codes = ['SERVER_CONFIG_MISSING', 'PULL_WAKE_REFUSED', 'PULL_WAKE_HTTP', 'PULL_WAKE_TIMEOUT', 'PULL_WAKE_UNREACHABLE', 'PULL_COOLDOWN', 'PULL_DAILY_LIMIT', 'NOT_OPERATOR', 'PULL_COUNT_FAILED'];
  assert.equal(new Set(codes.map(c => pullFailText(c))).size, codes.length, '까닭마다 다른 문장');
  for (const c of codes) assert.doesNotMatch(pullFailText(c), /https?:|script\.google/, '주소 없음');
  assert.equal(pullErrorCode({message:'PULL_WAKE_FAILED'}), 'PULL_WAKE_FAILED');
  assert.equal(pullErrorCode({message:'요청 실패 500'}), '');
  assert.equal(pullErrorCode({message:'권한 확인 실패: /functions/v1/drive-summary', status:403}), 'NOT_OPERATOR');
  assert.equal(pullAccepted({ok:true, source:'call', requested_at:REQ}, 'call'), REQ);
  assert.equal(pullAccepted({ok:true, source:'telegram', requested_at:REQ}, 'call'), null);
  assert.equal(pullAccepted({ok:true, source:'call', requested_at:'soon'}, 'call'), null);
  assert.equal(pullFinished(status('telegram', '2026-11-08T00:59:00Z'), 'telegram', REQ), null, 'older report is not the end');
  assert.deepEqual(pullFinished(status('telegram', '2026-11-08T01:01:00Z'), 'telegram', REQ), {upstreamAt:'2026-11-08T00:55:00Z'});
  assert.equal(pullFinished(status('telegram', '2026-11-08T01:01:00Z'), 'call', REQ), null, 'other source');
  assert.equal(pullFinished(null, 'call', REQ), null);
  assert.equal(pullDoneText('telegram', '2026-11-08T00:55:00Z'), '수집 끝 · 수집기가 마지막으로 올린 시각 09:55');
  assert.equal(pullDoneText('call', null), '수집 끝');
});

function harness({post, statuses = []}) {
  const calls = [], paints = [];
  let reloads = 0, who = 'u:w';
  const rt = {api: async (path, opts = {}) => { calls.push({path, opts}); if (path === PULL_PATH) return post(); return statuses.shift() ?? null; }};
  const p = createFeedPull({source:'telegram', rt, scope:() => who, reload:() => { reloads++; }, paint:() => paints.push(p.text), attr:'data-x-pull', wait:() => Promise.resolve()});
  return {p, calls, paints, reloads:() => reloads, switchUser:() => { who = 'v:w'; }};
}

test('flow: one POST with the source only, reload each poll, stops when the send report is after the request', async () => {
  const h = harness({post:async () => ({ok:true, source:'telegram', requested_at:REQ, left:19}), statuses:[status('telegram', '2026-11-08T00:59:00Z'), status('telegram', '2026-11-08T01:02:00Z')]});
  assert.match(h.p.button(), /data-x-pull>최신화</);
  await h.p.start();
  const posts = h.calls.filter(c => c.path === PULL_PATH);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].opts.body, {source:'telegram'});
  assert.equal(posts[0].opts.method, 'POST');
  assert.equal(h.reloads(), 2);
  assert.deepEqual(h.paints, [PULL_TEXT.busy, PULL_TEXT.sent, '수집 끝 · 수집기가 마지막으로 올린 시각 09:55']);
  assert.equal(h.p.busy, false);
  assert.match(h.p.line(), /data-feed-pull="telegram" role="status">수집 끝/);
});

test('flow: refused → one line, no polling; no answer for 3 minutes → late line', async () => {
  const err = Object.assign(new Error('PULL_COOLDOWN'), {status:429});
  let h = harness({post:async () => { throw err; }});
  await h.p.start();
  assert.equal(h.p.text, '방금 눌렀어요 · 3분 뒤에 다시 누를 수 있어요');
  assert.equal(h.reloads(), 0);
  // 공용 런타임이 넘기는 retryAfter(서버 retry_after 초)로 남은 시간.
  h = harness({post:async () => { throw Object.assign(new Error('PULL_COOLDOWN'), {status:429, retryAfter:45}); }});
  await h.p.start();
  assert.equal(h.p.text, '방금 눌렀어요 · 45초 뒤에 다시 누를 수 있어요');
  h = harness({post:async () => { throw Object.assign(new Error('PULL_WAKE_REFUSED'), {status:502}); }});
  await h.p.start();
  assert.match(h.p.text, /COLLECTOR_PULL_SECRET/);
  assert.equal(h.reloads(), 0);
  h = harness({post:async () => ({ok:true, source:'telegram', requested_at:REQ})});
  await h.p.start();
  assert.equal(h.reloads(), PULL_POLL_MAX);
  assert.equal(h.p.text, PULL_TEXT.late);
  h = harness({post:async () => ({ok:false})});
  await h.p.start();
  assert.match(h.p.text, /보내지 못했어요/);
});

test('flow: busy button is disabled and a second press does nothing; another account clears the line', async () => {
  let release;
  const h = harness({post:() => new Promise(r => { release = r; })});
  const first = h.p.start();
  assert.match(h.p.button(), /disabled/);
  await h.p.start();
  assert.equal(h.calls.filter(c => c.path === PULL_PATH).length, 1);
  h.switchUser();
  release({ok:true, source:'telegram', requested_at:REQ});
  await first;
  assert.equal(h.p.line(), '');
  assert.doesNotMatch(h.p.button(), /disabled/);
});

test('escape: line text is escaped', async () => {
  const h = harness({post:async () => { throw new Error('<b>'); }});
  await h.p.start();
  assert.doesNotMatch(h.p.line(), /<b>/);
});
