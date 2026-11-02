// APP-공유노트할일(앱 0.4.8): 공유 창 '웹2 노트'·'웹2 할 일' — 들어갈 곳 고르기와 노트·할 일로 바꾸는 규칙.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseShareList, shareTarget, shareLinks, shareNoteDraft, shareTaskDraft, shareTaskFiles, SHARE_TASK_FILES_MAX} from '../app/share-intake-model.mjs';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';

test('들어갈 곳: 앱이 알려 준 칸만, 모르는 값·옛 앱(값 없음)은 정리함', () => {
  assert.equal(shareTarget('note'), 'note');
  assert.equal(shareTarget('task'), 'task');
  assert.equal(shareTarget('basket'), 'basket');
  assert.equal(shareTarget('NOTE'), 'basket');
  assert.equal(shareTarget(undefined), 'basket');
  assert.equal(parseShareList({id:ID, items:[], target:'task'}).target, 'task');
  assert.equal(parseShareList({id:ID, items:[]}).target, 'basket');
  assert.equal(parseShareList({id:ID, items:[], target:'<x>'}).target, 'basket');
});

test('링크 찾기: 같은 것은 한 번, 끝 문장부호는 뺀다', () => {
  assert.deepEqual(shareLinks('보기 https://a.example/x?y=1). 또 https://a.example/x?y=1 그리고 http://b.example'), ['https://a.example/x?y=1', 'http://b.example']);
  assert.deepEqual(shareLinks(''), []);
});

test('노트: 글은 첫 줄이 제목, 브라우저 링크는 페이지 제목이 제목', () => {
  const text = shareNoteDraft({text:'회의 메모\n둘째 줄', subject:''});
  assert.deepEqual([text.title, text.raw_text], ['회의 메모', '회의 메모\n둘째 줄']);
  const link = shareNoteDraft({text:'https://news.example/a', subject:'기사 제목'});
  assert.equal(link.title, '기사 제목');
  assert.equal(link.raw_text, '기사 제목\nhttps://news.example/a');
  // 한 줄 더하기는 본문 맨 앞.
  const extra = shareNoteDraft({text:'https://news.example/a', subject:'기사 제목', extra:'  읽어 볼 것\n'});
  assert.equal(extra.raw_text, '읽어 볼 것\n기사 제목\nhttps://news.example/a');
  assert.equal(extra.title, '기사 제목');
  // 파일만: 한 줄 → 첫 파일 이름.
  assert.equal(shareNoteDraft({items:[{name:'계약서.pdf'}]}).title, '계약서.pdf');
  assert.equal(shareNoteDraft({items:[{name:'계약서.pdf'}], extra:'검토'}).title, '검토');
  assert.equal(shareNoteDraft({text:'# 제목\n본문'}).title, '제목');
  assert.equal([...shareNoteDraft({text:'가'.repeat(500)}).title].length, 200);
});

test('할 일: 글이 제목, 링크는 메모로, 링크뿐이면 링크 제목이 제목', () => {
  const a = shareTaskDraft({text:'자료 보내기 https://drive.example/f\n금요일까지'});
  assert.deepEqual([a.title, a.notes], ['자료 보내기', '금요일까지\nhttps://drive.example/f']);
  const b = shareTaskDraft({text:'https://news.example/a', subject:'기사 제목'});
  assert.deepEqual([b.title, b.notes], ['기사 제목', 'https://news.example/a']);
  const c = shareTaskDraft({text:'https://news.example/a'});
  assert.deepEqual([c.title, c.notes], ['https://news.example/a', '']);
  const d = shareTaskDraft({items:[{name:'사진.jpg'}]});
  assert.equal(d.title, '사진.jpg');
  // 작은 창에서 고친 제목을 쓰면 원래 첫 줄은 메모에 남는다.
  const e = shareTaskDraft({text:'원래 줄\n둘째', title:'고친 제목'});
  assert.deepEqual([e.title, e.notes, e.auto], ['고친 제목', '원래 줄\n둘째', '원래 줄']);
  assert.equal([...shareTaskDraft({text:'가'.repeat(2000)}).title].length, 1024);
  assert.ok([...shareTaskDraft({text:'제목\n' + '나'.repeat(9000)}).notes].length <= 8192);
});

test('할 일 첨부는 10개까지, 넘는 수를 알린다', () => {
  const files = Array.from({length:12}, (_, i) => ({name:`f${i}`}));
  const {keep, over} = shareTaskFiles(files);
  assert.equal(keep.length, SHARE_TASK_FILES_MAX);
  assert.equal(over, 2);
  assert.deepEqual(shareTaskFiles([]), {keep:[], over:0});
});
