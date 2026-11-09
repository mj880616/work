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

test('bindLibraryDrop: S55-08 놓을 수 없는 줄(ok:false) 위에서는 안내가 바뀌고 놓아도 올리지 않는다',()=>{
  const doc=fakeDoc(),span={textContent:''},overlay={hidden:true,firstChild:span},got=[];let under={ok:false,place:{}};
  m.bindLibraryDrop({doc,overlay,active:()=>true,onFiles:(f,t)=>got.push([f.map(x=>x.name),t]),pick:()=>under});
  doc.fire(dragEvent('dragenter'));doc.fire(dragEvent('dragover'));assert.equal(span.textContent,'여기에는 놓을 수 없어요');
  doc.fire(dragEvent('drop',{list:[file('a')]}));assert.deepEqual(got,[]);assert.equal(overlay.hidden,true);
  under=null;doc.fire(dragEvent('dragenter'));doc.fire(dragEvent('drop',{list:[file('b')]}));assert.deepEqual(got,[[['b'],null]]);
});

test('library-upload.js wires the drop: no storage of its own, no hard-coded colors, same upload request as the register dialog',()=>{
  const src=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  assert.match(src,/luEnhanceDrop\(\)/);
  // 폴더 묶기에서만 폴더를 고르고, 폴더에 넣기는 폴더 부품(putUploaded = 옮기기와 같은 자료 연결 표)이 한다.
  // S46-25: 다른 묶기(사업영역·담당조직·분류)는 묶음 머리 값(groupDropTarget + luDropValue 확인).
  assert.match(src,/pick:luDropTarget/);
  // S53-19: 폴더 묶기는 나무·위치 줄(placeDropTarget step) → 목록 폴더 줄(fileTarget) → 들어간 폴더 안 빈 곳(placeDropTarget) 순서.
  const target=src.slice(src.indexOf('function luDropTarget(e){'),src.indexOf('function luMarkDrop('));
  assert.match(target,/if\(luGroupBy!=='folder'\)return groupDropTarget\(e,luGroupBy,\{resolve:luDropValue\}\);\n\s*if\(!luFoldersReady\)return null;/);
  assert.match(target,/placeDropTarget\(el,\{\.\.\.opt,step:true\}\)[\s\S]*luFolders\(\)\.fileTarget\(e\)[\s\S]*placeDropTarget\(el,\{\.\.\.opt,step:false\}\)/);
  assert.match(src,/luFolders\(\)\.putUploaded\(doc\?\.id,f\.id\)/);
  // 담당조직 연결을 끝낸 뒤 AI 채우기(사람이 놓은 값을 AI가 덮지 않게).
  assert.match(src,/async function luUploadDropped[\s\S]*?luUploadRequest\(fd,file\)[\s\S]*?linkUploadedDocument\([\s\S]*?luAiFill\(d\.document\.id,fd,file\.name\)/);
  const drop=readFileSync(new URL('../app/library-drop.js',import.meta.url),'utf8');
  for(const word of ['local','session'])assert.ok(!drop.includes(word+'Storage'));
  assert.ok(!drop.includes('indexed'+'DB'));
  const css=readFileSync(new URL('../app/library-upload.css',import.meta.url),'utf8');
  const block=css.slice(css.indexOf('LIB-화면끌어놓기'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(block));
});

// S46-25 묶음으로올리기: 사업영역·담당조직·분류 묶음 머리에 놓으면 그 값을 달아 올린다(월별·'값 없음'은 지금처럼).
test('ro: 받침에 맞는 로/으로',()=>{
  assert.equal(m.ro('공공기관사업본부'),'로');
  assert.equal(m.ro('교섭'),'으로');
  assert.equal(m.ro('공공기관 기능개혁 대응'),'으로');
  assert.equal(m.ro('서울'),'로');// 받침 ㄹ
  assert.equal(m.ro('ABC'),'로');
  assert.equal(m.valueHint('공공기관사업본부'),'놓으면 ‘공공기관사업본부’로 올려요');
  assert.equal(m.resultText({done:2,value:'공공기관사업본부'}),'공공기관사업본부로 2개 올렸어요');
  assert.equal(m.resultText({done:2,value:'교섭',unlinked:1}),'교섭으로 2개 올렸어요 · 1개는 교섭에 붙이지 못했어요');
  assert.equal(m.resultText({done:1,unlinked:1}),'1개 올렸어요 · 1개는 그 묶음에 붙이지 못했어요');
});

// 아주 작은 details 나무 흉내: closest/querySelector만.
function tree(keys,{inList=true}={}){
  const list={id:'documentList'};let parent=list;const nodes=[];
  for(const key of keys){
    const node={tag:'details',dataset:{luNode:key},parentElement:parent};
    const head={tag:'summary',parentElement:node};
    node.querySelector=sel=>sel===':scope > summary.lu-node-head'?head:null;
    nodes.push(node);parent=node;
  }
  const closest=(el,sel)=>{for(let x=el;x;x=x.parentElement){if(sel==='details.lu-node'&&x.tag==='details')return x;if(sel==='#documentList'&&x===list&&inList)return x}return null};
  for(const n of nodes){n.closest=sel=>closest(n,sel);const h=n.querySelector(':scope > summary.lu-node-head');h.closest=sel=>closest(h,sel)}
  const row={tag:'article',parentElement:nodes.at(-1)};row.closest=sel=>closest(row,sel);
  return {nodes,row};
}
test('groupDropTarget: 가장 가까운 그 묶기의 묶음, 값 없음·없는 값·다른 묶기는 null',()=>{
  const resolve=raw=>({'top-a':{name:'공공기관 기능개혁 대응'},'child-a1':{name:'국토부 대응'},'org-1':{name:'공공기관사업본부'},'정책':{name:'정책'}})[raw]||null;
  // 사업영역 > 하위 사업영역 안 자료 줄 → 하위 사업영역. 사업영역 안 폴더 위는 지금처럼(null).
  assert.equal(m.groupDropTarget({target:tree(['p:top-a','f:fx']).row},'project',{resolve}),null);
  let {row,nodes}=tree(['p:top-a','p:child-a1']);
  let t=m.groupDropTarget({target:row},'project',{resolve});
  assert.equal(t.key,'p:child-a1');assert.equal(t.field,'project_id');assert.equal(t.value,'child-a1');assert.equal(t.kind,'into');assert.equal(t.hint,'놓으면 ‘국토부 대응’으로 올려요');assert.equal(t.head.parentElement,nodes[1]);
  ({row}=tree(['p:none']));assert.equal(m.groupDropTarget({target:row},'project',{resolve}),null);
  ({row}=tree(['p:gone']));assert.equal(m.groupDropTarget({target:row},'project',{resolve}),null);
  ({row}=tree(['o:org-1']));t=m.groupDropTarget({target:row},'organization',{resolve});assert.equal(t.field,'organization_id');assert.equal(t.name,'공공기관사업본부');
  ({row}=tree(['o:none']));assert.equal(m.groupDropTarget({target:row},'organization',{resolve}),null);
  ({row}=tree(['c:정책']));t=m.groupDropTarget({target:row},'category',{resolve});assert.equal(t.field,'category');assert.equal(t.kind,'category');assert.equal(t.value,'정책');
  ({row}=tree(['m:2026-10']));assert.equal(m.groupDropTarget({target:row},'month',{resolve}),null);
  assert.equal(m.groupDropTarget({target:row},'folder',{resolve}),null);
  ({row}=tree(['o:org-1'],{inList:false}));assert.equal(m.groupDropTarget({target:row},'organization',{resolve}),null);
  assert.equal(m.groupDropTarget({target:null},'project',{resolve}),null);
});
test('bindLibraryDrop: 값 묶음 안내 문구(hint)를 그대로 보인다',()=>{
  const doc=fakeDoc(),overlay={hidden:true,firstChild:{textContent:''}};let got=null;
  const t={name:'공공기관사업본부',hint:'놓으면 ‘공공기관사업본부’로 올려요',field:'organization_id',value:'org-1'};
  m.bindLibraryDrop({doc,overlay,active:()=>true,onFiles:(f,x)=>{got=x},pick:()=>t});
  doc.fire(dragEvent('dragenter'));doc.fire(dragEvent('dragover'));
  assert.equal(overlay.firstChild.textContent,'놓으면 ‘공공기관사업본부’로 올려요');
  doc.fire(dragEvent('drop',{list:[file('a.pdf')]}));assert.equal(got,t);
});
// S53-19 LIB-화면끌어놓기 이어서: 두 칸 폴더 보기의 나무 줄·위치 줄·들어간 폴더 안 빈 곳.
const STEP='#libraryFolderNav [data-lu-nav], #libraryPath [data-lu-path]';
// at: 손 아래 요소가 무엇 안에 있나({step,row,view,recent}). step은 dataset과 그 줄(.ft-row).
function placeEl({step=null,view=true,recent=false}={}){
  const row={kind:'ft-row'};
  const at=step?{dataset:step,closest:sel=>sel==='.ft-row'?(step.noRow?null:row):null}:null;
  return {row,at,el:{closest:sel=>sel===STEP?at:sel==='#libraryView'?(view?{}:null):sel==='#libraryRecent'?(recent?{}:null):null}};
}
test('placeDropTarget: 나무 줄·위치 줄은 그 폴더, 자료실 전체·자료실은 폴더 밖, 들어간 폴더 안 빈 곳은 그 폴더',()=>{
  const folders={fa:{id:'fa',name:'가상 A'},fw:{id:'fw',name:'주간보고'}},folderOf=id=>folders[id]||null;
  // ① 왼쪽 나무 줄 → 그 폴더(표시는 그 줄 .ft-row)
  let p=placeEl({step:{luNav:'fw'}});let t=m.placeDropTarget(p.el,{folderOf});
  assert.deepEqual({...t,place:t.place===p.row},{ok:true,kind:'into',target:'fw',name:'주간보고',place:true});
  // '자료실 전체' 줄 → 폴더 밖(들어간 폴더가 있어도)
  p=placeEl({step:{luNav:''}});t=m.placeDropTarget(p.el,{folderOf,inFolder:'fa'});assert.equal(t.out,true);assert.equal(t.target,undefined);assert.equal(t.place,p.row);
  // 위치 줄: 위 폴더 칸 → 그 폴더, 맨 앞 '자료실' → 폴더 밖. 줄(.ft-row)이 없으면 칸 자체를 표시.
  p=placeEl({step:{luPath:'fa',noRow:true}});t=m.placeDropTarget(p.el,{folderOf});assert.equal(t.target,'fa');assert.equal(t.place,p.at);
  p=placeEl({step:{luPath:'',noRow:true}});assert.equal(m.placeDropTarget(p.el,{folderOf}).out,true);
  // 없는 폴더 줄 → 폴더 밖
  // S55-08 LIB-나무로끌기안됨 ③: 모르는 폴더 id는 폴더 밖으로 바꾸지 않고 막는다.
  p=placeEl({step:{luNav:'gone'}});t=m.placeDropTarget(p.el,{folderOf});assert.equal(t.ok,false);assert.equal(t.out,undefined);assert.equal(t.place,p.row);
  // 나무·위치 줄이 아니면 ①은 null
  assert.equal(m.placeDropTarget(placeEl().el,{folderOf,inFolder:'fa'}),null);
  // ③ 들어간 폴더 안 빈 곳(자료실 화면 안) → 그 폴더
  assert.deepEqual(m.placeDropTarget(placeEl().el,{step:false,folderOf,inFolder:'fa'}),{ok:true,kind:'into',target:'fa',name:'가상 A',here:true});
  // 들어간 폴더가 없거나, 최근 올린 파일 칸이거나, 자료실 화면 밖이거나, 없는 폴더면 폴더 밖(null)
  assert.equal(m.placeDropTarget(placeEl().el,{step:false,folderOf,inFolder:null}),null);
  assert.equal(m.placeDropTarget(placeEl({recent:true}).el,{step:false,folderOf,inFolder:'fa'}),null);
  assert.equal(m.placeDropTarget(placeEl({view:false}).el,{step:false,folderOf,inFolder:'fa'}),null);
  assert.equal(m.placeDropTarget(placeEl().el,{step:false,folderOf,inFolder:'gone'}),null);
  assert.equal(m.placeDropTarget(null,{folderOf}),null);
});
test('bindLibraryDrop: 폴더 밖 표시({out})는 이름이 있어도 기본 안내, 놓으면 그 표시를 넘긴다',()=>{
  const doc=fakeDoc(),overlay={hidden:true,firstChild:{textContent:''}};let got=null;
  const t={out:true,name:'x'};
  m.bindLibraryDrop({doc,overlay,active:()=>true,onFiles:(f,x)=>{got=x},pick:()=>t});
  doc.fire(dragEvent('dragenter'));doc.fire(dragEvent('dragover'));
  assert.equal(overlay.firstChild.textContent,m.DROP_HINT);
  doc.fire(dragEvent('drop',{list:[file('a.pdf')]}));assert.equal(got,t);
});
test('자료실 화면 끌어놓기: 받는 폭은 공용 칸 나누기 판정(600px~), 옛 760px 폰 판정이 아니다',()=>{
  const src=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  const line=src.split('\n').find(l=>l.startsWith('const luDropActive='));
  assert.ok(line.includes('LU_NARROW'),line);assert.ok(!line.includes('luPhone()'),line);
  assert.match(src,/const LU_NARROW=typeof matchMedia==='function'\?matchMedia\(NARROW_QUERY\):null;/);
});
