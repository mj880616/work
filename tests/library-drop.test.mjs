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
  // LIB-폴더로올리기: 폴더에 놓으면 폴더 이름이 앞에, 폴더에 못 넣은 것은 따로 한 마디.
  assert.equal(m.folderHint('주간보고'),'놓으면 ‘주간보고’ 폴더로 올려요');
  assert.equal(m.resultText({done:2,folder:'주간보고'}),'주간보고에 2개 올렸어요');
  assert.equal(m.resultText({done:2,folder:'주간보고',unfiled:1}),'주간보고에 2개 올렸어요 · 1개는 폴더에 넣지 못해 폴더 밖에 있어요');
  assert.equal(m.resultText({done:1,folder:'주간보고',failed:[{name:'b',message:'실패'}]}),'주간보고에 1개 올렸어요 · 1개 못 올렸어요. 실패');
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

test('bindLibraryDrop: over a folder the hint names it and the folder line is marked; the drop hands the folder over; elsewhere nothing changes',()=>{
  const doc=fakeDoc(),span={textContent:''},overlay={hidden:true,firstChild:span},got=[],marks=[];let under=null;
  m.bindLibraryDrop({doc,overlay,active:()=>true,onFiles:(f,t)=>got.push([f.map(x=>x.name),t]),pick:()=>under,mark:t=>marks.push(t?.name||null)});
  doc.fire(dragEvent('dragenter'));doc.fire(dragEvent('dragover'));assert.equal(span.textContent,'놓으면 바로 올려요');
  under={name:'주간보고',target:'f1'};doc.fire(dragEvent('dragover'));assert.equal(span.textContent,'놓으면 ‘주간보고’ 폴더로 올려요');
  doc.fire(dragEvent('drop',{list:[file('a'),file('b')]}));
  assert.deepEqual(got,[[['a','b'],{name:'주간보고',target:'f1'}]]);assert.equal(overlay.hidden,true);assert.equal(span.textContent,'놓으면 바로 올려요');
  assert.equal(marks.at(-1),null);
  under=null;doc.fire(dragEvent('dragenter'));doc.fire(dragEvent('drop',{list:[file('c')]}));assert.deepEqual(got[1],[['c'],null]);
});

test('library-upload.js wires the drop: no storage of its own, no hard-coded colors, same upload request as the register dialog',()=>{
  const src=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  assert.match(src,/luEnhanceDrop\(\)/);
  // 폴더 묶기에서만 폴더를 고르고, 폴더에 넣기는 폴더 부품(putUploaded = 옮기기와 같은 자료 연결 표)이 한다.
  assert.match(src,/pick:e=>luGroupBy==='folder'&&luFoldersReady\?luFolders\(\)\.fileTarget\(e\):null/);
  assert.match(src,/luFolders\(\)\.putUploaded\(doc\?\.id,f\.id\)/);
  assert.match(src,/async function luUploadDropped[\s\S]*?luUploadRequest\(fd,file\)[\s\S]*?luAiFill\(d\.document\.id,fd,file\.name\)/);
  const drop=readFileSync(new URL('../app/library-drop.js',import.meta.url),'utf8');
  for(const word of ['local','session'])assert.ok(!drop.includes(word+'Storage'));
  assert.ok(!drop.includes('indexed'+'DB'));
  const css=readFileSync(new URL('../app/library-upload.css',import.meta.url),'utf8');
  const block=css.slice(css.indexOf('LIB-화면끌어놓기'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(block));
});
