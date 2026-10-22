import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmLinks} from '../app/basket-classification.js';
const rtFor = api => ({context:{read:()=>({user:{id:'owner'},workspace:{id:'workspace'}})},api});
test('confirmation explicitly carries approved summary and preserves legacy omission',async()=>{
  const calls=[],rt=rtFor(async(path,options)=>{calls.push(options.body);return {ok:true};});
  await confirmLinks('note','2026-10-12T00:00:00Z',[{kind:'organization',target_id:'org',reason:'AI reason',summary:' \n승인한 요약 😀\n '}],rt);
  assert.equal(calls[0].p_targets[0].summary,' \n승인한 요약 😀\n ');
  await confirmLinks('note','2026-10-12T00:00:00Z',[{kind:'project',target_id:'project',reason:'old reason'}],rt);
  assert.equal(Object.hasOwn(calls[1].p_targets[0],'summary'),false);
});
test('shared records module supplies summary validation and RPC-only editing',async()=>{
  const module=await import('../app/basket-link-records.js');
  for(const value of ['', '\u0085\u00a0\u1680\u2000\u2028\u202f\u205f\u3000\ufeff', '😀'.repeat(2001),'\0', '\ud800'])assert.throws(()=>module.validateLinkSummary(value));
  assert.equal(module.validateLinkSummary('😀'.repeat(2000)),'😀'.repeat(2000));
  assert.equal(module.validateLinkSummary(' \n기록\n '),' \n기록\n ');
  const calls=[],rt=rtFor(async(path,options)=>{calls.push({path,...options});return {ok:false,error:'SUMMARY_CHANGED'};});
  assert.deepEqual(await module.updateLinkSummary('link',null,'초안',rt),{ok:false,error:'SUMMARY_CHANGED'});
  assert.deepEqual(calls[0],{path:'/rest/v1/rpc/app_basket_update_link_summary',method:'POST',body:{p_link_id:'link',p_expected_summary:null,p_summary:'초안'}});
  await module.updateLinkSummary('link',' \n이전\n ','새 요약',rt);
  assert.equal(calls[1].body.p_expected_summary,' \n이전\n ');
});
test('record query scopes workspace, confirmed note sources and paginates instead of truncating',async()=>{
  const {readLinkRecords}=await import('../app/basket-link-records.js'),calls=[];
  const row=i=>({id:String(i),workspace_id:'workspace',summary:i===0?null:'합성 요약',note_id:'n'+i,organization_id:'org',status:'confirmed',note:{id:'n'+i,workspace_id:'workspace',occurred_at:'2026-10-12T00:00:00Z',raw_text:'보관된 AI 제외 원문'}});
  const rt=rtFor(async(path)=>{calls.push(path);const q=new URL(path,'http://fixture').searchParams;return Number(q.get('offset'))===0?Array.from({length:100},(_,i)=>row(i)):[row(100),{...row(101),note_id:null},{...row(102),status:'suggested'},{...row(103),workspace_id:'other'},{...row(104),project_id:'project',organization_id:null}];});
  const result=await readLinkRecords({kind:'organization',targetIds:['org'],weekStart:'2026-10-11T15:00:00Z',weekEnd:'2026-10-18T15:00:00Z'},rt);
  assert.equal(result.length,101);assert.equal(result[0].summary,null);assert.equal(result[0].raw_text,'보관된 AI 제외 원문');
  assert.equal(calls.length,2);
  const q=new URL(calls[0],'http://fixture').searchParams;
  assert.equal(q.get('workspace_id'),'eq.workspace');assert.equal(q.get('status'),'eq.confirmed');assert.equal(q.get('note_id'),'not.is.null');assert.equal(q.get('organization_id'),'in.(org)');assert.equal(q.get('note.kind'),'eq.basket');
  assert.match(q.get('select'),/summary/);assert.match(q.get('select'),/app_notes!inner/);assert.equal(q.getAll('note.occurred_at').length,2);
  assert.doesNotMatch(calls.join(''),/archived_at|ai_export_allowed/);
});
test('read failures and late cross-workspace responses never become empty successes',async()=>{
  const {readLinkRecords,readRecordPages}=await import('../app/basket-link-records.js');
  await assert.rejects(readLinkRecords({kind:'project',targetIds:['p']},rtFor(async()=>{throw {status:403};})));
  await assert.rejects(readRecordPages('/rest/v1/table?select=id',rtFor(async()=>({error:'denied'}))));
  let workspace='old';const rt={context:{read:()=>({user:{id:'owner'},workspace:{id:workspace}})},api:async()=>{workspace='new';return [];}};
  await assert.rejects(readLinkRecords({kind:'project',targetIds:['p']},rt),/바뀌/);
});
test('cleared explicit runtime context cannot fall back to a previous boot owner',async()=>{
  const {readLinkRecords}=await import('../app/basket-link-records.js'),previous=globalThis.window;
  const boot={user:{id:'owner'},workspace:{id:'workspace'}};let context=boot;
  globalThis.window={__KPTU_BOOT_CONTEXT__:boot};
  const rt={context:{read:()=>context},api:async()=>{context=null;return [];}};
  try{await assert.rejects(readLinkRecords({kind:'organization',targetIds:['org']},rt),/바뀌/);await assert.rejects(readLinkRecords({kind:'organization',targetIds:['org']},rt),/바뀌/);}finally{globalThis.window=previous;}
});
test('update failures distinguish absence, permissions, missing feature and uncertain transport',async()=>{
  const {updateLinkSummary}=await import('../app/basket-link-records.js');
  for(const [error,code] of [[{status:404,message:'PGRST202'},'FUNCTION_UNAVAILABLE'],[{status:403},'PERMISSION_DENIED'],[{status:500},'RESULT_UNKNOWN']])assert.equal((await updateLinkSummary('link',null,'요약',rtFor(async()=>{throw error;}))).error,code);
  assert.equal((await updateLinkSummary('link',null,'요약',rtFor(async()=>({ok:false,error:'NOT_FOUND'})))).error,'NOT_FOUND');
});

test('organization date projection shares confirmed owner/workspace checks without reading original or summary',async()=>{
 const {readLinkRecords}=await import('../app/basket-link-records.js'),calls=[];
 const row={id:'l',workspace_id:'workspace',summary:'must not return',note_id:'n',organization_id:'org',status:'confirmed',note:{id:'n',workspace_id:'workspace',occurred_at:'2026-10-12T01:00:00Z',raw_text:'must not return'}};
 const result=await readLinkRecords({kind:'organization',targetIds:['org'],dateOnly:true},rtFor(async path=>{calls.push(path);return [row,{...row,id:'foreign',workspace_id:'other'},{...row,id:'suggested',status:'suggested'}];}));
 assert.equal(result.length,1);assert.equal(result[0].occurred_at,row.note.occurred_at);assert.equal(Object.hasOwn(result[0],'raw_text'),false);assert.equal(Object.hasOwn(result[0],'summary'),false);
 const q=new URL(calls[0],'http://fixture').searchParams;assert.doesNotMatch(q.get('select'),/raw_text|summary/);assert.equal(q.get('workspace_id'),'eq.workspace');assert.equal(q.get('note.workspace_id'),'eq.workspace');assert.equal(q.get('status'),'eq.confirmed');assert.equal(q.get('note_id'),'not.is.null');
});
test('a note without a written summary shows its opening text: whitespace collapsed, 120 characters, ellipsis only when cut',async()=>{
  const {noteExcerpt,isBlankLinkSummary,linkRecordHtml}=await import('../app/basket-link-records.js');
  assert.equal(noteExcerpt('10/20 기자회견\n장소: 본사 앞\n\n참석 30명'),'10/20 기자회견 장소: 본사 앞 참석 30명');
  assert.equal(noteExcerpt('가'.repeat(120)),'가'.repeat(120));
  assert.equal(noteExcerpt('가'.repeat(121)),'가'.repeat(120)+'…');
  assert.equal(noteExcerpt(null),'');
  assert.equal(isBlankLinkSummary(' \n'),true);assert.equal(isBlankLinkSummary(null),true);assert.equal(isBlankLinkSummary('글'),false);
  const html=linkRecordHtml({id:'l',note_id:'n',organization_id:'o',project_id:null,occurred_at:'2026-10-20T01:00:00Z',summary:null,raw_text:'<b>본문</b> 앞부분'});
  // BUG-미리보기기호: the line shows plain letters; the written text stays escaped in data-md-raw (never a live <b>).
  assert.match(html,/data-link-summary-text data-md-raw="&lt;b&gt;본문&lt;\/b&gt; 앞부분">본문 앞부분<\/p>/);
  assert.doesNotMatch(html,/<b>/);
  assert.doesNotMatch(html,/요약 없음/);
});
// UI-엔터저장: the summary box now follows the shared rule (app/enter-save.js; Ctrl/Cmd+Enter saves on PC, Enter and
// Shift+Enter are new lines, a composing Enter is ignored). Its cases moved to tests/enter-save.test.mjs.
test('UI-연결요약수정: Ctrl/Cmd+Enter saves, plain or Shift+Enter is a new line, IME composition Enter is ignored',async()=>{
  const {SUMMARY_BLANK_TEXT}=await import('../app/basket-link-records.js');
  const {enterAction}=await import('../app/enter-save.js');
  const key=(o={})=>({key:'Enter',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,isComposing:false,keyCode:13,...o});
  assert.equal(enterAction(key({ctrlKey:true}),'multi'),true);
  assert.equal(enterAction(key({metaKey:true}),'multi'),true);
  for(const o of [{},{shiftKey:true},{ctrlKey:true,shiftKey:true},{ctrlKey:true,altKey:true},{ctrlKey:true,isComposing:true},{ctrlKey:true,keyCode:229},{ctrlKey:true,key:'a'}])assert.equal(enterAction(key(o),'multi'),false,JSON.stringify(o));
  assert.match(SUMMARY_BLANK_TEXT,/준비 중/);
});
