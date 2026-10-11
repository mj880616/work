import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {buildHandoff, selectHandoffNotes, readHandoff, mountHandoff} from '../app/basket-ai-handoff.js';
import {parseAIAnswer, classificationFormat, ERROR_TEXT} from '../app/basket-classification.js';
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
 const text=buildHandoff(rows,[{id:n,name:'합성 담당조직'}],now);
 for(const required of [rows[0].raw_text,n,stamp,'議事.pdf','application/pdf','https://drive.google.com/file/d/synthetic-drive/view','합성 담당조직',"AI 정리 결과 넣기",'블록이 기준'])assert.ok(text.includes(required),required);
 for(const excluded of ['ATTACHMENT_BODY','OCR_SECRET','size_bytes','google_task','write_request_candidate','library','project','합성 프로젝트'])assert.ok(!text.includes(excluded),excluded);
 const format=classificationFormat(now);const block=/```json\n([\s\S]*?)\n```/.exec(format)[1];
 const sample=JSON.parse(block);sample.items=proposal().items;assert.deepEqual(parseAIAnswer('사람 정리\n```json\n'+JSON.stringify(sample)+'\n```'),sample);
});
test('answer accepts exactly one supported fence and ignores outside markup',()=>{
 const json=JSON.stringify(proposal());
 for(const lang of ['json',''])assert.deepEqual(parseAIAnswer('<script>throw 1</script>\n```'+lang+'\n'+json+'\n```\n<img onerror=alert(1)>'),proposal());
 for(const answer of [json,'설명만','```json\n'+json+'\n```\n```\n'+json+'\n```','```json\n'+json+'\n```\n~~~json\n'+json+'\n~~~','```html\n'+json+'\n```','```json\n'+json])assert.throws(()=>parseAIAnswer(answer),/AI 답에서 복사용 블록만 넣어 주세요/);
});
test('stale handoff completion cannot release a new operation busy lock',async()=>{
 const previous=globalThis.window,listeners=new Map();let workspaceId='old',release,sharedBusy=false;
 const pending=new Promise(resolve=>release=resolve);
 globalThis.window={addEventListener:(type,fn)=>listeners.set(type,fn),KPTUProjectCatalog:{load:async({workspaceId,userId})=>({workspaceId,userId,tree:[]})}};
 const rt={context:{read:()=>({workspace:{id:workspaceId},user:{id:'u'}})},api:async path=>path.includes('app_notes')?(await pending,[note()]):[]};
 const status={textContent:''},fallback={hidden:true},input={value:''};
 const host={set innerHTML(value){},querySelector:selector=>selector==='textarea'?input:selector==='label'?fallback:status};
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
  assert.throws(()=>parseAIAnswer('```json\n'+bad+'\n```'),e=>! /JSON|schema|UUID|workspace|행 \d|열 \d|unknown|bad-id/.test(e.message));
 }
 assert.throws(()=>parseAIAnswer('```json\n'+json+'\n```'+' '.repeat(1048576)),/글이 너무 길어요/);
 for(const message of Object.values(ERROR_TEXT))assert.doesNotMatch(message,/JSON|schema|UUID|workspace|\(행|4b|확정/);
});
test('wrapper retains item, destination, reason, depth and duplicate-key rejection',()=>{
 const fenced=value=>'```json\n'+JSON.stringify(value)+'\n```';
 let value=proposal();value.items=Array.from({length:101},()=>value.items[0]);assert.throws(()=>parseAIAnswer(fenced(value)),/100/);
 value=proposal();value.items[0].destinations=Array.from({length:21},()=>value.items[0].destinations[0]);assert.throws(()=>parseAIAnswer(fenced(value)),/20/);
 value=proposal();value.items[0].destinations[0].reason='가'.repeat(2001);assert.throws(()=>parseAIAnswer(fenced(value)),/2,000/);
 assert.throws(()=>parseAIAnswer('```json\n'+('['.repeat(10))+'0'+(']'.repeat(10))+'\n```'),/내용이 맞지/);
 assert.throws(()=>parseAIAnswer(fenced(proposal()).replace('"kind":"project"','"kind":"project","\\u006bind":"project"')),/내용이 맞지/);
});
test('destination read includes every scoped organization and never calls the project catalog',async()=>{
 const previous=globalThis.window;
 globalThis.window={addEventListener(){},dispatchEvent(){},KPTUProjectCatalog:{load(){assert.fail('project catalog must not be called');}}};
 const paths=[];
 const rt={context:{read:()=>({workspace:{id:'w'},user:{id:'u'}})},api:async path=>{
  paths.push(path);const url=new URL(path,'http://test');
  if(path.includes('app_notes'))return [note()];
  if(path.includes('app_record_links'))return [];
  if(path.includes('app_spaces'))return [
   {id:p,name:'가능한 프로젝트',metadata:{project_system:'v2'}},
   {id:'child',name:'하위 프로젝트',parent_id:p},
   {id:'archive',name:'보관 프로젝트',status:'archived',metadata:{project_system:'v2'}},
   {id:'hidden-child',name:'보관 아래 숨김',parent_id:'archive'},
   {id:'legacy',name:'옛 공간'}];
  if(path.includes('app_suborganizations'))return url.searchParams.get('offset')==='0'?Array.from({length:100},(_,i)=>({id:'org'+i,name:'담당조직 '+i})):[{id:'org-last',name:'마지막 담당조직'}];
 }};
 globalThis.window.KPTURuntime=rt;
 try{
  const text=await readHandoff(rt,now);
  for(const label of ['담당조직 0','담당조직 99','마지막 담당조직'])assert.ok(text.includes(label));
  for(const label of ['가능한 프로젝트','하위 프로젝트','보관 프로젝트','보관 아래 숨김','옛 공간'])assert.ok(!text.includes(label));
  assert.ok(!paths.some(p=>new URL(p,'http://test').pathname.endsWith('/app_spaces')));
  assert.doesNotMatch(readFileSync(new URL('../app/basket-ai-handoff.js',import.meta.url),'utf8'),/project-catalog|KPTUProjectCatalog/);
  assert.ok(paths.filter(p=>p.includes('app_suborganizations')).every(p=>p.includes('workspace_id=eq.w')));
  paths.length=0;rt.api=async path=>{paths.push(path);return [];};assert.equal(await readHandoff(rt,now),'');assert.ok(!paths.some(p=>p.includes('app_spaces')||p.includes('app_suborganizations')));
 }finally{globalThis.window=previous;}
});

test('handoff example and organization proposal both round trip; legacy project replies remain accepted',()=>{
 const format=classificationFormat(now);
 assert.doesNotMatch(format,/project|library|google_task|write_request_candidate/);
 assert.match(format,/kind는 organization\(담당조직\)만 쓰세요/);
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
 await assert.rejects(readHandoff(rt,now),/업무 공간이 바뀌었어요/);
});
