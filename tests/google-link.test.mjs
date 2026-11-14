import { test } from 'node:test';
import assert from 'node:assert/strict';
// MULTI-처음쓰는사람 ①: 홈 그날 일정·할 일 읽기 실패 뒤 status 답으로 '연결 없음'과 '진짜 고장'을 가른다.
const {linkFromStatus, googleLinkState, linkText} = await import('../app/google-link.js');

test('status 답: 연결 없음·권한 다시 받기·그 밖(고장으로 둠)', () => {
  assert.equal(linkFromStatus('events', {connected:false}), 'none');
  assert.equal(linkFromStatus('events', {connected:true, calendars:[]}), '');
  assert.equal(linkFromStatus('events', {connected:true, warning:'x'}), '');
  assert.equal(linkFromStatus('tasks', {connected:false, authorized:false}), 'none');
  assert.equal(linkFromStatus('tasks', {connected:true, authorized:false, needs_reconnect:true}), 'reconnect');
  assert.equal(linkFromStatus('tasks', {connected:true, authorized:true}), '');
  // 일정은 needs_reconnect 구분을 쓰지 않는다(그 Edge의 status에 없음).
  assert.equal(linkFromStatus('events', {connected:true, needs_reconnect:true}), '');
  assert.equal(linkFromStatus('basket', {connected:false}), '');
  assert.equal(linkFromStatus('tasks', null), '');
});

test('status를 묻지 못하면 고장으로 둔다(연결 안내를 지어내지 않음)', async () => {
  const asked = [];
  const ok = {api:async path => { asked.push(path); return {connected:false}; }};
  assert.equal(await googleLinkState('events', ok), 'none');
  assert.equal(await googleLinkState('tasks', ok), 'none');
  assert.deepEqual(asked, ['/functions/v1/google-calendar?action=status', '/functions/v1/google-tasks?action=status']);
  assert.equal(await googleLinkState('tasks', {api:async () => { throw new Error('500'); }}), '');
  assert.equal(await googleLinkState('memos', ok), '');
});

test('화면 글은 "~하면 ~가 여기 보여요" 말투, 개발 용어 없음', () => {
  for (const [kind, link] of [['events', 'none'], ['tasks', 'none'], ['tasks', 'reconnect']]) {
    const t = linkText(kind, link);
    assert.match(t.line, /하면 .+ 여기 보여요\.$/);
    assert.doesNotMatch(t.line + t.button, /Edge|API|토큰|status|OAuth/i);
  }
  assert.equal(linkText('events', 'reconnect'), null);
});
