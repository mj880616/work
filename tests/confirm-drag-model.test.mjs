// S70-12 UI-확인창끌기: 떠 있는 작은 창(작은 확인창 포함)을 끌어 옮길 때의 계산(app/drag-move-model.mjs)과,
// 공용 확인창(small-notice.js askPanel)이 공용 끌기 부품(anchored-popup.js dragByTitle) 하나만 쓰는지 본다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dragStartOk,passedSlop,movedSpot,DRAG_SLOP,NO_DRAG_START} from '../app/drag-move-model.mjs';

const read=name=>readFileSync(new URL(`../app/${name}`,import.meta.url),'utf8');
// closest()만 흉내 내는 가짜 칸: tag가 막는 칸 목록에 있으면 그 칸을 돌려준다.
const el=(tag,attrs={})=>({tag,closest:sel=>sel===NO_DRAG_START&&(['button','a','input','select','textarea','label'].includes(tag)||attrs.contenteditable==='true')?{tag}:null});

test('끌기 거리만큼 새 자리로 옮긴다',()=>{
  assert.deepEqual(movedSpot({left:500,top:300,dx:-120,dy:40,width:300,height:140,vw:1280,vh:900}),{left:380,top:340});
  assert.deepEqual(movedSpot({left:500,top:300,dx:0,dy:0,width:300,height:140,vw:1280,vh:900}),{left:500,top:300});
});

test('화면 밖으로 나가지 않게 가장자리 8px 안에 가둔다',()=>{
  assert.deepEqual(movedSpot({left:500,top:300,dx:-2000,dy:-2000,width:300,height:140,vw:1280,vh:900}),{left:8,top:8});
  assert.deepEqual(movedSpot({left:500,top:300,dx:2000,dy:2000,width:300,height:140,vw:1280,vh:900}),{left:1280-8-300,top:900-8-140});
  // 창보다 큰 판은 왼쪽·위 끝을 가장자리에 둔다(음수 자리로 가지 않음).
  assert.deepEqual(movedSpot({left:0,top:0,dx:50,dy:50,width:2000,height:2000,vw:1280,vh:900}),{left:8,top:8});
  assert.deepEqual(movedSpot({left:100,top:100,dx:-500,dy:0,width:300,height:140,vw:1280,vh:900,edge:0}),{left:0,top:100});
});

test('단추·입력칸·체크 줄 위에서 시작하면 끌기가 아니다',()=>{
  for(const tag of ['button','a','input','select','textarea','label'])assert.equal(dragStartOk({button:0,pointerType:'mouse',target:el(tag)}),false,tag);
  assert.equal(dragStartOk({button:0,pointerType:'mouse',target:el('div',{contenteditable:'true'})}),false);
  assert.equal(dragStartOk({button:0,pointerType:'mouse',target:el('p')}),true);
  assert.equal(dragStartOk({button:0,pointerType:'mouse',target:el('div')}),true);
});

test('마우스 왼쪽 단추만, mouseOnly면 손가락·펜은 끌지 않는다',()=>{
  assert.equal(dragStartOk({button:2,pointerType:'mouse',target:el('p')}),false);
  assert.equal(dragStartOk({button:1,pointerType:'mouse',target:el('p')}),false);
  assert.equal(dragStartOk({button:0,pointerType:'touch',target:el('p')},{mouseOnly:true}),false);
  assert.equal(dragStartOk({button:0,pointerType:'pen',target:el('p')},{mouseOnly:true}),false);
  assert.equal(dragStartOk({button:0,pointerType:'touch',target:el('p')}),true); // 예전 제목 줄 끌기(mouseOnly 아님)는 그대로
  assert.equal(dragStartOk({button:0,pointerType:'mouse',target:null}),false);
});

test('조금만 움직인 짧은 누름은 끌기가 아니다',()=>{
  assert.equal(DRAG_SLOP,4);
  assert.equal(passedSlop(1,2),false);assert.equal(passedSlop(0,0),false);
  assert.equal(passedSlop(2,2),true);assert.equal(passedSlop(-5,0),true);
});

test('공용 확인창은 공용 끌기 부품 하나로, 마우스만, 저장 없이',()=>{
  const notice=read('small-notice.js'),popup=read('anchored-popup.js');
  assert.match(notice,/dragByTitle\(panel,'\.kptu-ask',\{mouseOnly:true\}\);/);
  // askPanel 한 곳에서만 붙인다(확인·버튼 셋·글 입력·날짜·고르기 창이 모두 이 틀).
  assert.equal(notice.match(/dragByTitle\(/g).length,1);
  const askPanel=notice.slice(notice.indexOf('function askPanel('),notice.indexOf('function askCheckRow('));
  assert.match(askPanel,/dragByTitle\(/);assert.doesNotMatch(askPanel,/pointermove|setPointerCapture/); // 끌기 코드를 따로 만들지 않는다
  assert.match(popup,/from '\.\/drag-move-model\.mjs'/);
  assert.match(popup,/movedSpot\(/);assert.match(popup,/dragStartOk\(/);
  // 닫히면 옮긴 자리를 잊는다(clearAnchored가 data-anchor-moved를 지운다). 기기 저장 없음.
  assert.match(popup,/delete panel\.dataset\.anchorMoved/);
  assert.doesNotMatch(read('drag-move-model.mjs')+popup,/Storage\b|DB\b/); // 저장 API 이름(공용 browser-storage-audit가 따로 막는다)
});
