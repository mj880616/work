// NOTE-파일그림넣기: 새 노트의 기다리는 사진·파일 자리(drive:wait_…) 바꾸기.
import test from 'node:test';
import assert from 'node:assert/strict';
import {WAIT_PREFIX, isWaiting, waitingSrcs, swapWaiting} from '../app/note-pending-media.mjs';

const doc = content => ({v: 'ed1', doc: {type: 'doc', content}});
const p = text => ({type: 'paragraph', content: [{type: 'text', text}]});
const img = src => ({type: 'image', attrs: {src, alt: ''}});
const file = (src, name) => ({type: 'file', attrs: {src, name, size: 10}});

test('기다리는 자리만 고른다(진짜 id·공유 사진·주소는 아님)', () => {
  assert.equal(WAIT_PREFIX, 'drive:wait_');
  assert.ok(isWaiting('drive:wait_1_ab'));
  for (const bad of ['drive:abc', 'share:wait_1', 'drive:wait_', 'drive:wait_a/b', 'blob:x', null]) assert.equal(isWaiting(bad), false, String(bad));
  const v = doc([p('a'), {type: 'photo_row', content: [img('drive:wait_1_a'), img('drive:real')]}, file('drive:wait_2_b', 'x.pdf'), img('drive:wait_1_a')]);
  assert.deepEqual(waitingSrcs(v), ['drive:wait_1_a', 'drive:wait_2_b']);
  assert.deepEqual(waitingSrcs(null), []);
});

test('올라간 것은 진짜 id로, 못 올라간 것은 글에서 빠지고 한 장 남은 줄은 사진 하나가 된다', () => {
  const v = doc([p('a'), {type: 'photo_row', content: [img('drive:wait_1_a'), img('drive:wait_2_b')]}, file('drive:wait_3_c', 'x.pdf')]);
  const out = swapWaiting(v, {'drive:wait_1_a': 'drive:UP1', 'drive:wait_3_c': 'drive:UP3'});
  assert.deepEqual(out.doc.content.map(n => n.type), ['paragraph', 'image', 'file']);
  assert.equal(out.doc.content[1].attrs.src, 'drive:UP1');
  assert.equal(out.doc.content[2].attrs.src, 'drive:UP3');
  assert.doesNotMatch(JSON.stringify(out), /wait_/);
});

test('바꿀 값이 기다리는 자리·주소면 받지 않고 빼며, 다 빠져도 빈 글이 된다', () => {
  const v = doc([img('drive:wait_1_a'), file('drive:wait_2_b', 'x')]);
  const out = swapWaiting(v, {'drive:wait_1_a': 'drive:wait_9_z', 'drive:wait_2_b': 'https://evil.example/x'});
  assert.doesNotMatch(JSON.stringify(out), /wait_|https?:/);
  assert.equal(out.doc.type, 'doc');
  assert.ok(out.doc.content.length >= 1);
});
