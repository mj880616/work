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
  // LIB-AI분류보완: a project the AI linked becomes user when the person changes it; a link without a record stays unmarked
  // (the DB before 20261023120000 would refuse the key, and an unrecorded link is already treated as the person's own).
  assert.deepEqual(m.originAfterEdit({field_origin:{project_id:'ai'}},['project_id']),{project_id:'user'});
  assert.deepEqual(m.originAfterEdit({field_origin:{}},['project_id']),{});
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
const row=(n,over={})=>({id:DOC(n),title:'scan_2026',file_name:'scan_2026.hwp',category:'기타',source:null,document_date:null,
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
  const docs=[row(1),row(2,{created_at:JUST}),row(3),row(4,{title:'정리됨',source:'a',document_date:'2026-01-01',category:'교섭',project_id:'p',organization_id:'o'}),{...row(5),id:'bad'}];
  const {field_origin,...noColumn}=row(6);void field_origin;
  const out=m.tidyCandidates([...docs,noColumn],{tried:new Set([DOC(3)]),categories:CATS,now:NOW}).map(d=>d.id);
  assert.deepEqual(out,[DOC(1)]);
});

function fakeRt({tried=[],nameOnly=[],triedFails=false,textDelay=0,textLog=[]}={}){
  return {api:async(path,o)=>{
    if(path.startsWith('/rest/v1/app_library_tidy_attempts'))throw new Error('the old attempt table is no longer read');
    if(path.startsWith('/rest/v1/app_library_classify_attempts')){if(triedFails)throw Object.assign(new Error('missing'),{status:404});
      assert.match(path,/select=document_id,with_text/);return [...tried.map(id=>({document_id:id,with_text:true})),...nameOnly.map(id=>({document_id:id,with_text:false}))]}
    if(path==='/functions/v1/document-actions'){textLog.push({id:o.body.document_id,start:Date.now()});if(textDelay)await new Promise(r=>setTimeout(r,textDelay));return {ok:true}}
    throw new Error('unexpected '+path);
  }};
}

test('autoTidyLibrary: 10 per request, at most 8 requests per run, mode tidy with ids only, refreshes when something changed',async()=>{
  const docs=Array.from({length:95},(_,i)=>row(i+1));
  const sent=[];let changed=0;
  const call=async body=>{sent.push(body);return {ok:true,data:{ok:true,kind:'library_fill',mode:'tidy',updated:2}}};
  const r=await m.autoTidyLibrary(docs,{rt:fakeRt(),call,workspace:'ws',categories:CATS,now:NOW,onChanged:()=>changed++});
  assert.equal(m.TIDY_MAX_BATCHES,8);
  assert.deepEqual(sent.map(b=>[b.kind,b.mode,b.document_ids.length,Object.keys(b).sort().join(',')]),
    Array.from({length:8},()=>['library_fill','tidy',10,'document_ids,kind,mode']));
  assert.deepEqual(r,{sent:80,updated:16,stop:null});assert.equal(changed,8);
});

test('LIB-AI분류보완 candidates: empty links count, hand links and removed links do not; name-only attempts come back once text is ready',()=>{
  const linked={project_id:'p',organization_id:'o'};
  const tidy={title:'정리됨',source:'a',document_date:'2026-01-01',category:'교섭'};
  assert.deepEqual(m.openLinks(row(1)),['project_id','organization_id']);
  assert.deepEqual(m.openLinks(row(1,linked)),[]);
  // A link the person removed keeps its 'ai' record; an edit-form save locks the project (it has a project field) but not the organization.
  assert.deepEqual(m.openLinks(row(1,{field_origin:{organization_id:'ai'}})),['project_id']);
  assert.deepEqual(m.openLinks(row(1,{classification_note:'사용자 수정'})),['organization_id']);
  assert.deepEqual(m.legacyUserFields('사용자 수정'),['title','document_date','source','category','project_id']);
  const docs=[row(1,{...tidy,...linked}),row(2,{...tidy}),row(3,{...tidy,...linked}),row(4,{...tidy,...linked,extraction_status:'pending'}),row(5)];
  const tried=new Map([[DOC(3),false],[DOC(4),false],[DOC(5),true]]);
  // 1: nothing to do. 2: empty links. 3: tried by file name, text now ready → once more. 4: still no text → wait. 5: tried with text → never.
  assert.deepEqual(m.tidyCandidates(docs,{tried,categories:CATS,now:NOW}).map(d=>d.id),[DOC(2),DOC(3)]);
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
  const start=src.indexOf('// LIB-자동정리'),end=src.indexOf('function luManage');
  const block=src.slice(start,end);
  assert.ok(block.length>200);
  for(const bad of ['local'+'Storage','session'+'Storage','indexed'+'DB','innerHTML','textContent','await '])assert.ok(!block.includes(bad),bad);
  assert.match(src,/luRenderLibrary\(\);luRevealRequested\(\);luStartAutoTidy\(\)/);
  const lib=readFileSync(new URL('../app/library-ai-fill.js',import.meta.url),'utf8');
  for(const bad of ['local'+'Storage','session'+'Storage','indexed'+'DB','buildTidyProposals','groupTidyProposals'])assert.ok(!lib.includes(bad),bad);
  const css=readFileSync(new URL('../app/library-upload.css',import.meta.url),'utf8');
  assert.ok(!/\.lt-|\.library-tidy/.test(css));
});

// ---- LIB-수정파일교체 ----
test('reclassifyLibraryDocument: reads the new text first, then one tidy call with ids only; never throws; refreshes only when something changed',async()=>{
  const calls=[],events=[];
  globalThis.window={dispatchEvent:e=>events.push(e.type)};globalThis.CustomEvent=class{constructor(type){this.type=type}};
  const rt={api:async(path,o)=>{calls.push(['api',path,o.body]);return {ok:true}}};
  const call=async body=>{calls.push(['ai',body]);return {ok:true,data:{ok:true,kind:'library_fill',updated:1}}};
  assert.deepEqual(await m.reclassifyLibraryDocument(ID,{rt,call}),{ok:true,updated:1});
  assert.deepEqual(calls,[['api','/functions/v1/document-actions',{action:'document-text',document_id:ID}],['ai',{kind:'library_fill',mode:'tidy',document_ids:[ID]}]]);
  assert.deepEqual(events,['kptu:documents-changed']);
  events.length=0;
  assert.deepEqual(await m.reclassifyLibraryDocument(ID,{rt,call:async()=>({ok:true,data:{updated:0}})}),{ok:true,updated:0});
  assert.deepEqual(events,[]);
  assert.deepEqual(await m.reclassifyLibraryDocument(ID,{rt:{api:async()=>{throw Error('down')}},call:async()=>({ok:false,code:'ai_busy'})}),{ok:false,code:'ai_busy'});
  assert.deepEqual(await m.reclassifyLibraryDocument('nope',{rt,call}),{ok:false,code:'invalid_request'});
  delete globalThis.window;delete globalThis.CustomEvent;
});

test('tidyCandidates: a document whose file was replaced (reclassify_needed) is a candidate even when tried or just uploaded; needs the field_origin column',()=>{
  const docs=[row(1,{reclassify_needed:true,created_at:JUST,title:'정리됨',source:'a',document_date:'2026-01-01',category:'교섭',project_id:'p',organization_id:'o'}),row(2,{reclassify_needed:false,created_at:JUST}),row(3,{reclassify_needed:true})];
  const {field_origin,...noColumn}=row(4,{reclassify_needed:true});void field_origin;
  const out=m.tidyCandidates([...docs,noColumn],{tried:new Set([DOC(1),DOC(3)]),categories:CATS,now:NOW}).map(d=>d.id);
  assert.deepEqual(out,[DOC(1),DOC(3)]);
});

test('replace file screen: renamed menu item, file line in the edit dialog, saved only on [수정 저장], hidden before the DB column, no storage',()=>{
  const src=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  assert.match(src,/data-lu-edit="\$\{luEsc\(id\)\}">정보 수정…<\/button>/);
  assert.ok(!src.includes('>정보 수정<'));
  assert.match(src,/<h2>자료 수정<\/h2>/);
  assert.match(src,/function luReplaceReady\(d\)\{return !!d&&Object\.hasOwn\(d,'previous_files'\)\}/);
  const start=src.indexOf('// LIB-수정파일교체'),end=src.indexOf('function luEditFields');
  const block=src.slice(start,end);
  assert.ok(block.length>1500);
  for(const bad of ['local'+'Storage','session'+'Storage','indexed'+'DB'])assert.ok(!block.includes(bad),bad);
  // The request carries the id of the document being edited and the file only; every other field of the row stays on the server.
  assert.match(block,/fd\.append\('file',file\);fd\.append\('replace_document_id',editor\.id\);/);
  assert.equal((block.match(/fd\.append\(/g)||[]).length,2);
  // Order on save: file replace, then the info save only when a field changed, then the background re-judgement.
  const save=src.slice(src.indexOf('async function luSaveEdit'),src.indexOf("window.addEventListener('kptu:view-changed'"));
  assert.ok(save.indexOf('luReplaceStaged(editor,st)')<save.indexOf('luEditAttempts.set(key,request)'));
  assert.match(save,/if\(!changed\.length\)\{luSetStatus\(st,'파일을 바꿨습니다\.',false\);luClose\('libraryEditModal'\)/);
  assert.match(save,/if\(replaced\)luReclassify\(editor\.id\)/);
  const css=readFileSync(new URL('../app/library-upload.css',import.meta.url),'utf8');
  assert.match(css,/\.library-edit-prev>summary/);
});

// WEEKLY-자료요약 화면 ①: 이미 분류된 예전 자료도 'b1:' 요약이 없으면(요약 표에 행이 없고 글자가 ready) 후보 — 오래된 것부터 뒤에.
test('tidyCandidates: an already tidied old document without any summary row is a brief candidate, oldest first; an old summary row keeps it out',()=>{
  const done={title:'정리됨',source:'a',document_date:'2026-01-01',category:'교섭',project_id:'p',organization_id:'o'};
  const docs=[row(1,{...done,created_at:'2026-09-10T00:00:00Z'}),row(2,{...done,created_at:'2026-08-01T00:00:00Z'}),row(3,{...done}),
    row(4,{...done,extraction_status:'empty'}),row(5,{...done,created_at:JUST}),row(6),row(7,{...done})];
  const tried=new Set([DOC(1),DOC(2),DOC(3),DOC(4),DOC(5),DOC(7)]);
  // 3: a 'b1:' row or an old row — both are rows in the table → out. 4: no text. 5: just uploaded (fill). 6: untidy → first. 7: no row → brief.
  const briefs=new Set([DOC(3)]);
  assert.deepEqual(m.tidyCandidates(docs,{tried,categories:CATS,now:NOW,briefs}).map(d=>d.id),[DOC(6),DOC(2),DOC(7),DOC(1)]);
  // the summary table could not be read → the old rule only
  assert.deepEqual(m.tidyCandidates(docs,{tried,categories:CATS,now:NOW,briefs:null}).map(d=>d.id),[DOC(6)]);
  assert.equal(m.needsBrief(row(1),new Set()),true);assert.equal(m.needsBrief(row(1),null),false);
});

test('autoTidyLibrary: reads the summary table ids once (document_id only) and sends brief-only documents; a failed read sends none of them',async()=>{
  const done={title:'정리됨',source:'a',document_date:'2026-01-01',category:'교섭',project_id:'p',organization_id:'o'};
  const docs=[row(1,done),row(2,done)];
  const paths=[];
  const rt=ok=>({api:async path=>{paths.push(path);
    if(path.startsWith('/rest/v1/app_library_classify_attempts'))return [{document_id:DOC(1),with_text:true},{document_id:DOC(2),with_text:true}];
    if(path.startsWith('/rest/v1/app_document_ai_index')){if(!ok)throw new Error('x');return [{document_id:DOC(1)}]}
    if(path==='/functions/v1/document-actions')return {ok:true};
    throw new Error('unexpected '+path)}});
  const sent=[];const call=async b=>{sent.push(b);return {ok:true,data:{updated:0}}};
  await m.autoTidyLibrary(docs,{rt:rt(true),call,workspace:'ws',categories:CATS,now:NOW});
  assert.deepEqual(sent.map(b=>b.document_ids),[[DOC(2)]]);
  const read=paths.find(p=>p.startsWith('/rest/v1/app_document_ai_index'));
  assert.match(read,/workspace_id=eq\.ws/);assert.match(read,/select=document_id&/);
  sent.length=0;
  await m.autoTidyLibrary(docs,{rt:rt(false),call,workspace:'ws',categories:CATS,now:NOW});
  assert.equal(sent.length,0);
});

// ---- LIB-파일이름제목: 뜻 있는 파일 이름이 제목이면 정리 대상이 아니다(서버와의 규칙 비교는 tests/security/ai-assist-library-fill.test.mjs) ----
test('untidyFields: a meaningful file-name title is not untidy; a meaningless one still is',()=>{
  const base={category:'정책',source:'x',document_date:'2026-01-01'};
  assert.equal(m.untidyFields(row(1,{title:'공문_협조요청',file_name:'공문_협조요청.pdf',...base}),CATS).includes('title'),false);
  assert.equal(m.untidyFields(row(1,{title:'scan0001',file_name:'scan0001.pdf',...base}),CATS).includes('title'),true);
});

// LIB-파일이름그대로(2026-10-30 사용자 결정 A): 파일 이름 판정은 app/library-file-name.mjs 한 곳(Edge 사본은 바이트까지 같음).
test('file name rule: meaningful names keep their title and date; meaningless names leave the title to the AI',async()=>{
  const n=await import('../app/library-file-name.mjs');
  assert.equal(n.fileNameTitle('주간보고_20261102_홍길동.hwpx'),'주간보고 20261102 홍길동');
  assert.equal(n.fileNameDate('주간보고_20261102_홍길동.hwpx'),'2026-11-02');
  assert.equal(n.isMeaninglessName('주간보고_20261102_홍길동.hwpx'),false);
  assert.deepEqual(n.nameKeptFields('주간보고_20261102_홍길동.hwpx'),['title','document_date']);
  // 뜻 없는 이름: AI 제목 허용(날짜는 이름에 있으면 그대로).
  for(const name of ['KakaoTalk_20261030_1.jpg','scan001.pdf','image.png','문서.hwp','최종.hwp','최종본_v2.hwpx','회의자료.pdf','제목 없음.hwp'])assert.equal(n.isMeaninglessName(name),true,name);
  assert.deepEqual(n.nameKeptFields('KakaoTalk_20261030_1.jpg'),['document_date']);
  assert.deepEqual(n.nameKeptFields('image.png'),[]);
  assert.deepEqual(n.nameKeptFields('공문_협조요청.pdf'),['title']);
  assert.equal(n.fileNameDate('보도자료_251020.hwp'),'2025-10-20');
  assert.equal(n.fileNameDate('교섭 요구안.pdf'),null);
  // 화면 판정 = 공용 모듈(따로 사본을 두지 않음).
  assert.equal(m.isMeaninglessName,n.isMeaninglessName);
  assert.equal(m.GENERIC_NAME_WORDS,n.GENERIC_NAME_WORDS);
});

test('Edge file name rule is a byte-for-byte deployment copy of the screen module, and library-files / ai-assist use it',async()=>{
  const read=p=>readFileSync(new URL(p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const banner='// Source of truth: app/library-file-name.mjs.\n// Deployment-local copy; the regression compares everything below this banner byte for byte.\n';
  const copy=read('../supabase/functions/_shared/library-file-name.mjs');
  assert.ok(copy.startsWith(banner));
  assert.equal(copy.slice(banner.length),read('../app/library-file-name.mjs'));
  assert.match(read('../supabase/functions/library-files/index.ts'),/import \{ fileNameTitle, isMeaninglessName \} from '\.\.\/_shared\/library-file-name\.mjs';/);
  assert.match(read('../supabase/functions/ai-assist/library-fill.ts'),/import \{ GENERIC_NAME_WORDS, isMeaninglessName \} from "\.\.\/_shared\/library-file-name\.mjs";/);
  // 자료실에서 올리는 길([+ 자료 등록]·끌어놓기·폴더·사업영역·담당조직·사업 보고 첨부)은 모두 luAiFill에 올린 파일 이름을 넘긴다.
  const upload=read('../app/library-upload.js');
  const calls=upload.match(/luAiFill\([^)]*\)/g);
  assert.ok(calls.length>=4);
  for(const c of calls)assert.ok(c==='luAiFill(id,fd,fileName)'||/,file\.name\)$/.test(c),c);
  // 주간보고 [확정]도 자료명을 파일 이름으로 정한다(본문 ■ 일시 글자가 아님).
  assert.match(read('../app/journal-hwpx.js'),/saveWeeklyReport\(b\.bytes, \{fileName:b\.name, title:fileNameTitle\(b\.name\)/);
});

test('fillLibraryDocument: with the uploaded file name, a meaningful name keeps title and its date keeps document_date',async()=>{
  const sent=[];const rt={api:async()=>({ok:true})};const call=async body=>{sent.push(body);return {ok:true,data:{updated:0}}};
  await m.fillLibraryDocument(ID,{keep:['source'],fileName:'주간보고_20261102_홍길동.hwpx',rt,call,notify:false});
  await m.fillLibraryDocument(ID,{keep:[],fileName:'KakaoTalk_20261030_1.jpg',rt,call,notify:false});
  await m.fillLibraryDocument(ID,{keep:[],fileName:'image.png',rt,call,notify:false});
  await m.fillLibraryDocument(ID,{keep:['category'],rt,call,notify:false});
  assert.deepEqual(sent.map(b=>b.keep),[['title','document_date','source'],['document_date'],[],['category']]);
});
