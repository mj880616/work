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
