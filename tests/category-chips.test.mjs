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
