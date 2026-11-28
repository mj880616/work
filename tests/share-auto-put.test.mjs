// SHARE-바로넣기 → SHARE-노트로(2026-11-28 사용자 결정): 공유로 들어오면 확인 줄 없이 바로 노트 새 노트 하나로 넣고,
// 위쪽 작은 알림 '노트에 넣었어요 [열기]', 실패 시 '넣지 못했어요 [다시]'. 잊지 말기(업데이트)에는 넣지 않는다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {skippedText, shareSummary} from '../app/share-intake-model.mjs';
import {noteDraft, linkedNoteDoc} from '../app/share-target-model.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('뺀 것 한 줄은 한 번만 "뺌:"을 붙인다', () => {
  assert.equal(skippedText({}), '');
  assert.equal(skippedText({failed:1, large:2, empty:1, over:3}), '뺌: 읽지 못한 파일 1개, 100MB 넘는 파일 2개, 빈 파일 1개, 20개 넘는 3개');
  assert.equal(shareSummary({items:[{type:'image/jpeg', size:2048}]}, {large:1}), '사진 1 (2.0KB) · 뺌: 100MB 넘는 파일 1개');
});

test('공유한 글 → 새 노트: 제목·본문은 노트 초안 규칙, 본문 주소는 링크', () => {
  const d = noteDraft({subject:'합성 기사 제목', text:'합성 기사 제목\nhttps://news.example.org/a/1'});
  assert.equal(d.title, '합성 기사 제목');
  const doc = linkedNoteDoc(d.body);
  assert.equal(doc.v, 'ed1');
  const texts = doc.doc.content.flatMap(b => b.content || []).filter(n => n.type === 'text');
  const link = texts.find(n => n.marks?.some(m => m.type === 'link'));
  assert.equal(link.text, 'https://news.example.org/a/1');
  assert.equal(link.marks[0].attrs.href, 'https://news.example.org/a/1');
  // 문장부호는 링크 밖, 주소 아닌 글은 링크 없음, http(s) 밖은 링크로 만들지 않는다.
  const tail = linkedNoteDoc('보기 (https://x.example.org/b). 끝').doc.content[0].content;
  assert.deepEqual(tail.map(n => n.text), ['보기 (', 'https://x.example.org/b', '). 끝']);
  assert.equal(JSON.stringify(linkedNoteDoc('javascript:alert(1) ftp://a.example')).includes('"link"'), false);
  // 사진·파일만 온 공유: 제목은 첫 파일 이름, 본문은 빈 문단 하나.
  assert.equal(noteDraft({files:[{name:'합성 사진.jpg'}]}).title, '합성 사진');
  assert.equal(linkedNoteDoc('').doc.content.length, 1);
});

test('공유 받기는 새 노트 길(createNoteDoc + 노트 첨부 sendNoteBehind)만 쓰고, 잊지 말기 길·메모 달기·되돌리기는 없다', () => {
  const src = read('../app/basket-share.js');
  for (const gone of ['data-share-put', 'data-share-cancel', 'data-share-memo', 'share-intake-memo', "'넣기'", "'취소'", '>취소<',
    'uploadBatch(', 'createNote({', 'updateNote(', 'deleteNoteOriginal', '메모 달기', 'SEND_NOTE', 'photo-menu-items', "go?.('basket', {allowUnloaded"]) assert.equal(src.includes(gone), false, gone);
  assert.match(src, /import \{notify\} from '\.\/small-notice\.js'/);
  assert.match(src, /createNoteDoc\(\{title:draft\.title, raw_text:draft\.body, doc:linkedNoteDoc\(draft\.body\)\}\)/);
  assert.match(src, /void sendNoteBehind\(noteId, batch\)/);
  assert.match(src, /done:'노트에 넣었어요', open:'열기'/);
  assert.match(src, /notify\(SHARE_NOTE_TEXT\.done,/);
  assert.match(src, /requestNoteDocOpen\(noteId\)/);
  assert.match(src, /'넣지 못했어요'/);
  assert.match(src, /label:'다시'/);
  // 주소 없는 뉴스·읽을 거리 공유의 대체 단추도 '노트로 넣기'.
  assert.match(src, /label:NEWS_NOTE\.toNote/);
  assert.match(src, /label:SHARE_NOTE\.toNote/);
  assert.match(read('../app/share-news-words.mjs'), /toNote: '노트로 넣기'/);
  assert.match(read('../app/reading-data.js'), /toNote: '노트로 넣기'/);
  assert.equal(read('../app/share-news-words.mjs').includes('잊지 말기'), false);
  // 밖으로 보내는 길·직접 서버 주소·기기 저장 없음.
  assert.doesNotMatch(src, /\/functions\/v1\/|\/rest\/v1\/|navigator\.share|share:send/);
  for (const word of ['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'cach' + 'es.']) assert.equal(src.includes(word), false, word);
  assert.equal(read('../app/basket.css').includes('share-intake'), false);
});

test('공용 작은 알림은 [되돌리기] 앞에 다른 버튼(actions)을 둘 수 있다', () => {
  const js = read('../app/small-notice.js');
  assert.match(js, /actions=\[\]/);
  assert.match(js, /kptu-notice-action/);
  assert.ok(js.indexOf('for(const action of') < js.indexOf('if(undo){\n    const entry=makeEntry'));
});
