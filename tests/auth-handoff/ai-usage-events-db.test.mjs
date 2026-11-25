// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// AI-비용보기 4단계 DB(20261125235000): 기능별 사용 기록 표 app_ai_usage_events(넣기만) + app_ai_cost_entries.kind에 cap·reload.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예. 두 번째 apply는 거절.
// - 표에 글 내용 칸이 없다(칸은 작업공간·날짜·기능 키·공급자·모델·호출 수·토큰·시각뿐).
// - 소유자는 자기 작업공간만 읽고 넣는다. 남의 작업공간은 못 읽고(0행) 못 넣는다(42501). 고치기·지우기는 아무도 못 한다.
// - service_role은 넣기만(읽기 42501). anon은 아무것도 못 한다. 기능 키·공급자 밖 값은 검사가 거절(23514).
// - 금액 표: cap·reload를 month 없이 넣을 수 있고, topup·bill 규칙은 그대로.
// - 되돌리기: cap·reload 줄이 있으면 멈추고, 없으면 새 표·검사·기록이 원래대로(스냅샷 같음), 다시 적용 가능.
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
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261125235000',name='ai_usage_events',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const COLUMNS=['calls','created_at','day','feature','id','input_tokens','model','output_tokens','provider','workspace_id'];

test('ai usage events: insert-only per-feature table, owner-only read, no content columns, cap/reload kinds; rollback restores',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ai-usage-events-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const guardFails=async(pattern)=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};
  const ins="insert into public.app_ai_usage_events(workspace_id,day,feature,provider,model,calls,input_tokens,output_tokens) values($1,'2026-11-25',$2,'openai','gpt-5-mini',1,100,20)";

  await t.test('guard: stops without changes before 20261028160000_ai_usage_costs is applied',async()=>{
   await guardFails(/AI_USAGE_EVENTS_PREREQUISITE_CHANGED/);
   assert.equal((await pool.query("select to_regclass('public.app_ai_usage_events') t")).rows[0].t,null);
   await pool.query(await read('supabase/migrations/20261028160000_ai_usage_costs.sql'));
   // 적용 전 이미 있던 금액 줄(되돌린 뒤에도 남아야 함).
   await pool.query("insert into public.app_ai_cost_entries(workspace_id,provider,kind,amount_krw,month) values($1,'openai','topup',10000,null),($1,'gemini','bill',5000,'2026-10-01')",[WS_A]);
  });
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: rules pass, summary 3 lines, no fixed id, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');
    assert.deepEqual([...plan.createdTables],['app_ai_usage_events']);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto\s+(anon|public)\b|disable row level security|security definer|create (or replace )?function|rtw_/i);
   assert.doesNotMatch(code,/grant\s+(update|delete|all)|grant\s+select[^;]*service_role/i,'no update/delete grant, no service_role read');
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   await allYes(postcheck);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9973')).ok,false);
  });

  await t.test('columns: numbers and keys only, no content column',async()=>{
   const cols=(await pool.query("select attname from pg_attribute where attrelid='public.app_ai_usage_events'::regclass and attnum>0 and not attisdropped order by attname")).rows.map(r=>r.attname);
   assert.deepEqual(cols,COLUMNS);
   for(const bad of ['text','prompt','answer','title','file_name','content','body','cost_krw','user_id'])assert.ok(!cols.includes(bad),bad);
   assert.equal((await pool.query("select relrowsecurity r from pg_class where oid='public.app_ai_usage_events'::regclass")).rows[0].r,true);
  });

  await t.test('owner reads and inserts only own workspace; stranger cannot read or insert it',async()=>{
   await owner(c=>c.query(ins,[WS_A,'ledger']));
   await server(c=>c.query(ins,[WS_A,'library']));
   await stranger(c=>c.query(ins,[WS_B,'ask']));
   const mine=(await owner(c=>c.query('select workspace_id,feature from public.app_ai_usage_events order by feature'))).rows;
   assert.deepEqual(mine.map(r=>[r.workspace_id,r.feature]),[[WS_A,'ledger'],[WS_A,'library']]);
   const theirs=(await stranger(c=>c.query('select workspace_id,feature from public.app_ai_usage_events'))).rows;
   assert.deepEqual(theirs.map(r=>[r.workspace_id,r.feature]),[[WS_B,'ask']]);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_ai_usage_events where workspace_id=$1',[WS_A]))).rows[0].n,0);
   await assert.rejects(stranger(c=>c.query(ins,[WS_A,'ask'])),{code:'42501'});
   await assert.rejects(owner(c=>c.query(ins,[WS_B,'ask'])),{code:'42501'});
  });

  await t.test('insert only: no update or delete for anyone; server cannot read; anon nothing; id/created_at not settable',async()=>{
   for(const fn of [owner,stranger,server,anon]){
    await assert.rejects(fn(c=>c.query("update public.app_ai_usage_events set input_tokens=0")),{code:'42501'});
    await assert.rejects(fn(c=>c.query('delete from public.app_ai_usage_events')),{code:'42501'});
   }
   await assert.rejects(server(c=>c.query('select feature from public.app_ai_usage_events')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select * from public.app_ai_usage_events')),{code:'42501'});
   await assert.rejects(anon(c=>c.query(ins,[WS_A,'ask'])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_ai_usage_events(id,workspace_id,day,feature,provider,model) values(gen_random_uuid(),$1,'2026-11-25','ask','openai','gpt-5-mini')",[WS_A])),{code:'42501'});
   await assert.rejects(server(c=>c.query("insert into public.app_ai_usage_events(workspace_id,day,feature,provider,model,created_at) values($1,'2026-11-25','ask','openai','gpt-5-mini',now())",[WS_A])),{code:'42501'});
  });

  await t.test('checks: unknown feature, provider, bad model or negative numbers refused',async()=>{
   await assert.rejects(owner(c=>c.query(ins,[WS_A,'secret_feature'])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_ai_usage_events(workspace_id,day,feature,provider,model) values($1,'2026-11-25','ask','gemini','gemini-x')",[WS_A])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_ai_usage_events(workspace_id,day,feature,provider,model) values($1,'2026-11-25','ask','openai','회의 내용 글')",[WS_A])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_ai_usage_events(workspace_id,day,feature,provider,model,input_tokens) values($1,'2026-11-25','ask','openai','gpt-5-mini',-1)",[WS_A])),{code:'23514'});
   for(const f of ['journal','todo','meeting','org','telegram','call_judge','news','other'])await owner(c=>c.query(ins,[WS_A,f]));
  });

  await t.test('cost entries: cap and reload allowed without month; old rules kept',async()=>{
   await owner(c=>c.query("insert into public.app_ai_cost_entries(workspace_id,provider,kind,amount_krw) values($1,'gemini','cap',30000),($1,'openai','reload',20000)",[WS_A]));
   await assert.rejects(owner(c=>c.query("insert into public.app_ai_cost_entries(workspace_id,provider,kind,amount_krw,month) values($1,'gemini','cap',30000,'2026-11-01')",[WS_A])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_ai_cost_entries(workspace_id,provider,kind,amount_krw) values($1,'gemini','limit',30000)",[WS_A])),{code:'23514'});
   await assert.rejects(owner(c=>c.query("insert into public.app_ai_cost_entries(workspace_id,provider,kind,amount_krw) values($1,'gemini','bill',30000)",[WS_A])),{code:'23514'});
   await assert.rejects(stranger(c=>c.query("insert into public.app_ai_cost_entries(workspace_id,provider,kind,amount_krw) values($1,'gemini','cap',1)",[WS_A])),{code:'42501'});
   assert.equal((await stranger(c=>c.query("select count(*)::int n from public.app_ai_cost_entries where kind in ('cap','reload')"))).rows[0].n,0);
  });

  await t.test('rollback stops while cap/reload rows exist; after they are removed it restores; re-apply works',async()=>{
   {const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/AI_USAGE_EVENTS_ROLLBACK_BLOCKED: cap or reload rows exist/);await c.query('rollback');}finally{c.release();}}
   assert.notEqual((await pool.query("select to_regclass('public.app_ai_usage_events') t")).rows[0].t,null);
   await owner(c=>c.query("delete from public.app_ai_cost_entries where kind in ('cap','reload')"));
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query('select count(*)::int n from public.app_ai_cost_entries')).rows[0].n,2);
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   const again=await run('apply','9974');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
