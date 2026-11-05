// Fresh local PostgreSQL only. No Supabase, Edge, pg_cron, pg_net, vault or production credentials. All data synthetic.
// S51-5 NEWS-전면개편 P1b(20261106070000, SQL Editor 전용): 확장 확인·켜기 / 금고 값·지문 / 예약 4개 + 기록 1행.
// 시험 PostgreSQL에는 pg_cron·pg_net·supabase_vault가 없다 → 조각 ①은 '확장 없음'에서 멈추는지만 보고,
// 나머지는 같은 이름·같은 모양의 가짜 cron·net·vault 스키마(표·함수)를 만들어 조각 ②·③·확인 SQL·rollback과
// 예약 명령 본문(칸 만들기 → 1분 명령: 응답 정리 → 1분 정리 → 꺼내기 → 요청 → 보냄 기록)의 호출 순서를 실제로 돌려 본다.
// 가짜 net.http_post는 요청을 표에 적기만 하고(바깥으로 안 나감), 응답은 시험이 net._http_response에 직접 넣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import pg from 'pg';
import {trackPool,closePool} from './pg-close.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261106070000',name='feed_cron_schedule',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
const externalPort=process.env.FEED_CRON_PG_PORT;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const URL_OK='https://abcdefghijklmnopqrst.supabase.co'; // 합성 주소(실제 프로젝트 아님)
const setup=`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema private; create schema extensions;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);`;
// 운영 확장과 같은 이름·인자 모양의 가짜(시험 전용).
const fakes=`
  create schema cron;
  create table cron.job(jobid bigserial primary key, schedule text not null, command text not null, database text default current_database(),
    username text default current_user, active boolean default true, jobname text unique);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as
    $f$ insert into cron.job(jobname,schedule,command) values(job_name,schedule,command)
        on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid $f$;
  create function cron.unschedule(job_name text) returns boolean language plpgsql as
    $f$ begin delete from cron.job where jobname=job_name; if not found then raise exception 'could not find valid entry for job %', job_name; end if; return true; end $f$;
  create schema net;
  create table net._http_response(id bigint primary key, status_code integer, content_type text, headers jsonb, content text, timed_out boolean, error_msg text, created timestamptz default now());
  create table net.fake_requests(id bigserial primary key, url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{"Content-Type":"application/json"}', timeout_milliseconds integer default 5000)
    returns bigint language sql as
    $f$ insert into net.fake_requests(url,body,params,headers,timeout_milliseconds) values(url,body,params,headers,timeout_milliseconds) returning id $f$;
  create schema vault;
  create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, secret text not null, description text);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as
    $f$ insert into vault.secrets(secret,name,description) values(new_secret,new_name,new_description) returning id $f$;`;
const fakeRandom=`create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as
  $f$ select substring(decode(md5(random()::text)||md5(random()::text)||md5(random()::text)||md5(random()::text),'hex') from 1 for n) $f$;`;

// migration 파일을 조각·확인으로 나눈다(머리글 '-- ===== …' 기준).
function pieces(sql){
 const parts={};let cur=null;
 for(const line of sql.split('\n')){
  if(/^-- ===== .*끝 =====$/.test(line)){cur=null;continue;}
  const m=/^-- ===== (조각 ①|조각 ②|조각 ③|확인 1|확인 2|확인 3)/.exec(line);
  if(m){cur=m[1];parts[cur]='';continue;}
  if(cur)parts[cur]+=line+'\n';
 }
 return parts;
}

test('feed cron schedule: SQL Editor only, extension guard, vault key + fingerprint, four jobs, tick flow, rollback',{timeout:120000},async t=>{
 let cluster,pool,adminPool,port,password,database='postgres';
 if(externalPort){
  port=Number(externalPort);database='feedcron_'+randomBytes(4).toString('hex');
  adminPool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false}));
  await adminPool.query('create database '+database);
  for(const role of ['anon','authenticated','service_role'])await adminPool.query(`drop role if exists ${role}`).catch(()=>{});
 }else{
  const {default:EmbeddedPostgres}=await import('embedded-postgres');
  const directory=await mkdtemp(join(tmpdir(),'feed-cron-sched-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));port=sock.address().port;await new Promise(r=>sock.close(r));
  password=randomBytes(24).toString('hex');
  cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
 }
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false,options:'-c cron.timezone=GMT'}));
  await pool.query(setup);
  await pool.query(await read('supabase/migrations/20261106040000_feed_cron_tables.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const P=pieces(migration);
  const items=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allRows=res=>(Array.isArray(res)?res:[res]).flatMap(r=>r.rows||[]);
  // 조각 하나를 한 연결에서 실행(SQL Editor처럼). 실패하면 열린 거래를 닫고 오류를 돌려준다.
  const runPiece=async sql=>{const c=await pool.connect();try{return allRows(await c.query(sql));}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const snap=async()=>(await pool.query(snapshot)).rows.map(r=>[r.kind,r.name,r.definition].join(' | ')).join('\n');
  const key=async()=>(await pool.query(`select secret from vault.secrets where name='web2_feed_cron'`)).rows[0]?.secret;
  const sha=v=>createHash('sha256').update(v,'utf8').digest('hex');
  const frag2=url=>P['조각 ②'].replace("'__CC_PROJECT_URL__'","'"+url+"'");
  const command=async job=>(await pool.query('select command from cron.job where jobname=$1',[job])).rows[0].command;
  const runJob=async job=>pool.query(await command(job));
  const age=async interval=>pool.query(`update public.app_feed_runs set slot_at=slot_at-$1::interval, started_at=started_at-$1::interval`,[interval]);

  await t.test('files: SQL Editor only, three fragments with begin/commit, one placeholder, no ref/URL/key, summary 3 lines',()=>{
   for(const mode of ['apply','dry-run','rollback'])assert.throws(()=>prepareMigration({mode,version,runId:'1',root}),undefined,mode);
   assert.match(migration,/SQL Editor\(폰 경로 C\) 전용/);
   for(const k of ['조각 ①','조각 ②','조각 ③','확인 1','확인 2']){assert.ok(P[k]&&P[k].trim(),k);}
   for(const k of ['조각 ①','조각 ②','조각 ③']){
    const body=P[k].trim();
    assert.match(body,/^begin;/,k);assert.match(body,/commit;$/,k);
    assert.equal((body.match(/^begin;$/gm)||[]).length,1,k);assert.equal((body.match(/^commit;$/gm)||[]).length,1,k);
   }
   for(const k of ['확인 1','확인 2'])assert.doesNotMatch(P[k],/\b(insert|update|delete|create|drop|alter|begin|commit|perform)\b/i,k);
   assert.equal(migration.replace(/--.*$/gm,'').split('__CC_PROJECT_URL__').length-1,1,'placeholder exactly once in code (fragment 2)');
   assert.ok(P['조각 ②'].includes('__CC_PROJECT_URL__'));
   assert.equal((migration.match(/insert into supabase_migrations\.schema_migrations/g)||[]).length,1);
   assert.ok(P['조각 ③'].includes('insert into supabase_migrations.schema_migrations'));
   const code=[migration,precheck,postcheck,snapshot,rollbackSQL].join('\n').replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/https:\/\/[a-z0-9]{20}\.supabase\.co/i,'no literal project URL');
   assert.doesNotMatch(code,/\b[a-z]{20}\b/,'no project-ref-like 20-letter token');
   assert.doesNotMatch(code,/security definer|\bto (anon|public|authenticated)\b|disable row level security|create policy|rtw_|drop extension/i);
   assert.doesNotMatch(code,/raise (notice|info|warning|log)/i,'nothing printed');
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
  });

  let before;
  await t.test('precheck, fragment 1 stops when pg_cron/pg_net are not available, check 1 all yes on fake cron/net/vault',async()=>{
   await pool.query(fakes);
   try{await pool.query('create extension if not exists pgcrypto with schema extensions');}catch{await pool.query(fakeRandom);}
   assert.ok((await pool.query(`select to_regprocedure('extensions.gen_random_bytes(integer)') is not null as ok`)).rows[0].ok);
   before=await snap();
   const v=items((await pool.query(precheck)).rows);
   for(const k of ['new migration absent','P1a feed_cron_tables recorded','app_cron_keys table','feed functions present','fingerprint row absent','pgcrypto gen_random_bytes'])assert.equal(v[k],'예',k);
   assert.equal(v['pg_cron available'],'아니오');assert.equal(v['extension pg_cron'],'꺼짐');
   assert.equal(v['web2_feed jobs absent'],'확인 1에서');
   assert.equal(v['cron timezone'],'GMT');
   await assert.rejects(runPiece(P['조각 ①']),/FEED_CRON_EXTENSION_UNAVAILABLE/);
   assert.equal(await snap(),before,'fragment 1 changed nothing');
   for(const r of await runPiece(P['확인 1']))assert.equal(r.value,'예',r.item);
  });

  await t.test('fragment 3 before fragment 2 stops; fragment 2 stops on placeholder or bad URL',async()=>{
   await assert.rejects(runPiece(P['조각 ③']),/FEED_CRON_SCHEDULE_PREREQUISITE_CHANGED/);
   await assert.rejects(runPiece(P['조각 ②']),/FEED_CRON_PROJECT_URL_INVALID/);
   for(const bad of ['http://abcdefghijklmnopqrst.supabase.co','https://abcdefghijklmnopqrst.supabase.co/','https://evil.example.com','https://ABCDEFGHIJKLMNOPQRST.supabase.co'])
    await assert.rejects(runPiece(frag2(bad)),/FEED_CRON_PROJECT_URL_INVALID/,bad);
   assert.equal(await snap(),before);
   assert.equal((await pool.query('select count(*)::int n from vault.secrets')).rows[0].n,0);
  });

  let k1;
  await t.test('fragment 2: random key in vault (never returned), only its SHA-256 in app_cron_keys; second run stops',async()=>{
   const out=await runPiece(frag2(URL_OK));
   k1=await key();
   assert.match(k1,/^[0-9a-f]{64}$/);
   assert.ok(!JSON.stringify(out).includes(k1),'key not in any returned row');
   const fp=(await pool.query(`select secret_sha256 from public.app_cron_keys where name='web2_feed_cron'`)).rows;
   assert.deepEqual(fp,[{secret_sha256:sha(k1)}]);
   assert.equal((await pool.query(`select secret from vault.secrets where name='web2_feed_project_url'`)).rows[0].secret,URL_OK);
   await assert.rejects(runPiece(frag2(URL_OK)),/FEED_CRON_KEY_PREREQUISITE_CHANGED/);
   const c2=await runPiece(P['확인 2']);
   for(const r of c2)assert.equal(r.value,'예',r.item);
   assert.ok(!JSON.stringify(c2).includes(k1)&&!JSON.stringify(c2).includes(URL_OK));
   // 화면·익명·서버 역할은 지문 표를 고칠 수 없다(P1a 권한 그대로).
   for(const role of ['anon','authenticated','service_role'])
    assert.equal((await pool.query(`select has_table_privilege($1,'public.app_cron_keys','insert,update,delete') ok`,[role])).rows[0].ok,false,role);
  });

  await t.test('fragment 3: four jobs with exact UTC schedules, record row, postcheck all yes; second run stops',async()=>{
   const out=await runPiece(P['조각 ③']);
   assert.ok(!JSON.stringify(out).includes(k1));
   const jobs=(await pool.query(`select jobname,schedule,active from cron.job order by jobname`)).rows;
   assert.deepEqual(jobs,[
    {jobname:'web2_feed_news',schedule:'22 4,9,23 * * *',active:true},
    {jobname:'web2_feed_news_fill',schedule:'22 0-3,5-8,10-22 * * *',active:true},
    {jobname:'web2_feed_outside',schedule:'7 4,9,23 * * *',active:true},
    {jobname:'web2_feed_tick',schedule:'* * * * *',active:true}]);
   // KST 시각 환산: UTC 시 + 9.
   const kst=h=>(h+9)%24;
   assert.deepEqual([4,9,23].map(kst).sort((a,b)=>a-b),[8,13,18]);
   const fill=[...Array(24).keys()].filter(h=>![4,9,23].includes(h));
   assert.deepEqual(fill,[0,1,2,3,5,6,7,8,10,11,12,13,14,15,16,17,18,19,20,21,22]);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.value,'예',r.item);
   assert.equal((await pool.query(`select name from supabase_migrations.schema_migrations where version=$1`,[version])).rows[0].name,name);
   for(const j of ['web2_feed_outside','web2_feed_news','web2_feed_news_fill','web2_feed_tick']){
    const c=await command(j);assert.ok(!c.includes(k1)&&!c.includes(URL_OK),j);
   }
   await assert.rejects(runPiece(P['조각 ③']),/FEED_CRON_SCHEDULE_PREREQUISITE_CHANGED/);
   // P1a 되돌리기는 예약이 함수를 부르는 동안 멈춘다(짝 순서 확인).
   await assert.rejects(runPiece(await read('docs/20261106040000_feed_cron_tables.rollback.sql')),/FEED_CRON_TABLES_ROLLBACK_BLOCKED/);
  });

  await t.test('job commands: enqueue → tick settles, tidies, claims one job per collector, posts with key header and 150 s, marks sent',async()=>{
   const sent=async()=>(await pool.query('select id,url,body,headers,timeout_milliseconds from net.fake_requests order by id')).rows;
   // 칸이 없으면 1분 명령은 아무것도 보내지 않는다.
   await runJob('web2_feed_tick');assert.equal((await sent()).length,0);
   await runJob('web2_feed_outside');await runJob('web2_feed_news');
   await runJob('web2_feed_tick');
   let reqs=await sent();
   assert.equal(reqs.length,2,'one request per collector');
   const [o,n]=reqs;
   assert.equal(o.url,URL_OK+'/functions/v1/outside-feed?action=run_plan');
   assert.deepEqual(o.body,{});
   assert.deepEqual(Object.keys(o.headers).sort(),['Content-Type','x-outside-feed-cron-secret']);
   assert.equal(o.headers['x-outside-feed-cron-secret'],k1);
   assert.equal(o.timeout_milliseconds,150000);
   assert.equal(n.url,URL_OK+'/functions/v1/news-feed?action=run_plan');
   assert.deepEqual(Object.keys(n.headers).sort(),['Content-Type','x-news-feed-cron-secret']);
   assert.equal(n.headers['x-news-feed-cron-secret'],k1);
   const job=async req=>(await pool.query('select j.state,j.body,j.result,j.error_code from public.app_feed_jobs j where j.request_id=$1',[req])).rows[0];
   assert.equal((await job(o.id)).state,'sent');assert.equal((await job(n.id)).state,'sent');
   // 응답이 아직 없으면 같은 수집기에서 다음 일을 꺼내지 않는다.
   await runJob('web2_feed_tick');assert.equal((await sent()).length,2);
   // 계획 응답 → 다음 일들. 사회운동 2곳, 언론 1곳(+ keywords·pending·titles·prune).
   await pool.query(`insert into net._http_response(id,status_code,content) values
     ($1,200,'{"ok":true,"sources":["kctu","kptu"],"pruned":0,"title":"x"}'),
     ($2,200,'{"ok":true,"media":["news-hani"]}')`,[o.id,n.id]);
   await runJob('web2_feed_tick');
   reqs=await sent();
   assert.equal(reqs.length,4);
   assert.equal((await job(o.id)).state,'ok');assert.deepEqual((await job(o.id)).result,{pruned:0,keys:2});
   assert.equal(reqs[2].url,URL_OK+'/functions/v1/outside-feed?action=run');assert.deepEqual(reqs[2].body,{source:'kctu'});
   assert.equal(reqs[3].url,URL_OK+'/functions/v1/news-feed?action=run');assert.deepEqual(reqs[3].body,{step:'media',source:'news-hani'});
   // 5xx는 다시 줄에 넣고 다음 1분에 다시 보낸다. 시간 초과(상태 없음)도 같다.
   await pool.query(`insert into net._http_response(id,status_code,content,timed_out) values ($1,503,'{"error":"UPSTREAM"}',false),($2,null,null,true)`,[reqs[2].id,reqs[3].id]);
   await runJob('web2_feed_tick');
   reqs=await sent();
   assert.equal(reqs.length,6);
   assert.deepEqual(reqs[4].body,{source:'kctu'});assert.deepEqual(reqs[5].body,{step:'media',source:'news-hani'});
   // 401이면 그 칸의 남은 일도 닫는다.
   await pool.query(`insert into net._http_response(id,status_code,content) values ($1,401,'{"error":"UNAUTHORIZED"}')`,[reqs[4].id]);
   await runJob('web2_feed_tick');
   const run=(await pool.query(`select state,jobs_failed from public.app_feed_runs where feed='outside'`)).rows[0];
   assert.equal(run.state,'partial');
   // 언론 보충(news_fill)은 언론 수집기와 같은 줄(news가 '보냄'이면 기다림).
   await age('1 minute');await runJob('web2_feed_news_fill');
   assert.equal((await pool.query(`select count(*)::int n from public.app_feed_runs where feed='news_fill'`)).rows[0].n,1);
   // 금고 주소가 모양이 틀리면 1분 명령은 아무것도 보내지 않는다(정리만).
   const count=(await sent()).length;
   await pool.query(`update vault.secrets set secret='https://evil.example.com' where name='web2_feed_project_url'`);
   await pool.query(`insert into net._http_response(id,status_code,content) values ($1,200,'{"ok":true,"listed":3}')`,[reqs[5].id]);
   await runJob('web2_feed_tick');
   assert.equal((await sent()).length,count);
   assert.equal((await job(reqs[5].id)).state,'ok','settle still ran');
   await pool.query(`update vault.secrets set secret=$1 where name='web2_feed_project_url'`,[URL_OK]);
  });

  await t.test('rollback: jobs, vault values, fingerprint and record removed; extensions untouched; twice ok; reapply makes a new key',async()=>{
   await runPiece(rollbackSQL);
   assert.equal((await pool.query(`select count(*)::int n from cron.job where jobname like 'web2\\_feed\\_%'`)).rows[0].n,0);
   assert.equal((await pool.query(`select count(*)::int n from vault.secrets where name in ('web2_feed_cron','web2_feed_project_url')`)).rows[0].n,0);
   assert.equal(await snap(),before,'snapshot equal after rollback');
   await runPiece(rollbackSQL);
   assert.equal(await snap(),before);
   // P1a 표·쌓인 칸은 남는다.
   assert.ok((await pool.query(`select count(*)::int n from public.app_feed_runs`)).rows[0].n>0);
   // 조각 ②까지만 한 상태의 되돌리기도 된다.
   await runPiece(frag2(URL_OK));
   const k2=await key();assert.notEqual(k2,k1);
   await runPiece(rollbackSQL);assert.equal(await snap(),before);
   // 다시 ②·③.
   await runPiece(frag2(URL_OK));await runPiece(P['조각 ③']);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.value,'예',r.item);
   await runPiece(rollbackSQL);assert.equal(await snap(),before);
  });
 }finally{
  await closePool(pool);
  if(adminPool){await adminPool.query('drop database if exists '+database+' with (force)').catch(()=>{});await closePool(adminPool);}
  if(cluster)await cluster.stop().catch(()=>{});
 }
});
