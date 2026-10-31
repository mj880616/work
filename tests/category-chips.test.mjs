import test from 'node:test';
import assert from 'node:assert/strict';
import {toggleCategoryOff} from '../app/category-chips.js';

const names=['교섭','투쟁','교육'];
test('a kind chip turns that kind off and on without touching the others',()=>{
  const off=toggleCategoryOff(names,new Set(),'투쟁');
  assert.deepEqual([...off],['투쟁']);
  assert.deepEqual([...toggleCategoryOff(names,off,'투쟁')],[]);
  assert.deepEqual([...toggleCategoryOff(names,off,'교육')].sort(),['교육','투쟁']);
});
test('the all chip turns everything off when all are on, otherwise everything on',()=>{
  assert.deepEqual([...toggleCategoryOff(names,new Set(),'all')].sort(),[...names].sort());
  assert.deepEqual([...toggleCategoryOff(names,new Set(['교육']),'all')],[]);
  assert.deepEqual([...toggleCategoryOff(names,new Set(names),'all')],[]);
});
test('toggling never changes the set it was given',()=>{
  const off=new Set(['교육']);
  toggleCategoryOff(names,off,'교섭');toggleCategoryOff(names,off,'all');
  assert.deepEqual([...off],['교육']);
});
// 2026-10-24 명진 결정: 담당조직·프로젝트 상세 [자료]는 '회의'를 기본으로 켠 채(아무것도 끄지 않고) 열린다. 자료실 기본('회의'만 꺼짐)과 다르다.
test('organization and project details start with every kind on, 회의 included',async()=>{
  const {DETAIL_DEFAULT_OFF,detailDefaultOff}=await import('../app/category-chips.js');
  assert.deepEqual([...DETAIL_DEFAULT_OFF],[]);
  const a=detailDefaultOff(),b=detailDefaultOff();
  assert.equal(a.has('회의'),false);assert.notEqual(a,b);
  a.add('회의');assert.equal(detailDefaultOff().has('회의'),false);
});

// LIB-소분류 ②: 큰 분류가 하나만 켜졌을 때만 소분류 줄이 뜨고, 고른 소분류는 그때만 거른다. 세 화면이 같은 '숨길 분류 모음'으로 거른다.
test('subcategory row: shows for a sole parent and filters only inside it',async()=>{
  const {soleParent,activeSubcategory,hiddenCategories}=await import('../app/category-chips.js');
  const dc=await import('../app/document-categories.js');
  dc.setDocumentCategories(['교섭','선전','기타','선전›투쟁속보','선전›소식지']);
  const tops=dc.topDocumentCategories();
  assert.equal(soleParent(tops,new Set()),'');
  assert.equal(soleParent(tops,new Set(['교섭','기타'])),'선전');
  // 큰 분류 여럿이 켜져 있으면 고른 소분류는 쓰이지 않는다.
  assert.equal(activeSubcategory(tops,new Set(),'선전›투쟁속보'),'');
  assert.equal(activeSubcategory(tops,new Set(['교섭','기타']),'선전›투쟁속보'),'선전›투쟁속보');
  assert.equal(activeSubcategory(tops,new Set(['선전','기타']),'선전›투쟁속보'),'');
  assert.equal(activeSubcategory(tops,new Set(['교섭','기타']),'선전›없는것'),'');
  // 꺼 둔 큰 분류는 소분류까지 숨긴다.
  assert.deepEqual([...hiddenCategories(tops,new Set(['선전']))].sort(),['선전','선전›소식지','선전›투쟁속보'].sort());
  // 선전 전체: 선전과 그 소분류 모두 보임.
  assert.deepEqual([...hiddenCategories(tops,new Set(['교섭','기타']),'')].sort(),['교섭','기타']);
  // 선전 › 투쟁속보만.
  assert.deepEqual([...hiddenCategories(tops,new Set(['교섭','기타']),'선전›투쟁속보')].sort(),['교섭','기타','선전','선전›소식지'].sort());
  // toggleCategoryOff는 큰 분류 이름만 다룬다(소분류는 칩 줄에 없다).
  assert.deepEqual([...toggleCategoryOff(tops,new Set(),'all')].sort(),[...tops].sort());
  dc.resetDocumentCategories();
});
