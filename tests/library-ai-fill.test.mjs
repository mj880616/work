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

// ---- LIB-정리제안화면: 정리 제안 화면용 순수 함수 ----
const DOC=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const nameOf=v=>({'기타':'기타','회의자료':'회의'}[v]||v);

test('tidyValueText: empty is (빈 칸), a title equal to the file name is (파일 이름 그대로), category shows its name, date is dotted',()=>{
  const doc={file_name:'2026_임단협_요구안.hwp'};
  assert.equal(m.tidyValueText('date',null,doc),'(빈 칸)');
  assert.equal(m.tidyValueText('source','  ',doc),'(빈 칸)');
  assert.equal(m.tidyValueText('title','2026 임단협 요구안',doc),'(파일 이름 그대로)');
  assert.equal(m.tidyValueText('title','2026년 임단협 요구안',doc),'2026년 임단협 요구안');
  assert.equal(m.tidyValueText('category','회의자료',doc,{categoryName:nameOf}),'회의');
  assert.equal(m.tidyValueText('document_date','2026-03-14',doc),'2026.03.14');
  assert.equal(m.tidyValueText('document_date','모름',doc),'모름');
});

test('groupTidyProposals: groups per document in list order, drops unknown documents, shows display text, keeps markup as plain text',()=>{
  const docs=[{id:DOC(1),file_name:'a.pdf',title:'a'},{id:DOC(2),file_name:'b.hwp',title:'b'},{id:DOC(3),file_name:'c.pdf',title:'c'}];
  const rows=m.groupTidyProposals([
    {document_id:DOC(2),field:'category',from:'기타',to:'회의자료'},
    {document_id:DOC(1),field:'title',from:'a',to:'<img src=x onerror=alert(1)>'},
    {document_id:DOC(1),field:'document_date',from:null,to:'2026-03-14'},
    {document_id:DOC(9),field:'title',from:null,to:'모르는 자료'},
  ],docs,{categoryName:nameOf});
  assert.deepEqual(rows.map(r=>[r.id,r.name,r.items.length]),[[DOC(1),'a.pdf',2],[DOC(2),'b.hwp',1]]);
  assert.deepEqual(rows[0].items[0],{field:'title',label:'제목',from:'(파일 이름 그대로)',to:'<img src=x onerror=alert(1)>'});
  assert.deepEqual(rows[0].items[1],{field:'document_date',label:'날짜',from:'(빈 칸)',to:'2026.03.14'});
  assert.deepEqual(rows[1].items[0],{field:'category',label:'분류',from:'기타',to:'회의'});
});

test('buildTidyProposals for the screen: progress, remaining ids after a limit, stop code, stopOnError, no save kind',async()=>{
  const ids=Array.from({length:25},(_,i)=>DOC(i+1));
  const sent=[],progress=[];
  const call=async body=>{
    sent.push(body);
    if(sent.length===2)return {ok:false,code:'daily_limit'};
    return {ok:true,data:{proposals:[{document_id:body.document_ids[0],field:'title',from:null,to:'제목'}]}};
  };
  const r=await m.buildTidyProposals(ids,{rt:{api:async()=>({})},call,readFirst:false,onProgress:(d,t)=>progress.push([d,t])});
  assert.deepEqual(sent.map(b=>[b.kind,b.mode]),[['library_fill','propose'],['library_fill','propose']]); // stops after the limit: batch 3 never sent
  assert.deepEqual(progress,[[10,25]]);
  assert.equal(r.stop,'daily_limit');
  assert.equal(r.done,10);
  assert.deepEqual(r.remaining,ids.slice(10));
  assert.equal(r.proposals.length,1);
  // a non-limit failure continues by default but stops with stopOnError
  const calls=[];
  const flaky=async body=>{calls.push(body);return {ok:false,code:'ai_busy'};};
  const a=await m.buildTidyProposals(ids,{rt:{api:async()=>({})},call:flaky,readFirst:false});
  assert.equal(calls.length,3);assert.equal(a.remaining.length,25);assert.equal(a.stop,null);
  calls.length=0;
  const b=await m.buildTidyProposals(ids,{rt:{api:async()=>({})},call:flaky,readFirst:false,stopOnError:true});
  assert.equal(calls.length,1);assert.equal(b.stop,'ai_busy');assert.equal(b.remaining.length,25);
});

test('continue-search state: keeps received proposals, resumes only the remaining ids, ignores duplicates, error text and retryability',()=>{
  const ids=Array.from({length:15},(_,i)=>DOC(i+1));
  let st=m.startTidyState([...ids,ids[0],'not-an-id']);
  assert.equal(st.total,15);assert.equal(st.pending.length,15);assert.deepEqual(st.proposals,[]);
  const p1={document_id:DOC(1),field:'title',from:null,to:'가'};
  st=m.mergeTidyResult(st,{proposals:[p1],failed:[{ids:ids.slice(10),code:'daily_limit'}],remaining:ids.slice(10),stop:'daily_limit'});
  assert.deepEqual(st.pending,ids.slice(10));assert.equal(st.error,'daily_limit');assert.equal(st.proposals.length,1);
  st=m.mergeTidyResult(st,{proposals:[p1,{document_id:DOC(12),field:'category',from:'기타',to:'교섭'}],failed:[],remaining:[],stop:null});
  assert.equal(st.pending.length,0);assert.equal(st.error,null);assert.equal(st.proposals.length,2);
  assert.equal(m.tidyRetryable('daily_limit'),true);assert.equal(m.tidyRetryable('monthly_limit'),false);assert.equal(m.tidyRetryable('not_ready'),false);assert.equal(m.tidyRetryable('ai_busy'),true);
  assert.match(m.tidyErrorText('daily_limit'),/오늘/);assert.match(m.tidyErrorText('not_ready'),/아직 쓸 수 없/);assert.ok(m.tidyErrorText('zzz'));
});

test('tidy screen code: no storage, no document save, proposals are escaped when drawn',()=>{
  const src=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  const start=src.indexOf('let luTidy=null'),end=src.indexOf('function luRenderManageList');
  const block=src.slice(start,end);
  assert.ok(block.length>200);
  for(const bad of ['local'+'Storage','session'+'Storage','PATCH','method:','fetch(','indexed'+'DB'])assert.ok(!block.includes(bad),bad);
  assert.ok(/luEsc\(r\.name\)/.test(block)&&/luEsc\(i\.from\)/.test(block)&&/luEsc\(i\.to\)/.test(block)&&/luEsc\(i\.label\)/.test(block));
});
