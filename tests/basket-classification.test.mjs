import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClassification, previewClassification, confirmLinks, timestampKey } from '../app/basket-classification.js';
const n='10000000-0000-4000-8000-000000000001', p='20000000-0000-4000-8000-000000000001', w='30000000-0000-4000-8000-000000000001';
const stamp='2026-10-11T01:02:03.123456Z';
const proposal=()=>({schema_version:1,copied_at:stamp,items:[{note_id:n,note_updated_at:stamp,destinations:[{kind:'project',target_id:p,reason:'<img src=x onerror=alert(1)> https://example.org'}]}]});
const snapshot=()=>({workspaceId:w,userId:'owner',notes:[{id:n,workspace_id:w,raw_text:' 현재 원문\n ',updated_at:stamp,ai_export_allowed:true}],links:[],projects:[{id:p,workspace_id:w,owner_id:'owner',name:'현재 프로젝트',metadata:{project_system:'v2'}}],organizations:[]});
test('strict canonical JSON and a single fenced JSON block preserve text',()=>{
 const json=JSON.stringify(proposal()); assert.deepEqual(parseClassification(json),proposal());
 assert.deepEqual(parseClassification('```json\n'+json+'\n```'),proposal());
 assert.throws(()=>parseClassification('설명\n'+json),/행.*열/);
 assert.throws(()=>parseClassification(json+'\n설명'),/행.*열/);
});
test('reject duplicate and unknown keys, kind, UUID, date and invalid Unicode',()=>{
 const json=JSON.stringify(proposal());
 for(const text of [json.replace('"schema_version":1','"schema_version":1,"schema_version":1'),json.replace('"kind":"project"','"kind":"project","\\u006bind":"project"'),json.replace('"schema_version":1','"schema_version":2'),json.replace('"reason":','"owner":"forged","reason":'),json.replace('project','unknown'),json.replace(n,'not-uuid'),json.replaceAll(stamp,'2026-02-30T01:02:03Z'),json.replaceAll(stamp,'2026-10-11'),json.replaceAll(stamp,'2026-10-11T01:02:03+25:00'),json.replace('https://example.org','\\ud800'),json.replace('https://example.org','\\u0000')]) assert.throws(()=>parseClassification(text),/행.*열/);
});
test('UTF-8, item, destination, reason and nesting caps reject without truncation',()=>{
 assert.throws(()=>parseClassification(' '.repeat(1048577)),/1 MiB/);
 let data=proposal();data.items=Array.from({length:101},()=>data.items[0]);assert.throws(()=>parseClassification(JSON.stringify(data)),/100/);
 data=proposal();data.items[0].destinations=Array.from({length:21},()=>data.items[0].destinations[0]);assert.throws(()=>parseClassification(JSON.stringify(data)),/20/);
 data=proposal();data.items[0].destinations[0].reason='가'.repeat(2001);assert.throws(()=>parseClassification(JSON.stringify(data)),/2,000/);
 assert.throws(()=>parseClassification('['.repeat(10)+'0'+']'.repeat(10)),/중첩/);
});
test('timestamps compare exact instants including microseconds and timezone offsets',()=>{
 assert.equal(timestampKey(stamp),timestampKey('2026-10-11T10:02:03.123456+09:00'));
 assert.notEqual(timestampKey(stamp),timestampKey('2026-10-11T01:02:03.123457Z'));
});
test('preview uses live text and name; all stale/ineligible rows are unselectable',()=>{
 const data=proposal(), snap=snapshot();const row=previewClassification(data,snap)[0];
 assert.equal(row.note.raw_text,' 현재 원문\n ');assert.equal(row.destinations[0].name,'현재 프로젝트');assert.equal(row.destinations[0].error,null);
 for(const [change,code] of [[s=>s.notes=[], 'NOTE_MISSING'],[s=>s.notes[0].workspace_id='other','NOTE_WORKSPACE'],[s=>s.notes[0].archived_at=stamp,'NOTE_ARCHIVED'],[s=>s.notes[0].ai_export_allowed=false,'AI_EXCLUDED'],[s=>s.notes[0].updated_at='2026-10-11T01:02:03.123457Z','NOTE_CHANGED'],[s=>s.projects=[],'TARGET_MISSING'],[s=>s.projects[0].workspace_id='other','TARGET_WORKSPACE'],[s=>s.projects[0].status='archived','TARGET_UNSELECTABLE'],[s=>s.projects[0].metadata={},'TARGET_UNSELECTABLE'],[s=>s.projects[0].owner_id='other-owner','TARGET_UNSELECTABLE'],[s=>s.links=[{note_id:n,project_id:p,status:'confirmed'}],'ALREADY_CONFIRMED']]){
 const s=snapshot();change(s);assert.equal(previewClassification(data,s)[0].destinations[0].error,code);
 }
 const s=snapshot();s.projects.push({id:'parent',workspace_id:w,owner_id:'owner',status:'archived',metadata:{project_system:'v2'}});s.projects[0].parent_id='parent';assert.equal(previewClassification(data,s)[0].destinations[0].error,'TARGET_UNSELECTABLE');
});
test('known 4b kinds preview as disabled; organizations use current names',()=>{
 const data=proposal();for(const kind of ['library','write_request_candidate','google_task']){data.items[0].destinations[0].kind=kind;assert.equal(previewClassification(parseClassification(JSON.stringify(data)),snapshot())[0].destinations[0].error,'NEXT_STAGE');}
 const s=snapshot();s.organizations=[{id:p,workspace_id:w,name:'현재 조직'}];data.items[0].destinations[0].kind='organization';assert.equal(previewClassification(data,s)[0].destinations[0].name,'현재 조직');
});
test('confirm sends only typed note/version/selected targets and recognizes absent function',async()=>{
 const calls=[];const rt={api:async(path,options)=>{calls.push({path,...options});return {ok:true,created:1,existing:0};}};
 assert.equal((await confirmLinks(n,stamp,proposal().items[0].destinations,rt)).created,1);
 assert.deepEqual(Object.keys(calls[0].body),['p_note_id','p_note_updated_at','p_targets']);
 assert.equal(calls[0].path,'/rest/v1/rpc/app_basket_confirm_links');
 for(const error of [{status:404},{message:'Could not find the function public.app_basket_confirm_links in the schema cache'},{message:'function public.app_basket_confirm_links does not exist'}])assert.equal((await confirmLinks(n,stamp,[],{api:async()=>{throw error;}})).error,'FUNCTION_UNAVAILABLE');
 await assert.rejects(confirmLinks(n,stamp,[],{api:async()=>{throw Error('RLS denied');}}),/RLS/);
});
test('confirmed destination with a real link ID becomes exact previous-summary CAS candidate',()=>{
 for(const summary of [null,'  정확한 이전 요약\n ']){
  const s=snapshot();s.links=[{id:'40000000-0000-4000-8000-000000000001',note_id:n,project_id:p,status:'confirmed',summary}];
  const t=previewClassification(proposal(),s)[0].destinations[0];
  assert.equal(t.error,null);assert.equal(t.action,'update');assert.equal(t.linkId,s.links[0].id);assert.equal(t.expectedSummary,summary);
 }
});
test('new destination is a create candidate while another-workspace and unsupported kinds stay disabled',()=>{
 assert.equal(previewClassification(proposal(),snapshot())[0].destinations[0].action,'create');
 const s=snapshot();s.projects[0].workspace_id='other';assert.equal(previewClassification(proposal(),s)[0].destinations[0].error,'TARGET_WORKSPACE');
});
test('unsupported optional-ID kinds cannot inherit an existing project summary or action',()=>{
 const s=snapshot();s.links=[{id:'40000000-0000-4000-8000-000000000001',note_id:n,project_id:p,status:'confirmed',summary:'PRIVATE_EXISTING_PROJECT_SUMMARY'}];
 for(const kind of ['google_task','library']){
  const data=proposal();data.items[0].destinations=[{kind,reason:'미지원 제안'}];
  const target=previewClassification(parseClassification(JSON.stringify(data)),s)[0].destinations[0];
  assert.equal(target.error,'NEXT_STAGE');for(const key of ['action','summary','linkId','expectedSummary'])assert.equal(Object.hasOwn(target,key),false,key);
 }
});
