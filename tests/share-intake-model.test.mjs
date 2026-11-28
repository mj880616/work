import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isShareId, parseShareList, pickShareItems, shareSummary, SHARE_MAX_BYTES} from '../app/share-intake-model.mjs';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';

test('일회용 번호는 추측하기 어려운 모양만 받는다', () => {
  assert.equal(isShareId(ID), true);
  assert.equal(isShareId('short'), false);
  assert.equal(isShareId(ID + '/../x'), false);
  assert.equal(isShareId(null), false);
});

test('앱 목록을 읽고 이름·종류·크기를 다듬는다', () => {
  const list = parseShareList(JSON.stringify({id:ID, subject:'제목', text:'본문\r\n둘째', items:[
    {i:0, name:'사진.jpg', type:'IMAGE/JPEG', size:1024},
    {i:1, name:'../a/b\nc.pdf', type:'bad type', size:-5},
    {i:1, name:'중복', type:'text/plain', size:1},
    {i:'x', name:'틀린 순번'},
    {i:2, name:'', type:'application/pdf', size:3},
  ]}));
  assert.equal(list.id, ID);
  assert.equal(list.text, '본문\n둘째');
  assert.deepEqual(list.items.map(item => [item.index, item.name, item.type, item.size]), [
    [0, '사진.jpg', 'image/jpeg', 1024],
    [1, '.. a b c.pdf', 'application/octet-stream', -1],
    [2, '공유 파일 3', 'application/pdf', 3],
  ]);
  assert.equal(parseShareList('{"id":"x","items":[]}'), null);
  assert.equal(parseShareList('not json'), null);
  assert.equal(parseShareList({id:ID}), null);
});

test('한도를 넘는 것만 뺀다(빈 파일·100MB 초과·21번째부터)', () => {
  const items = [{index:0, size:0}, {index:1, size:SHARE_MAX_BYTES + 1}, ...Array.from({length:21}, (_, i) => ({index:i + 2, size:-1}))];
  const {keep, skipped} = pickShareItems(items);
  assert.equal(keep.length, 20);
  assert.deepEqual(skipped, {empty:1, large:1, over:1});
});

test('확인 줄 한 줄 문구', () => {
  const items = [{type:'image/png', size:1048576}, {type:'image/jpeg', size:1048576}, {type:'application/pdf', size:-1}];
  assert.equal(shareSummary({items}), '사진 2 · 파일 1 (2.0MB)');
  assert.equal(shareSummary({items:[], text:'링크'}), '글 1');
  assert.equal(shareSummary({items:[]}), '넣을 것 없음');
  assert.equal(shareSummary({items:items.slice(2)}, {large:2, over:1}), '파일 1 · 뺌: 100MB 넘는 파일 2개, 20개 넘는 1개');
});

test('공유 받기 화면은 노트 기존 저장 길만 쓰고 기기에 저장하지 않는다(SHARE-노트로)', () => {
  const src = readFileSync(new URL('../app/basket-share.js', import.meta.url), 'utf8');
  assert.match(src, /import\('\.\/basket-upload\.js'\)/);
  assert.match(src, /createNoteDoc\(/);
  assert.match(src, /sendNoteBehind\(/);
  // 잊지 말기(업데이트) 저장 길은 쓰지 않는다.
  assert.doesNotMatch(src, /uploadBatch\(|createNote\(\{|updateNote\(/);
  // 기기 저장 이름은 조각으로 만든다(browser-storage-audit가 이 시험 파일 자체를 잡지 않게).
  for (const word of ['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'cach' + 'es.']) assert.equal(src.includes(word), false, word);
  assert.doesNotMatch(src, /\/functions\/v1\/|\/rest\/v1\//);
  assert.match(src, /KPTUAndroid/);
  const loader = readFileSync(new URL('../app/loader-v2.js', import.meta.url), 'utf8');
  assert.match(loader, /import\('\.\/basket-share\.js'\)/);
});

// S62-22 APP-공유로뉴스보관: 'News 보관' 칸(target news)과 글에서 기사 주소 하나 고르기.
test('share target news and article url picking', async () => {
  const M = await import('../app/share-intake-model.mjs');
  const id = 'A'.repeat(24);
  assert.equal(M.parseShareList({id, items: [], target: 'news'}).target, 'news');
  assert.equal(M.parseShareList({id, items: [], target: 'trash'}).target, 'basket');
  assert.equal(M.shareArticleUrl({subject: '합성 기사 제목', text: '합성 기사 제목\nhttps://news.example.org/a/1?x=1'}), 'https://news.example.org/a/1?x=1');
  assert.equal(M.shareArticleUrl({text: '이것 보세요 (https://news.example.org/a/2).'}), 'https://news.example.org/a/2');
  assert.equal(M.shareArticleUrl({text: '“https://news.example.org/a/3”'}), 'https://news.example.org/a/3');
  assert.equal(M.shareArticleUrl({text: 'https://ko.example.org/wiki/A_(B)'}), 'https://ko.example.org/wiki/A_(B)');
  assert.equal(M.shareArticleUrl({subject: 'http://news.example.org/a/4', text: '주소 없는 글'}), 'http://news.example.org/a/4', '본문에 없으면 제목에서');
  assert.equal(M.shareArticleUrl({text: '첫 https://one.example.org/a 둘 https://two.example.org/b'}), 'https://one.example.org/a', '첫 주소 하나');
  for (const text of ['', '주소 없는 글', 'javascript:alert(1)', 'ftp://news.example.org/a', 'https://localhost', 'www.example.org/a', `https://news.example.org/${'a'.repeat(2100)}`])
    assert.equal(M.shareArticleUrl({text}), '', text.slice(0, 40));
});

// S67-10 NEWS-네이버공유읽기: 공유 창이 넘긴 기사 제목 한 줄(원문을 못 읽었을 때만 서버가 제목으로 씀).
test('shareArticleTitle: 제목 칸이 먼저, 없으면 본문에서 주소를 뺀 첫 줄, 주소뿐이면 빈 값', async () => {
  const M = await import('../app/share-intake-model.mjs');
  assert.equal(M.shareArticleTitle({subject: '합성 기사 제목', text: '다른 줄\nhttps://n.news.naver.com/mnews/article/000/1'}), '합성 기사 제목');
  assert.equal(M.shareArticleTitle({subject: '', text: '[네이버 뉴스] 합성 기사 제목\nhttps://n.news.naver.com/mnews/article/000/1'}), '[네이버 뉴스] 합성 기사 제목');
  assert.equal(M.shareArticleTitle({subject: 'https://n.news.naver.com/a', text: 'https://n.news.naver.com/a\n\n  합성 둘째 줄 제목  '}), '합성 둘째 줄 제목');
  assert.equal(M.shareArticleTitle({subject: '', text: 'https://n.news.naver.com/mnews/article/000/1'}), '');
  assert.equal(M.shareArticleTitle({}), '');
  assert.equal(M.shareArticleTitle({subject: '합성\u0000 제목\t끝'}), '합성 제목 끝');
  assert.equal([...M.shareArticleTitle({subject: '가'.repeat(3000)})].length, M.SHARE_TITLE_SEND_MAX);
});
