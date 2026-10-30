// SHARE-바로넣기: 공유로 들어오면 확인 줄 없이 바로 정리함에 넣고, 위쪽 작은 알림에 [메모 달기]·[되돌리기]·실패 시 [다시].
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withMemo, skippedText, shareSummary, SHARE_MEMO_MAX} from '../app/share-intake-model.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('[메모 달기]: 한 줄을 기존 글 맨 앞에 붙이고, 기존 글은 그대로 둔다', () => {
  assert.deepEqual(withMemo(' 회의 자료\n둘째 ', '받은 글\n  들여쓰기'), {text:'회의 자료 둘째\n받은 글\n  들여쓰기', cut:false});
  assert.deepEqual(withMemo('메모', ''), {text:'메모', cut:false});
  assert.equal(withMemo('   ', '글'), null);
  assert.equal([...withMemo('가'.repeat(SHARE_MEMO_MAX + 50), '').text].length, SHARE_MEMO_MAX);
  // 20,000자를 넘기면 잘렸다고 알려 준다(화면은 이때 쓰지 않는다: 기존 글 끝이 잘리지 않게).
  assert.equal(withMemo('메모', '나'.repeat(20000)).cut, true);
});

test('뺀 것 한 줄은 한 번만 "뺌:"을 붙인다', () => {
  assert.equal(skippedText({}), '');
  assert.equal(skippedText({failed:1, large:2, empty:1, over:3}), '뺌: 읽지 못한 파일 1개, 100MB 넘는 파일 2개, 빈 파일 1개, 20개 넘는 3개');
  assert.equal(shareSummary({items:[{type:'image/jpeg', size:2048}]}, {large:1}), '사진 1 (2.0KB) · 뺌: 100MB 넘는 파일 1개');
});

test('공유 받기 화면에는 확인 줄·메모 칸·[넣기]·[취소]가 없고, 공용 작은 알림과 기존 저장·지우기 길만 쓴다', () => {
  const src = read('../app/basket-share.js');
  for (const gone of ['data-share-put', 'data-share-cancel', 'data-share-memo]', 'share-intake-memo', "'넣기'", "'취소'", '>취소<']) assert.equal(src.includes(gone), false, gone);
  assert.match(src, /import \{notify\} from '\.\/small-notice\.js'/);
  assert.match(src, /'정리함에 넣었어요'/);
  assert.match(src, /label:'메모 달기'/);
  assert.match(src, /'넣지 못했어요'/);
  assert.match(src, /label:'다시'/);
  // 되돌리기 = 정리함 [지우기]와 같은 휴지통 길, 다시 묻지 않음.
  assert.match(src, /deleteNoteOriginal\(noteId, \{trash:true, confirmed:true/);
  // 메모 달기 = 기존 업데이트 고치기 길.
  assert.match(src, /updateNote\(noteId, \{raw_text:text\.text\}\)/);
  assert.match(src, /uploadBatch\(/);
  assert.match(src, /createNote\(/);
  // 밖으로 보내는 길·직접 서버 주소·기기 저장 없음.
  assert.doesNotMatch(src, /\/functions\/v1\/|\/rest\/v1\/|navigator\.share|share:send/);
  for (const word of ['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'cach' + 'es.']) assert.equal(src.includes(word), false, word);
  const css = read('../app/basket.css');
  assert.equal(css.includes('share-intake'), false);
});

test('공용 작은 알림은 [되돌리기] 앞에 다른 버튼(actions)을 둘 수 있고, 알림 안 입력칸은 누를 수 있다', () => {
  const js = read('../app/small-notice.js');
  assert.match(js, /actions=\[\]/);
  assert.match(js, /kptu-notice-action/);
  assert.ok(js.indexOf('for(const action of') < js.indexOf('if(undo){\n    const entry=makeEntry'));
  const css = read('../app/base-ui.css');
  assert.match(css, /\.kptu-notice input\.kptu-notice-input\{pointer-events:auto/);
});
