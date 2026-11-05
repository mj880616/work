// Fresh local PostgreSQL only. No Supabase, Edge, pg_net or production credentials. All data synthetic.
// S51-2 NEWS-전면개편 P1a(20261106040000): 수집 예약 표 app_cron_keys·app_feed_runs·app_feed_jobs와 내부 함수 다섯.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예. 확장(pg_cron·pg_net·vault)이 없어도 만들어진다.
// - 화면(authenticated)·익명은 표·함수에 권한이 없고, 서버(service_role)는 읽기만, 함수 실행은 소유자(예약 = postgres)만.
// - 칸 흐름: 칸 만들기 → 꺼내기(수집기마다 한 번에 하나) → 요청 번호 → 응답 정리(건수·코드만, 계획 응답으로 다음 일, 5xx·시간 초과 3번, 401 남은 일 닫기) → 칸 집계.
// - 1분 정리: 응답 없는 '보냄' 시간 초과, 2시간 넘은 칸 '늦음', 30일 지난 칸 지움.
// - 되돌리기는 예약이 함수를 부르고 있으면 멈추고, 아니면 표·함수·기록만 원래대로.
// pg_net 응답(net._http_response)은 쓰지 않는다: 시험은 같은 값(요청 번호·상태·본문)을 app_feed_settle에 직접 넣는다.
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
import {fixture} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261106040000',name='feed_cron_tables',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  -- Hosted default ACL 흉내: 새 함수에도 API 역할 실행권이 기본으로 붙는다(이 migration이 회수해야 함).
  alter default privileges in schema private grant execute on functions to anon, authenticated, service_role;`;
const TABLES=['app_cron_keys','app_feed_runs','app_feed_jobs'];
const FUNCS=['private.app_feed_enqueue(text)','private.app_feed_claim(text)','private.app_feed_sent(uuid,bigint)','private.app_feed_settle(bigint,integer,text)','private.app_feed_tidy()'];

test('feed cron tables: service-only tables, owner-only functions, queue flow, tidy, guarded rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'feed-cron-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,fn){const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};
  const one=async(sql,args=[])=>(await pool.query(sql,args)).rows[0];
  const enqueue=async feed=>(await one('select private.app_feed_enqueue($1) v',[feed])).v;
  const claim=async who=>(await one('select private.app_feed_claim($1) v',[who])).v;
  const sent=async(job,req)=>(await one('select private.app_feed_sent($1,$2) v',[job,req])).v;
  const settle=async(req,status,content)=>(await one('select private.app_feed_settle($1,$2,$3) v',[req,status,content])).v;
  const tidy=async()=>(await one('select private.app_feed_tidy() v')).v;
  const jobs=async runId=>(await pool.query('select seq,action,body,state,tries,request_id,http_status,result,error_code from public.app_feed_jobs where run_id=$1 order by seq',[runId])).rows;
  const runRow=async runId=>one('select feed,state,jobs_total,jobs_ok,jobs_failed,finished_at from public.app_feed_runs where id=$1',[runId]);
  // 같은 분의 칸 중복 막기(feed, slot_at)를 넘어 다음 칸을 만들 수 있게 앞 칸들을 과거로 민다.
  const age=async(interval)=>pool.query(`update public.app_feed_runs set slot_at=slot_at-$1::interval, started_at=started_at-$1::interval`,[interval]);
  let req=100;const send=async who=>{const j=await claim(who);assert.ok(j,'claim '+who);req++;assert.equal(await sent(j.id,req),true);return {...j,req};};
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: expanded rules pass, three new tables and five functions, no extension/cron/net/vault, summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
    assert.deepEqual([...plan.createdTables].sort(),[...TABLES].sort());
    assert.deepEqual([...plan.functions],['private.app_feed_claim','private.app_feed_enqueue','private.app_feed_sent','private.app_feed_settle','private.app_feed_tidy']);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\b(cron|net|vault|extensions)\.|create extension|http_post|decrypted_secrets|security definer/i);
   assert.doesNotMatch(code,/\bto (anon|public|authenticated)\b|disable row level security|create policy|rtw_|grant usage on schema/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   assert.doesNotMatch(precheck,/from public\./i,'precheck reads no app table (no counts that change while collecting)');
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261106040000', 'feed_cron_tables'/);
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);assert.match(rollbackSQL,/FEED_CRON_TABLES_ROLLBACK_BLOCKED: cron schedule/);
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const item of ['new migration absent','private schema','new tables absent','new functions absent','helper names free'])assert.equal(v[item],'예',item);
   assert.equal(v['extension pg_cron'],'아니오','no extensions in this local DB: the migration must not need them');
   await allYes(postcheck);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9983')).ok,false);
  });

  await t.test('access: anon and authenticated see nothing and run nothing; service_role reads only; functions owner only',async()=>{
   for(const table of TABLES){
    for(const role of ['anon','authenticated'])await assert.rejects(as(role,c=>c.query(`select * from public.${table}`)),{code:'42501'},role+' '+table);
    await as('service_role',c=>c.query(`select * from public.${table}`));
    await assert.rejects(as('service_role',c=>c.query(`delete from public.${table} where true`)),{code:'42501'});
   }
   await assert.rejects(as('service_role',c=>c.query("insert into public.app_cron_keys(name,secret_sha256) values('web2_feed_cron',repeat('a',64))")),{code:'42501'});
   await assert.rejects(as('service_role',c=>c.query("update public.app_feed_jobs set state='ok' where true")),{code:'42501'});
   for(const f of FUNCS)for(const role of ['anon','authenticated','service_role'])
    assert.equal((await one('select has_function_privilege($1,$2,$3) x',[role,f,'execute'])).x,false,role+' '+f);
   await assert.rejects(as('service_role',c=>c.query("select private.app_feed_enqueue('news')")),{code:'42501'});
   await assert.rejects(as('authenticated',c=>c.query("select private.app_feed_claim('news')")),{code:'42501'});
   const fns=(await pool.query("select p.oid::regprocedure::text f, p.prosecdef d from pg_proc p where p.pronamespace='private'::regnamespace and p.proname like 'app_feed_%' order by 1")).rows;
   assert.equal(fns.length,5);assert.ok(fns.every(r=>r.d===false),'all invoker');
  });

  await t.test('shape: key fingerprint and job checks refuse titles, links, long bodies and bad states',async()=>{
   await pool.query("insert into public.app_cron_keys(name,secret_sha256) values('web2_feed_cron',$1)",['0'.repeat(64)]);
   for(const [n,s] of [['web2_feed_cron2','A'.repeat(64)],['other','0'.repeat(64)],['web2_x','0'.repeat(63)]])
    await assert.rejects(pool.query('insert into public.app_cron_keys(name,secret_sha256) values($1,$2)',[n,s]),{code:'23514'},n);
   await pool.query('delete from public.app_cron_keys where true');
   const r=await one("insert into public.app_feed_runs(feed,slot_at) values('outside','2026-01-01T00:00:00Z') returning id");
   const put=(over)=>{const row={seq:1,action:'run',body:{source:'kctu'},...over};const cols=Object.keys(row);
    return pool.query(`insert into public.app_feed_jobs(run_id,${cols.join(',')}) values($1,${cols.map((_,i)=>'$'+(i+2)).join(',')})`,[r.id,...cols.map(k=>row[k])]);};
   const bad=[{body:{title:'기사 제목'}},{body:{source:'https://example.com/a'}},{body:{source:'kctu',url:'x'}},{body:{step:'delete_all'}},
    {body:{source:'k'.repeat(60)}},{action:'run_plan',body:{source:'kctu'}},{action:'run',body:{}},{action:'post'},{state:'done'},
    {state:'sent'},{tries:4},{state:'queued',request_id:5},{state:'ok',done_at:'2026-01-01T00:00:00Z',http_status:200},
    {state:'ok',done_at:'2026-01-01T00:00:00Z',http_status:200,result:{title:'제목'}},
    {state:'ok',done_at:'2026-01-01T00:00:00Z',http_status:200,result:{inserted:-1}},
    {state:'ok',done_at:'2026-01-01T00:00:00Z',http_status:200,result:{inserted:1.5}},
    {state:'ok',done_at:'2026-01-01T00:00:00Z',http_status:200,result:{status:'https://x.example'}},
    {state:'ok',done_at:'2026-01-01T00:00:00Z',http_status:200,result:{nested:{a:1}}},
    {state:'failed',done_at:'2026-01-01T00:00:00Z',error_code:'긴 오류 문장'},{http_status:700},{seq:0}];
   for(const [i,over] of bad.entries())await assert.rejects(put({seq:i+1,...over}),{code:'23514'},JSON.stringify(over));
   await put({seq:50,state:'ok',done_at:'2026-01-01T00:00:00Z',http_status:200,result:{inserted:3,status:'ok'}});
   await put({seq:51,body:{step:'media',source:'news-abc'}});
   await pool.query("insert into public.app_feed_jobs(run_id,seq,action,body) values($1,52,'run_plan','{}')",[r.id]);
   await pool.query('delete from public.app_feed_runs where id=$1',[r.id]);
   assert.equal((await one('select count(*)::int n from public.app_feed_jobs')).n,0,'jobs go with their run');
  });

  await t.test('enqueue: one run per feed at a time, one per minute; first jobs by feed; bad feed refused',async()=>{
   await assert.rejects(pool.query("select private.app_feed_enqueue('github')"),/FEED_KIND_INVALID/);
   await assert.rejects(pool.query("select private.app_feed_claim('outside_news')"),/FEED_COLLECTOR_INVALID/);
   const fill=await enqueue('news_fill');assert.ok(fill);
   assert.deepEqual((await jobs(fill)).map(j=>[j.seq,j.action,j.body,j.state]),[[1,'run',{step:'pending'},'queued'],[2,'run',{step:'titles'},'queued']]);
   assert.equal(await enqueue('news_fill'),null,'still running');
   const o=await enqueue('outside');assert.ok(o);
   assert.deepEqual((await jobs(o)).map(j=>[j.action,j.body]),[['run_plan',{}]]);
   assert.equal((await runRow(o)).jobs_total,1);
   {const c=await pool.connect();try{await c.query('begin');
    await c.query("update public.app_feed_runs set state='done',finished_at=now(),slot_at=date_trunc('minute',now()) where id=$1",[o]);
    assert.equal((await c.query("select private.app_feed_enqueue('outside') v")).rows[0].v,null,'same minute slot already used');
    await c.query('commit');}finally{c.release();}}
   await pool.query('delete from public.app_feed_runs where true');
  });

  await t.test('outside run: plan makes one job per valid key (titles dropped), one in flight, 5xx/timeout retried 3 times, run partial',async()=>{
   const o=await enqueue('outside');
   assert.equal(await claim('news'),null,'other collector has nothing');
   const plan=await send('outside');
   assert.equal(plan.action,'run_plan');assert.equal(plan.feed,'outside');assert.deepEqual(plan.body,{});
   assert.equal(await claim('outside'),null,'one in flight per collector');
   assert.equal(await sent(plan.id,999),false,'request number written once');
   assert.equal(await settle(777,200,'{"ok":true}'),null,'unknown request ignored');
   assert.equal(await settle(plan.req,200,JSON.stringify({ok:true,sources:['kctu','kctu','Bad Key!',5,'pkk-2'],pruned:3,title:'성명 제목',url:'https://example.com'})),'ok');
   const after=await jobs(o);
   assert.deepEqual(after.map(j=>[j.seq,j.action,j.body,j.state]),[[1,'run_plan',{},'ok'],[2,'run',{source:'kctu'},'queued'],[3,'run',{source:'pkk-2'},'queued']]);
   assert.deepEqual(after[0].result,{pruned:3,keys:2},'only counts');
   assert.equal(await settle(plan.req,200,'{"ok":true}'),null,'settled once');
   // kctu: 503 → 다시, 시간 초과 → 다시, 502(세 번째) → 실패.
   const a=await send('outside');assert.deepEqual(a.body,{source:'kctu'});
   assert.equal(await settle(a.req,503,'{"error":"UPSTREAM_DOWN"}'),'queued');
   const b=await send('outside');assert.equal(b.id,a.id);
   assert.equal(await settle(b.req,null,null),'queued');
   const c=await send('outside');assert.equal(c.id,a.id);
   assert.equal(await settle(c.req,502,'not json'),'failed');
   let rows=await jobs(o);assert.deepEqual([rows[1].state,rows[1].tries,rows[1].http_status,rows[1].error_code],['failed',3,502,'http_502']);
   assert.equal((await runRow(o)).state,'running');
   const d=await send('outside');assert.deepEqual(d.body,{source:'pkk-2'});
   assert.equal(await settle(d.req,200,JSON.stringify({ok:true,source:'pkk-2',listed:10,fresh:2,inserted:2,skipped:8,deferred:0,refilled:0,status:'ok',titles:['가'],link:'https://x'})),'ok');
   rows=await jobs(o);assert.deepEqual(rows[2].result,{listed:10,fresh:2,inserted:2,skipped:8,deferred:0,refilled:0,status:'ok'});
   const run1=await runRow(o);
   assert.deepEqual([run1.state,run1.jobs_total,run1.jobs_ok,run1.jobs_failed],['partial',3,2,1]);assert.ok(run1.finished_at);
   assert.equal(await claim('outside'),null);
  });

  await t.test('news run: plan makes media jobs then keywords/pending/titles/prune; 401 closes the rest; config error not retried',async()=>{
   const n=await enqueue('news');
   const plan=await send('news');
   assert.equal(await settle(plan.req,200,JSON.stringify({ok:true,media:['news-hani','news-khan','kctu','news-hani']})),'ok');
   assert.deepEqual((await jobs(n)).map(j=>j.body),[{},{step:'media',source:'news-hani'},{step:'media',source:'news-khan'},
    {step:'keywords'},{step:'pending'},{step:'titles'},{step:'prune'}]);
   assert.equal((await runRow(n)).jobs_total,7);
   const m1=await send('news');
   assert.equal(await settle(m1.req,500,'{"error":"SERVER_CONFIG_MISSING"}'),'failed','config error is not retried');
   const m2=await send('news');
   assert.equal(await settle(m2.req,401,'{"error":"UNAUTHORIZED"}'),'failed');
   const rows=await jobs(n);
   assert.deepEqual(rows.map(j=>j.state),['ok','failed','failed','failed','failed','failed','failed']);
   assert.deepEqual(rows.slice(3).map(j=>j.error_code),['unauthorized','unauthorized','unauthorized','unauthorized']);
   assert.equal(rows[1].error_code,'SERVER_CONFIG_MISSING');
   const r=await runRow(n);assert.deepEqual([r.state,r.jobs_ok,r.jobs_failed],['partial',1,6]);
   // 계획 응답 모양이 다르면 실패, 2xx인데 ok가 아니면 not_ok.
   await age('5 minutes');
   const n2=await enqueue('news');const p2=await send('news');
   assert.equal(await settle(p2.req,200,'{"ok":true}'),'failed');
   assert.equal((await jobs(n2))[0].error_code,'plan_shape');assert.equal((await runRow(n2)).state,'failed');
   const f=await enqueue('news_fill');const f1=await send('news');
   assert.equal(await settle(f1.req,200,'{"ok":false}'),'failed');assert.equal((await jobs(f))[0].error_code,'not_ok');
   const f2=await send('news');
   assert.equal(await settle(f2.req,200,JSON.stringify({ok:true,done:4,remaining:7,stale:1,deferred:2})),'ok');
   assert.deepEqual((await jobs(f))[1].result,{done:4,remaining:7,stale:1,deferred:2});
   assert.equal((await runRow(f)).state,'partial');
   await assert.rejects(pool.query('select private.app_feed_settle(0,200,null)'),/FEED_RESPONSE_INVALID/);
   await assert.rejects(pool.query('select private.app_feed_settle(1,99,null)'),/FEED_RESPONSE_INVALID/);
  });

  await t.test('tidy: silent sends time out (retry then fail), runs over 2 hours close as late, closed runs over 30 days go',async()=>{
   await age('1 day');
   const o=await enqueue('outside');const s=await send('outside');
   await pool.query("update public.app_feed_jobs set sent_at=now()-interval '11 minutes' where request_id=$1",[s.req]);
   let out=await tidy();assert.equal(out.retried,1);
   assert.deepEqual((await jobs(o)).map(j=>[j.state,j.error_code,j.request_id]),[['queued','no_response',null]]);
   assert.equal(await settle(s.req,200,'{"ok":true,"sources":[],"pruned":0}'),null,'a late answer to a closed send is ignored');
   for(let i=0;i<2;i++){const x=await send('outside');await pool.query("update public.app_feed_jobs set sent_at=now()-interval '11 minutes' where request_id=$1",[x.req]);await tidy();}
   assert.deepEqual((await jobs(o)).map(j=>[j.state,j.tries,j.error_code]),[['failed',3,'no_response']]);
   assert.equal((await runRow(o)).state,'failed','run closed by tidy when nothing is open');
   // 2시간 넘은 칸: 남은 일 늦음.
   const n=await enqueue('news');const p=await send('news');
   await settle(p.req,200,JSON.stringify({ok:true,media:['news-a']}));
   await send('news');
   await pool.query("update public.app_feed_runs set started_at=now()-interval '3 hours' where id=$1",[n]);
   out=await tidy();assert.equal(out.late,1);
   const r=await runRow(n);assert.deepEqual([r.state,r.jobs_total,r.jobs_ok,r.jobs_failed],['late',6,1,5]);
   assert.ok((await jobs(n)).slice(1).every(j=>j.state==='late'));
   await age('1 hour');assert.ok(await enqueue('news'),'a new slot can start after the late one closed');
   // 30일.
   const total=(await one('select count(*)::int n from public.app_feed_runs')).n;
   await pool.query("update public.app_feed_runs set started_at=now()-interval '31 days' where state<>'running'");
   out=await tidy();assert.equal(out.pruned,total-1);
   assert.equal((await one('select count(*)::int n from public.app_feed_runs')).n,1,'only the running slot stays');
   assert.equal((await one("select count(*)::int n from public.app_feed_jobs j where not exists(select 1 from public.app_feed_runs r where r.id=j.run_id)")).n,0);
  });

  await t.test('isolation: no other DB function names the new tables',async()=>{
   const fns=(await pool.query("select p.oid::regprocedure::text f from pg_proc p where p.prosrc ~ '(app_cron_keys|app_feed_runs|app_feed_jobs)' order by 1")).rows.map(r=>r.f);
   assert.deepEqual(fns,['private.app_feed_claim(text)','private.app_feed_enqueue(text)','private.app_feed_sent(uuid,bigint)','private.app_feed_settle(bigint,integer,text)','private.app_feed_tidy()']);
   assert.equal((await one("select count(*)::int n from pg_views where definition ~ '(app_cron_keys|app_feed_runs|app_feed_jobs)'")).n,0);
  });

  await t.test('rollback: blocked while a cron schedule calls the functions; then restores tables, functions and record; re-apply works',async()=>{
   await pool.query("create schema cron; create table cron.job(jobid bigint primary key, jobname text, command text); insert into cron.job values (1,'web2_feed_tick','select private.app_feed_tidy()')");
   {const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/FEED_CRON_TABLES_ROLLBACK_BLOCKED: cron schedule/);await c.query('rollback');}finally{c.release();}}
   assert.notEqual((await one("select to_regclass('public.app_feed_jobs') t")).t,null);
   await pool.query("delete from cron.job where jobid=1; insert into cron.job values (2,'other_job','select 1')");
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows.filter(r=>r.kind!=='extension'),before.filter(r=>r.kind!=='extension'));
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   await pool.query('drop schema cron cascade');
   const again=await run('apply','9984');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
