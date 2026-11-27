// S71-69 SHARE-글공유 ①: 기사 [공유] = 제목 + 원래 주소(http·https만). 폰 = 기기 공유 창, PC·공유 창 없는 곳 = 복사 + '복사했어요'.
import test from 'node:test';
import assert from 'node:assert/strict';
import {articleShare, shareUrlOf, shareWay, nativeData, wideShare, WIDE_SHARE_QUERY, SHARE_NOTE} from '../app/link-share-model.mjs';
import {shareArticleLink} from '../app/link-share.js';
import {rowMenuItems} from '../app/now-row-acts.js';

test('주소는 http·https만', () => {
  assert.equal(shareUrlOf('https://news.example.org/a?b=1'), 'https://news.example.org/a?b=1');
  assert.equal(shareUrlOf('http://news.example.org/a'), 'http://news.example.org/a');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://x.example.org/a', '', null, 'not a url', 'https://' + 'a'.repeat(2001)]) assert.equal(shareUrlOf(bad), '', String(bad).slice(0, 20));
});
test('기사 하나 → 제목 + 주소(본문 없음), 주소가 없으면 null', () => {
  assert.deepEqual(articleShare({title: ' 가상  기사 제목 ', url: 'https://news.example.org/1', body: '본문은 넘기지 않음'}), {title: '가상 기사 제목', url: 'https://news.example.org/1', text: '가상 기사 제목\nhttps://news.example.org/1'});
  assert.deepEqual(articleShare({url: 'http://news.example.org/2'}), {title: '', url: 'http://news.example.org/2', text: 'http://news.example.org/2'});
  assert.equal(articleShare({title: '제목만'}), null);
  assert.equal(articleShare({title: 'x', url: 'javascript:alert(1)'}), null);
  assert.equal(articleShare(), null);
  assert.deepEqual(nativeData(articleShare({title: 'T', url: 'https://a.example.org/'})), {title: 'T', text: 'T', url: 'https://a.example.org/'});
});
test('어느 길: 좁은 화면 + 공유 창 = 공유 창, 아니면 복사', () => {
  assert.equal(shareWay({wide: false, canNative: true}), 'native');
  assert.equal(shareWay({wide: true, canNative: true}), 'copy');
  assert.equal(shareWay({wide: false, canNative: false}), 'copy');
  assert.equal(WIDE_SHARE_QUERY, '(min-width:761px)');
  assert.equal(wideShare(q => ({matches: q === WIDE_SHARE_QUERY})), true);
});
test('shareArticleLink: 폰은 공유 창, 닫으면 cancel, PC는 복사 + 알림', async () => {
  const shared = [], copied = [], said = [];
  const nav = {share: async d => { shared.push(d); }};
  const copy = async t => { copied.push(t); return true; };
  const say = (t, o) => said.push([t, !!o?.error]);
  const a = {title: '가상 기사', url: 'https://news.example.org/9'};
  assert.equal(await shareArticleLink(a, {nav, wide: false, copy, say}), 'shared');
  assert.deepEqual(shared, [{title: '가상 기사', text: '가상 기사', url: 'https://news.example.org/9'}]);
  assert.equal(copied.length, 0);
  assert.equal(await shareArticleLink(a, {nav: {share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; }}, wide: false, copy, say}), 'cancel');
  assert.equal(copied.length, 0, '닫으면 복사도 안 함');
  assert.equal(await shareArticleLink(a, {nav, wide: true, copy, say}), 'copied');
  assert.deepEqual(copied, ['가상 기사\nhttps://news.example.org/9']);
  assert.deepEqual(said.at(-1), [SHARE_NOTE.copied, false]);
  assert.equal(shared.length, 1, 'PC는 공유 창을 열지 않음');
  // 공유 창 없음(폰 앱 화면) → 복사, 공유 창이 막힘(NotAllowedError) → 복사로 이어 줌.
  assert.equal(await shareArticleLink(a, {nav: {}, wide: false, copy, say}), 'copied');
  assert.equal(await shareArticleLink(a, {nav: {share: async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; }}, wide: false, copy, say}), 'copied');
  assert.equal(await shareArticleLink(a, {nav: {}, wide: true, copy: async () => false, say}), 'failed');
  assert.deepEqual(said.at(-1), [SHARE_NOTE.copyFail, true]);
  assert.equal(await shareArticleLink({title: 'x', url: 'javascript:1'}, {nav, wide: false, copy, say}), 'none');
  assert.equal(shared.length, 1);
});
test('읽을 거리 줄 메뉴: [공유]는 숨기기·삭제 바로 앞, 주는 화면만', () => {
  assert.deepEqual(rowMenuItems({canEdit: true, canShare: true}).map(x => x.id), ['edit', 'save', 'share', 'hide']);
  assert.deepEqual(rowMenuItems({saved: true, canShare: true}).map(x => x.id), ['share', 'release']);
  assert.deepEqual(rowMenuItems({canEdit: true}).map(x => x.id), ['edit', 'save', 'hide']);
});
