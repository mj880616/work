// NOTE-링크원문: 다른 길(폰 공유·빠른 입력·새 노트 창 본문·위젯)로 만든 링크 노트에 원문을 가져올 때의 순수 부품 시험.
// 주소·이름·글은 모두 가짜(example.com, 예시).
import test from 'node:test';
import assert from 'node:assert/strict';
import {linkOnlyUrl, firstLink, noteLinkUrl, askLinkImport, keepOrImportedTitle, mergeImported, blocksToDoc, importedNote, urlOnlyDoc, NOTE_BODY_MAX} from '../app/note-import-model.mjs';
import {toPlain} from '../app/ed-text.mjs';

const URL1 = 'https://news.example.com/mnews/article/001/0000000001';
const made = importedNote({title: '예시 기사 제목', blocks: [{t: 'p', text: '예시 기사 첫 문단.'}, {t: 'p', text: '예시 기사 둘째 문단.'}]}, URL1);

test('링크 하나뿐인 본문만 묻는다(https만)', () => {
  assert.equal(linkOnlyUrl(`  ${URL1}\n`), URL1);
  assert.equal(linkOnlyUrl(`<${URL1}>`), URL1);
  assert.equal(linkOnlyUrl(`${URL1}.`), URL1);
  assert.equal(linkOnlyUrl(`메모 ${URL1}`), '');
  assert.equal(linkOnlyUrl('http://news.example.com/a'), '', 'http는 묻지 않는다');
  assert.equal(linkOnlyUrl('https://user:pw@news.example.com/a'), '');
  assert.equal(linkOnlyUrl(''), '');
  assert.equal(firstLink(`읽을 것: ${URL1}), 그리고 끝`), URL1);
  assert.equal(firstLink('http://a.example.com 만 있음'), '');
});

test('묻는 줄: 원문 정보 없음 · 링크 하나뿐 · [괜찮아요] 안 누름 · 가족 노트 아님', () => {
  const base = {id: 'n1', title: '예시 기사 제목', raw_text: URL1, metadata: {}};
  assert.equal(askLinkImport(base), true);
  assert.equal(askLinkImport({...base, metadata: {link_import: 'no'}}), false);
  assert.equal(askLinkImport({...base, metadata: {source: {url: URL1, state: 'ok'}}}), false);
  assert.equal(askLinkImport({...base, raw_text: `내 생각 한 줄\n${URL1}`}), false, '글이 있으면 묻지 않고 ⋯에서 고른다');
  assert.equal(askLinkImport({...base, metadata: {family_list: true}}), false);
  assert.equal(noteLinkUrl({...base, raw_text: `내 생각 한 줄\n${URL1}`}), URL1);
  assert.equal(noteLinkUrl({...base, raw_text: '링크 없음'}), '');
  assert.equal(noteLinkUrl({...base, raw_text: '글', metadata: {source: {url: URL1, state: 'ok'}}}), URL1, '원문 정보가 있으면 그 주소(다시 가져오기)');
  assert.equal(noteLinkUrl({...base, metadata: {family_past: true}}), '');
});

test('제목: 사람이 붙인 제목은 그대로, 주소·사이트 이름이면 가져온 제목', () => {
  assert.equal(keepOrImportedTitle('공유한 앱이 준 제목', URL1, '가져온 제목'), '공유한 앱이 준 제목');
  assert.equal(keepOrImportedTitle(URL1, URL1, '가져온 제목'), '가져온 제목');
  assert.equal(keepOrImportedTitle('news.example.com', URL1, '가져온 제목'), '가져온 제목');
  assert.equal(keepOrImportedTitle('', URL1, '가져온 제목'), '가져온 제목');
});

test('본문이 링크 하나뿐이면 바꿔 넣는다(원문 주소는 원문 줄에)', () => {
  const out = mergeImported({title: '공유 제목', raw_text: URL1, doc: null}, made, URL1);
  assert.equal(out.mode, 'replace');
  assert.equal(out.title, '공유 제목');
  assert.equal(out.raw_text, made.text);
  assert.deepEqual(out.doc, made.doc);
  const again = mergeImported({title: 'news.example.com', raw_text: URL1, doc: urlOnlyDoc(URL1)}, made, URL1);
  assert.equal(again.mode, 'replace'); assert.equal(again.title, '예시 기사 제목');
});

test('사람이 쓴 글이 있으면 덮지 않고 아래에 붙인다(글자 노트·서식 노트 모두)', () => {
  const plain = mergeImported({title: '내 메모', raw_text: `내가 쓴 생각\n${URL1}\n`, doc: null}, made, URL1);
  assert.equal(plain.mode, 'append');
  assert.equal(plain.doc, undefined, '글자 노트는 저장 모양을 만들지 않는다');
  assert.ok(plain.raw_text.startsWith(`내가 쓴 생각\n${URL1}\n\n`));
  assert.ok(plain.raw_text.endsWith(made.text));
  const mine = blocksToDoc([{t: 'p', text: '내가 쓴 생각'}, {t: 'p', text: URL1}]);
  const rich = mergeImported({title: '내 메모', raw_text: toPlain(mine), doc: mine}, made, URL1);
  assert.equal(rich.mode, 'append');
  assert.equal(rich.doc.doc.content.length, 4);
  assert.equal(rich.doc.doc.content[0].content[0].text, '내가 쓴 생각');
  assert.ok(rich.raw_text.includes('내가 쓴 생각') && rich.raw_text.includes('예시 기사 둘째 문단.'));
  assert.equal(rich.title, '내 메모');
});

test('링크 하나뿐이어도 사진 등 다른 것이 든 서식 노트는 바꿔 넣지 않고 아래에 붙인다', () => {
  const withPhoto = {v: 'ed1', doc: {type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: URL1}]}, {type: 'image', attrs: {file: 'f1'}}]}};
  const out = mergeImported({title: 't', raw_text: URL1, doc: withPhoto}, made, URL1);
  assert.notEqual(out?.mode, 'replace');
});

test('붙이면 노트 상한을 넘을 때는 쓰지 않는다(null)', () => {
  const big = 'ㄱ'.repeat(NOTE_BODY_MAX - 5);
  assert.equal(mergeImported({title: 't', raw_text: big, doc: null}, made, URL1), null);
});
