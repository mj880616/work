// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S46-32 바깥 성명 ① DB(20261031230000_outside_statements): 표 넷 + app_outside_search — through the approved DB workflow runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {trackPool,closePool} from './pg-close.mjs';
import {fixture,OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261031230000',name='outside_statements',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;
const SEARCH='public.app_outside_search($1,$2,$3,$4,$5,$6,$7)';

test('outside statements db: plan, dry-run, apply, owner boundary, server-only writes, ko-only sentences, search, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'outside-statements-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const addPost=(c,ws,p)=>c.query(`insert into public.app_outside_posts(workspace_id,source_key,kind,lang,title,title_ko,url,published_at,summary_ko,key_sentences,has_body)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,[ws,p.source??'kctu',p.kind??'statement',p.lang??'ko',p.title??'[성명] 합성 제목',p.title_ko??null,
    p.url??'https://example.org/a/1',p.published??'2026-10-30T01:00:00Z',p.summary??'한 문장 요약',JSON.stringify(p.key??[]),p.body??(p.lang!=='en')]).then(r=>r.rows[0].id);
  const addSentences=(c,ws,post,texts,lang='ko')=>Promise.all(texts.map((text,idx)=>c.query('insert into public.app_outside_sentences(post_id,workspace_id,lang,idx,text) values ($1,$2,$3,$4,$5)',[post,ws,lang,idx,text])));

  await t.test('approval plan: expanded rules, full flow, no definer function',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,[]);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9921');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9922');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9923')).ok,false);
  });

  let postA,postEn;
  await t.test('sources: owner switches own rows only; server-only status columns; anon refused',async()=>{
   await owner(c=>c.query("insert into public.app_outside_sources(workspace_id,source_key) values ($1,'kctu'),($1,'jacobin')",[WS_A]));
   await assert.rejects(owner(c=>c.query("insert into public.app_outside_sources(workspace_id,source_key) values ($1,'kctu')",[WS_B])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_outside_sources(workspace_id,source_key,last_error) values ($1,'kptu','x')",[WS_A])),{code:'42501'});
   for(const bad of ['K','-a','a b','https://evil.example','a'.repeat(41)])
     await assert.rejects(owner(c=>c.query('insert into public.app_outside_sources(workspace_id,source_key) values ($1,$2)',[WS_A,bad])),{code:'23514'},bad);
   assert.equal((await owner(c=>c.query("update public.app_outside_sources set enabled=false,updated_at=now() where source_key='jacobin'"))).rowCount,1);
   await assert.rejects(owner(c=>c.query("update public.app_outside_sources set last_ok_at=now() where source_key='kctu'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_outside_sources set source_key='other' where source_key='kctu'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_outside_sources set workspace_id=$1 where source_key='kctu'",[WS_B])),{code:'42501'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_outside_sources'))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query("update public.app_outside_sources set enabled=false"))).rowCount,0);
   assert.equal((await stranger(c=>c.query("delete from public.app_outside_sources"))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_outside_sources')),{code:'42501'});
   // Collector (service_role) records status.
   assert.equal((await server(c=>c.query("update public.app_outside_sources set last_ok_at=now(),last_error='robots' where workspace_id=$1 and source_key='kctu'",[WS_A]))).rowCount,1);
   await assert.rejects(server(c=>c.query("update public.app_outside_sources set last_error='Robots Blocked' where source_key='kctu'")),{code:'23514'});
  });
  await t.test('posts and sentences: only the server writes; owner reads; stranger and anon see nothing',async()=>{
   postA=await server(c=>addPost(c,WS_A,{url:'https://www.nodong.org/statement/1'}));
   await server(c=>addSentences(c,WS_A,postA,['정부는 구조조정을 즉각 중단하라.','인력 감축은 안전을 무너뜨린다.','노동자는 100% 싸운다_끝까지.']));
   await assert.rejects(owner(c=>addPost(c,WS_A,{url:'https://example.org/own'})),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_outside_posts set title='x'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_outside_posts')),{code:'42501'});
   await assert.rejects(owner(c=>addSentences(c,WS_A,postA,['끼워 넣기'])),{code:'42501'});
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_outside_posts'))).rows[0].n,1);
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_outside_sentences'))).rows[0].n,3);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_outside_posts'))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_outside_sentences'))).rows[0].n,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_outside_posts')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_outside_sentences')),{code:'42501'});
   // Same url once per workspace; another workspace may hold its own copy.
   await assert.rejects(server(c=>addPost(c,WS_A,{url:'https://www.nodong.org/statement/1'})),{code:'23505'});
   assert.ok(await server(c=>addPost(c,WS_B,{url:'https://www.nodong.org/statement/1'})));
  });
  await t.test('foreign posts: summary and up to 3 key sentences only; no stored body or sentence rows',async()=>{
   const key=[{orig:'Workers win when they organize.',ko:'노동자는 조직할 때 이긴다.'}];
   postEn=await server(c=>addPost(c,WS_A,{source:'jacobin',kind:'article',lang:'en',title:'Synthetic title',title_ko:'합성 제목',url:'https://jacobin.com/2026/10/x',key,body:false}));
   await assert.rejects(server(c=>addSentences(c,WS_A,postEn,['Full body sentence.'],'en')),{code:'23514'});
   await assert.rejects(server(c=>addSentences(c,WS_A,postEn,['Full body sentence.'],'ko')),{code:'23503'});
   await assert.rejects(server(c=>addPost(c,WS_A,{lang:'en',url:'https://jacobin.com/b',body:true})),{code:'23514'});
   for(const bad of [[1,2,3,4].map(()=>key[0]),[{orig:'x'}],[{orig:'x',ko:''}],[{orig:'a'.repeat(301),ko:'b'}],['text'],[{orig:1,ko:'b'}]])
     await assert.rejects(server(c=>addPost(c,WS_A,{lang:'en',url:'https://jacobin.com/c',key:bad,body:false})),{code:'23514'},JSON.stringify(bad).slice(0,60));
   await assert.rejects(server(c=>addPost(c,WS_A,{lang:'ko',url:'https://example.org/k',key})),{code:'23514'},'domestic posts carry no key sentences');
   // Sentence rows must belong to a post in the same workspace.
   await assert.rejects(server(c=>c.query("insert into public.app_outside_sentences(post_id,workspace_id,idx,text) values ($1,$2,50,'다른 작업공간')",[postA,WS_B])),{code:'23503'});
   for(const bad of [{kind:'tweet'},{lang:'jp'},{url:'javascript:alert(1)'},{url:'https://a b'},{title:''},{title:'줄\n바꿈'},{source:'Bad Key'}])
     await assert.rejects(server(c=>addPost(c,WS_A,{url:'https://example.org/bad',...bad})),{code:'23514'},JSON.stringify(bad));
  });
  await t.test('seen time: owner sets own row; stranger cannot',async()=>{
   await owner(c=>c.query("insert into public.app_outside_seen(workspace_id,seen_at) values ($1,now())",[WS_A]));
   assert.equal((await owner(c=>c.query('update public.app_outside_seen set seen_at=now(),updated_at=now()'))).rowCount,1);
   await assert.rejects(owner(c=>c.query("insert into public.app_outside_seen(workspace_id,seen_at) values ($1,now())",[WS_B])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_outside_seen')),{code:'42501'});
   assert.equal((await stranger(c=>c.query('update public.app_outside_seen set seen_at=now()'))).rowCount,0);
  });
  await t.test('search: words and similar words, neighbours, literal wildcards, filters, owner only, anon refused',async()=>{
   const s=(fn,args)=>fn(c=>c.query(`select * from ${SEARCH}`,args)).then(r=>r.rows);
   const a=await s(owner,['구조조정',['인력 감축','구조조정'],null,null,null,null,null]);
   assert.equal(a.length,2);
   assert.deepEqual(a.map(r=>[r.idx,r.matched,r.is_similar]),[[0,'구조조정',false],[1,'인력 감축',true]]);
   assert.equal(a[0].next_sentence,'인력 감축은 안전을 무너뜨린다.');assert.equal(a[0].prev_sentence,null);
   assert.equal(a[1].prev_sentence,'정부는 구조조정을 즉각 중단하라.');
   assert.equal(a[0].title,'[성명] 합성 제목');assert.equal(a[0].source_key,'kctu');
   // %, _ and \ are literal characters, not patterns.
   assert.equal((await s(owner,['%',null,null,null,null,null,null])).length,1);
   assert.equal((await s(owner,['_끝',null,null,null,null,null,null])).length,1);
   assert.equal((await s(owner,['0% 싸운다_',null,null,null,null,null,null])).length,1);
   assert.equal((await s(owner,['\\',null,null,null,null,null,null])).length,0);
   assert.equal((await s(owner,['   ',['구조조정'],null,null,null,null,null])).length,0,'empty main word → empty');
   assert.equal((await s(owner,['구조조정',null,['jacobin'],null,null,null,null])).length,0);
   assert.equal((await s(owner,['구조조정',null,['kctu'],'2026-10-30','2026-10-30',null,null])).length,1);
   assert.equal((await s(owner,['구조조정',null,null,'2026-10-31',null,null,null])).length,0);
   assert.equal((await s(owner,['.',null,null,null,null,null,null])).length,3);
   assert.equal((await s(owner,['.',null,null,null,null,1,2])).length,1);
   assert.equal((await s(owner,['.',null,null,null,null,1,5])).length,0);
   // Main word + up to 6 similar words; blanks and nulls are skipped.
   assert.equal((await s(owner,['zz',['a','b','c','d','e','다'],null,null,null,null,null])).length,2);
   assert.equal((await s(owner,['zz',['a','b','c','d','e','f','다'],null,null,null,null,null])).length,0);
   assert.equal((await s(owner,['구조조정',[null,'  '],null,null,null,null,null])).length,1);
   assert.equal((await s(owner,[null,null,null,null,null,null,null])).length,0);
   // Stranger has its own copy of the post but no sentences: nothing from the owner's workspace.
   assert.equal((await s(stranger,['구조조정',['인력 감축'],null,null,null,null,null])).length,0);
   await assert.rejects(as('anon','',c=>c.query(`select * from ${SEARCH}`,['구조조정',null,null,null,null,null,null])),{code:'42501'});
  });
  await t.test('deleting a post removes its sentences; rollback returns to the snapshot',async()=>{
   await server(c=>c.query('delete from public.app_outside_posts where id=$1',[postA]));
   assert.equal((await pool.query('select count(*)::int n from public.app_outside_sentences')).rows[0].n,0);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
