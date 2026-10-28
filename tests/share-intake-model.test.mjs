import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isShareId, parseShareList, pickShareItems, shareSummary, shareRawText, fitText, SHARE_MAX_BYTES} from '../app/share-intake-model.mjs';

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

test('저장할 글: 메모 → 제목(글에 없을 때) → 받은 글, 20,000자(CRLF 기준) 안', () => {
  assert.deepEqual(shareRawText({memo:' 읽어 볼 것\n ', subject:'기사 제목', text:'https://example.com/a'}), {text:'읽어 볼 것\n기사 제목\nhttps://example.com/a', cut:false});
  assert.equal(shareRawText({subject:'같은 제목', text:'같은 제목 https://x'}).text, '같은 제목 https://x');
  assert.equal(shareRawText({}).text, '');
  const long = fitText('a\n'.repeat(8000) + 'b'.repeat(10000));
  assert.equal(long.cut, true);
  assert.ok([...long.text.replace(/\n/g, '\r\n')].length <= 20000);
  assert.equal(fitText('가나다', 2).text, '가나');
});

test('확인 줄 화면은 바구니 기존 저장 길만 쓰고 기기에 저장하지 않는다', () => {
  const src = readFileSync(new URL('../app/basket-share.js', import.meta.url), 'utf8');
  assert.match(src, /import\('\.\/basket-upload\.js'\)/);
  assert.match(src, /uploadBatch\(/);
  assert.match(src, /createNote\(/);
  // 기기 저장 이름은 조각으로 만든다(browser-storage-audit가 이 시험 파일 자체를 잡지 않게).
  for (const word of ['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'cach' + 'es.']) assert.equal(src.includes(word), false, word);
  assert.doesNotMatch(src, /\/functions\/v1\/|\/rest\/v1\//);
  assert.match(src, /KPTUAndroid/);
  const loader = readFileSync(new URL('../app/loader-v2.js', import.meta.url), 'utf8');
  assert.match(loader, /import\('\.\/basket-share\.js'\)/);
});
