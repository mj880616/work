import * as projectRules from '../app/project-catalog-model.mjs';
import * as orderRules from '../app/project-order.mjs';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildHandoff, selectHandoffNotes, readHandoff, mountHandoff} from '../app/basket-ai-handoff.js';
import {parseAIAnswer, classificationFormat, ERROR_TEXT} from '../app/basket-classification.js';
const installCatalog=rt=>{
 globalThis.window={addEventListener(){},dispatchEvent(){},KPTURuntime:rt};
 vm.runInNewContext(readFileSync(new URL('../app/project-catalog.js',import.meta.url),'utf8').replace(/^import .*\n/gm,''),{...projectRules,...orderRules,window:globalThis.window,CustomEvent:class {}});
};
const now=new Date('2026-10-11T01:02:03.123Z'),stamp=now.toISOString();
const n='10000000-0000-4000-8000-000000000001',p='20000000-0000-4000-8000-000000000001';
const note=(id=n,changes={})=>({id,raw_text:' 첫 줄\n둘째 줄 ',updated_at:stamp,occurred_at:stamp,ai_export_allowed:true,attachments:[],...changes});
const proposal=()=>({schema_version:1,copied_at:stamp,items:[{note_id:n,note_updated_at:stamp,destinations:[{kind:'project',target_id:p,reason:'관련 업무'}]}]});
test('export follows Drive eligibility, inclusive KST midnight boundary and excludes future notes',()=>{
 const rows=[note(),note('confirmed'),note('suggested'),note('archive',{archived_at:stamp}),note('excluded',{ai_export_allowed:false}),note('unset',{ai_export_allowed:undefined}),note('old',{occurred_at:'2026-09-12T14:59:59.999Z'}),note('boundary',{occurred_at:'2026-09-12T15:00:00.000Z'}),note('future',{occurred_at:'2026-10-11T01:02:04Z'})];
 assert.deepEqual(selectHandoffNotes(rows,[{note_id:'confirmed',status:'confirmed'},{note_id:'suggested',status:'suggested'}],now).map(x=>x.id),[n,'boundary']);
});
test('BUG-자료넣기미분류: a memo already filed as a project document is not sent as unclassified',()=>{
 const rows=[note('filed',{raw_text:'',attachments:[{drive_file_id:'drive-a'}]}),note('open',{raw_text:'',attachments:[{drive_file_id:'drive-b'}]})];
 assert.deepEqual(selectHandoffNotes(rows,[],now,[{file_id:'drive-a',project_id:'p'}]).map(x=>x.id),['open']);
 assert.deepEqual(selectHandoffNotes(rows,[],now).map(x=>x.id),['filed','open']);
});
test('export takes newest 100 notes with deterministic ID ordering',()=>{
 const rows=Array.from({length:105},(_,i)=>note(String(i).padStart(3,'0'))).reverse();
 assert.equal(selectHandoffNotes(rows,[],now).length,100);assert.equal(selectHandoffNotes(rows,[],now)[0].id,'000');assert.equal(selectHandoffNotes(rows,[],now)[99].id,'099');
});
test('handoff preserves original and no-OCR PDF name, type, Drive link; destinations and parser format round trip',()=>{
 const rows=[note(n,{attachments:[{file_name:'議事.pdf',mime_type:'application/pdf',drive_file_id:'synthetic-drive',size_bytes:10,body:'ATTACHMENT_BODY'}]})];
 const text=buildHandoff(rows,[{id:p,name:'합성 프로젝트'}],[{id:n,name:'합성 담당조직'}],now);
 for(const required of [rows[0].raw_text,n,stamp,'議事.pdf','application/pdf','https://drive.google.com/file/d/synthetic-drive/view','합성 담당조직','합성 프로젝트','프로젝트 목록 (ID · 이름)',"'분류 결과 입력'",'블록이 기준'])assert.ok(text.includes(required),required);
 for(const excluded of ['ATTACHMENT_BODY','size_bytes','google_task','write_request_candidate','library','AI 정리 결과 넣기',])assert.ok(!text.includes(excluded),excluded);
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
 value=proposal();value.items.push(value.items[0]);assert.throws(()=>parseAIAnswer(fenced(value)),/같은 업데이트가 두 번/);
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
 assert.match(format,/kind는 organization\(담당조직\), project\(프로젝트\), reference\(참고 묶음\) 세 종류만 쓰세요/);
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
 // ORG-담당13기준: the basket list is the app's one "내 담당 조직" rule, not a copy of it.
 const mine=await import('../app/my-organizations.js');
 assert.equal(browser,mine.selectMyOrganizations);
 const orgs=[{id:'a',active:true},{id:'b',active:false},{id:'c',active:null},{id:'d'}];
 for(const rows of [orgs,[],orgs.filter(o=>o.active===false)]){
  for(const ids of [[],['a','c'],['b'],['foreign'],['d','a']]){
   const assignees=ids.map(organization_id=>({organization_id}));
   assert.deepEqual(browser(rows,assignees),edge(rows,assignees));
   const expected=rows.filter(o=>o.active!==false&&ids.includes(o.id)),active=rows.filter(o=>o.active!==false);
   assert.deepEqual(browser(rows,assignees),{organizations:expected.length?expected:active,fallback:expected.length===0});
   assert.deepEqual([...mine.myOrganizationIds(rows,assignees)],(expected.length?expected:active).map(o=>o.id));
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
  const h=handoffHarness({rows:[]});await h.handoff.copy();assert.equal(items.length,1);await assert.rejects(items[0].data['text/plain']);assert.equal(h.status.textContent,'분류 요청할 업데이트가 없어요');assert.equal(h.input.value,'');
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

const photo=(changes={})=>({drive_file_id:'source',file_name:'photo.jpg',mime_type:'image/jpeg',size_bytes:4,...changes});
const photoOcr=(changes={})=>({state:'done',attempt_id:'40000000-0000-4000-8000-000000000001',original_file_id:'source',cleanup_state:'deleted',temp_document_id:'private-temp',text:' 認識した字\r\n<そのまま> ',...changes});
const budgetPhotos=()=>Array.from({length:16},(_,index)=>photo({drive_file_id:'source-'+index,file_name:'photo-'+index+'.jpg',ocr:photoOcr({original_file_id:'source-'+index,temp_document_id:'private-temp-'+index,text:'😀'.repeat(16384)})}));

const OLD_KIND_SENTENCE='kind는 organization(담당조직), project(프로젝트) 두 종류만 쓰세요.';
const REFERENCE_KIND_SENTENCE='kind는 organization(담당조직), project(프로젝트), reference(참고 묶음) 세 종류만 쓰세요. reference(참고 묶음)는 담당조직·프로젝트 어디에도 맞지 않을 때만 제안하세요. 노조 전체·공공기관 사업 전반·담당이 아닌 조직의 소식이 여기에 해당합니다. 담당조직·프로젝트와 함께 쓰지 마세요.';
test('complete no-OCR handoff bytes match the actual approved base including fallback guidance',()=>{
 // Captured before OCR implementation from main9235, identical to approved #528 product51.
 const rows=[note(n,{raw_text:' 原文\r\n\r\n末尾  ',attachments:[photo({file_name:'写真.jpg',body:'PRIVATE_BODY'}),{drive_file_id:'document',file_name:'議事.pdf',mime_type:'application/pdf',size_bytes:10}]}),note('10000000-0000-4000-8000-000000000002',{raw_text:'第二のメモ\n',updated_at:'2026-10-11T01:02:03.123456+00:00'})];
 const projects=[{id:p,name:'合成プロジェクト'}],orgs=[{id:'30000000-0000-4000-8000-000000000001',name:'合成組織'}];
 // UI-디자인기준 3/3: only the paste-button name in one guide sentence changed ('AI 정리 결과 넣기' -> '분류 결과 입력').
 // Reverting that name must still give the approved base bytes and hash.
 for(const [fallback,bytes,hash,baseBytes,baseHash] of [[false,3707,'145d329e41526212a2ee5ed4a4662fe1b76d7507c45e5a09212daca169274005',3416,'1affa40d45af7be157c82aece05b6b39917245a96e7f0325194b6cba49c732ad'],[true,3774,'8571abb4b3bf7400e19140e26e9bf0bd70b9268c8fb37889b62872044b9f1e40',3483,'891a548ee0fb576aca1a2097ba67a09a99c96f94d80b4732f5a199ac8fc56930']]){
  // REF-참고묶음 AI: only the kind sentence changed (reference added). Undoing it, too, must still give the approved base.
  const text=buildHandoff(rows,projects,orgs,now,fallback),base=text.split("'분류 결과 입력'").join("'AI 정리 결과 넣기'").split(REFERENCE_KIND_SENTENCE).join(OLD_KIND_SENTENCE);
  assert.equal(Buffer.byteLength(text),bytes);assert.equal(createHash('sha256').update(text).digest('hex'),hash);
  assert.equal(Buffer.byteLength(base),baseBytes);assert.equal(createHash('sha256').update(base).digest('hex'),baseHash);
 }
});
test('handoff appends source-labeled committed OCR outside raw markers without private attempt metadata',()=>{
 const original=' 原文\r\n\r\n末尾  ',updated_at='2026-10-11T01:02:03.123456+00:00';
 const rows=[note(n,{raw_text:original,updated_at,attachments:[photo({body:'PRIVATE_BODY',text:'UNVALIDATED_TEXT',ocr:photoOcr({error_code:'OCR_SAFE_ERROR',cleanup_error_code:'OCR_CLEANUP_ERROR'})})]})],before=structuredClone(rows);
 const text=buildHandoff(rows,[],[],now);
 assert.ok(text.includes('본문 시작\n\n'+original+'\n\n본문 끝'));
 assert.ok(text.includes('updated_at: '+updated_at));
 assert.ok(text.includes('첨부: photo.jpg · image/jpeg · https://drive.google.com/file/d/source/view'));
 const label='사진에서 읽은 글 · photo.jpg\n'+rows[0].attachments[0].ocr.text;
 assert.ok(text.includes(label));assert.ok(text.indexOf(label)>text.indexOf('본문 끝'));
 for(const value of ['PRIVATE_BODY','UNVALIDATED_TEXT','private-temp','40000000-0000-4000-8000-000000000001','OCR_SAFE_ERROR','OCR_CLEANUP_ERROR','attempt_id','cleanup_state'])assert.ok(!text.includes(value),value);
 assert.deepEqual(rows,before);
});
test('reading and failed attempts preserve previously committed OCR in the handoff through cleanup states',()=>{
 for(const state of ['reading','failed'])for(const cleanup_state of ['created','delete_pending','deleted','delete_failed']){
  const text=' 以前の確定字\r\n ',row=note(n,{attachments:[photo({ocr:photoOcr({state,cleanup_state,text})})]});
  const handoff=buildHandoff([row],[],[],now);
  assert.ok(handoff.includes('사진에서 읽은 글 · photo.jpg\n'+text),state+' '+cleanup_state);
  assert.ok(handoff.includes('updated_at: '+stamp));assert.equal(row.raw_text,' 첫 줄\n둘째 줄 ');
 }
});
test('absent, unread and empty validated OCR preserve the exact link-only handoff',()=>{
 const rows=[note(n,{attachments:[photo()]})],expected=buildHandoff(rows,[],[],now);
 for(const ocr of [{state:'unread',original_file_id:'source',cleanup_state:'none'},photoOcr({state:'empty',text:''})]){
  assert.equal(buildHandoff([note(n,{attachments:[photo({ocr})]})],[],[],now),expected);
 }
});
test('every present malformed OCR fails closed including unread, empty and unsupported PDFs',async t=>{
 const values=[null,undefined,'OCR_SECRET',{},photoOcr({original_file_id:'other'}),photoOcr({extra:'private'}),photoOcr({text:'\0'}),photoOcr({text:'😀'.repeat(16385)}),photoOcr({state:'empty',text:'not-empty'}),{state:'unread',original_file_id:'source',cleanup_state:'none',attempt_id:'40000000-0000-4000-8000-000000000001'}];
 for(const [index,ocr] of values.entries())await t.test('invalid OCR '+index,()=>assert.throws(()=>buildHandoff([note(n,{attachments:[photo({ocr})]})],[],[],now)));
 await t.test('malformed OCR on a PDF',()=>assert.throws(()=>buildHandoff([note(n,{attachments:[photo({mime_type:'application/pdf',ocr:'OCR_SECRET'})]})],[],[],now)));
});
test('validated OCR counts toward the full UTF8 handoff budget at exactly 1MiB and one byte over',()=>{
 const row=note(n,{attachments:budgetPhotos()}),last=row.attachments.at(-1);
 last.ocr.text='x';
 const remainingBytes=1048576-Buffer.byteLength(buildHandoff([row],[],[],now))+1;
 assert.ok(remainingBytes>0&&remainingBytes<=65536);
 last.ocr.text='😀'.repeat(Math.floor(remainingBytes/4))+['','x','é','字'][remainingBytes%4];
 assert.ok([...last.ocr.text].length<=16384);
 assert.equal(Buffer.byteLength(buildHandoff([row],[],[],now)),1048576);
 assert.throws(()=>buildHandoff([{...row,raw_text:row.raw_text+'x'}],[],[],now),/1MiB/);
 const linksOnly=row.attachments.map(({ocr,...file})=>file);
 assert.ok(Buffer.byteLength(buildHandoff([{...row,attachments:linksOnly}],[],[],now))<1048576);
});
test('explicit current-note handoff retains OCR and exact microsecond version on an older linked note',async()=>{
 const updated_at='2026-10-11T01:02:03.123456+00:00',opened=note(n,{occurred_at:'2025-10-01T01:00:00Z',updated_at,attachments:[photo({ocr:photoOcr({state:'failed',cleanup_state:'delete_failed'})})]});
 const rt={context:{read:()=>({workspace:{id:'w'},user:{id:'owner'}})},api:async path=>path.includes('app_notes?')?[opened,note('other')]:path.includes('app_record_links?')?[{note_id:n,status:'confirmed'}]:[]};
 installCatalog(rt);
 const text=await readHandoff(rt,now,{noteId:n});
 assert.ok(text.includes('updated_at: '+updated_at));assert.ok(text.includes('사진에서 읽은 글 · photo.jpg\n'+opened.attachments[0].ocr.text));assert.ok(!text.includes('메모 ID: other'));
});
test('malformed or over-budget OCR rejects promised clipboard data without partial replacement',async t=>{
 for(const [name,row] of [['malformed',note(n,{attachments:[photo({ocr:null})]})],['over-budget',note(n,{attachments:budgetPhotos()})]])await t.test(name,async()=>{
  await withPromiseClipboard(async()=>{
   let clipboard='previous clipboard',item;
   navigator.clipboard.write=async entries=>{item=entries[0];const blob=await item.data['text/plain'];clipboard=await blob.text();};
   const h=handoffHarness({rows:[row]});await h.handoff.copy();
   await assert.rejects(item.data['text/plain']);assert.equal(clipboard,'previous clipboard');assert.equal(h.input.value,'');assert.equal(h.fallback.hidden,true);assert.equal(h.busy,false);
  });
 });
});

// BASKET-분류중복·변화반영 ①: existing-record block (synthetic strings only).
import {selectExistingRecords, EXISTING_LIMITS} from '../app/basket-ai-handoff.js';
const dest=[{kind:'organization',id:n},{kind:'project',id:p}];
const rec=(i,day,extra={})=>({id:`50000000-0000-4000-8000-${String(i).padStart(12,'0')}`,summary:`합성 요약 ${i}`,raw_text:'합성 원문',organization_id:n,project_id:null,occurred_at:`2026-10-${String(day).padStart(2,'0')}T01:00:00Z`,...extra});
test('existing records: newest 5 per destination, 28 days, summary then original, 200 chars',()=>{
 const rows=[...Array.from({length:7},(_,i)=>rec(i+1,i+1)),rec(20,1,{organization_id:null,project_id:p,summary:null,raw_text:'가'.repeat(300)}),rec(21,1,{occurred_at:'2026-09-01T00:00:00Z'}),rec(22,2,{organization_id:'other'})];
 const out=selectExistingRecords(rows,dest,now);
 assert.deepEqual(out.filter(r=>r.kind==='organization').map(r=>r.text),['합성 요약 7','합성 요약 6','합성 요약 5','합성 요약 4','합성 요약 3']);
 const fromOriginal=out.find(r=>r.kind==='project');assert.equal([...fromOriginal.text].length,EXISTING_LIMITS.chars);
 assert.ok(!out.some(r=>r.id.endsWith('21')||r.id.endsWith('22')));
});
test('existing records block appears in the request; absent records leave the request unchanged',()=>{
 const rows=[note()],plain=buildHandoff(rows,[{id:p,name:'합성 프로젝트'}],[{id:n,name:'합성 담당조직'}],now);
 assert.ok(!plain.includes('기존 기록'));
 const existing=selectExistingRecords([rec(1,5),rec(2,6)],dest,now);
 const text=buildHandoff(rows,[{id:p,name:'합성 프로젝트'}],[{id:n,name:'합성 담당조직'}],now,false,existing);
 assert.ok(text.startsWith(plain.slice(0,200)));
 for(const s of ['기존 기록 (','기록 ID: '+existing[0].id,'2026-10-06','합성 요약 2','compared_link_ids','duplicate','changed','후속: ',`organization · ${n}`])assert.ok(text.includes(s),s);
});
test('existing records over the total cap are cut oldest first',()=>{
 const big=Array.from({length:120},(_,i)=>rec(i+1,1+(i%9),{organization_id:null,project_id:`60000000-0000-4000-8000-${String(i).padStart(12,'0')}`,summary:'나'.repeat(200)}));
 const ds=big.map(r=>({kind:'project',id:r.project_id}));
 const out=selectExistingRecords(big,ds,now);
 const bytes=out.reduce((s,r)=>s+Buffer.byteLength(`기록 ID: ${r.id} · 0000-00-00 · ${r.text}`)+2,0);
 assert.ok(out.length<big.length&&bytes<=EXISTING_LIMITS.bytes+out.length*8);
 const dropped=big.filter(r=>!out.some(o=>o.id===r.id));
 assert.ok(dropped.every(d=>out.every(o=>Date.parse(o.occurred_at)>=Date.parse(d.occurred_at))));
});
// TEST-바구니담당조직: a token refresh writes the session again for the same owner (kptu:session-changed). While the catalog had
// nothing published yet, that event reset it and the handoff's in-flight catalog read came back empty ("업무 공간이 바뀌었어요").
// A refresh for the same owner keeps the read; a new owner or sign-out still drops it.
test('catalog read in flight survives a same-owner session refresh, not an owner change',async()=>{
 const listeners=[],pending=[];
 const rt={api:()=>new Promise(resolve=>pending.push(resolve))};
 globalThis.window={addEventListener(type,fn){if(type==='kptu:session-changed')listeners.push(fn);},dispatchEvent(){},KPTURuntime:rt};
 vm.runInNewContext(readFileSync(new URL('../app/project-catalog.js',import.meta.url),'utf8').replace(/^import .*\n/gm,''),{...projectRules,...orderRules,window:globalThis.window,CustomEvent:class {}});
 const catalog=globalThis.window.KPTUProjectCatalog,session=id=>listeners.forEach(fn=>fn({detail:{session:id?{user:{id}}:null}}));
 const rows=[{id:p,name:'합성 프로젝트',status:'active',metadata:{project_system:'v2'}}];
 let read=catalog.load({workspaceId:'w',userId:'u',force:true});session('u');pending.shift()(rows);
 let result=await read;assert.equal(result.workspaceId,'w');assert.equal(result.userId,'u');assert.equal(result.loaded,true);
 session('u');assert.equal(catalog.snapshot().workspaceId,'w');
 read=catalog.load({workspaceId:'w',userId:'u',force:true});session('v');pending.shift()(rows);
 result=await read;assert.equal(result.workspaceId,null);assert.equal(result.loaded,false);
 catalog.publish({workspaceId:'w',userId:'u',spaces:rows});session(null);assert.equal(catalog.snapshot().loaded,false);
 read=catalog.load({workspaceId:'w',userId:'u',force:true});session(null);pending.shift()(rows);
 assert.equal((await read).loaded,false);
});
