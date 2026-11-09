import test from 'node:test';
import assert from 'node:assert/strict';
import {isDockedPane,floatingWindows,floatingWindowOpen} from '../app/open-window.mjs';
// ★LIB-바깥파일놓기안됨: '떠 있는 창' 판단은 칸에 붙인 창(role=region)을 뺀다. 가짜 문서 객체로 확인한다.
const modal=(id,{hidden=false,role='dialog'}={})=>({id,classList:{contains:c=>c==='hidden'&&hidden},getAttribute:k=>k==='role'?role:null,matches:sel=>sel==='#'+id});
const docOf=list=>({querySelectorAll:sel=>{assert.equal(sel,'.modal:not(.hidden)');return list.filter(m=>!m.classList.contains('hidden'))}});

test('칸에 붙인 창(role=region)은 떠 있는 창이 아니다',()=>{
  const docked=modal('meetingRoundDetailModal',{role:'region'});
  assert.equal(isDockedPane(docked),true);
  assert.equal(floatingWindowOpen(docOf([docked])),false);
});
test('보통 창이 떠 있으면 열림, 숨기면 닫힘',()=>{
  assert.equal(floatingWindowOpen(docOf([modal('a')])),true);
  assert.equal(floatingWindowOpen(docOf([modal('a',{hidden:true})])),false);
  assert.deepEqual(floatingWindows(docOf([modal('a'),modal('b',{role:'region'})])).map(m=>m.id),['a']);
});
test('except로 자기 창은 빼고 본다',()=>{
  const d=docOf([modal('wdModal'),modal('x',{role:'region'})]);
  assert.equal(floatingWindowOpen(d,{except:['#wdModal']}),false);
  assert.equal(floatingWindowOpen(docOf([modal('wdModal'),modal('other')]),{except:['#wdModal']}),true);
});
test('문서가 없어도 깨지지 않는다',()=>{assert.equal(floatingWindowOpen(null),false)});
