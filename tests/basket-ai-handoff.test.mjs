import * as projectRules from '../app/project-catalog-model.mjs';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {buildHandoff, selectHandoffNotes, readHandoff, mountHandoff} from '../app/basket-ai-handoff.js';
import {parseAIAnswer, classificationFormat, ERROR_TEXT} from '../app/basket-classification.js';
const installCatalog=rt=>{
 globalThis.window={addEventListener(){},dispatchEvent(){},KPTURuntime:rt};
 vm.runInNewContext(readFileSync(new URL('../app/project-catalog.js',import.meta.url),'utf8').replace(/^import .*\n/,''),{...projectRules,window:globalThis.window,CustomEvent:class {}});
};
const now=new Date('2026-10-11T01:02:03.123Z'),stamp=now.toISOString();
const n='10000000-0000-4000-8000-000000000001',p='20000000-0000-4000-8000-000000000001';
const note=(id=n,changes={})=>({id,raw_text:' 첫 줄\n둘째 줄 ',updated_at:stamp,occurred_at:stamp,ai_export_allowed:true,attachments:[],...changes});
const proposal=()=>({schema_version:1,copied_at:stamp,items:[{note_id:n,note_updated_at:stamp,destinations:[{kind:'project',target_id:p,reason:'관련 업무'}]}]});
test('export follows Drive eligibility, inclusive KST midnight boundary and excludes future notes',()=>{
 const rows=[note(),note('confirmed'),note('suggested'),note('archive',{archived_at:stamp}),note('excluded',{ai_export_allowed:false}),note('unset',{ai_export_allowed:undefined}),note('old',{occurred_at:'2026-09-12T14:59:59.999Z'}),note('boundary',{occurred_at:'2026-09-12T15:00:00.000Z'}),note('future',{occurred_at:'2026-10-11T01:02:04Z'})];
 assert.deepEqual(selectHandoffNotes(rows,[{note_id:'confirmed',status:'confirmed'},{note_id:'suggested',status:'suggested'}],now).map(x=>x.id),[n,'boundary']);
});
test('export takes newest 100 notes with deterministic ID ordering',()=>{
 const rows=Array.from({length:105},(_,i)=>note(String(i).padStart(3,'0'))).reverse();
 assert.equal(selectHandoffNotes(rows,[],now).length,100);assert.equal(selectHandoffNotes(rows,[],now)[0].id,'000');assert.equal(selectHandoffNotes(rows,[],now)[99].id,'099');
});
test('handoff preserves original and only attachment name, type, Drive link; destinations and parser format round trip',()=>{
 const rows=[note(n,{attachments:[{file_name:'議事.pdf',mime_type:'application/pdf',drive_file_id:'synthetic-drive',size_bytes:10,body:'ATTACHMENT_BODY',ocr:'OCR_SECRET'}]})];
 const text=buildHandoff(rows,[{id:p,name:'합성 프로젝트'}],[{id:n,name:'합성 담당조직'}],now);
 for(const required of [rows[0].raw_text,n,stamp,'議事.pdf','application/pdf','https://drive.google.com/file/d/synthetic-drive/view','합성 담당조직','합성 프로젝트','프로젝트 목록 (ID · 이름)',"AI 정리 결과 넣기",'블록이 기준'])assert.ok(text.includes(required),required);
 for(const excluded of ['ATTACHMENT_BODY','OCR_SECRET','size_bytes','google_task','write_request_candidate','library',])assert.ok(!text.includes(excluded),excluded);
 const format=classificationFormat(now);const block=/```json\n([\s\S]*?)\n```/.exec(format)[1];
 const sample=JSON.parse(block);sample.items=proposal().items;assert.deepEqual(parseAIAnswer('사람 정리\n```json\n'+JSON.stringify(sample)+'\n```'),sample);
});
test('answer accepts raw copied JSON and exactly one supported fence, ignoring outside markup',()=>{
 const json=JSON.stringify(proposal());
 for(const raw of [json,' \n\t'+json+'\r\n '])assert.deepEqual(parseAIAnswer(raw),proposal());
 for(const lang of ['json',''])assert.deepEqual(parseAIAnswer('<script>throw 1</script>\n```'+lang+'\n'+json+'\n```\n<img onerror=alert(1)>'),proposal());
 for(const answer of ['설명만','설명\n'+json,json+'\n설명','[]','```json\n'+json+'\n```\n```\n'+json+'\n```','```json\n'+json+'\n```\n~~~json\n'+json+'\n~~~','```html\n'+json+'\n```','```json\n'+json])assert.throws(()=>parseAIAnswer(answer),/AI 답 전체나, 답 속 복사용 블록만 넣어 주세요/);
});
test('raw object-shaped prose is still rejected by the strict parser',()=>{
 assert.throws(()=>parseAIAnswer('{}\n설명\n{}'),/복사용 블록의 내용이 맞지/);
});
test('stale handoff completion cannot release a new operation busy lock',async()=>{
 const previous=globalThis.window,listeners=new Map();let workspaceId='old',release,sharedBusy=false;
 const pending=new Promise(resolve=>release=resolve);
 globalThis.window={addEventListener:(type,fn)=>listeners.set(type,fn),KPTUProjectCatalog:{load:async({workspaceId,userId})=>({workspaceId,userId,tree:[]})}};
 const rt={context:{read:()=>({workspace:{id:workspaceId},user:{id:'u'}})},api:async path=>path.includes('app_notes')?(await pending,[note()]):[]};
 const status={textContent:''},fallback={hidden:true},input={value:''};
 const host={set innerHTML(value){},querySelector:selector=>selector==='textarea'?input:selector==='[data-handoff-fallback]'?fallback:status};
 try{
  const handoff=mountHandoff(host,{isBlocked:()=>sharedBusy,onBusy:value=>sharedBusy=value},rt),copy=handoff.copy();
  assert.equal(sharedBusy,true);workspaceId='new';listeners.get('kptu:session-changed')();
  // A new-scope classification preview now owns the shared lock.
  sharedBusy=true;release();await copy;assert.equal(sharedBusy,true);assert.equal(input.value,'');assert.equal(status.textContent,'');
 }finally{globalThis.window=previous;}
});
test('inner strict checks remain and public errors contain no developer vocabulary or arbitrary keys',()=>{
 const json=JSON.stringify(proposal());
 for(const bad of [json.replace('"schema_version":1','"schema_version":1,"schema_version":1'),json.replace(n,'bad-id'),json.replaceAll(stamp,'2026-02-30T00:00:00Z'),json.replace('project','unknown'),json.replace('"schema_version":1','"schema_version":2')]){
  for(const input of [bad,'```json\n'+bad+'\n```'])assert.throws(()=>parseAIAnswer(input),e=>! /JSON|schema|UUID|workspace|행 \d|열 \d|unknown|bad-id/.test(e.message));
 }
 for(const input of [json,'```json\n'+json+'\n```'])assert.throws(()=>parseAIAnswer(input+' '.repeat(1048576)),/글이 너무 길어요/);
 for(const message of Object.values(ERROR_TEXT))assert.doesNotMatch(message,/JSON|schema|UUID|workspace|\(행|4b|확정/);
});
test('wrapper retains item, destination, reason, depth and duplicate-key rejection',()=>{
 for(const fenced of [JSON.stringify,value=>'```json\n'+JSON.stringify(value)+'\n```']){
 let value=proposal();value.items=Array.from({length:101},()=>value.items[0]);assert.throws(()=>parseAIAnswer(fenced(value)),/100/);
 value=proposal();value.items.push(value.items[0]);assert.throws(()=>parseAIAnswer(fenced(value)),/같은 메모가 두 번/);
 value=proposal();value.items[0].destinations=Array.from({length:21},()=>value.items[0].destinations[0]);assert.throws(()=>parseAIAnswer(fenced(value)),/20/);
 value=proposal();value.items[0].destinations[0].reason='가'.repeat(2001);assert.throws(()=>parseAIAnswer(fenced(value)),/2,000/);
 assert.throws(()=>parseAIAnswer('```json\n'+('['.repeat(10))+'0'+(']'.repeat(10))+'\n```'),/내용이 맞지/);
 assert.throws(()=>parseAIAnswer(fenced(proposal()).replace('"kind":"project"','"kind":"project","\\u006bind":"project"')),/내용이 맞지/);
 }
});
test('destination read reuses owner-scoped catalog and includes only active visible projects',async()=>{
 const previous=globalThis.window;

 const paths=[];
 const rt={context:{read:()=>({workspace:{id:'w'},user:{id:'u'}})},api:async path=>{
  paths.push(path);const url=new URL(path,'http://test');
  if(path.includes('app_notes'))return [note()];
  if(path.includes('app_record_links')||path.includes('app_suborganization_assignees'))return [];
  if(path.includes('app_spaces'))return [
   {id:p,name:'가능한 프로젝트',metadata:{project_system:'v2'}},
   {id:'child',name:'하위 프로젝트',parent_id:p},
   {id:'archive',name:'보관 프로젝트',status:'archived',metadata:{project_system:'v2'}},
   {id:'hidden-child',name:'보관 아래 숨김',parent_id:'archive'},
   {id:'done',name:'완료 프로젝트',status:'done',metadata:{project_system:'v2'}},
   {id:'completed',name:'완료 표기 프로젝트',status:'completed',metadata:{management_version:2}},
   {id:'legacy',name:'옛 공간'}];
  if(path.includes('app_suborganizations'))return url.searchParams.get('offset')==='0'?Array.from({length:100},(_,i)=>({id:'org'+i,name:'담당조직 '+i})):[{id:'org-last',name:'마지막 담당조직'}];
 }};
 installCatalog(rt);
 try{
  const text=await readHandoff(rt,now);
  for(const label of ['담당조직 0','담당조직 99','마지막 담당조직'])assert.ok(text.includes(label));
  for(const label of ['가능한 프로젝트', '가능한 프로젝트 › 하위 프로젝트'])assert.ok(text.includes(label));
  for(const label of ['완료 프로젝트','완료 표기 프로젝트','보관 프로젝트','보관 아래 숨김','옛 공간'])assert.ok(!text.includes(label));
  const query=new URL(paths.find(p=>new URL(p,'http://test').pathname.endsWith('/app_spaces')),'http://test').searchParams;
  assert.equal(query.get('owner_id'),'eq.u');assert.equal(query.get('workspace_id'),'eq.w');
  assert.match(readFileSync(new URL('../app/basket-ai-handoff.js',import.meta.url),'utf8'),/KPTUProjectCatalog.load/);
  assert.ok(paths.filter(p=>p.includes('app_suborganizations')).every(p=>p.includes('workspace_id=eq.w')));
  paths.length=0;rt.api=async path=>{paths.push(path);return [];};assert.equal(await readHandoff(rt,now),'');assert.ok(!paths.some(p=>p.includes('app_spaces')||p.includes('app_suborganizations')));
 }finally{globalThis.window=previous;}
});

test('handoff example and both organization and project proposals round trip',()=>{
 const format=classificationFormat(now);
 assert.doesNotMatch(format,/library|google_task|write_request_candidate/);
 assert.match(format,/kind는 organization\(담당조직\), project\(프로젝트\) 두 종류만 쓰세요/);
 assert.deepEqual(parseAIAnswer(format),{schema_version:1,copied_at:stamp,items:[]});
 const organization=proposal();organization.items[0].destinations[0].kind='organization';
 assert.deepEqual(parseAIAnswer('짧은 정리\n```json\n'+JSON.stringify(organization)+'\n```'),organization);
 assert.deepEqual(parseAIAnswer('옛 프로젝트 제안\n```json\n'+JSON.stringify(proposal())+'\n```'),proposal());
});

test('organization read cannot return a handoff after the workspace changes',async()=>{
 let workspaceId='w';
 const rt={context:{read:()=>({workspace:{id:workspaceId},user:{id:'u'}})},api:async path=>{
  if(path.includes('app_notes'))return [note()];
  if(path.includes('app_suborganizations')){workspaceId='other';return [{id:p,name:'조직'}];}
  return [];
 }};
 installCatalog(rt);
 await assert.rejects(readHandoff(rt,now),/업무 공간이 바뀌었어요/);
});

const fallbackNotice='담당조직이 지정되지 않아 전체 조직을 싣습니다';
for(const mode of ['two','zero','inactive-only','failure','malformed','later-page-failure']){
 test(`handoff organization selection: ${mode}`,async()=>{
  const orgs=[{id:'a',name:'합성 담당 A',active:true},{id:'b',name:'합성 담당 B',active:null},{id:'c',name:'합성 다른 조직',active:true,default_assignee_name:'합성 소유자'},{id:'d',name:'합성 비활성',active:false}];
  const paths=[];
  const rt={context:{read:()=>({workspace:{id:'w'},user:{id:'u'}})},api:async path=>{
   paths.push(path);const q=new URL(path,'http://test').searchParams;
   if(path.includes('app_notes'))return [note()];
   if(path.includes('app_record_links'))return [];
   if(path.includes('app_suborganization_assignees')){
    assert.equal(q.get('user_id'),'eq.u');
    if(mode==='failure')throw Error('private failure detail');
    if(mode==='malformed')return {};
    if(mode==='later-page-failure'){
     if(q.get('offset')==='0')return Array.from({length:100},()=>({organization_id:'a'}));
     throw Error('second page failure');
    }
    return mode==='two'?[{organization_id:'a'},{organization_id:'b'},{organization_id:'d'},{organization_id:'foreign'}]:mode==='inactive-only'?[{organization_id:'d'}]:[];
   }
   if(path.includes('app_suborganizations')){assert.equal(q.get('workspace_id'),'eq.w');assert.match(q.get('select'),/active/);return orgs;}
   if(path.includes('app_spaces'))return [{id:p,name:'합성 프로젝트',metadata:{project_system:'v2'},status:'active'}];
   assert.fail(path);
  }};
  installCatalog(rt);
  const text=await readHandoff(rt,now);
  const listed=text.split('담당조직 목록 (ID · 이름)')[1];
  for(const id of mode==='two'?['a','b']:['a','b','c'])assert.match(listed,new RegExp(`organization · ${id} ·`));
  assert.doesNotMatch(listed,/organization · (d|foreign) ·|private failure detail/);
  if(mode==='two'){assert.doesNotMatch(listed,/organization · c ·/);assert.ok(!text.includes(fallbackNotice));}
  else{assert.ok(text.includes(fallbackNotice));assert.ok(text.indexOf(fallbackNotice)<text.indexOf('담당조직 목록'));}
 });
}
test('handoff reads every assignment page rather than publishing partial assigned IDs',async()=>{
 const rt={context:{read:()=>({workspace:{id:'w'},user:{id:'u'}})},api:async path=>{
  if(path.includes('app_notes'))return [note()];
  if(path.includes('app_record_links'))return [];
  if(path.includes('app_suborganizations'))return [{id:'first',name:'합성 첫 조직',active:true},{id:'last',name:'합성 마지막 조직',active:true},{id:'other',name:'합성 다른 조직',active:true}];
  if(path.includes('app_spaces'))return [];
  if(path.includes('app_suborganization_assignees'))return new URL(path,'http://test').searchParams.get('offset')==='0'?Array.from({length:100},()=>({organization_id:'first'})):[{organization_id:'last'}];
 }};
 installCatalog(rt);
 const text=await readHandoff(rt,now);assert.match(text,/합성 첫 조직/);assert.match(text,/합성 마지막 조직/);assert.doesNotMatch(text,/합성 다른 조직|전체 조직을 싣습니다/);
});

test('browser and Edge owner organization definitions agree, including zero active organizations',async()=>{
 const {selectBasketOrganizations:browser}=await import('../app/basket-ai-handoff.js');
 const {selectBasketOrganizations:edge}=await import('../supabase/functions/drive-summary/basket.mjs');
 const orgs=[{id:'a',active:true},{id:'b',active:false},{id:'c',active:null},{id:'d'}];
 for(const rows of [orgs,[],orgs.filter(o=>o.active===false)]){
  for(const ids of [[],['a','c'],['b'],['foreign'],['d','a']]){
   const assignees=ids.map(organization_id=>({organization_id}));
   assert.deepEqual(browser(rows,assignees),edge(rows,assignees));
   const expected=rows.filter(o=>o.active!==false&&ids.includes(o.id)),active=rows.filter(o=>o.active!==false);
   assert.deepEqual(browser(rows,assignees),{organizations:expected.length?expected:active,fallback:expected.length===0});
  }
 }
});

// Browser APIs are mocked here only to control timing; readHandoff is the real reader.
function handoffHarness({rows=[note()],hold=null}={}) {
 const listeners=new Map(),clicks=new Map();let sharedBusy=false;
 const rt={context:{read:()=>({workspace:{id:'w'},user:{id:'u'}})},api:async path=>path.includes('app_notes')?(hold&&await hold,rows):[]};
 installCatalog(rt);window.addEventListener=(type,fn)=>listeners.set(type,fn);
 const status={textContent:''},fallback={hidden:true},input={value:'',focus(){},select(){}};
 const host={set innerHTML(value){},addEventListener:(type,fn)=>clicks.set(type,fn),querySelector:selector=>selector==='textarea'?input:selector==='[data-handoff-fallback]'?fallback:status};
 const handoff=mountHandoff(host,{isBlocked:()=>sharedBusy,onBusy:value=>sharedBusy=value},rt);
 return {handoff,status,fallback,input,listeners,rt,get busy(){return sharedBusy;}};
}
async function withPromiseClipboard(run){
 const previous={window:globalThis.window,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),ClipboardItem:globalThis.ClipboardItem};
 const items=[];
 globalThis.ClipboardItem=class {constructor(data){this.data=data;}};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{write:async entries=>{items.push(entries[0]);await entries[0].data['text/plain'];}}}});
 try{await run(items);}finally{globalThis.window=previous.window;globalThis.ClipboardItem=previous.ClipboardItem;if(previous.navigator)Object.defineProperty(globalThis,'navigator',previous.navigator);else delete globalThis.navigator;}
}
test('starts clipboard write synchronously while private text is still being read',async()=>{
 await withPromiseClipboard(async items=>{
  let release;const held=new Promise(resolve=>release=resolve),h=handoffHarness({hold:held});
  const copying=h.handoff.copy();assert.equal(items.length,1);assert.equal(h.busy,true);assert.equal(h.input.value,'');
  release();await copying;assert.match(await (await items[0].data['text/plain']).text(),/첫 줄/);assert.match(h.status.textContent,/복사했어요/);assert.equal(h.fallback.hidden,true);assert.equal(h.busy,false);
 });
});
test('empty basket rejects pending clipboard data without replacing the clipboard',async()=>{
 await withPromiseClipboard(async items=>{
  const h=handoffHarness({rows:[]});await h.handoff.copy();assert.equal(items.length,1);await assert.rejects(items[0].data['text/plain']);assert.equal(h.status.textContent,'맡길 메모가 없어요');assert.equal(h.input.value,'');
 });
});
test('closing during a pending read rejects clipboard data and never restores private text',async()=>{
 await withPromiseClipboard(async items=>{
  let release;const held=new Promise(resolve=>release=resolve),h=handoffHarness({hold:held});
  const copying=h.handoff.copy();h.handoff.close();assert.equal(h.busy,false);release();await copying;
  await assert.rejects(items[0].data['text/plain']);assert.equal(h.input.value,'');assert.equal(h.status.textContent,'');assert.equal(h.fallback.hidden,true);
 });
});
test('explicit current-note handoff includes only the opened linked older note without changing eligibility',async()=>{
 const opened=note(n,{occurred_at:'2025-10-01T01:00:00Z'}),other=note('other');
 const rt={context:{read:()=>({workspace:{id:'w'},user:{id:'owner'}})},api:async path=>path.includes('app_notes?')?[opened,other]:path.includes('app_record_links?')?[{note_id:n,status:'confirmed'}]:[]};
 installCatalog(rt);
 const text=await readHandoff(rt,now,{noteId:n});assert.ok(text.includes(opened.raw_text));assert.ok(text.includes('메모 ID: '+n));assert.ok(!text.includes('메모 ID: other'));
 for(const change of [{archived_at:stamp},{ai_export_allowed:false}]){Object.assign(opened,change);await assert.rejects(readHandoff(rt,now,{noteId:n}));Object.assign(opened,{archived_at:null,ai_export_allowed:true});}
});
test('entire handoff output refuses oversized UTF-8 rather than truncating original text',()=>{
 assert.throws(()=>buildHandoff([note(n,{raw_text:'가'.repeat(400000)})],[],[],now),/너무|1MiB|1 MiB/);
});
