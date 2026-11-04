// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// CALL-업무기본: 20261104200000_call_contact_choice (이전 단계 20261025200000 위) — personal/unsure calls live in their own table app_call_personal,
// so no work-side reader (원장 자동 기록 등) can see them. Moving between the two boxes is one owner-checked, atomic function.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {trackPool,closePool} from './pg-close.mjs';
import {fixture,OWNER,STRANGER,WS_A,PROJECT_A,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261104200000',name='call_contact_choice',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const CALL={workspace_id:WS_A,source:'call',day:'2026-10-24',occurred_at:'2026-10-24T01:10:00Z',title:'가상 업무 통화',points:'["가상 요점"]',raw_text:'가상 전문',source_ref:'call:cb-work1'};
const PERSONAL={workspace_id:WS_A,kind:'personal',day:'2026-10-24',occurred_at:'2026-10-24T02:10:00Z',title:'가상 개인 통화',points:'["가상 요점"]',raw_text:'가상 개인 전문',source_ref:'call:cb-p1'};
const files=async dir=>{const out=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.name==='node_modules'||e.name==='.git')continue;const p=join(dir,e.name);if(e.isDirectory())out.push(...await files(p));else out.push(p);}return out;};

test('call contact choice: remembered work/personal per counterpart (keyed, owner-only), move function carries the key; rollback guarded',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'call-contact-choice-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  // Production: service_role has no USAGE on schema private; the owner reads app_spaces through RLS.
  await pool.query('revoke usage on schema private from service_role');
  await pool.query('grant select on public.app_spaces to authenticated');
  await pool.query('alter table public.app_spaces enable row level security');
  await pool.query('create policy fake_owner_read on public.app_spaces for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
  await pool.query(await read('supabase/migrations/20261024140000_call_tg_feed.sql'));
  await pool.query(await read('supabase/migrations/20261024210000_feed_item_guard_public.sql'));
  await pool.query(await read('supabase/migrations/20261025200000_call_personal_box.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const K=n=>String(n).repeat(64).slice(0,64);
  const putWork=(c,row,over={})=>{const r={...row,...over};const cols=['workspace_id','source','day','occurred_at','title','points','raw_text','source_ref'].filter(k=>k in r);
   return c.query(`insert into public.app_feed_items(${cols.join(',')}) values(${cols.map((k,i)=>k==='points'?`$${i+1}::jsonb`:`$${i+1}`).join(',')})`,cols.map(k=>r[k]));};
  const putPersonal=(c,row,over={})=>{const r={...row,...over};const cols=['workspace_id','kind','day','occurred_at','title','points','raw_text','source_ref'].filter(k=>k in r);
   return c.query(`insert into public.app_call_personal(${cols.join(',')}) values(${cols.map((k,i)=>k==='points'?`$${i+1}::jsonb`:`$${i+1}`).join(',')})`,cols.map(k=>r[k]));};
  const workOf=async ref=>(await pool.query('select * from public.app_feed_items where source_ref=$1',[ref])).rows[0];
  const personalOf=async ref=>(await pool.query('select * from public.app_call_personal where source_ref=$1',[ref])).rows[0];
  const move=(id,to)=>owner(c=>c.query('select public.app_call_move($1,$2) r',[id,to])).then(r=>r.rows[0].r);
  const ref=(c,source_ref,key)=>c.query('insert into public.app_call_contact_ref(workspace_id,source_ref,contact_key) values($1,$2,$3)',[WS_A,source_ref,key]);
  const choices=async()=>(await pool.query('select contact_key,choice from public.app_call_contact_choice order by contact_key')).rows;
  // 앞 단계 때 이미 있던 줄(열쇠 없음)
  await server(c=>putWork(c,CALL,{source_ref:'call:cc-old'}));
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);

  await t.test('before: no choice table, no ref table',async()=>{
   assert.equal((await pool.query("select to_regclass('public.app_call_contact_choice') t, to_regclass('public.app_call_contact_ref') r")).rows[0].t,null);
   await assert.rejects(server(c=>ref(c,'call:cc-old',K('a'))),/app_call_contact_ref/);
  });
  await t.test('files: expanded rules pass; one new table, move function replaced in place; no anon/PUBLIC; summary 3 lines; rollback guarded',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const plan=prepareMigration({mode,version,runId:'1',root});assert.equal(plan.rules,'expanded');assert.deepEqual(plan.createdTables.sort(),['app_call_contact_choice','app_call_contact_ref']);assert.ok(plan.functions.includes('public.app_call_move'));}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b|disable row level security|alter policy|drop policy|rtw_|grant usage on schema/i);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261104200000', 'call_contact_choice'/);
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);assert.match(rollbackSQL,/CALL_CONTACT_CHOICE_ROLLBACK_BLOCKED/);
  });
  await t.test('precheck; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const dry=await run('dry-run','9951');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9952');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);else assert.equal(value,v[item],item);}
   assert.equal((await run('apply','9953')).ok,false);
  });
  await t.test('the server writes one key per call; the key is shape-checked; calls without a key remember nothing',async()=>{
   await server(c=>putWork(c,CALL,{source_ref:'call:cc-w1'}));await server(c=>ref(c,'call:cc-w1',K('a')));
   await server(c=>putPersonal(c,PERSONAL,{kind:'unsure',source_ref:'call:cc-u1'}));await server(c=>ref(c,'call:cc-u1',K('b')));
   await server(c=>putPersonal(c,PERSONAL,{kind:'unsure',source_ref:'call:cc-u2'}));await server(c=>ref(c,'call:cc-u2',K('c')));
   await server(c=>putPersonal(c,PERSONAL,{kind:'unsure',source_ref:'call:cc-nokey'}));
   await assert.rejects(server(c=>ref(c,'call:cc-bad','010-1234-5678')),{code:'23514'});
   await assert.rejects(server(c=>ref(c,'call:cc-bad2','A'.repeat(64))),{code:'23514'});
   await assert.rejects(server(c=>ref(c,'call:cc-w1',K('d'))),{code:'23505'},'one key per call');
   assert.deepEqual(await choices(),[]);
  });
  await t.test('moves remember the chosen box per counterpart (unsure to work/personal, work to personal, personal back to work); same-box and keyless moves do not',async()=>{
   const u1=await personalOf('call:cc-u1'),u2=await personalOf('call:cc-u2'),w1=await workOf('call:cc-w1'),nk=await personalOf('call:cc-nokey'),old=await workOf('call:cc-old');
   assert.equal((await move(u1.id,'work')).needs_refill,true);
   assert.deepEqual(await choices(),[{contact_key:K('b'),choice:'work'}]);
   assert.ok(await workOf('call:cc-u1'),'moved to the work box');
   assert.equal((await move(u2.id,'personal')).changed,true);
   assert.deepEqual((await choices()).map(r=>r.choice+K('x').slice(0,0)+r.contact_key[0]),['workb','personalc']);
   assert.equal((await move(w1.id,'personal')).changed,true);
   assert.deepEqual((await choices()).find(r=>r.contact_key===K('a')),{contact_key:K('a'),choice:'personal'});
   assert.equal((await move(w1.id,'work')).changed,true);
   assert.deepEqual((await choices()).find(r=>r.contact_key===K('a')),{contact_key:K('a'),choice:'work'},'a correction replaces the remembered choice');
   assert.equal((await move(w1.id,'work')).changed,false);
   await move(nk.id,'work');await move(old.id,'personal');
   assert.equal((await choices()).length,3,'rows without a key add nothing');
  });
  await t.test('visibility and writes: owner reads own choices; stranger sees none; nobody but the move function writes; server reads three columns only',async()=>{
   assert.equal((await owner(c=>c.query('select * from public.app_call_contact_choice'))).rows.length,3);
   assert.equal((await stranger(c=>c.query('select * from public.app_call_contact_choice'))).rows.length,0);
   await assert.rejects(as('anon','',c=>c.query('select * from public.app_call_contact_choice')),{code:'42501'});
   await assert.rejects(stranger(c=>c.query('select public.app_call_move(gen_random_uuid(),$1)',['work'])),{message:/CALL_NOT_FOUND/});
   const w=await workOf('call:cc-w1');
   await assert.rejects(stranger(c=>c.query('select public.app_call_move($1,$2)',[w.id,'personal'])),{message:/CALL_NOT_FOUND/});
   await assert.rejects(owner(c=>c.query("insert into public.app_call_contact_choice(workspace_id,contact_key,choice) values($1,$2,'work')",[WS_A,K('d')])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_call_contact_choice set choice='work'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_call_contact_choice')),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_call_contact_ref(workspace_id,source_ref,contact_key) values($1,'call:cc-own',$2)",[WS_A,K('e')])),{code:'42501'});
   assert.equal((await owner(c=>c.query('select * from public.app_call_contact_ref'))).rows.length,3);
   assert.equal((await stranger(c=>c.query('select * from public.app_call_contact_ref'))).rows.length,0);
   await assert.rejects(server(c=>c.query('select contact_key from public.app_call_contact_ref')),{code:'42501'},'the server cannot read keys back');
   await assert.rejects(server(c=>c.query("insert into public.app_call_contact_choice(workspace_id,contact_key,choice) values($1,$2,'work')",[WS_A,K('d')])),{code:'42501'});
   await assert.rejects(server(c=>c.query("update public.app_call_contact_choice set choice='work'")),{code:'42501'});
   await assert.rejects(server(c=>c.query('select updated_at from public.app_call_contact_choice')),{code:'42501'});
   const rows=(await server(c=>c.query('select workspace_id,contact_key,choice from public.app_call_contact_choice where contact_key=$1',[K('a')]))).rows;
   assert.deepEqual(rows,[{workspace_id:WS_A,contact_key:K('a'),choice:'work'}]);
  });
  await t.test('⑤ census (select only) counts rule hits among old unsure calls by counterpart text; sweep moves exactly those once the count matches',async()=>{
   await pool.query("alter table public.app_suborganizations add column aliases text[], add column active boolean, add column deleted_at timestamptz");
   await pool.query("update public.app_suborganizations set name='가상노동조합', aliases=array['가상노조'], active=true where id=$1",[ORG_A]);
   const U=(ref,cp,over={})=>server(c=>putPersonal(c,PERSONAL,{kind:'unsure',source_ref:ref,...over})).then(()=>cp===undefined?null:pool.query('update public.app_call_personal set counterpart=$1 where source_ref=$2',[cp,ref]));
   await U('call:sw-hit1','가상 노동조합 김가상 위원장');
   await U('call:sw-hit2','가상노조 박가상');
   await U('call:sw-miss','김가상 팀장');
   await U('call:sw-none');
   await U('call:sw-hidden','가상노조 이가상');await pool.query("update public.app_call_personal set hidden_at=now() where source_ref='call:sw-hidden'");
   const census=await readOnly(await read('docs/ops/call-unsure-census.sql'));
   const v=values(census);
   const hit=Number(Object.entries(v).find(([k])=>/^rule hit/.test(k))[1]);
   assert.equal(hit,2);
   assert.ok(Number(v['unsure calls (not hidden)'])>=4);
   assert.equal(Number(Object.entries(v).find(([k])=>/^remaining/.test(k))[1]),Number(v['unsure calls (not hidden)'])-2);
   const sweep=await read('docs/ops/call-unsure-sweep.sql');
   const blocked=async sql=>{const c=await pool.connect();try{await assert.rejects(c.query(sql),/CALL_UNSURE_SWEEP_COUNT_MISMATCH/);await c.query('rollback');}finally{c.release();}};
   await blocked(sweep);
   await blocked(sweep.replace('expected integer := -1','expected integer := 3'));
   await pool.query(sweep.replace('expected integer := -1','expected integer := 2'));
   for(const ref of ['call:sw-hit1','call:sw-hit2']){const w=await workOf(ref);assert.ok(w&&w.moved_at&&w.refilled_at===null&&w.organization_id===null,ref);assert.equal(await personalOf(ref),undefined);}
   for(const ref of ['call:sw-miss','call:sw-none','call:sw-hidden'])assert.equal((await personalOf(ref)).kind,'unsure',ref);
   assert.equal((await readOnly(await read('docs/ops/call-unsure-census.sql'))).length,4);
   assert.equal(Number(Object.entries(values(await readOnly(await read('docs/ops/call-unsure-census.sql')))).find(([k])=>/^rule hit/.test(k))[1]),0,'second run finds nothing');
  });
  await t.test('rollback is refused while remembered choices exist, then restores the snapshot; re-apply works',async()=>{
   const blocked=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/CALL_CONTACT_CHOICE_ROLLBACK_BLOCKED/);await c.query('rollback');}finally{c.release();}};
   await blocked();
   await pool.query('delete from public.app_call_contact_choice');
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regclass('public.app_call_contact_choice') t")).rows[0].t,null);
   assert.equal((await pool.query("select to_regclass('public.app_call_contact_ref') t")).rows[0].t,null);
   assert.equal((await pool.query("select count(*)::int n from pg_proc where oid=to_regprocedure('public.app_call_move(uuid,text)') and prosrc like '%contact_key%'")).rows[0].n,0,'previous function body restored');
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
