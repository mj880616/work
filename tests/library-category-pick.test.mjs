import test from 'node:test';
import assert from 'node:assert/strict';
import {pickedFrom,offFrom,togglePick,isPicked,pickLabel,pickCount} from '../app/library-category-pick.mjs';
// S51-28 LIB-화면정리 ①: 폰·폴드 [분류 ▾] 창 규칙. 체크 = 보일 분류, 아무것도 안 고르면 전체(꺼 둔 분류 없음).
const names=['교섭','투쟁','정책','회의','기타'];
const parentOf=n=>n.split('›')[0];

test('창 체크 ↔ 꺼 둔 분류',()=>{
  assert.deepEqual(pickedFrom(names,new Set()),[]);
  assert.deepEqual(pickedFrom(names,new Set(['회의'])),['교섭','투쟁','정책','기타']);
  assert.deepEqual([...offFrom(names,[])],[]);
  assert.deepEqual([...offFrom(names,['정책','투쟁'])],['교섭','회의','기타']);
});

test('줄 누르기: 전체·큰 분류 켬/끔·소분류는 하나만(그 큰 분류만 고름)',()=>{
  let s={picked:[],sub:''};
  s=togglePick(s,'정책',parentOf);assert.deepEqual(s,{picked:['정책'],sub:''});
  s=togglePick(s,'투쟁',parentOf);assert.deepEqual(s.picked.sort(),['정책','투쟁'].sort());
  s=togglePick(s,'sub:주간보고›확정본',parentOf);assert.deepEqual(s,{picked:['주간보고'],sub:'주간보고›확정본'});
  assert.equal(isPicked(s,'sub:주간보고›확정본'),true);assert.equal(isPicked(s,'주간보고'),true);assert.equal(isPicked(s,'all'),false);
  s=togglePick(s,'sub:주간보고›확정본',parentOf);assert.deepEqual(s,{picked:['주간보고'],sub:''});
  s=togglePick(s,'all',parentOf);assert.deepEqual(s,{picked:[],sub:''});assert.equal(isPicked(s,'all'),true);
});

test('위 한 줄 글자와 창 아래 셈',()=>{
  assert.equal(pickLabel(names,new Set()),'분류: 전체');
  assert.equal(pickLabel(names,new Set(['회의'])),'분류: 회의 빼고');
  assert.equal(pickLabel(names,new Set(['교섭','회의','기타'])),'분류: 투쟁 외 1');
  assert.equal(pickLabel(names,new Set(['교섭','투쟁','회의','기타'])),'분류: 정책');
  assert.equal(pickLabel(names,new Set(names)),'분류: 없음');
  assert.equal(pickLabel(names,new Set(),'주간보고 › 확정본'),'분류: 주간보고 › 확정본');
  assert.equal(pickCount({picked:[],sub:''}),'전체');assert.equal(pickCount({picked:['a','b'],sub:''}),'2개 고름');assert.equal(pickCount({picked:['a'],sub:'a›b'}),'소분류 1개 고름');
});
