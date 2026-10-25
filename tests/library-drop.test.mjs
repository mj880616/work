// LIB-화면끌어놓기: app/library-drop.js (끌어오기 감지·올리기 순서·안내 문구). No network, no DOM library: tiny stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const m=await import('../app/library-drop.js');

const file=(name)=>({name});
const dragEvent=(type,{files=true,list=[],relatedTarget}={})=>({type,relatedTarget,dataTransfer:{types:files?['Files']:['text/plain'],files:list,dropEffect:''},prevented:false,preventDefault(){this.prevented=true}});
function fakeDoc(){
  const handlers={};
  return {handlers,addEventListener(t,f){handlers[t]=f},removeEventListener(t){delete handlers[t]},fire(e){return handlers[e.type]?.(e)}};
}

test('text: progress and result lines are one short Korean line',()=>{
  assert.equal(m.DROP_HINT,'놓으면 바로 올려요');
  assert.equal(m.progressText({index:2,total:3,name:'a.pdf'}),'올리는 중 2/3 · a.pdf');
  assert.equal(m.progressText({index:1,total:1,name:'a.pdf'}),'올리는 중 · a.pdf');
  assert.equal(m.resultText({done:3}),'3개 올렸어요');
  assert.equal(m.resultText({done:2,failed:[{name:'b',message:'빈 파일은 업로드할 수 없습니다.'}]}),'2개 올렸어요 · 1개 못 올렸어요. 빈 파일은 업로드할 수 없습니다.');
  assert.equal(m.resultText({done:0,failed:[],rest:2}),'2개 못 올렸어요');
});

test('runDropUpload: one at a time in order; a bad file is skipped; a stop failure leaves the rest untried',async()=>{
  const order=[],progress=[];
  const r=await m.runDropUpload([file('a'),file('empty'),file('b'),file('c'),file('d')],{
    upload:async f=>{order.push(f.name);if(f.name==='c')throw Object.assign(new Error('x'),{stop:true})},
    preflight:f=>f.name==='empty'?{message:'빈 파일'}:null,
    classify:e=>({message:e.stop?'로그인 만료':'실패',stop:!!e.stop}),
    onProgress:p=>progress.push(p.index+'/'+p.total)});
  assert.deepEqual(order,['a','b','c']);
  assert.deepEqual(progress,['1/5','3/5','4/5']);
  assert.equal(r.done,2);assert.deepEqual(r.failed.map(f=>f.message),['빈 파일','로그인 만료']);assert.equal(r.rest,1);assert.ok(r.stopped);
  // A non-stopping failure continues with the next file.
  const r2=await m.runDropUpload([file('a'),file('b')],{upload:async f=>{if(f.name==='a')throw new Error('x')},classify:()=>({message:'실패'})});
  assert.equal(r2.done,1);assert.equal(r2.rest,0);assert.equal(r2.stopped,null);
});

test('bindLibraryDrop: overlay only while a file is dragged and active; drop hands the files over; other drags are untouched',()=>{
  const doc=fakeDoc(),overlay={hidden:true},got=[];let on=true,placed=0;
  m.bindLibraryDrop({doc,overlay,active:()=>on,onFiles:f=>got.push(f),place:()=>placed++});
  // Not a file drag: nothing.
  const text=dragEvent('dragover',{files:false});doc.fire(text);assert.equal(overlay.hidden,true);assert.equal(text.prevented,false);
  // File drag: overlay shown (placed once), default prevented so the drop is allowed.
  const enter=dragEvent('dragenter');doc.fire(enter);assert.equal(overlay.hidden,false);assert.equal(enter.prevented,true);assert.equal(placed,1);
  const over=dragEvent('dragover');doc.fire(over);assert.equal(over.dataTransfer.dropEffect,'copy');assert.equal(placed,1);
  // Leaving the window hides it.
  doc.fire(dragEvent('dragleave',{relatedTarget:null}));assert.equal(overlay.hidden,true);
  // A dialog opens (inactive): overlay hidden, nothing prevented, drop not taken.
  doc.fire(dragEvent('dragenter'));on=false;
  const blocked=dragEvent('dragover');doc.fire(blocked);assert.equal(overlay.hidden,true);assert.equal(blocked.prevented,false);
  const noDrop=dragEvent('drop',{list:[file('x')]});doc.fire(noDrop);assert.equal(noDrop.prevented,false);assert.deepEqual(got,[]);
  // Active again: drop gives the files over and hides the overlay.
  on=true;doc.fire(dragEvent('dragenter'));
  const drop=dragEvent('drop',{list:[file('a'),file('b')]});doc.fire(drop);
  assert.equal(drop.prevented,true);assert.equal(overlay.hidden,true);assert.deepEqual(got,[[file('a'),file('b')]]);
});

test('library-upload.js wires the drop: no storage of its own, no hard-coded colors, same upload request as the register dialog',()=>{
  const src=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  assert.match(src,/luEnhanceDrop\(\)/);
  assert.match(src,/async function luUploadDropped[\s\S]*?luUploadRequest\(fd,file\)[\s\S]*?luAiFill\(d\.document\.id,fd\)/);
  const drop=readFileSync(new URL('../app/library-drop.js',import.meta.url),'utf8');
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(drop));
  const css=readFileSync(new URL('../app/library-upload.css',import.meta.url),'utf8');
  const block=css.slice(css.indexOf('LIB-화면끌어놓기'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(block));
});
