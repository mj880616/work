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

test('no AI marker reaches the library screen (사용자 결정 ③)',()=>{
  const src=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  for(const marker of ['field_origin==','field_origin?.','AI가 채움','AI 채움','data-ai','✨'])assert.ok(!src.includes(marker),marker);
  // The only field_origin use is the hidden record sent with an edit save.
  assert.equal(src.match(/field_origin/g)?.length,1);
});

// ---- LIB-자동정리: 자료실을 열 때 조용히 정리 안 된 칸만 서버에 맡긴다 ----
const DOC=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const CATS=['교섭','투쟁','교육','선전','정책','회의','기타'];
const NOW=Date.parse('2026-10-22T12:00:00Z'),OLD='2026-09-01T00:00:00Z',JUST='2026-10-22T11:50:00Z';
const row=(n,over={})=>({id:DOC(n),title:'2026_요구안',file_name:'2026_요구안.hwp',category:'기타',source:null,document_date:null,
  created_at:OLD,updated_at:OLD,field_origin:{},extraction_status:'ready',classification_note:'파일명 정돈 및 메타정보 기반 자동분류',...over});

test('untidyFields: only empty / file-name / 기타 / out-of-list fields; user and legacy-edited fields are never candidates',()=>{
  assert.deepEqual(m.untidyFields(row(1),CATS),['title','document_date','source','category']);
  assert.deepEqual(m.untidyFields(row(1,{title:'2026년 임금교섭 요구안',source:'공공운수노조',document_date:'2026-01-01',category:'교섭'}),CATS),[]);
  assert.deepEqual(m.untidyFields(row(1,{category:'회의자료'}),CATS).includes('category'),true);
  assert.deepEqual(m.untidyFields(row(1,{field_origin:{title:'user',category:'user'}}),CATS),['document_date','source']);
  assert.deepEqual(m.untidyFields(row(1,{classification_note:'사용자 수정'}),CATS),[]);
  assert.deepEqual(m.untidyFields(row(1,{classification_note:'사용자 입력 제목 · 메타정보 자동분류'}),CATS),['document_date','source','category']);
  // 'ai' fields that still look untidy stay candidates (the server decides again)
  assert.deepEqual(m.untidyFields(row(1,{field_origin:{source:'ai'},source:'국토부'}),CATS),['title','document_date','category']);
});

test('tidyCandidates: needs the field_origin column, skips just-uploaded, tried and already tidy documents',()=>{
  const docs=[row(1),row(2,{created_at:JUST}),row(3),row(4,{title:'정리됨',source:'a',document_date:'2026-01-01',category:'교섭'}),{...row(5),id:'bad'}];
  const {field_origin,...noColumn}=row(6);void field_origin;
  const out=m.tidyCandidates([...docs,noColumn],{tried:new Set([DOC(3)]),categories:CATS,now:NOW}).map(d=>d.id);
  assert.deepEqual(out,[DOC(1)]);
});

function fakeRt({tried=[],triedFails=false,textDelay=0,textLog=[]}={}){
  return {api:async(path,o)=>{
    if(path.startsWith('/rest/v1/app_library_tidy_attempts')){if(triedFails)throw Object.assign(new Error('missing'),{status:404});return tried.map(id=>({document_id:id}))}
    if(path==='/functions/v1/document-actions'){textLog.push({id:o.body.document_id,start:Date.now()});if(textDelay)await new Promise(r=>setTimeout(r,textDelay));return {ok:true}}
    throw new Error('unexpected '+path);
  }};
}

test('autoTidyLibrary: 10 per request, at most 3 requests per run, mode tidy with ids only, refreshes when something changed',async()=>{
  const docs=Array.from({length:45},(_,i)=>row(i+1));
  const sent=[];let changed=0;
  const call=async body=>{sent.push(body);return {ok:true,data:{ok:true,kind:'library_fill',mode:'tidy',updated:2}}};
  const r=await m.autoTidyLibrary(docs,{rt:fakeRt(),call,workspace:'ws',categories:CATS,now:NOW,onChanged:()=>changed++});
  assert.deepEqual(sent.map(b=>[b.kind,b.mode,b.document_ids.length,Object.keys(b).sort().join(',')]),
    [['library_fill','tidy',10,'document_ids,kind,mode'],['library_fill','tidy',10,'document_ids,kind,mode'],['library_fill','tidy',10,'document_ids,kind,mode']]);
  assert.deepEqual(r,{sent:30,updated:6,stop:null});assert.equal(changed,3);
});

test('autoTidyLibrary: a tried document is never sent again; nothing to do sends nothing',async()=>{
  const sent=[];const call=async body=>{sent.push(body);return {ok:true,data:{updated:0}}};
  await m.autoTidyLibrary([row(1),row(2)],{rt:fakeRt({tried:[DOC(1)]}),call,workspace:'ws',categories:CATS,now:NOW});
  assert.deepEqual(sent.map(b=>b.document_ids),[[DOC(2)]]);
  sent.length=0;
  await m.autoTidyLibrary([row(1),row(2)],{rt:fakeRt({tried:[DOC(1),DOC(2)]}),call,workspace:'ws',categories:CATS,now:NOW});
  assert.equal(sent.length,0);
});

test('autoTidyLibrary: stops quietly at the limit and on any failure; no retry; before the DB is ready nothing is called',async()=>{
  const docs=Array.from({length:25},(_,i)=>row(i+1));
  const sent=[];
  const r=await m.autoTidyLibrary(docs,{rt:fakeRt(),call:async b=>{sent.push(b);return {ok:false,code:'daily_limit'}},workspace:'ws',categories:CATS,now:NOW});
  assert.equal(sent.length,1);assert.equal(r.stop,'daily_limit');
  sent.length=0;
  const busy=await m.autoTidyLibrary(docs,{rt:fakeRt(),call:async b=>{sent.push(b);return {ok:false,code:'ai_busy'}},workspace:'ws',categories:CATS,now:NOW});
  assert.equal(sent.length,1);assert.equal(busy.stop,'ai_busy');
  sent.length=0;
  const notReady=await m.autoTidyLibrary(docs,{rt:fakeRt({triedFails:true}),call:async b=>{sent.push(b);return {ok:true,data:{}}},workspace:'ws',categories:CATS,now:NOW});
  assert.equal(sent.length,0);assert.equal(notReady.stop,'library_not_ready');
  const {field_origin,...old}=row(1);void field_origin;
  const noColumn=await m.autoTidyLibrary([old],{rt:fakeRt(),call:async b=>{sent.push(b);return {ok:true,data:{}}},workspace:'ws',categories:CATS,now:NOW});
  assert.equal(sent.length,0);assert.equal(noColumn.stop,'library_not_ready');
  // never throws
  const thrown=await m.autoTidyLibrary(docs,{rt:fakeRt(),call:async()=>{throw new Error('x')},workspace:'ws',categories:CATS,now:NOW});
  assert.equal(thrown.stop,'internal_error');
});

test('autoTidyLibrary: a stale scope (other workspace, sign-out, left the library) sends no further request',async()=>{
  const docs=Array.from({length:30},(_,i)=>row(i+1));
  let current=true;const sent=[];
  const call=async b=>{sent.push(b);current=false;return {ok:true,data:{updated:1}}};
  let changed=0;
  const r=await m.autoTidyLibrary(docs,{rt:fakeRt(),call,workspace:'ws',categories:CATS,now:NOW,isCurrent:()=>current,onChanged:()=>changed++});
  assert.equal(sent.length,1);assert.equal(r.stop,'stale');assert.equal(changed,0);
  sent.length=0;
  const none=await m.autoTidyLibrary(docs,{rt:fakeRt(),call,workspace:'ws',categories:CATS,now:NOW,isCurrent:()=>false});
  assert.equal(sent.length,0);assert.equal(none.stop,'invalid_request');
});

test('text reading: documents that already have text (ready or error) never call document-text; others 3 at a time; a slow one is not awaited past the limit',async()=>{
  const log=[];
  const sent=[];
  const docs=[row(1),row(2,{extraction_status:'error'}),...Array.from({length:6},(_,i)=>row(i+3,{extraction_status:'pending'}))];
  await m.autoTidyLibrary(docs,{rt:fakeRt({textLog:log}),call:async b=>{sent.push(b);return {ok:true,data:{updated:0}}},workspace:'ws',categories:CATS,now:NOW});
  assert.deepEqual(log.map(l=>l.id),docs.slice(2).map(d=>d.id));
  assert.deepEqual(sent[0].document_ids,docs.map(d=>d.id));
  // all-ready → zero document-text calls
  const none=[];
  await m.autoTidyLibrary([row(1),row(2)],{rt:fakeRt({textLog:none}),call:async()=>({ok:true,data:{}}),workspace:'ws',categories:CATS,now:NOW});
  assert.equal(none.length,0);
  // concurrency 3 and per-document time limit
  let active=0,peak=0;const limits=[];
  const slowRt={api:async(path,o)=>{limits.push(o.timeoutMs);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,30));active--;return {}}};
  await m.readTexts(Array.from({length:7},(_,i)=>row(i+1,{extraction_status:'pending'})),{rt:slowRt});
  assert.equal(peak,3);assert.deepEqual([...new Set(limits)],[m.TIDY_TEXT_TIMEOUT_MS]);assert.equal(m.TIDY_TEXT_TIMEOUT_MS,20000);
  // the runtime aborts the request at the limit; even if a read hangs, the run moves on with the file name only
  const hangRt={api:()=>new Promise(()=>{})};
  const t0=Date.now();
  await m.readTexts([row(1,{extraction_status:'pending'})],{rt:hangRt,timeoutMs:40});
  assert.ok(Date.now()-t0<1000,'did not wait for the hanging read');
});

test('library screen: auto tidy has no button, no progress text, no storage; list loading does not await it',()=>{
  const src=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  for(const gone of ['libraryTidy','luTidyRender','정리 제안','이어서 찾기','찾는 중','lt-row'])assert.ok(!src.includes(gone),gone);
  const start=src.indexOf('// LIB-자동정리'),end=src.indexOf('function luRenderManageList');
  const block=src.slice(start,end);
  assert.ok(block.length>200);
  for(const bad of ['local'+'Storage','session'+'Storage','indexed'+'DB','innerHTML','textContent','await '])assert.ok(!block.includes(bad),bad);
  assert.match(src,/luRenderLibrary\(\);luRevealRequested\(\);luStartAutoTidy\(\)/);
  const lib=readFileSync(new URL('../app/library-ai-fill.js',import.meta.url),'utf8');
  for(const bad of ['local'+'Storage','session'+'Storage','indexed'+'DB','buildTidyProposals','groupTidyProposals'])assert.ok(!lib.includes(bad),bad);
  const css=readFileSync(new URL('../app/library-upload.css',import.meta.url),'utf8');
  assert.ok(!/\.lt-|\.library-tidy/.test(css));
});
