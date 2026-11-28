// READ-수정한창: 원문 블록 ↔ 공용 편집기 문서(ed1) 바꾸기(app/body-edit-doc.mjs). 순수 계산.
import test from 'node:test';
import assert from 'node:assert/strict';
import {blocksToDoc, docToBlocks} from '../app/body-edit-doc.mjs';
import {editBlocks, lostMarks} from '../app/body-edit-model.mjs';
import {cleanDoc} from '../app/ed-schema.mjs';

const BLOCKS = [{t: 'p', text: '첫 문단'}, {t: 'h', text: '소제목'}, {t: 'img', src: 'https://img.example.org/a.jpg', cap: '설명', alt: null}, {t: 'quote', text: '인용 글'}, {t: 'p', text: '끝 문단'}];

test('블록 → 편집기 문서 → 블록: 그대로 돌아온다(사진 주소는 문서에 넣지 않고 자리 표로)', () => {
  const {value, pics} = blocksToDoc(BLOCKS);
  assert.equal(JSON.stringify(value).includes('https://img.example.org'), false);
  const clean = cleanDoc(value); // 편집기가 받는 모양(사진 자리 id가 남는다)
  assert.equal(clean.doc.content[2].type, 'image');
  assert.equal(pics.get(clean.doc.content[2].attrs.src).src, 'https://img.example.org/a.jpg');
  assert.deepEqual(editBlocks(docToBlocks(clean, pics)).blocks, BLOCKS);
});

test('문단 글을 지우면 그 문단이 빠지고, 엔터로 나눈 줄은 문단 하나씩, 줄 안 바꿈은 빈칸', () => {
  const {value, pics} = blocksToDoc(BLOCKS);
  const c = value.doc.content;
  c[0] = {type: 'paragraph', attrs: {style: 'body2'}}; // 첫 문단 글을 모두 지움
  c.splice(4, 1, {type: 'paragraph', content: [{type: 'text', text: '끝'}, {type: 'hard_break'}, {type: 'text', text: '문단'}]}, {type: 'paragraph', content: [{type: 'text', text: '새 문단'}]});
  assert.deepEqual(editBlocks(docToBlocks(value, pics)).blocks, [BLOCKS[1], BLOCKS[2], BLOCKS[3], {t: 'p', text: '끝 문단'}, {t: 'p', text: '새 문단'}]);
});

test('사진 지우기 · 모르는 사진 자리는 버린다 · 목록·표 글자는 문단으로', () => {
  const {value, pics} = blocksToDoc(BLOCKS);
  const c = value.doc.content;
  c.splice(2, 1, {type: 'image', attrs: {src: 'share:other', alt: ''}});
  c.push({type: 'bullet_list', content: [{type: 'list_item', content: [{type: 'paragraph', content: [{type: 'text', text: '목록 글'}]}]}]});
  const out = editBlocks(docToBlocks(value, pics)).blocks;
  assert.equal(out.some(b => b.t === 'img'), false);
  assert.deepEqual(out.at(-1), {t: 'p', text: '목록 글'});
});

test('밑줄은 문단 번호가 아니라 글자로: 앞 문단을 지워도 남고, 밑줄 글을 지우면 잃는 밑줄로 센다', () => {
  const mark = {id: 'm1', quote: '끝 문단', quote_prefix: '인용 글', quote_suffix: ''};
  const {value, pics} = blocksToDoc(BLOCKS);
  value.doc.content.splice(0, 4);
  const after = editBlocks(docToBlocks(value, pics)).blocks;
  assert.deepEqual(lostMarks(BLOCKS, after, [mark]), []);
  assert.deepEqual(lostMarks(BLOCKS, [{t: 'p', text: '첫 문단'}], [mark]).map(h => h.id), ['m1']);
});

test('빈 원문은 빈 문단 하나(편집기가 열린다) · 저장하면 남은 문단이 없다는 안내', () => {
  const {value, pics} = blocksToDoc([]);
  assert.equal(value.doc.content.length, 1);
  assert.ok(editBlocks(docToBlocks(value, pics)).error);
});
