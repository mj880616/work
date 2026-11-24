import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// NOTE-게시 ①: the anonymous reader shows a published note (app_note_share_pages pair) and nothing else of it.
// Real handler, synthetic reader. Without a link, with a stopped page, or for any other note: the same 404.
const {createShareReadHandler,noteBlocks,noteShowable}=await import('../../supabase/functions/share-page-read/handler.ts');
const URL_='https://example.supabase.co/functions/v1/share-page-read';
const ORIGIN='https://work.bokdoong.com';
const P={note:'40000000-0000-4000-8000-000000000001',stopped:'40000000-0000-4000-8000-000000000002',old:'40000000-0000-4000-8000-000000000003',
 trashed:'40000000-0000-4000-8000-000000000004',purged:'40000000-0000-4000-8000-000000000005',memo:'40000000-0000-4000-8000-000000000006',
 plain:'40000000-0000-4000-8000-000000000007',kept:'40000000-0000-4000-8000-000000000008'};
const N={a:'41000000-0000-4000-8000-000000000001',trashed:'41000000-0000-4000-8000-000000000002',memo:'41000000-0000-4000-8000-000000000003',
 plain:'41000000-0000-4000-8000-000000000004',kept:'41000000-0000-4000-8000-000000000005',secret:'41000000-0000-4000-8000-000000000009'};
const tok=Object.fromEntries(Object.keys(P).map((k,i)=>[k,(i+1).toString(16).padStart(2,'0').repeat(32)]));
const h=t=>createHash('sha256').update(Buffer.from(t,'hex')).digest('hex');
const doc=content=>({v:'ed1',doc:{type:'doc',content}});

function harness({pairFail=false}={}){
 const links=new Map(Object.entries(P).map(([k,id])=>[h(tok[k]),{page_id:id,token_hash:h(tok[k]),expires_at:null,disabled_at:null}]));
 const page=(id,status='published',blocks=[])=>[id,{id,title:'제목 사본',blocks,status}];
 const pages=new Map([page(P.note),page(P.stopped,'draft'),page(P.old,'published',[{type:'summary',text:'옛 블록'}]),page(P.trashed),page(P.purged),page(P.memo),page(P.plain),page(P.kept)]);
 const pairs=new Map([[P.note,N.a],[P.stopped,N.a],[P.trashed,N.trashed],[P.purged,null],[P.memo,N.memo],[P.plain,N.plain],[P.kept,N.kept]]);
 const note=(id,extra={})=>[id,{id,kind:'note',title:'회의 정리',raw_text:'',doc:null,deleted_at:null,archived_at:null,...extra}];
 const notes=new Map([
  note(N.a,{doc:doc([{type:'paragraph',content:[{type:'text',text:'지금 글'}]},{type:'image',attrs:{src:'drive:FILEID123',alt:'현장',title:'x'}}])}),
  note(N.trashed,{deleted_at:'2026-11-24T00:00:00Z'}),note(N.memo,{kind:'basket'}),note(N.plain,{title:'  ',raw_text:'첫 줄\n\n셋째 줄'}),
  note(N.kept,{archived_at:'2026-11-24T00:00:00Z'}),note(N.secret,{title:'남의 노트',raw_text:'비밀'}),
 ]);
 const calls={pair:[],note:[]};
 const handler=createShareReadHandler({
  async linkByHash(x){return links.get(x)??null;},
  async pageById(id){return pages.get(id)??null;},
  async noteForPage(id){calls.pair.push(id);if(pairFail)throw new Error('relation does not exist');return pairs.has(id)?{note_id:pairs.get(id)}:null;},
  async noteById(id){calls.note.push(id);return notes.get(id)??null;},
 },{log:()=>{}});
 return {handler,calls};
}
const post=(handler,body)=>handler(new Request(URL_,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify(body)}));
const notFound=async r=>{assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'not_found'});};

test('a published note shows its current title and text as one doc block; photo address and file id are dropped',async()=>{
 const {handler,calls}=harness();
 const r=await post(handler,{token:tok.note});
 assert.equal(r.status,200);
 const body=await r.json();
 assert.deepEqual(body,{ok:true,page:{title:'회의 정리',blocks:[{type:'doc',doc:doc([{type:'paragraph',content:[{type:'text',text:'지금 글'}]},{type:'image',attrs:{alt:'현장'}}])}]}});
 assert.doesNotMatch(JSON.stringify(body),/FILEID123|drive:/);
 assert.deepEqual(calls.note,[N.a],'only the paired note is read');
 const head=await post(handler,{token:tok.note,head:true});
 assert.deepEqual(await head.json(),{ok:true,page:{title:'회의 정리'}});
});

test('stopped page, trashed, kept, purged or memo note: the same 404',async()=>{
 const {handler,calls}=harness();
 for(const k of ['stopped','trashed','kept','purged','memo'])await notFound(await post(handler,{token:tok[k]}));
 assert.ok(!calls.pair.includes(P.stopped),'a stopped page is refused before the pair is read');
 assert.ok(!calls.note.includes(N.secret));
});

test('a note without saved formats shows one paragraph per line; an empty title falls back to the page title',async()=>{
 const {handler}=harness();
 const body=await (await post(handler,{token:tok.plain})).json();
 assert.equal(body.page.title,'제목 사본');
 assert.deepEqual(body.page.blocks,[{type:'doc',doc:doc([{type:'paragraph',content:[{type:'text',text:'첫 줄'}]},{type:'paragraph'},{type:'paragraph',content:[{type:'text',text:'셋째 줄'}]}])}]);
});

test('old share pages without a pair are unchanged; a failing pair lookup keeps them and stops empty pages',async()=>{
 const {handler}=harness();
 assert.deepEqual(await (await post(handler,{token:tok.old})).json(),{ok:true,page:{title:'제목 사본',blocks:[{type:'summary',text:'옛 블록'}]}});
 const failing=harness({pairFail:true});
 assert.deepEqual(await (await post(failing.handler,{token:tok.old})).json(),{ok:true,page:{title:'제목 사본',blocks:[{type:'summary',text:'옛 블록'}]}});
 const r=await post(failing.handler,{token:tok.note});
 assert.equal(r.status,503);
 assert.deepEqual(await r.json(),{error:'unavailable'});
});

test('noteShowable needs the same id, kind note and no trash or keep; noteBlocks cuts too deep documents',()=>{
 const base={id:N.a,kind:'note',title:'t',raw_text:'',doc:null,deleted_at:null,archived_at:null};
 assert.equal(noteShowable(base,N.a),true);
 assert.equal(noteShowable(base,N.secret),false);
 assert.equal(noteShowable(null,N.a),false);
 let deep={type:'paragraph',content:[{type:'text',text:'끝'}]};
 for(let i=0;i<60;i++)deep={type:'blockquote',content:[deep]};
 const out=JSON.stringify(noteBlocks({...base,doc:doc([deep])}));
 assert.doesNotMatch(out,/끝/);
});

test('the migration goes through the expanded one-approval plan; the reader reads two pair columns and seven note columns',()=>{
 assert.equal(prepareMigration({mode:'apply',version:'20261124230000',runId:'1',root:process.cwd()}).rules,'expanded');
 const index=readFileSync(new URL('../../supabase/functions/share-page-read/index.ts',import.meta.url),'utf8');
 assert.match(index,/from\("app_note_share_pages"\)\s*\.select\("note_id"\)\s*\.eq\("page_id", pageId\)/);
 assert.match(index,/from\("app_notes"\)\s*\.select\("id,kind,title,raw_text,doc,deleted_at,archived_at"\)\s*\.eq\("id", id\)\s*\.is\("deleted_at", null\)/);
 const sql=readFileSync(new URL('../../supabase/migrations/20261124230000_note_share_pages.sql',import.meta.url),'utf8');
 assert.match(sql,/grant select \(page_id, note_id\) on table public\.app_note_share_pages to service_role;/);
 assert.doesNotMatch(sql,/to anon|to public\b/i);
});

// NOTE-게시 ③: 주인 화면이 게시하며 올린 사진(짝 페이지 사진 거울)만, 그 페이지 소속 사진 기록으로 짧게 서명해 보인다.
// 받는 사람 요청 때 서버는 Drive를 읽지 않는다(이 읽기 함수에는 Drive 틈새가 없다). 첨부 파일 칸은 이름만.
const {photoKey,noteMirror}=await import('../../supabase/functions/share-page-read/handler.ts');
const PH={mine:'52000000-0000-4000-8000-000000000001',other:'52000000-0000-4000-8000-000000000002',gone:'52000000-0000-4000-8000-000000000003'};
async function photoHarness({pairFail=false,mediaFail=false,pair=true}={}){
 const page=P.note,note=N.a;
 const mirror=[{type:'doc',doc:{v:'ed1',doc:{type:'doc',content:[
  {type:'image',attrs:{src:'share:'+PH.mine,key:await photoKey(page,'drive:PHOTO_A')}},
  {type:'image',attrs:{src:'share:'+PH.other,key:await photoKey(page,'drive:PHOTO_B')}},
  {type:'image',attrs:{src:'share:'+PH.gone,key:await photoKey(page,'drive:PHOTO_C')}},
 ]}}}];
 const media=[{id:PH.mine,page_id:page,storage_path:`${page}/${PH.mine}.jpg`},{id:PH.other,page_id:P.old,storage_path:`${P.old}/${PH.other}.jpg`}];
 const calls={media:[],sign:[]};
 const handler=createShareReadHandler({
  async linkByHash(x){return x===h(tok.note)?{page_id:page,token_hash:x,expires_at:null,disabled_at:null}:null;},
  async pageById(id){return id===page?{id,title:'사본',blocks:mirror,status:'published'}:null;},
  async noteForPage(){if(pairFail)throw new Error('down');return pair?{note_id:note}:null;},
  async noteById(id){return id===note?{id,kind:'note',title:'사진 노트',raw_text:'',deleted_at:null,archived_at:null,doc:doc([
   {type:'image',attrs:{src:'drive:PHOTO_A',alt:'현장'}},{type:'image',attrs:{src:'drive:PHOTO_B'}},{type:'image',attrs:{src:'drive:PHOTO_C'}},
   {type:'image',attrs:{src:'drive:PHOTO_D'}},{type:'file',attrs:{src:'drive:FILE_E',name:'회의.pdf',size:2048}}])}:null;},
  async mediaForPage(pid,ids){calls.media.push([pid,ids]);if(mediaFail)throw new Error('down');return media.filter(r=>r.page_id===pid&&ids.includes(r.id));},
  async signMedia(path,sec){calls.sign.push([path,sec]);return 'https://example.supabase.co/storage/v1/object/sign/share-page-media/'+path+'?token=s';},
 },{log:()=>{}});
 return {handler,calls};
}
test('③ a mirrored note photo is shown only through this page\'s photo record, signed for 5 minutes; Drive and file ids never go out',async()=>{
 const {handler,calls}=await photoHarness();
 const r=await post(handler,{token:tok.note});
 assert.equal(r.status,200);
 const body=await r.json();
 const out=body.page.blocks[0].doc.doc.content;
 assert.deepEqual(out[0],{type:'image',attrs:{src:'share:'+PH.mine,alt:'현장'}});
 assert.deepEqual(out.slice(1,4),[{type:'image',attrs:{}},{type:'image',attrs:{}},{type:'image',attrs:{}}],'another page\'s record, a missing record and an unmirrored photo stay places');
 assert.deepEqual(out[4],{type:'file',attrs:{name:'회의.pdf',size:2048}},'an attachment card keeps only its name and size');
 assert.deepEqual(Object.keys(body.media),[PH.mine]);
 assert.doesNotMatch(JSON.stringify(body),/PHOTO_|FILE_E|drive:|"key"/);
 assert.deepEqual(calls.media.map(c=>c[0]),[P.note],'records are asked only for this page');
 assert.deepEqual(calls.sign,[[`${P.note}/${PH.mine}.jpg`,300]]);
});
test('③ the mirror alone is never shown: a failing pair lookup is 503, a page without its pair is 404, a failing photo lookup keeps the text',async()=>{
 const failing=await photoHarness({pairFail:true});
 assert.equal((await post(failing.handler,{token:tok.note})).status,503);
 const orphan=await photoHarness({pair:false});
 await notFound(await post(orphan.handler,{token:tok.note}));
 assert.deepEqual(orphan.calls.media,[]);
 const noMedia=await photoHarness({mediaFail:true});
 const body=await (await post(noMedia.handler,{token:tok.note})).json();
 assert.equal(body.page.title,'사진 노트');
 assert.equal(body.media,undefined);
 assert.doesNotMatch(JSON.stringify(body),/share:/);
});
test('③ noteMirror reads only the mirror shape (one doc block of keyed share photos); old pages are not mirrors',async()=>{
 assert.equal(noteMirror([{type:'summary',text:'x'}]),null);
 assert.equal(noteMirror([{type:'doc',doc:{v:'ed1',doc:{type:'doc',content:[{type:'image',attrs:{src:'share:'+PH.mine}}]}}}]),null,'a photo without a key is an ordinary share page photo');
 assert.equal(noteMirror([{type:'doc',doc:{v:'ed1',doc:{type:'doc',content:[{type:'image',attrs:{src:'drive:X',key:'a'.repeat(64)}}]}}}]),null);
 assert.equal(noteMirror([]).size,0);
 assert.notEqual(await photoKey(P.note,'drive:A'),await photoKey(P.old,'drive:A'));
});
