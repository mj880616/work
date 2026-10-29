import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// SHARE-현장공유 PR 1: contract of the anonymous share-page reader. Real handler, synthetic reader.
const {createShareReadHandler,sameHash,tokenHash,MAX_BODY_BYTES}=await import('../../supabase/functions/share-page-read/handler.ts');
const URL_='https://example.supabase.co/functions/v1/share-page-read';
const ORIGIN='https://work.bokdoong.com';
const PAGE='30000000-0000-4000-8000-000000000001',OTHER='30000000-0000-4000-8000-000000000002';
const T={valid:'a1'.repeat(32),off:'b2'.repeat(32),old:'c3'.repeat(32),future:'d4'.repeat(32),draft:'e5'.repeat(32),other:'f6'.repeat(32)};
const h=t=>createHash('sha256').update(Buffer.from(t,'hex')).digest('hex');

function harness({now=Date.parse('2026-10-20T00:00:00Z'),fail=false}={}){
 const links=new Map([
  [h(T.valid),{page_id:PAGE,token_hash:h(T.valid),expires_at:null,disabled_at:null}],
  [h(T.off),{page_id:PAGE,token_hash:h(T.off),expires_at:null,disabled_at:'2026-10-19T00:00:00Z'}],
  [h(T.old),{page_id:PAGE,token_hash:h(T.old),expires_at:'2026-10-19T23:59:59Z',disabled_at:null}],
  [h(T.future),{page_id:PAGE,token_hash:h(T.future),expires_at:'2026-10-21T00:00:00Z',disabled_at:null}],
  [h(T.draft),{page_id:'draft',token_hash:h(T.draft),expires_at:null,disabled_at:null}],
  [h(T.other),{page_id:OTHER,token_hash:h(T.other),expires_at:null,disabled_at:null}],
 ]);
 const pages=new Map([
  [PAGE,{id:PAGE,title:'민자철도 현황',blocks:[{type:'summary',text:'교섭 중'}],status:'published'}],
  [OTHER,{id:OTHER,title:'다른 페이지',blocks:[],status:'published'}],
  ['draft',{id:'draft',title:'초안',blocks:[],status:'draft'}],
 ]);
 const calls={hash:[],page:[]};const logs=[];
 const handler=createShareReadHandler({
  async linkByHash(x){calls.hash.push(x);if(fail)throw new Error('db secret detail');return links.get(x)??null;},
  async pageById(id){calls.page.push(id);return pages.get(id)??null;},
 },{now:()=>now,log:c=>logs.push(c)});
 return {handler,calls,logs};
}
const post=(handler,body,{origin=ORIGIN,type='application/json',headers={}}={})=>handler(new Request(URL_,{method:'POST',
 headers:{...(origin?{Origin:origin}:{}),...(type?{'Content-Type':type}:{}),...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
const notFound=async r=>{assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'not_found'});};

test('valid link returns only title and blocks with no-store, noindex and Web1-only CORS',async()=>{
 const {handler,calls}=harness();
 const r=await post(handler,{token:T.valid});
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{ok:true,page:{title:'민자철도 현황',blocks:[{type:'summary',text:'교섭 중'}]}});
 assert.equal(r.headers.get('Access-Control-Allow-Origin'),ORIGIN);
 assert.match(r.headers.get('Cache-Control'),/no-store/);
 assert.match(r.headers.get('X-Robots-Tag'),/noindex/);
 assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');
 assert.equal(r.headers.get('Vary'),'Origin');
 // Lookup is by hash only, then the page of that same link.
 assert.deepEqual(calls.hash,[h(T.valid)]);assert.deepEqual(calls.page,[PAGE]);
});
test('disabled, expired, draft, unknown and malformed values all return the same 404',async()=>{
 const {handler,calls}=harness();
 for(const token of [T.off,T.old,T.draft,'0'.repeat(64)])await notFound(await post(handler,{token}));
 for(const token of ['short','A'.repeat(64),'g'.repeat(64),'a'.repeat(63),'a'.repeat(65),12,null,true,['x']])await notFound(await post(handler,{token}));
 assert.equal((await post(handler,{token:T.future})).status,200);
 // Malformed values never reach the database.
 assert.equal(calls.hash.length,5);
 // A stored hash is not a valid link value.
 await notFound(await post(handler,{token:h(T.valid)}));
});
test('a link never opens another page',async()=>{
 const {handler}=harness();
 assert.equal((await (await post(handler,{token:T.other})).json()).page.title,'다른 페이지');
 assert.equal((await (await post(handler,{token:T.valid})).json()).page.title,'민자철도 현황');
});
test('response never carries owner, workspace, internal ids or the token',async()=>{
 const {handler}=harness();
 const text=await (await post(handler,{token:T.valid})).text();
 for(const secret of [PAGE,T.valid,h(T.valid),'workspace','owner','page_id','status'])assert.equal(text.includes(secret),false,secret);
});
test('request shape is validated: method, content type, size, JSON, exact keys',async()=>{
 const {handler,calls}=harness();
 assert.equal((await handler(new Request(URL_,{method:'GET',headers:{Origin:ORIGIN}}))).status,405);
 assert.equal((await post(handler,{token:T.valid},{type:'text/plain'})).status,400);
 assert.equal((await post(handler,'{bad',{})).status,400);
 assert.equal((await post(handler,'[]',{})).status,400);
 assert.equal((await post(handler,{token:T.valid,page:'x'})).status,400);
 assert.equal((await post(handler,{})).status,400);
 assert.equal((await post(handler,JSON.stringify({token:T.valid})+' '.repeat(MAX_BODY_BYTES))).status,400);
 assert.equal((await post(handler,{token:T.valid},{headers:{'Content-Length':'999999'}})).status,400);
 assert.equal(calls.hash.length,0);
});
test('CORS allows only the Web1 origin; other origins are refused before any lookup',async()=>{
 const {handler,calls}=harness();
 const pre=await handler(new Request(URL_,{method:'OPTIONS',headers:{Origin:ORIGIN,'Access-Control-Request-Method':'POST'}}));
 assert.equal(pre.status,204);assert.equal(pre.headers.get('Access-Control-Allow-Origin'),ORIGIN);
 assert.match(pre.headers.get('Access-Control-Allow-Methods'),/POST/);
 for(const origin of ['https://desk.bokdoong.com','https://mj880616.github.io','https://evil.example']){
  const o=await handler(new Request(URL_,{method:'OPTIONS',headers:{Origin:origin}}));
  assert.equal(o.status,204);assert.equal(o.headers.get('Access-Control-Allow-Origin'),null,origin);
  const r=await post(handler,{token:T.valid},{origin});
  assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
 }
 assert.equal(calls.hash.length,0);
});
test('database failure is a generic 503 without details',async()=>{
 const {handler,logs}=harness({fail:true});
 const r=await post(handler,{token:T.valid});
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'unavailable'});
 assert.deepEqual(logs,['share_page_read_unavailable']);
});
test('hash and constant-time comparison helpers',async()=>{
 assert.equal(await tokenHash(T.valid),h(T.valid));
 assert.equal(sameHash(h(T.valid),h(T.valid)),true);
 assert.equal(sameHash(h(T.valid),h(T.off)),false);
 assert.equal(sameHash(h(T.valid),h(T.valid).slice(1)),false);
 const src=readFileSync('supabase/functions/share-page-read/handler.ts','utf8');
 assert.match(src,/diff \|= a\.charCodeAt\(i\) \^ b\.charCodeAt\(i\)/);
});
test('index reads only the needed columns with the server key kept inside the function',()=>{
 const index=readFileSync('supabase/functions/share-page-read/index.ts','utf8');
 assert.match(index,/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
 assert.match(index,/\.select\("page_id,token_hash,expires_at,disabled_at"\)\s*\.eq\("token_hash", hash\)/);
 assert.match(index,/\.select\("id,title,blocks,status"\)\s*\.eq\("id", id\)/);
 assert.match(index,/\.select\("id,storage_path"\)\s*\.eq\("page_id", pageId\)/);
 assert.doesNotMatch(index,/select\("\*"\)|\.insert\(|\.update\(|\.delete\(|\.rpc\(|token"|workspace_id/);
});
test('verify_jwt=false is registered for share-page-read in section 5 with the reason',()=>{
 const doc=readFileSync('docs/web2-env6b-edge-source.md','utf8');
 const section=doc.slice(doc.indexOf('## 5.'),doc.indexOf('### 5.1'));
 const rows=section.split('\n').filter(l=>/^\| \d+ \| `share-page-read` \|/.test(l));
 assert.equal(rows.length,1);assert.match(rows[0],/\| false \|/);
 assert.match(section,/share-page-read[\s\S]*링크/);
});
test('migration keeps owner RLS, no anon/PUBLIC grants, and does not touch retired share paths',()=>{
 const sql=readFileSync('supabase/migrations/20261020005000_share_pages_links.sql','utf8');
 const code=sql.replace(/--.*$/gm,'');
 assert.doesNotMatch(code,/to\s+(?:anon|public)\b|security definer|disable row level|app_share_links|app_open_share|app_create_share_link|app_pages|rtw_/i);
 assert.match(code,/revoke all on table public\.app_share_pages, public\.app_share_page_links from public, anon, authenticated, service_role;/);
 assert.equal((code.match(/using \(private\.app_is_workspace_owner\(workspace_id\)\)/g)||[]).length,2);
 assert.match(code,/grant select \(page_id, token_hash, expires_at, disabled_at\) on table public\.app_share_page_links to service_role;/);
 assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261020005000', 'share_pages_links'/);
 // DB-승인형확장: policies/grants on tables made in this file pass the expanded rules (no anon/PUBLIC widening).
 assert.equal(prepareMigration({mode:'apply',version:'20261020005000',runId:'1',root:process.cwd()}).rules,'expanded');
 const summary=readFileSync('docs/20261020005000_share_pages_links.summary.md','utf8').trim().split('\n');
 assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
 const rollback=readFileSync('docs/20261020005000_share_pages_links.rollback.sql','utf8');
 assert.match(rollback,/SHARE_PAGES_ROLLBACK_BLOCKED: share pages or links exist/);
 assert.doesNotMatch(rollback.replace(/--.*$/gm,''),/delete from public|truncate|cascade/i);
});

// SHARE-보관함·HTML공유: short address {slug} (name + 8 DB letters), HTML file versions, and head:true (title only).
const {slugOk,slugHash}=await import('../../supabase/functions/share-page-read/handler.ts');
const S={valid:'minja-rail-k7q2m9xa',off:'off-page-abcdefgh',blocks:'block-page-22334455'};
const sh=s=>createHash('sha256').update(s,'utf8').digest('hex');
function htmlHarness({htmlFail=false}={}){
 const links=new Map([
  [h(T.valid),{page_id:'html',token_hash:h(T.valid),expires_at:null,disabled_at:null}],
  [h(T.off),{page_id:'html',token_hash:h(T.off),expires_at:null,disabled_at:'2026-10-19T00:00:00Z'}],
  [h(T.other),{page_id:PAGE,token_hash:h(T.other),expires_at:null,disabled_at:null}],
 ]);
 const slugs=new Map([[sh(S.valid),{token_hash:h(T.valid),slug_hash:sh(S.valid)}],[sh(S.off),{token_hash:h(T.off),slug_hash:sh(S.off)}],[sh(S.blocks),{token_hash:h(T.other),slug_hash:sh(S.blocks)}]]);
 const pages=new Map([['html',{id:'html',title:'그래프 현황',blocks:[],status:'published'}],[PAGE,{id:PAGE,title:'민자철도 현황',blocks:[{type:'summary',text:'교섭 중'}],status:'published'}]]);
 const versions=new Map([['html','<!doctype html><title>그래프</title><script>draw()</script>']]);
 const calls={slug:[],html:[]};const logs=[];
 const handler=createShareReadHandler({
  async linkByHash(x){return links.get(x)??null;},
  async pageById(id){return pages.get(id)??null;},
  async slugByHash(x){calls.slug.push(x);return slugs.get(x)??null;},
  async latestHtml(id){calls.html.push(id);if(htmlFail)throw new Error('relation missing');return versions.get(id)??null;},
 },{now:()=>Date.parse('2026-10-20T00:00:00Z'),log:c=>logs.push(c)});
 return {handler,calls,logs};
}
test('short address opens the same link; an HTML page returns only its latest version',async()=>{
 const {handler,calls}=htmlHarness();
 const r=await post(handler,{slug:S.valid});
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{ok:true,page:{kind:'html',title:'그래프 현황',html:'<!doctype html><title>그래프</title><script>draw()</script>'}});
 assert.match(r.headers.get('Cache-Control'),/no-store/);assert.match(r.headers.get('X-Robots-Tag'),/noindex/);
 assert.deepEqual(calls.slug,[sh(S.valid)]);assert.deepEqual(calls.html,['html']);
 // The long link of the same row gives the same page.
 assert.equal((await (await post(handler,{token:T.valid})).json()).page.kind,'html');
 // A blocks page by short address still returns blocks (no kind).
 assert.deepEqual(await (await post(handler,{slug:S.blocks})).json(),{ok:true,page:{title:'민자철도 현황',blocks:[{type:'summary',text:'교섭 중'}]}});
});
test('turning the link off closes the short address too; unknown and malformed short addresses are the same 404',async()=>{
 const {handler,calls}=htmlHarness();
 await notFound(await post(handler,{slug:S.off}));
 await notFound(await post(handler,{slug:'minja-rail-k7q2m9xb'}));
 for(const slug of ['minja-rail','minja-rail-k7q2','MINJA-rail-k7q2m9xa','minja-rail-k7q2m9x0','minja-rail-k7q2m9xl','-x-abcdefgh','a-abcdefgh','x--y-abcdefgh','민자-abcdefgh','a'.repeat(41)+'-abcdefgh',12,null,['x']])await notFound(await post(handler,{slug}));
 assert.equal(calls.slug.length,2,'malformed short addresses never reach the database');
 assert.equal(slugOk('ab-abcdefgh'),true);assert.equal(slugOk('a'.repeat(40)+'-abcdefgh'),true);
 assert.equal(await slugHash(S.valid),sh(S.valid));
});
test('head:true gives the title only; bad shapes are 400',async()=>{
 const {handler,calls}=htmlHarness();
 assert.deepEqual(await (await post(handler,{slug:S.valid,head:true})).json(),{ok:true,page:{title:'그래프 현황'}});
 assert.deepEqual(await (await post(handler,{token:T.other,head:true})).json(),{ok:true,page:{title:'민자철도 현황'}});
 assert.equal(calls.html.length,0,'head never reads the HTML');
 for(const body of [{slug:S.valid,token:T.valid},{slug:S.valid,head:false},{slug:S.valid,head:'1'},{head:true},{slug:S.valid,head:true,x:1}])
  assert.equal((await post(handler,body)).status,400,JSON.stringify(body));
 // The old reader (no slug lookup) refuses {slug}.
 const {handler:old}=harness();assert.equal((await post(old,{slug:S.valid})).status,400);
});
test('an HTML lookup failure keeps block pages open and is a generic 503 for an empty page',async()=>{
 const {handler,logs}=htmlHarness({htmlFail:true});
 assert.equal((await post(handler,{slug:S.blocks})).status,200);
 const r=await post(handler,{slug:S.valid});assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'unavailable'});
 assert.ok(logs.every(c=>c==='share_page_html_unavailable'));
 const text=await (await htmlHarness().handler(new Request(URL_,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({slug:S.valid})}))).text();
 for(const secret of [S.valid,sh(S.valid),h(T.valid),'workspace','page_id','status'])assert.equal(text.includes(secret),false,secret);
});
test('index reads short addresses by hash and only the latest HTML of the page',()=>{
 const index=readFileSync('supabase/functions/share-page-read/index.ts','utf8');
 assert.match(index,/from\("app_share_page_slugs"\)\s*\.select\("token_hash,slug_hash"\)\s*\.eq\("slug_hash", hash\)/);
 assert.match(index,/from\("app_share_page_html"\)\s*\.select\("html"\)\s*\.eq\("page_id", pageId\)\s*\.order\("created_at", \{ ascending: false \}\)\s*\.limit\(1\)/);
 assert.doesNotMatch(index,/slug_name|slug_code/);
});
