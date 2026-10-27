// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// TG-카드밀기 1단계: 20261025210000_feed_item_archive - a telegram item is normal, archived (archived_at) or trashed (hidden_at).
// The only writer of the new column is one owner-checked, telegram-only function; nobody gets a column privilege on it.
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
import {fixture,OWNER,STRANGER,WS_A} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261025210000',name='feed_item_archive',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const TG={workspace_id:WS_A,source:'telegram',day:'2026-10-25',occurred_at:'2026-10-25T01:10:00Z',room_key:'room-a1',room_label:'가상 방',summary:'가상 요약',raw_count:1,points:'[]',source_ref:'tg:fa1'};
const CALL={workspace_id:WS_A,source:'call',day:'2026-10-25',occurred_at:'2026-10-25T01:10:00Z',title:'가상 통화',raw_count:0,points:'[]',source_ref:'call:fa1'};
const MISSING='99999999-9999-4999-8999-999999999999';

test('feed item archive: one owner-checked telegram-only function writes the new column; no new privilege for anyone; rollback guarded',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'feed-item-archive-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
 const COLS=['workspace_id','source','day','occurred_at','room_key','room_label','title','summary','raw_count','points','source_ref'];
  const put=(c,row,over={})=>{const r={...row,...over};const cols=COLS.filter(k=>k in r);
   return c.query(`insert into public.app_feed_items(${cols.join(',')}) values(${cols.map((k,i)=>k==='points'?`$${i+1}::jsonb`:`$${i+1}`).join(',')})`,cols.map(k=>r[k]));};
  const rowOf=async ref=>(await pool.query('select * from public.app_feed_items where source_ref=$1',[ref])).rows[0];
  const setState=(id,state)=>owner(c=>c.query('select public.app_feed_set_state($1,$2) r',[id,state])).then(r=>r.rows[0].r);
  const before=(await pool.query(snapshot)).rows;
  await server(c=>put(c,TG));
  await server(c=>put(c,TG,{source_ref:'tg:fa2',summary:'가상 요약 둘'}));
  await server(c=>put(c,CALL));
  const beforeCheck=await readOnly(precheck);

  await t.test('before: the new column and the function do not exist yet',async()=>{
   assert.equal((await pool.query("select to_regprocedure('public.app_feed_set_state(uuid,text)') f")).rows[0].f,null);
   await assert.rejects(pool.query('select archived_at from public.app_feed_items'),/archived_at/);
  });
  await t.test('files: expanded rules pass; one definer function, one grant, one revoke, no policy or trigger; no grant on the existing table; summary 3 lines; rollback guarded',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.functions,['public.app_feed_set_state']);
    assert.deepEqual(plan.review.definer,['public.app_feed_set_state']);
    assert.deepEqual([plan.review.policies,plan.review.triggers,plan.review.grants,plan.review.revokes],[0,0,1,1]);
    assert.deepEqual(plan.createdTables,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant execute on function public.app_feed_set_state(uuid, text) to authenticated;']);
   assert.doesNotMatch(code,/grant [^;]*app_feed_items/i);
   assert.doesNotMatch(code,/disable row level security|create or replace|alter policy|drop policy|create policy|create trigger|rtw_|grant usage on schema|drop constraint|add constraint/i);
   assert.ok(code.includes('revoke all on function public.app_feed_set_state(uuid, text) from public, anon, authenticated, service_role;'));
   assert.ok(code.indexOf('revoke all on function')<code.indexOf('grant execute on function'));
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261025210000', 'feed_item_archive'/);
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);assert.match(rollbackSQL,/FEED_ITEM_ARCHIVE_ROLLBACK_BLOCKED/);
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const dry=await run('dry-run','9951');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await readOnly(precheck),beforeCheck);
   const apply=await run('apply','9952');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9953')).ok,false);
  });
  await t.test('after: existing rows are untouched (column empty); the owner moves a telegram item between normal, archived and trashed in one step',async()=>{
   const a=await rowOf('tg:fa1');
   assert.equal(a.archived_at,null);assert.equal(a.hidden_at,null);
   const r1=await setState(a.id,'archived');
   assert.deepEqual([r1.ok,r1.state],[true,'archived']);
   let row=await rowOf('tg:fa1');assert.ok(row.archived_at);assert.equal(row.hidden_at,null);
   const stamp=row.archived_at.getTime();
   await setState(a.id,'archived');
   assert.equal((await rowOf('tg:fa1')).archived_at.getTime(),stamp,'archiving twice keeps the first time');
   await setState(a.id,'trashed');
   row=await rowOf('tg:fa1');assert.equal(row.archived_at,null);assert.ok(row.hidden_at);
   await setState(a.id,'archived');
   row=await rowOf('tg:fa1');assert.ok(row.archived_at);assert.equal(row.hidden_at,null);
   await setState(a.id,'active');
   row=await rowOf('tg:fa1');assert.equal(row.archived_at,null);assert.equal(row.hidden_at,null);
   assert.equal(row.summary,'가상 요약','text is not touched');
  });
  await t.test('after: calls, strangers, anon, service_role, unknown rows and unknown states are refused',async()=>{
   const tg=await rowOf('tg:fa2'),call=await rowOf('call:fa1');
   await assert.rejects(owner(c=>c.query("select public.app_feed_set_state($1,'archived')",[call.id])),/FEED_STATE_TELEGRAM_ONLY/);
   await assert.rejects(owner(c=>c.query("select public.app_feed_set_state($1,'secret')",[tg.id])),/FEED_STATE_TARGET/);
   await assert.rejects(owner(c=>c.query("select public.app_feed_set_state($1,null)",[tg.id])),/FEED_STATE_TARGET/);
   await assert.rejects(owner(c=>c.query("select public.app_feed_set_state($1,'archived')",[MISSING])),/FEED_NOT_FOUND/);
   await assert.rejects(stranger(c=>c.query("select public.app_feed_set_state($1,'archived')",[tg.id])),/FEED_NOT_FOUND/);
   await assert.rejects(as('anon','',c=>c.query("select public.app_feed_set_state($1,'archived')",[tg.id])),{code:'42501'});
   await assert.rejects(server(c=>c.query("select public.app_feed_set_state($1,'archived')",[tg.id])),{code:'42501'});
   const after=await rowOf('tg:fa2');assert.deepEqual([after.archived_at,after.hidden_at],[null,null]);
  });
  await t.test('after: nobody gets a direct privilege on the new column; delete (hidden_at) still works through the old path; existing denials stay',async()=>{
   const tg=await rowOf('tg:fa2');
   await assert.rejects(owner(c=>c.query('update public.app_feed_items set archived_at=now() where id=$1',[tg.id])),{code:'42501'});
   await assert.rejects(server(c=>put(c,TG,{source_ref:'tg:fa-bad'}).then(()=>c.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,room_key,room_label,summary,raw_count,points,source_ref,archived_at) values($1,'telegram','2026-10-25','2026-10-25T00:00:00Z','room-a1','가상 방','가상',1,'[]','tg:fa-bad2',now())",[WS_A]))),{code:'42501'});
   await assert.rejects(server(c=>c.query('select archived_at from public.app_feed_items')),{code:'42501'});
   await assert.rejects(server(c=>c.query('update public.app_feed_items set archived_at=now()')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select archived_at from public.app_feed_items')),{code:'42501'});
   await owner(c=>c.query('update public.app_feed_items set hidden_at=now() where id=$1',[tg.id]));
   assert.ok((await rowOf('tg:fa2')).hidden_at);
   await owner(c=>c.query('update public.app_feed_items set hidden_at=null where id=$1',[tg.id]));
   await assert.rejects(owner(c=>c.query('delete from public.app_feed_items where id=$1',[tg.id])),{code:'42501'});
   await assert.rejects(owner(c=>put(c,TG,{source_ref:'tg:fa-own'})),{code:'42501'});
   const seen=(await owner(c=>c.query('select count(*)::int n from public.app_feed_items'))).rows[0].n;
   assert.ok(seen>=3);
   assert.equal((await stranger(c=>c.query('select * from public.app_feed_items'))).rows.length,0);
  });
  await t.test('rollback is refused while archived items exist, then restores the snapshot; re-apply works',async()=>{
   const tg=await rowOf('tg:fa2');
   await setState(tg.id,'archived');
   const blocked=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/FEED_ITEM_ARCHIVE_ROLLBACK_BLOCKED/);await c.query('rollback');}finally{c.release();}};
   await blocked();
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1,'nothing changed');
   await setState(tg.id,'active');
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query("select to_regprocedure('public.app_feed_set_state(uuid,text)') f")).rows[0].f,null);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
