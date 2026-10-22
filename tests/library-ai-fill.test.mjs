// LIB-AI자동분류: app/library-ai-fill.js (screen side). No network: the runtime and ai-assist call are stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const m=await import('../app/library-ai-fill.js');
const ID='e0000000-0000-4000-8000-000000000001';

test('keptFields: only fields typed at upload; a shared title is not kept for several files',()=>{
  assert.deepEqual(m.keptFields({title:' 내 제목 ',document_date:'',source:'국토부',category:''}),['title','source']);
  assert.deepEqual(m.keptFields({title:'내 제목',category:'교섭'},{multiple:true}),['category']);
  assert.deepEqual(m.keptFields({}),[]);
});

test('originAfterEdit: edited AI fields become user; other records stay; old DB without the column sends nothing',()=>{
  assert.deepEqual(m.originAfterEdit({field_origin:{title:'ai',category:'ai'}},['title','tags','project_id']),{title:'user',category:'ai'});
  assert.deepEqual(m.originAfterEdit({field_origin:{}},['category','document_date']),{category:'user',document_date:'user'});
  assert.equal(m.originAfterEdit({title:'x'},['title']),null);
  // Same key order as jsonb returns, so the edit save check compares equal.
  assert.deepEqual(Object.keys(m.originAfterEdit({field_origin:{document_date:'ai'}},['title','source','category'])),['title','source','category','document_date']);
});

test('fillLibraryDocument: reads text first, then one fill call; never throws; refreshes the list only when something changed',async()=>{
  const calls=[],events=[];
  globalThis.window={dispatchEvent:e=>events.push(e.type)};globalThis.CustomEvent=class{constructor(type){this.type=type}};
  const rt={api:async(path,o)=>{calls.push(['api',path,o.body]);return {ok:true}}};
  const call=async body=>{calls.push(['ai',body]);return {ok:true,data:{ok:true,kind:'library_fill',updated:1}}};
  assert.deepEqual(await m.fillLibraryDocument(ID,{keep:['title','project_id'],rt,call}),{ok:true,updated:1});
  assert.deepEqual(calls,[['api','/functions/v1/document-actions',{action:'document-text',document_id:ID}],['ai',{kind:'library_fill',mode:'fill',document_ids:[ID],keep:['title']}]]);
  assert.deepEqual(events,['kptu:documents-changed']);
  // Text read failure still fills from the file name; AI failure is returned, not thrown.
  const failing={api:async()=>{throw Error('down')}};
  assert.deepEqual(await m.fillLibraryDocument(ID,{rt:failing,call:async()=>({ok:false,code:'ai_busy'})}),{ok:false,code:'ai_busy'});
  assert.deepEqual(await m.fillLibraryDocument('nope',{rt,call}),{ok:false,code:'invalid_request'});
  delete globalThis.window;delete globalThis.CustomEvent;
});

test('buildTidyProposals: batches of 10, keeps only well-formed proposals for sent ids, stops on limits; never saves',async()=>{
  const ids=Array.from({length:12},(_,i)=>`e0000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  const sent=[];
  const call=async body=>{sent.push(body);return {ok:true,data:{proposals:[{document_id:body.document_ids[0],field:'category',from:'기타',to:'교섭'},{document_id:'x',field:'title',to:'a'},{document_id:body.document_ids[0],field:'project_id',to:'p'}]}}};
  const r=await m.buildTidyProposals(ids,{rt:{api:async()=>({})},call,readFirst:false});
  assert.deepEqual(sent.map(b=>[b.mode,b.document_ids.length]),[['propose',10],['propose',2]]);
  assert.deepEqual(r.proposals,[{document_id:ids[0],field:'category',from:'기타',to:'교섭'},{document_id:ids[10],field:'category',from:'기타',to:'교섭'}]);
  const limited=await m.buildTidyProposals(ids,{rt:{api:async()=>({})},call:async()=>({ok:false,code:'daily_limit'}),readFirst:false});
  assert.equal(limited.failed.length,1);
});

test('no AI marker reaches the library screen (사용자 결정 ③)',()=>{
  const src=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  for(const marker of ['field_origin==','field_origin?.','AI가 채움','AI 채움','data-ai','✨'])assert.ok(!src.includes(marker),marker);
  // The only field_origin use is the hidden record sent with an edit save.
  assert.equal(src.match(/field_origin/g)?.length,1);
});
