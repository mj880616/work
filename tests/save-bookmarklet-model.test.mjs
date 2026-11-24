// S69-BM 저장 버튼(북마클릿) 순수 계산: 버튼 한 줄 모양·넘기는 값(주소·제목뿐)·저장 창 주소 검사(http·https만).
import test from 'node:test';
import assert from 'node:assert/strict';
import {bookmarkletLine, openSave, readSaveParams, saveAddress, SAVE_WORDS} from '../app/save-bookmarklet-model.mjs';

const SAVE = 'https://desk.bokdoong.com/work/app/save/';

test('저장 창 주소는 앱 뿌리 아래 save/', () => {
  assert.equal(saveAddress('https://desk.bokdoong.com/work/app/'), SAVE);
});

test('버튼 한 줄은 javascript: 한 줄이고 openSave 그대로다(토큰·사용자 id 없음)', () => {
  const line = bookmarkletLine(SAVE);
  assert.match(line, /^javascript:\(function openSave\(w, s\) \{/);
  assert.ok(!line.includes('\n'));
  assert.ok(line.endsWith(`(window,"${SAVE}");void 0`));
  assert.doesNotMatch(line, /token|session|local[S]torage|cookie|user/i);
});

function fakeWin({href, title, blocked = false}) {
  const opened = [];
  return {opened, location: {href}, document: {title}, open(u, name, features) { opened.push({u, name, features}); return blocked && name !== '_blank' ? null : {}; }};
}

test('openSave는 지금 탭 주소·제목만 작은 창(420x300)으로 넘긴다', () => {
  const w = fakeWin({href: 'https://news.example.com/a?b=1&c=2', title: '예시 & 제목'});
  openSave(w, SAVE);
  assert.equal(w.opened.length, 1);
  const {u, features} = w.opened[0];
  assert.equal(features, 'popup,width=420,height=300');
  const q = new URL(u).searchParams;
  assert.deepEqual([...q.keys()], ['u', 't']);
  assert.equal(q.get('u'), 'https://news.example.com/a?b=1&c=2');
  assert.equal(q.get('t'), '예시 & 제목');
});

test('팝업이 막히면 새 탭으로 연다', () => {
  const w = fakeWin({href: 'https://news.example.com/a', title: 't', blocked: true});
  openSave(w, SAVE);
  assert.deepEqual(w.opened.map(o => o.name), ['workonplus_save', '_blank']);
});

test('긴 제목은 300자로 잘라 보낸다', () => {
  const w = fakeWin({href: 'https://news.example.com/a', title: '가'.repeat(900)});
  openSave(w, SAVE);
  assert.equal(new URL(w.opened[0].u).searchParams.get('t').length, 300);
});

test('저장 창은 http·https 주소만 받는다', () => {
  assert.deepEqual(readSaveParams('?u=' + encodeURIComponent('https://news.example.com/a') + '&t=%20제목%0A하나%20'), {ok: true, url: 'https://news.example.com/a', title: '제목 하나'});
  assert.equal(readSaveParams('?u=' + encodeURIComponent('http://news.example.com/a')).url, 'https://news.example.com/a');
  assert.deepEqual(readSaveParams('?u=' + encodeURIComponent('javascript:alert(1)')), {ok: false, reason: 'scheme'});
  assert.deepEqual(readSaveParams('?u=' + encodeURIComponent('file:///etc/passwd')), {ok: false, reason: 'scheme'});
  assert.deepEqual(readSaveParams('?u=' + encodeURIComponent('chrome://settings')), {ok: false, reason: 'scheme'});
  assert.deepEqual(readSaveParams('?u=' + encodeURIComponent('news.example.com/a')), {ok: false, reason: 'scheme'});
  assert.deepEqual(readSaveParams(''), {ok: false, reason: 'empty'});
  assert.equal(readSaveParams('?u=' + encodeURIComponent('https://localhost/x')).ok, false);
});

test('저장 창 글자에 옛 이름이 없다', () => {
  assert.ok(Object.values(SAVE_WORDS).every(v => !/Web2|웹2/i.test(v)));
});
