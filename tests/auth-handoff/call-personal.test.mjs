// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// CALL-개인통화함 1단계: 20261025190000_call_personal — personal/unsure calls live in app_feed_items under their own source value,
// so every reader that asks for source='call' (원장 자동 기록 등) never sees them. Moving goes through one owner-checked function; no column grant is added.
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
import {fixture,OWNER,STRANGER,WS_A,PROJECT_A,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261025190000',name='call_personal',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const CALL={workspace_id:WS_A,source:'call',day:'2026-10-24',occurred_at:'2026-10-24T01:10:00Z',title:'가상 업무 통화',points:'["가상 요점"]',raw_text:'가상 전문',source_ref:'call:cp-work1'};

test('call personal: new source values, owner-checked move, links blocked on personal rows, readers of source=call unaffected; rollback guarded',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'call-personal-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  // Production: service_role has no USAGE on schema private; the owner reads app_spaces through RLS. Same setup as the guard test.
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
  const COLS=['workspace_id','source','day','occurred_at','title','points','raw_text','organization_id','suggested_project_id','source_ref','pinned_at','moved_at'];
  const put=(c,row,over={})=>{const r={...row,...over};const cols=COLS.filter(k=>k in r);
   return c.query(`insert into public.app_feed_items(${cols.join(',')}) values(${cols.map((k,i)=>k==='points'?`$${i+1}::jsonb`:`$${i+1}`).join(',')})`,cols.map(k=>r[k]));};
  const rowOf=async ref=>(await pool.query('select * from public.app_feed_items where source_ref=$1',[ref])).rows[0];
  const move=(id,to)=>owner(c=>c.query('select public.app_feed_call_move($1,$2) r',[id,to])).then(r=>r.rows[0].r);
  const before=(await pool.query(snapshot)).rows;
  await server(c=>put(c,CALL,{organization_id:ORG_A}));
  await server(c=>put(c,CALL,{source_ref:'call:cp-work2',title:'가상 통화 둘'}));
  const beforeCheck=await readOnly(precheck);

  await t.test('before: personal and unsure values and the move functions do not exist yet',async()=>{
   await assert.rejects(server(c=>put(c,CALL,{source:'call_personal',source_ref:'call:cp-early'})),/app_feed_items_source_check|violates check constraint/);
   assert.equal((await pool.query("select to_regprocedure('public.app_feed_call_move(uuid,text)') f")).rows[0].f,null);
  });
  await t.test('files: expanded rules pass; guard replaced plus two owner-checked definer functions; no table grant, policy or table; summary 3 lines; rollback guarded',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.functions,['private.app_feed_item_guard','public.app_feed_call_move','public.app_feed_call_work_info']);
    assert.deepEqual(plan.review.definer,['public.app_feed_call_move','public.app_feed_call_work_info']);
    assert.equal(plan.review.policies,0);assert.deepEqual(plan.createdTables,[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.deepEqual([...code.matchAll(/^grant .*$/gim)].map(m=>m[0]),['grant execute on function public.app_feed_call_move(uuid, text) to authenticated;','grant execute on function public.app_feed_call_work_info(uuid, text, text, uuid) to authenticated;']);
   assert.doesNotMatch(code,/disable row level security|create policy|alter policy|drop policy|create table|rtw_|grant usage on schema/i);
   const guard=code.slice(code.indexOf('as $guard$'),code.indexOf('$guard$;'));
   assert.doesNotMatch(guard,/private\./);
   assert.match(code,/revoke all on function private\.app_feed_item_guard\(\) from public, anon, authenticated, service_role;/);
   assert.match(code,/revoke all on function public\.app_feed_call_move\(uuid, text\) from public, anon, authenticated, service_role;/);
   assert.match(code,/revoke all on function public\.app_feed_call_work_info\(uuid, text, text, uuid\) from public, anon, authenticated, service_role;/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261025190000', 'call_personal'/);
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);assert.match(rollbackSQL,/CALL_PERSONAL_ROLLBACK_BLOCKED/);
   // The old guard body in the rollback is the previous migration's, character for character.
   const body=s=>{const i=s.indexOf('function private.app_feed_item_guard');return s.slice(s.indexOf('as $guard$',i),s.indexOf('$guard$;',i)+8);};
   assert.equal(body(rollbackSQL),body(await read('supabase/migrations/20261024210000_feed_item_guard_public.sql')));
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const dry=await run('dry-run','9931');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await readOnly(precheck),beforeCheck);
   const apply=await run('apply','9932');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9933')).ok,false);
  });
  await t.test('after: existing rows are unchanged work calls; owner moves work to personal and the links and pin are cleared by the database',async()=>{
   const w1=await rowOf('call:cp-work1');
   assert.equal(w1.source,'call');assert.equal(w1.moved_at,null);assert.equal(w1.organization_id,ORG_A);
   await owner(c=>c.query('update public.app_feed_items set pinned_at=now() where id=$1',[w1.id]));
   const r=await move(w1.id,'personal');
   assert.deepEqual([r.ok,r.from,r.to,r.changed,r.needs_refill],[true,'call','call_personal',true,false]);
   const p=await rowOf('call:cp-work1');
   assert.equal(p.source,'call_personal');assert.equal(p.organization_id,null);assert.equal(p.pinned_at,null);assert.ok(p.moved_at);assert.equal(p.refilled_at,null);
   assert.equal(p.raw_text,'가상 전문','the row and its text are kept, only moved');
   assert.equal((await move(w1.id,'personal')).changed,false,'same target is a no-op');
  });
  await t.test('after: a reader that asks for source=call never sees personal or unsure rows',async()=>{
   const w2=await rowOf('call:cp-work2');
   await move(w2.id,'unsure');
   const seen=await owner(c=>c.query("select source_ref from public.app_feed_items where source='call' order by source_ref"));
   assert.deepEqual(seen.rows,[]);
   const all=await owner(c=>c.query("select source from public.app_feed_items where source like 'call%' order by source"));
   assert.deepEqual(all.rows.map(x=>x.source),['call_personal','call_unsure']);
   await move(w2.id,'work');
   assert.deepEqual((await owner(c=>c.query("select source_ref from public.app_feed_items where source='call'"))).rows.map(x=>x.source_ref),['call:cp-work2']);
  });
  await t.test('after: personal rows cannot be linked, pinned or retitled by anyone; direct source/title writes stay denied; raw text stays clear-only',async()=>{
   const p=await rowOf('call:cp-work1');
   for(const sql of ["update public.app_feed_items set organization_id='"+ORG_A+"' where id='"+p.id+"'","update public.app_feed_items set project_id='"+PROJECT_A+"' where id='"+p.id+"'","update public.app_feed_items set pinned_at=now() where id='"+p.id+"'"])
    await assert.rejects(owner(c=>c.query(sql)),/app_feed_items_call_class_check/);
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set source='call' where id=$1",[p.id])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set title='x' where id=$1",[p.id])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set moved_at=null where id=$1",[p.id])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set raw_text='되살리기' where id=$1",[p.id])),/FEED_RAW_TEXT_CLEAR_ONLY/);
   await assert.rejects(server(c=>put(c,CALL,{source:'call_personal',source_ref:'call:cp-bad',organization_id:ORG_A})),/app_feed_items_call_class_check/);
   await assert.rejects(pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,points,source_ref,pinned_at) values($1,'call_unsure','2026-10-24','2026-10-24T01:00:00Z','가상','[]','call:cp-bad2',now())",[WS_A]),/app_feed_items_call_class_check/,'even the table owner cannot pin a non-work call');
   await assert.rejects(server(c=>put(c,CALL,{source:'call_unsure',source_ref:'call:cp-bad4',pinned_at:'2026-10-25T00:00:00Z'})),{code:'42501'},'service_role has no pin column');
   await assert.rejects(server(c=>put(c,CALL,{source_ref:'call:cp-bad3',moved_at:'2026-10-25T00:00:00Z'})),{code:'42501'});
  });
  await t.test('after: service_role stores personal and unsure calls once per original across all three values',async()=>{
   await server(c=>put(c,CALL,{source:'call_personal',source_ref:'call:cp-p1',organization_id:null}));
   await server(c=>put(c,CALL,{source:'call_unsure',source_ref:'call:cp-u1',organization_id:null}));
   await assert.rejects(server(c=>put(c,CALL,{source:'call',source_ref:'call:cp-p1'})),{code:'23505'});
   await assert.rejects(server(c=>put(c,CALL,{source:'call_unsure',source_ref:'call:cp-p1'})),{code:'23505'});
   await assert.rejects(server(c=>put(c,CALL,{source:'call_personal',source_ref:'call:cp-p1'})),{code:'23505'});
   await assert.rejects(server(c=>c.query("update public.app_feed_items set summary='x'")),{code:'42501'});
   await assert.rejects(server(c=>c.query('delete from public.app_feed_items')),{code:'42501'});
  });
  await t.test('after: only calls move; other owners and roles cannot; targets are checked',async()=>{
   await server(c=>c.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,room_key,room_label,summary,raw_count,points,source_ref) values($1,'telegram','2026-10-24','2026-10-24T00:00:00Z','room-a1','가상 방','가상',1,'[]','tg:cp1')",[WS_A]));
   const tg=await rowOf('tg:cp1'),w2=await rowOf('call:cp-work2');
   await assert.rejects(owner(c=>c.query("select public.app_feed_call_move($1,'personal')",[tg.id])),/FEED_NOT_CALL/);
   await assert.rejects(owner(c=>c.query("select public.app_feed_call_move($1,'secret')",[w2.id])),/FEED_MOVE_TARGET/);
   await assert.rejects(owner(c=>c.query("select public.app_feed_call_move($1,'personal')",['99999999-9999-4999-8999-999999999999'])),/FEED_NOT_FOUND/);
   await assert.rejects(stranger(c=>c.query("select public.app_feed_call_move($1,'personal')",[w2.id])),/FEED_NOT_FOUND/);
   await assert.rejects(as('anon','',c=>c.query("select public.app_feed_call_move($1,'personal')",[w2.id])),{code:'42501'});
   await assert.rejects(server(c=>c.query("select public.app_feed_call_move($1,'personal')",[w2.id])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('select private.app_feed_item_guard()')),{code:/^(42501|0A000)$/});
   assert.equal((await rowOf('call:cp-work2')).source,'call');
  });
  await t.test('after: work info is filled once, only right after a move to work, with an organization from the same workspace',async()=>{
   const p=await rowOf('call:cp-work1'),w2=await rowOf('call:cp-work2');
   await server(c=>put(c,CALL,{source_ref:'call:cp-work3',title:'가상 통화 셋'}));
   const w3=await rowOf('call:cp-work3');
   const info=(id,title,counterpart,org)=>owner(c=>c.query('select public.app_feed_call_work_info($1,$2,$3,$4) r',[id,title,counterpart,org]));
   await assert.rejects(info(p.id,'x',null,null),/FEED_REFILL_NOT_PENDING/,'personal row');
   await assert.rejects(info(w3.id,'x',null,null),/FEED_REFILL_NOT_PENDING/,'work row that was never moved');
   await assert.rejects(info(w2.id,'새 제목','가상 상대',ORG_B),/FEED_LINK_SCOPE/,'other-workspace organization');
   assert.equal((await rowOf('call:cp-work2')).refilled_at,null,'a refused fill leaves it pending');
   await assert.rejects(stranger(c=>c.query('select public.app_feed_call_work_info($1,$2,$3,$4)',[w2.id,'x',null,null])),/FEED_NOT_FOUND/);
   assert.equal((await info(w2.id,'  새 제목  ','가상 상대 위원장',ORG_A)).rows[0].r.ok,true);
   const done=await rowOf('call:cp-work2');
   assert.deepEqual([done.title,done.counterpart,done.organization_id,done.source],['새 제목','가상 상대 위원장',ORG_A,'call']);assert.ok(done.refilled_at);
   assert.equal(done.raw_text,'가상 전문','text and points are not touched');
   await assert.rejects(info(w2.id,'또',null,null),/FEED_REFILL_NOT_PENDING/,'only once per move');
   // Moving personal back to work makes it pending again; an empty answer still ends the pending state.
   const back=await move(p.id,'work');
   assert.deepEqual([back.to,back.needs_refill],['call',true]);
   assert.equal((await rowOf('call:cp-work1')).refilled_at,null);
   await info(p.id,'',null,null);
   const kept=await rowOf('call:cp-work1');
   assert.deepEqual([kept.title,kept.counterpart,kept.organization_id],['가상 업무 통화',null,null]);assert.ok(kept.refilled_at);
  });
  await t.test('readers: every app_feed_items read in ai-assist asks for source=call, so personal and unsure rows cannot reach 원장·챙길 것·주간보고 재료',async()=>{
   const handler=await read('supabase/functions/ai-assist/handler.ts');
   const reads=[...handler.matchAll(/app_feed_items\?[^`"']*/g)].map(m=>m[0]);
   assert.ok(reads.length>=2);
   for(const r of reads)assert.match(r,/[?&]source=eq\.call&/,r);
   assert.doesNotMatch(await read('supabase/functions/ai-assist/ledger-auto.ts'),/call_personal|call_unsure/);
  });
  await t.test('rollback is refused while personal rows or move marks exist, then restores the snapshot; re-apply works',async()=>{
   await move((await rowOf('call:cp-work3')).id,'personal');
   const blocked=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/CALL_PERSONAL_ROLLBACK_BLOCKED/);await c.query('rollback');}finally{c.release();}};
   await blocked();
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,1,'nothing changed');
   await pool.query("delete from public.app_feed_items where source in('call_personal','call_unsure')");
   await blocked();
   await pool.query('update public.app_feed_items set moved_at=null,refilled_at=null');
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await assert.rejects(server(c=>put(c,CALL,{source:'call_personal',source_ref:'call:cp-after-rollback'})),/violates check constraint/);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await server(c=>put(c,CALL,{source:'call_personal',source_ref:'call:cp-after-reapply'}));
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
