// S71-68 ② READ-원문고치기: 글 보기 원문 직접 수정 모양 규칙(app/body-edit-model.mjs). DOM·서버 없음. 글은 모두 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
const M = await import('../app/body-edit-model.mjs');

test('초안 → 저장 블록: 빈 글은 문단 삭제, 제어 글자·여러 칸은 한 칸, https 사진만, 종류 그대로', () => {
  const d = M.draftOf([{t: 'p', text: '첫 문단'}, {t: 'h', text: '소제목'}, {t: 'img', src: 'https://img.example.com/a.jpg', cap: '설명', alt: null}, {t: 'img', src: 'http://img.example.com/b.jpg'}, {t: 'img', src: 'javascript:alert(1)'}, {t: 'quote', text: '인용'}, {t: 'x', text: '모름'}]);
  assert.deepEqual(d.map(b => b.t), ['p', 'h', 'img', 'quote']);
  d[0].text = '  고친\u0001 첫\n문단  ';
  d[3].text = '   ';
  assert.deepEqual(M.editBlocks(d).blocks, [{t: 'p', text: '고친 첫 문단'}, {t: 'h', text: '소제목'}, {t: 'img', src: 'https://img.example.com/a.jpg', cap: '설명', alt: null}]);
  assert.match(M.editBlocks([{t: 'p', text: ' '}]).error, /남은 문단이 없어요/);
  assert.match(M.editBlocks(Array.from({length: 401}, (_, i) => ({t: 'p', text: `문단 ${i}`}))).error, /400개까지/);
  assert.match(M.editBlocks([{t: 'p', text: '가'.repeat(110001)}]).error, /너무 길어요/);
  assert.equal(M.sameBlocks([{t: 'p', text: 'a '}], [{t: 'p', text: 'a'}]), true);
});

test('서버 줄: 글 종류마다 칸 하나(뉴스 news_article_id · 사회운동 outside_article_id), 그 밖은 null', () => {
  const b = [{t: 'p', text: 'a'}];
  assert.deepEqual(M.editRow('w1', {type: 'news', id: 'n1'}, b, '2026-11-26T00:00:00Z'), {workspace_id: 'w1', news_article_id: 'n1', blocks: b, edited_at: '2026-11-26T00:00:00Z'});
  assert.deepEqual(Object.keys(M.editRow('w1', {type: 'outside', id: 'o1'}, b)).sort(), ['blocks', 'edited_at', 'outside_article_id', 'workspace_id']);
  assert.equal(M.editRow('w1', {type: 'telegram', id: 't1'}, b), null);
  assert.equal(M.editRow('', {type: 'news', id: 'n1'}, b), null);
  assert.deepEqual(M.editView({blocks: [{t: 'p', text: '고친 글'}], edited_at: '2026-11-26T00:00:00Z'}), {state: 'ok', reason: '', blocks: [{t: 'p', text: '고친 글'}], edited: true, at: '2026-11-26T00:00:00Z'});
  assert.equal(M.editView({blocks: []}), null);
  assert.equal(M.editView({blocks: 'x'}), null);
});

test('사라지는 밑줄: 지운 문단·고친 글에 걸린 밑줄만(남은 문단 밑줄은 그대로 찾힘)', () => {
  const before = [{t: 'p', text: '앞 덧줄 하나'}, {t: 'p', text: '본문 첫 문단이다.'}, {t: 'p', text: '본문 둘째 문단이다.'}];
  const after = [{t: 'p', text: '본문 첫 문단을 고쳤다.'}, {t: 'p', text: '본문 둘째 문단이다.'}];
  const marks = [{id: 'a', quote: '덧줄', quote_prefix: '앞 ', quote_suffix: ''}, {id: 'b', quote: '첫 문단이다', quote_prefix: '', quote_suffix: ''}, {id: 'c', quote: '둘째 문단', quote_prefix: '', quote_suffix: ''}, {id: 'd', quote: '원래 없던 글', quote_prefix: '', quote_suffix: ''}];
  assert.deepEqual(M.lostMarks(before, after, marks).map(h => h.id), ['a', 'b']);
  assert.equal(M.lostNote(2), '밑줄 2개도 함께 삭제돼요');
});
