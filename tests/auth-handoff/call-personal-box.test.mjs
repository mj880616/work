// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// CALL-개인통화함 1단계(B안): 20261025200000_call_personal_box — personal/unsure calls live in their own table app_call_personal,
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
const version='20261025200000',name='call_personal_box',stem=version+'_'+name;
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

test('call personal box: separate table, atomic owner-checked moves, duplicate guard across both boxes, no work reader touches it; rollback guarded',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'call-personal-box-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const FEED_COLS=['workspace_id','source','day','occurred_at','title','points','raw_text','organization_id','source_ref'];
  const putWork=(c,row,over={})=>{const r={...row,...over};const cols=FEED_COLS.filter(k=>k in r);
   return c.query(`insert into public.app_feed_items(${cols.join(',')}) values(${cols.map((k,i)=>k==='points'?`$${i+1}::jsonb`:`$${i+1}`).join(',')})`,cols.map(k=>r[k]));};
  const PCOLS=['workspace_id','kind','day','occurred_at','title','points','raw_text','source_ref'];
  const putPersonal=(c,row,over={})=>{const r={...row,...over};const cols=PCOLS.filter(k=>k in r);
   return c.query(`insert into public.app_call_personal(${cols.join(',')}) values(${cols.map((k,i)=>k==='points'?`$${i+1}::jsonb`:`$${i+1}`).join(',')})`,cols.map(k=>r[k]));};
  const workOf=async ref=>(await pool.query('select * from public.app_feed_items where source_ref=$1',[ref])).rows[0];
  const personalOf=async ref=>(await pool.query('select * from public.app_call_personal where source_ref=$1',[ref])).rows[0];
  const move=(id,to)=>owner(c=>c.query('select public.app_call_move($1,$2) r',[id,to])).then(r=>r.rows[0].r);
  const before=(await pool.query(snapshot)).rows;
  await server(c=>putWork(c,CALL,{organization_id:ORG_A}));
  await server(c=>putWork(c,CALL,{source_ref:'call:cb-work2',title:'가상 통화 둘'}));
  const beforeCheck=await readOnly(precheck);

  await t.test('before: the personal table and the move functions do not exist yet',async()=>{
   assert.equal((await pool.query("select to_regclass('public.app_call_personal') t, to_regprocedure('public.app_call_move(uuid,text)') f")).rows[0].t,null);
   await assert.rejects(server(c=>putPersonal(c,PERSONAL)),/app_call_personal/);
  });
  await t.test('files: expanded rules pass; new table plus two owner-checked definer functions; no grant on existing tables; existing policies and guard untouched; summary 3 lines; rollback guarded',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.functions,['private.app_call_personal_guard','private.app_call_ref_guard','public.app_call_move','public.app_call_work_info']);
    assert.deepEqual(plan.review.definer,['public.app_call_move','public.app_call_work_info']);
    assert.equal(plan.review.policies,1);assert.deepEqual(plan.createdTables,['app_call_personal']);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.equal(grants.length,6);
   for(const g of grants)assert.match(g,/ on (table public\.app_call_personal|function public\.app_call_(move|work_info)\([^)]*\)) to (authenticated|service_role);$/,g);
   assert.doesNotMatch(code,/grant [^;]*app_feed_items/i);
   assert.doesNotMatch(code,/disable row level security|create or replace|alter policy|drop policy|create policy [^;]*app_feed_items|rtw_|grant usage on schema|drop constraint|add constraint app_feed_items/i);
   for(const fn of ['private.app_call_ref_guard()','private.app_call_personal_guard()','public.app_call_move(uuid, text)','public.app_call_work_info(uuid, text, text, uuid)'])
    assert.ok(code.includes('revoke all on function '+fn+' from public, anon, authenticated, service_role;'),fn);
   const guards=code.slice(code.indexOf('create function private.app_call_ref_guard'),code.indexOf('create trigger app_call_personal_guard'));
   assert.doesNotMatch(guards.replace(/private\.app_call_(ref|personal)_guard/g,''),/private\./);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261025200000', 'call_personal_box'/);
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);assert.match(rollbackSQL,/CALL_PERSONAL_BOX_ROLLBACK_BLOCKED/);
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const dry=await run('dry-run','9941');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await readOnly(precheck),beforeCheck);
   const apply=await run('apply','9942');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9943')).ok,false);
  });
  await t.test('after: work rows are untouched; owner moves work to personal in one step (same id, text and time kept, links and pin gone)',async()=>{
   const w1=await workOf('call:cb-work1');
   assert.equal(w1.source,'call');assert.equal(w1.moved_at,null);assert.equal(w1.organization_id,ORG_A);
   await owner(c=>c.query('update public.app_feed_items set pinned_at=now() where id=$1',[w1.id]));
   const r=await move(w1.id,'personal');
   assert.deepEqual([r.ok,r.from,r.to,r.changed,r.needs_refill],[true,'work','personal',true,false]);
   assert.equal(await workOf('call:cb-work1'),undefined,'gone from the work box');
   const p=await personalOf('call:cb-work1');
   assert.equal(p.id,w1.id);assert.equal(p.kind,'personal');assert.equal(p.raw_text,'가상 전문');assert.equal(p.title,'가상 업무 통화');
   assert.equal(p.created_at.getTime(),w1.created_at.getTime());assert.ok(p.moved_at);
   assert.equal((await move(w1.id,'personal')).changed,false,'same target is a no-op');
   assert.equal((await pool.query('select count(*)::int n from public.app_call_personal where source_ref=$1',['call:cb-work1'])).rows[0].n,1);
  });
  await t.test('after: a failing insert on the other side rolls the whole move back (nothing lost, nothing doubled)',async()=>{
   await pool.query("create function public.cb_fail() returns trigger language plpgsql as $$ begin raise exception 'CB_INJECTED'; end $$");
   await pool.query('create trigger cb_fail before insert on public.app_call_personal for each row execute function public.cb_fail()');
   const w2=await workOf('call:cb-work2');
   await assert.rejects(move(w2.id,'personal'),/CB_INJECTED/);
   assert.equal((await workOf('call:cb-work2')).id,w2.id,'still in the work box');
   assert.equal(await personalOf('call:cb-work2'),undefined);
   await pool.query('drop trigger cb_fail on public.app_call_personal');await pool.query('drop function public.cb_fail()');
  });
  await t.test('after: the same original cannot live in both boxes (collector re-send, direct insert, concurrent insert)',async()=>{
   await assert.rejects(server(c=>putWork(c,CALL,{source_ref:'call:cb-work1'})),{code:'23505'},'moved to personal, work re-send refused');
   await assert.rejects(server(c=>putPersonal(c,PERSONAL,{source_ref:'call:cb-work2'})),{code:'23505'},'in work, personal insert refused');
   await server(c=>putPersonal(c,PERSONAL));
   await assert.rejects(server(c=>putPersonal(c,PERSONAL)),{code:'23505'},'personal twice');
   await assert.rejects(server(c=>putWork(c,CALL,{source_ref:'call:cb-p1'})),{code:'23505'});
   // Same key from both sides at the same moment: exactly one wins.
   const attempts=await Promise.allSettled([server(c=>putWork(c,CALL,{source_ref:'call:cb-race'})),server(c=>putPersonal(c,PERSONAL,{source_ref:'call:cb-race'}))]);
   assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
   const n=(await pool.query("select (select count(*) from public.app_feed_items where source_ref='call:cb-race')+(select count(*) from public.app_call_personal where source_ref='call:cb-race') n")).rows[0].n;
   assert.equal(Number(n),1);
   // Telegram rows are not call originals and are not checked.
   await server(c=>c.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,room_key,room_label,summary,raw_count,points,source_ref) values($1,'telegram','2026-10-24','2026-10-24T00:00:00Z','room-a1','가상 방','가상',1,'[]','tg:cb1')",[WS_A]));
  });
  await t.test('after: unsure calls are decided in place or moved; work box never sees them before a decision',async()=>{
   await server(c=>putPersonal(c,PERSONAL,{kind:'unsure',source_ref:'call:cb-u1'}));
   await server(c=>putPersonal(c,PERSONAL,{kind:'unsure',source_ref:'call:cb-u2'}));
   const u1=await personalOf('call:cb-u1'),u2=await personalOf('call:cb-u2');
   const work=await owner(c=>c.query("select source_ref from public.app_feed_items where source='call' order by source_ref"));
   assert.ok(!work.rows.some(x=>/cb-u|cb-p1|cb-work1/.test(x.source_ref)));
   const a=await move(u1.id,'personal');
   assert.deepEqual([a.from,a.to,a.changed,a.needs_refill],['unsure','personal',true,false]);
   assert.equal((await personalOf('call:cb-u1')).kind,'personal');
   const b=await move(u2.id,'work');
   assert.deepEqual([b.from,b.to,b.changed,b.needs_refill],['unsure','work',true,true]);
   const w=await workOf('call:cb-u2');
   assert.equal(w.id,u2.id);assert.equal(w.source,'call');assert.ok(w.moved_at);assert.equal(w.refilled_at,null);assert.equal(w.raw_text,'가상 개인 전문');
   assert.deepEqual([w.organization_id,w.project_id,w.pinned_at],[null,null,null]);
   assert.equal(await personalOf('call:cb-u2'),undefined);
  });
  await t.test('after: owner sees both boxes through their own tables; nobody else, and anon/service_role cannot read the text',async()=>{
   const mine=await owner(c=>c.query('select kind from public.app_call_personal order by source_ref'));
   assert.ok(mine.rows.length>=2);
   assert.equal((await stranger(c=>c.query('select * from public.app_call_personal'))).rows.length,0);
   await assert.rejects(as('anon','',c=>c.query('select * from public.app_call_personal')),{code:'42501'});
   await assert.rejects(server(c=>c.query('select raw_text from public.app_call_personal')),{code:'42501'});
   await assert.rejects(server(c=>c.query('select * from public.app_call_personal')),{code:'42501'});
  });
  await t.test('after: direct writes stay denied; only hide and clear-text are allowed on the personal table; raw text is clear-only',async()=>{
   const p=await personalOf('call:cb-p1');
   await assert.rejects(owner(c=>c.query("update public.app_call_personal set kind='unsure' where id=$1",[p.id])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_call_personal set title='x' where id=$1",[p.id])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_call_personal set moved_at=null where id=$1',[p.id])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_call_personal where id=$1',[p.id])),{code:'42501'});
   await assert.rejects(owner(c=>putPersonal(c,PERSONAL,{source_ref:'call:cb-own'})),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_call_personal set raw_text='되살리기' where id=$1",[p.id])),/FEED_RAW_TEXT_CLEAR_ONLY/);
   await assert.rejects(server(c=>c.query("update public.app_call_personal set title='x'")),{code:'42501'});
   await assert.rejects(server(c=>c.query('delete from public.app_call_personal')),{code:'42501'});
   await assert.rejects(server(c=>putPersonal(c,PERSONAL,{source_ref:'call:cb-bad',kind:'work'})),/app_call_personal_kind_check/);
   await assert.rejects(pool.query("insert into public.app_call_personal(workspace_id,kind,day,occurred_at,title,source_ref) values($1,'personal','2026-10-24','2026-10-24T00:00:00Z','가상','call:cb-bad2') returning moved_at,pinned_at",[WS_A]),/pinned_at/,'no pin/org/project columns exist');
   await owner(c=>c.query('update public.app_call_personal set hidden_at=now() where id=$1',[p.id]));
   await owner(c=>c.query('update public.app_call_personal set raw_text=null where id=$1',[p.id]));
   const h=await personalOf('call:cb-p1');assert.ok(h.hidden_at);assert.equal(h.raw_text,null);
   await assert.rejects(server(c=>putWork(c,CALL,{source_ref:'call:cb-bad3'}).then(()=>c.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,source_ref,moved_at) values($1,'call','2026-10-24','2026-10-24T00:00:00Z','가상','call:cb-bad4',now())",[WS_A]))),{code:'42501'},'service_role cannot write moved_at');
   await assert.rejects(owner(c=>c.query('update public.app_feed_items set refilled_at=now()')),{code:'42501'});
  });
  await t.test('after: only calls move; strangers, anon, service_role and the trigger functions cannot call or run',async()=>{
   const tg=await workOf('tg:cb1'),w2=await workOf('call:cb-work2');
   await assert.rejects(owner(c=>c.query("select public.app_call_move($1,'personal')",[tg.id])),/CALL_NOT_CALL/);
   await assert.rejects(owner(c=>c.query("select public.app_call_move($1,'secret')",[w2.id])),/CALL_MOVE_TARGET/);
   await assert.rejects(owner(c=>c.query("select public.app_call_move($1,'personal')",['99999999-9999-4999-8999-999999999999'])),/CALL_NOT_FOUND/);
   await assert.rejects(stranger(c=>c.query("select public.app_call_move($1,'personal')",[w2.id])),/CALL_NOT_FOUND/);
   const pu=(await personalOf('call:cb-p1')).id;
   await assert.rejects(stranger(c=>c.query("select public.app_call_move($1,'work')",[pu])),/CALL_NOT_FOUND/);
   await assert.rejects(as('anon','',c=>c.query("select public.app_call_move($1,'personal')",[w2.id])),{code:'42501'});
   await assert.rejects(server(c=>c.query("select public.app_call_move($1,'personal')",[w2.id])),{code:'42501'});
   for(const f of ['private.app_call_ref_guard()','private.app_call_personal_guard()'])await assert.rejects(owner(c=>c.query('select '+f)),{code:/^(42501|0A000)$/});
   assert.equal((await workOf('call:cb-work2')).source,'call');
  });
  await t.test('after: work info is filled once, only right after a move to work, with an organization from the same workspace',async()=>{
   const moved=await workOf('call:cb-u2'),w2=await workOf('call:cb-work2');
   const info=(id,title,counterpart,org)=>owner(c=>c.query('select public.app_call_work_info($1,$2,$3,$4) r',[id,title,counterpart,org]));
   await assert.rejects(info(w2.id,'x',null,null),/CALL_REFILL_NOT_PENDING/,'work row that was never moved');
   await assert.rejects(info((await personalOf('call:cb-p1')).id,'x',null,null),/CALL_NOT_FOUND/,'personal rows are not work rows');
   await assert.rejects(info(moved.id,'새 제목','가상 상대',ORG_B),/FEED_LINK_SCOPE/,'other-workspace organization');
   assert.equal((await workOf('call:cb-u2')).refilled_at,null,'a refused fill leaves it pending');
   await assert.rejects(stranger(c=>c.query('select public.app_call_work_info($1,$2,$3,$4)',[moved.id,'x',null,null])),/CALL_NOT_FOUND/);
   assert.equal((await info(moved.id,'  새 제목  ','가상 상대 위원장',ORG_A)).rows[0].r.ok,true);
   const done=await workOf('call:cb-u2');
   assert.deepEqual([done.title,done.counterpart,done.organization_id,done.source],['새 제목','가상 상대 위원장',ORG_A,'call']);assert.ok(done.refilled_at);
   assert.equal(done.raw_text,'가상 개인 전문','text is not touched');
   await assert.rejects(info(moved.id,'또',null,null),/CALL_REFILL_NOT_PENDING/,'only once per move');
   // Round trip: work -> personal -> work becomes pending again; an empty answer still ends the pending state.
   await move(moved.id,'personal');
   const back=await move(moved.id,'work');
   assert.deepEqual([back.to,back.needs_refill],['work',true]);
   assert.equal((await workOf('call:cb-u2')).refilled_at,null);
   await info(moved.id,'',null,null);
   const kept=await workOf('call:cb-u2');
   assert.equal(kept.title,'새 제목','empty title keeps the old one');assert.deepEqual([kept.counterpart,kept.organization_id],[null,null]);assert.ok(kept.refilled_at);
  });
  await t.test('readers: no code outside the migration names the personal table; every work-side read asks for source=call; database objects that name it are only the two expected functions',async()=>{
   const hits=[];
   for(const dir of ['supabase/functions','app','scripts','docs/ops','.github'])
    for(const f of await files(new URL('../../'+dir,import.meta.url).pathname))
     if(/\.(js|mjs|ts|gs|html|yml|yaml|json|sh)$/.test(f)&&(await readFile(f,'utf8')).includes('app_call_personal'))hits.push(f.replace(root,''));
   // 2단계(collector-feed 저장)가 허용 목록에 들어왔다. 3단계 화면 PR이 통화 메뉴 화면을 더한다.
   assert.deepEqual(hits,['supabase/functions/collector-feed/handler.ts'],'only the call menu screen and collector-feed may name the table');
   const handler=await read('supabase/functions/ai-assist/handler.ts');
   const reads=[...handler.matchAll(/app_feed_items\?[^`"']*/g)].map(m=>m[0]);
   assert.ok(reads.length>=2);
   for(const r of reads)assert.match(r,/[?&]source=eq\.call&/,r);
   const named=(await pool.query("select proname from pg_proc where prosrc like '%app_call_personal%' and pronamespace in ('public'::regnamespace,'private'::regnamespace) order by 1")).rows.map(r=>r.proname);
   assert.deepEqual(named,['app_call_move','app_call_ref_guard']);
   assert.equal((await pool.query("select count(*)::int n from pg_views where schemaname in('public','private') and definition like '%app_call_personal%'")).rows[0].n,0);
   assert.equal((await pool.query("select count(*)::int n from pg_policy p where pg_get_expr(p.polqual,p.polrelid) like '%app_call_personal%' and p.polrelid<>'public.app_call_personal'::regclass")).rows[0].n,0);
  });
  await t.test('rollback is refused while personal box rows or move marks exist, then restores the snapshot; re-apply works',async()=>{
   const blocked=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/CALL_PERSONAL_BOX_ROLLBACK_BLOCKED/);await c.query('rollback');}finally{c.release();}};
   await blocked();
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,1,'nothing changed');
   await pool.query('delete from public.app_call_personal');
   await blocked();
   await pool.query('update public.app_feed_items set moved_at=null,refilled_at=null');
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query("select to_regclass('public.app_call_personal') t")).rows[0].t,null);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await server(c=>putPersonal(c,PERSONAL,{source_ref:'call:cb-after-reapply'}));
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
