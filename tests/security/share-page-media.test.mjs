import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// ED-통합편집기 ②: share photo keeping. Real handlers, synthetic stores (no Supabase, no production).
const {createShareMediaHandler,inspectJpeg,usedPhotoIds,MAX_BYTES,PRUNE_MAX}=await import('../../supabase/functions/share-page-media/handler.ts');
const {createShareReadHandler,sharePhotoIds,SIGN_SECONDS}=await import('../../supabase/functions/share-page-read/handler.ts');
const PAGE='30000000-0000-4000-8000-000000000001',OTHER='30000000-0000-4000-8000-000000000002',WS='20000000-0000-4000-8000-000000000001';
const P1='40000000-0000-4000-8000-000000000001',P2='40000000-0000-4000-8000-000000000002',P3='40000000-0000-4000-8000-000000000003';
const seg=(marker,body)=>Buffer.concat([Buffer.from([0xff,marker,(body.length+2)>>8,(body.length+2)&255]),body]);
const sof=(w,h)=>seg(0xc0,Buffer.from([8,h>>8,h&255,w>>8,w&255,3,1,0x22,0,2,0x11,1,3,0x11,1]));
const jpeg=(...parts)=>Buffer.concat([Buffer.from([0xff,0xd8]),seg(0xe0,Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),...parts,sof(40,30),Buffer.from([0xff,0xda,0,2,1,2,3,0xff,0xd9])]);
const exif=seg(0xe1,Buffer.from('Exif\0\0MM\0*GPS'));
const xmp=seg(0xe1,Buffer.from('http://ns.adobe.com/xap/1.0/\0<x/>'));

test('inspectJpeg accepts a plain redrawn JPEG and refuses EXIF, XMP, IPTC and non-JPEG',()=>{
 assert.deepEqual(inspectJpeg(new Uint8Array(jpeg())),{width:40,height:30});
 assert.equal(inspectJpeg(new Uint8Array(jpeg(exif))),null);
 assert.equal(inspectJpeg(new Uint8Array(jpeg(xmp))),null);
 assert.equal(inspectJpeg(new Uint8Array(jpeg(seg(0xed,Buffer.from('Photoshop 3.0\0'))))),null);
 assert.equal(inspectJpeg(new Uint8Array(Buffer.from('GIF89a....'))),null);
 assert.equal(inspectJpeg(new Uint8Array([0xff,0xd8,0xff])),null);
 assert.equal(inspectJpeg(new Uint8Array(Buffer.from([0xff,0xd8,0xff,0xe0,0,200,1,2]))),null);
});

function media(){
 const state={pages:new Map([[PAGE,WS]]),blocks:new Map(),rows:new Map(),files:new Map(),failFile:new Set(),tokens:{good:'u1',other:'u2'},calls:[]};
 const owns=t=>t==='good';
 const deps={
  async userId(t){return state.tokens[t]??null;},
  async pageWorkspace(t,id){return owns(t)?state.pages.get(id)??null:null;},
  async insertRow(t,row){state.calls.push('insert');if(!owns(t))return false;state.rows.set(row.id,row);return true;},
  async rowsFor(t,pageId,ids){return owns(t)?[...state.rows.values()].filter(r=>r.page_id===pageId&&ids.includes(r.id)):[];},
  async rowById(t,id){return owns(t)?state.rows.get(id)??null:null;},
  async deleteRow(t,id){if(state.failRow)return false;state.rows.delete(id);return true;},
  async pageBlocks(t,id){return owns(t)&&state.pages.has(id)?(state.blocks.get(id)??[]):null;},
  async rowsForPage(t,pageId,limit){return owns(t)?[...state.rows.values()].filter(r=>r.page_id===pageId).slice(0,limit):[];},
  async putFile(p,b){state.files.set(p,b);return true;},
  async removeFile(p){state.calls.push('remove');if(state.failFile.has(p))return false;state.files.delete(p);return true;},
  async signFile(p,s){return state.files.has(p)?`https://x.supabase.co/storage/v1/object/sign/share-page-media/${p}?token=t&s=${s}`:null;},
 };
 return {state,handler:createShareMediaHandler(deps,{newId:()=>P1,log:()=>{}})};
}
const URL_='https://x.supabase.co/functions/v1/share-page-media';
const upload=(handler,{token='good',page=PAGE,bytes=jpeg(),name='a.jpg'}={})=>{
 const fd=new FormData();fd.set('page_id',page);fd.set('image',new File([bytes],name,{type:'image/jpeg'}));
 return handler(new Request(URL_,{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:fd}));
};
const json=(handler,body,token='good')=>handler(new Request(URL_,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}));

test('media: owner uploads a redrawn JPEG, gets share:<id>, signs a short address, deletes file and row',async()=>{
 const {state,handler}=media();
 const r=await upload(handler);assert.equal(r.status,200);
 const body=await r.json();assert.deepEqual(body,{ok:true,id:P1,src:'share:'+P1,width:40,height:30});
 assert.deepEqual([...state.files.keys()],[`${PAGE}/${P1}.jpg`]);
 assert.equal(state.rows.get(P1).storage_path,`${PAGE}/${P1}.jpg`);
 const s=await json(handler,{action:'sign',page_id:PAGE,ids:[P1,P2]});
 const urls=(await s.json()).urls;assert.deepEqual(Object.keys(urls),[P1]);assert.match(urls[P1],/s=600$/);
 assert.equal((await json(handler,{action:'delete',id:P1})).status,200);
 assert.equal(state.files.size,0);assert.equal(state.rows.size,0);
 assert.equal((await json(handler,{action:'delete',id:P1})).status,404);
});
test('media: no login, a stranger, a foreign page, EXIF, oversize and wrong shapes are all refused with nothing stored',async()=>{
 const {state,handler}=media();
 assert.equal((await upload(handler,{token:''})).status,401);
 assert.equal((await upload(handler,{token:'nobody'})).status,401);
 assert.equal((await upload(handler,{token:'other'})).status,404);
 assert.equal((await upload(handler,{page:OTHER})).status,404);
 assert.equal((await upload(handler,{bytes:jpeg(exif)})).status,422);
 assert.equal((await upload(handler,{bytes:Buffer.alloc(MAX_BYTES+1)})).status,413);
 assert.equal((await upload(handler,{page:'x'})).status,400);
 assert.equal((await json(handler,{action:'sign',page_id:PAGE,ids:['x']})).status,400);
 assert.equal((await json(handler,{action:'nope'})).status,400);
 assert.equal((await handler(new Request(URL_,{method:'GET',headers:{Authorization:'Bearer good'}}))).status,405);
 assert.equal(state.files.size,0);assert.equal(state.rows.size,0);
 assert.deepEqual(await (await json(handler,{action:'sign',page_id:PAGE,ids:[P1]},'other')).json(),{ok:true,urls:{}});
});
test('media: a row that cannot be saved removes the file again',async()=>{
 const {state}=media();
 const h=createShareMediaHandler({userId:async()=>'u',pageWorkspace:async()=>WS,insertRow:async()=>false,rowsFor:async()=>[],rowById:async()=>null,deleteRow:async()=>true,pageBlocks:async()=>[],rowsForPage:async()=>[],
  putFile:async(p,b)=>{state.files.set(p,b);return true;},removeFile:async p=>{state.files.delete(p);return true;},signFile:async()=>null},{newId:()=>P1,log:()=>{}});
 assert.equal((await upload(h)).status,503);assert.equal(state.files.size,0);
});


// SHARE-사진같이지우기: a photo taken out of the page goes with its file; the page as saved in the DB decides what is still used.
const put=(state,id,page=PAGE)=>{const p=`${page}/${id}.jpg`;state.rows.set(id,{id,page_id:page,storage_path:p});state.files.set(p,new Uint8Array([1]));};
const saved=(...ids)=>[{type:'summary',text:'x'},{type:'doc',doc:{v:'ed1',doc:{type:'doc',content:ids.map(id=>({type:'image',attrs:{src:'share:'+id,alt:''}}))}}}];
test('prune: removes file and record of photos the saved page no longer uses, keeps used and kept ones, other pages untouched',async()=>{
 const {state,handler}=media();
 put(state,P1);put(state,P2);put(state,P3);put(state,'40000000-0000-4000-8000-000000000009',OTHER);
 state.blocks.set(PAGE,saved(P1));
 const r=await json(handler,{action:'prune',page_id:PAGE,keep:[P3]});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,removed:1,failed:0});
 assert.deepEqual([...state.rows.keys()].sort(),[P1,P3,'40000000-0000-4000-8000-000000000009'].sort());
 assert.equal(state.files.has(`${PAGE}/${P2}.jpg`),false);assert.equal(state.files.has(`${PAGE}/${P1}.jpg`),true);
 assert.equal(state.files.has(`${OTHER}/40000000-0000-4000-8000-000000000009.jpg`),true);
 // nothing left to remove: the same call again is harmless
 assert.deepEqual(await (await json(handler,{action:'prune',page_id:PAGE,keep:[P3]})).json(),{ok:true,removed:0,failed:0});
});
test('prune: a file the bucket does not remove keeps its record, so the next prune removes it again',async()=>{
 const {state,handler}=media();
 put(state,P1);state.blocks.set(PAGE,saved());state.failFile.add(`${PAGE}/${P1}.jpg`);
 assert.deepEqual(await (await json(handler,{action:'prune',page_id:PAGE})).json(),{ok:true,removed:0,failed:1});
 assert.equal(state.rows.has(P1),true);assert.equal(state.files.has(`${PAGE}/${P1}.jpg`),true);
 state.failFile.clear();
 assert.deepEqual(await (await json(handler,{action:'prune',page_id:PAGE})).json(),{ok:true,removed:1,failed:0});
 assert.equal(state.rows.size,0);assert.equal(state.files.size,0);
});
test('prune: no login, a stranger, a foreign page and wrong shapes remove nothing',async()=>{
 const {state,handler}=media();
 put(state,P1);state.blocks.set(PAGE,saved());
 assert.equal((await json(handler,{action:'prune',page_id:PAGE},'')).status,401);
 assert.equal((await json(handler,{action:'prune',page_id:PAGE},'nobody')).status,401);
 assert.equal((await json(handler,{action:'prune',page_id:PAGE},'other')).status,404);
 assert.equal((await json(handler,{action:'prune',page_id:OTHER})).status,404);
 assert.equal((await json(handler,{action:'prune',page_id:'x'})).status,400);
 assert.equal((await json(handler,{action:'prune',page_id:PAGE,keep:['../x']})).status,400);
 assert.equal((await json(handler,{action:'prune',page_id:PAGE,keep:Array(201).fill(P1)})).status,400);
 assert.equal(state.rows.size,1);assert.equal(state.files.size,1);
});
test('prune: a saved page too deep to read fully removes nothing (a used photo is never taken as unused)',async()=>{
 const {state,handler}=media();
 put(state,P1);
 let node={type:'image',attrs:{src:'share:'+P1}};for(let i=0;i<90;i++)node={type:'blockquote',content:[node]};
 state.blocks.set(PAGE,[{type:'doc',doc:{v:'ed1',doc:{type:'doc',content:[node]}}}]);
 assert.equal((await json(handler,{action:'prune',page_id:PAGE})).status,409);
 assert.equal(state.rows.size,1);assert.equal(state.files.size,1);
});
test('usedPhotoIds reads every share: photo of 글 blocks (no 60 cap), ignores other blocks and odd shapes',()=>{
 const many=Array.from({length:80},(_,i)=>`40000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
 assert.equal(usedPhotoIds(saved(...many)).size,80);
 assert.deepEqual([...usedPhotoIds([{type:'summary',text:'share:'+P1},{type:'doc',doc:{doc:{content:[{type:'image',attrs:{src:'https://x/'+P1}},null,5]}}}])],[]);
 assert.equal(usedPhotoIds(null),null);assert.equal(usedPhotoIds({}),null);
 assert.ok(PRUNE_MAX>=40);
});
test('delete: the file goes first; if it cannot, the record stays (no record-less file left behind)',async()=>{
 const {state,handler}=media();
 put(state,P1);state.failFile.add(`${PAGE}/${P1}.jpg`);
 assert.equal((await json(handler,{action:'delete',id:P1})).status,503);
 assert.equal(state.rows.has(P1),true);
});
const doc=(...srcs)=>({type:'doc',v:'ed1',doc:{type:'doc',content:srcs.map(src=>({type:'image',attrs:{src,alt:''}}))}});
function reader(blocks,{status='published',dead=false}={}){
 const calls=[];
 const links=new Map([[createHash('sha256').update(Buffer.from('a1'.repeat(32),'hex')).digest('hex'),{page_id:PAGE,disabled_at:dead?'2026-10-19T00:00:00Z':null,expires_at:null}]]);
 const rows=[{id:P1,page_id:PAGE,storage_path:`${PAGE}/${P1}.jpg`},{id:P3,page_id:OTHER,storage_path:`${OTHER}/${P3}.jpg`}];
 const h=createShareReadHandler({
  async linkByHash(x){const l=links.get(x);return l?{...l,token_hash:x}:null;},
  async pageById(){return {id:PAGE,title:'t',blocks,status};},
  async mediaForPage(pageId,ids){calls.push(['media',pageId,ids]);return rows.filter(r=>r.page_id===pageId&&ids.includes(r.id)).map(({id,storage_path})=>({id,storage_path}));},
  async signMedia(p,s){calls.push(['sign',p,s]);return `https://x.supabase.co/sign/${p}`;},
 },{now:()=>Date.parse('2026-10-20T00:00:00Z'),log:()=>{}});
 return {calls,post:()=>h(new Request('https://x/f',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://work.bokdoong.com'},body:JSON.stringify({token:'a1'.repeat(32)})}))};
}
test('read: live link gets short addresses only for this page\'s recorded photos; the others are not signed',async()=>{
 assert.equal(SIGN_SECONDS,300);
 const r=reader([doc('share:'+P1,'share:'+P3,'drive:abc','share:'+P2)]);
 const res=await r.post();assert.equal(res.status,200);
 const body=await res.json();assert.deepEqual(Object.keys(body.media),[P1]);
 assert.deepEqual(r.calls,[['media',PAGE,[P1,P3,P2]],['sign',`${PAGE}/${P1}.jpg`,300]]);
 assert.equal(JSON.stringify(body).includes('storage_path'),false);
});
test('read: no photos means no media key and no lookup; a closed link or a draft signs nothing',async()=>{
 const none=reader([{type:'summary',text:'x'}]);const b=await (await none.post()).json();assert.equal('media' in b,false);assert.deepEqual(none.calls,[]);
 const dead=reader([doc('share:'+P1)],{dead:true});assert.equal((await dead.post()).status,404);assert.deepEqual(dead.calls,[]);
 const draft=reader([doc('share:'+P1)],{status:'draft'});assert.equal((await draft.post()).status,404);assert.deepEqual(draft.calls,[]);
});
test('read: a photo lookup problem does not stop the text',async()=>{
 const h=createShareReadHandler({async linkByHash(x){return {page_id:PAGE,token_hash:x,expires_at:null,disabled_at:null};},async pageById(){return {id:PAGE,title:'t',blocks:[doc('share:'+P1)],status:'published'};},
  async mediaForPage(){throw new Error('db');},async signMedia(){return null;}},{log:()=>{}});
 const res=await h(new Request('https://x/f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'a1'.repeat(32)})}));
 assert.equal(res.status,200);assert.deepEqual((await res.json()).media,{});
});
test('sharePhotoIds finds nested photos once, only share: ids, and ignores odd shapes',()=>{
 const nested={type:'doc',v:'ed1',doc:{type:'doc',content:[{type:'table',content:[{type:'table_row',content:[{type:'table_cell',content:[{type:'image',attrs:{src:'share:'+P1}}]}]}]},{type:'image',attrs:{src:'share:'+P1}},{type:'image',attrs:{src:'https://evil/x.jpg'}},{type:'image',attrs:{src:'share:not-a-uuid'}},null,5]}};
 assert.deepEqual(sharePhotoIds([nested,{type:'summary',text:'x'},null,'s']),[P1]);
 assert.deepEqual(sharePhotoIds([{type:'doc',doc:{type:'image'}}]),[]);
});

test('migration: new table only, owner RLS, no anon/PUBLIC, service_role three columns, record row, expanded rules',()=>{
 const stem='20261023110000_share_page_media';
 const code=readFileSync(`supabase/migrations/${stem}.sql`,'utf8').replace(/--.*$/gm,'');
 assert.doesNotMatch(code,/to\s+(?:anon|public)\b|security definer|disable row level|alter policy|drop policy|rtw_/i);
 assert.match(code,/revoke all on table public\.app_share_page_media from public, anon, authenticated, service_role;/);
 assert.match(code,/grant select \(id, page_id, storage_path\) on table public\.app_share_page_media to service_role;/);
 assert.match(code,/using \(private\.app_is_workspace_owner\(workspace_id\)\)/);
 assert.match(code,/storage_path = page_id::text \|\| '\/' \|\| id::text \|\| '\.jpg'/);
 assert.doesNotMatch(code,/grant update/i);
 assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261023110000', 'share_page_media'/);
 for(const mode of ['apply','dry-run']){
  const plan=prepareMigration({mode,version:'20261023110000',runId:'1',root:process.cwd()});
  assert.equal(plan.rules,'expanded');assert.equal(plan.summaryLines.length,3);
 }
 const rollback=readFileSync(`docs/${stem}.rollback.sql`,'utf8').replace(/--.*$/gm,'');
 assert.match(rollback,/exists \(select 1 from public\.app_share_page_media\) then\s+raise exception/);
 for(const f of ['snapshot','precheck','postcheck','rollback'])assert.match(readFileSync(`docs/${stem}.${f}.sql`,'utf8'),/20261023110000/);
});
test('share-page-media is registered (verify_jwt=true) and the index keeps the server key to the bucket',()=>{
 const doc=readFileSync('docs/web2-env6b-edge-source.md','utf8');
 const rows=doc.split('\n').filter(l=>/^\| \d+ \| `share-page-media` \|/.test(l));
 assert.equal(rows.length,1);assert.match(rows[0],/\*\*true\*\*/);
 const index=readFileSync('supabase/functions/share-page-media/index.ts','utf8');
 assert.match(index,/const BUCKET = "share-page-media"/);
 assert.match(index,/asUser\(token\)\.from\("app_share_pages"\)/);
 assert.doesNotMatch(index,/admin\.from\(/);
});
