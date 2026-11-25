// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// SEC-Web2CSP I-5(20261125220000_csp_reports): CSP 위반 개수 표 app_csp_reports + 넣기 함수 app_csp_report_add(service_role만).
// - 승인형 DB workflow 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예. 두 번째 apply는 멈춤.
// - 허용 모양만 저장: 정해진 지시어·출처(origin) 모양·정해진 낱말, 1~20개, hits 1~20. 경로·쿼리가 붙은 주소·모르는 지시어·덧붙인 칸은 거절.
// - 날짜별 개수 합치기: 같은 날·지시어·출처는 한 줄에 더하고, 다른 날은 따로. 한 날 300줄이 차면 새 출처는 그 지시어의 'other'로 합친다.
// - 표는 날짜·지시어·출처·개수 칸뿐이고, 어떤 API 역할도 직접 못 읽고 못 쓴다. 함수는 anon·authenticated가 못 부른다.
// - 되돌리기는 함수·기록만 지우고 표는 남긴다. 다시 적용하면 이전 표가 있어 멈춘다.
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
import {fixture,OWNER} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261125220000',name='csp_reports',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('csp reports: allowed shapes only, daily counts merge, no API table access, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'csp-reports-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const add=items=>server(c=>c.query('select public.app_csp_report_add($1::jsonb) r',[JSON.stringify(items)]));
  const rows=async()=>(await pool.query("select day::text, directive, blocked, hits from public.app_csp_reports order by day, directive, blocked")).rows;
  const today=(await pool.query("select (now() at time zone 'Asia/Seoul')::date::text d")).rows[0].d;
  const allYes=async sql=>{for(const r of await readOnly(sql))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);};
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: rules pass, summary 3 lines, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run'])assert.equal(prepareMigration({mode,version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public|authenticated)\b(?!\.)|disable row level security|create policy|rtw_/i);
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   await allYes(precheck);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9973')).ok,false);
  });

  await t.test('columns: only day, directive, blocked, hits',async()=>{
   const cols=(await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='app_csp_reports' order by ordinal_position")).rows.map(r=>r.column_name);
   assert.deepEqual(cols,['day','directive','blocked','hits']);
  });

  await t.test('add: server only; anon and signed-in users are refused',async()=>{
   const item=[{directive:'img-src',blocked:'https://a.example',hits:1}];
   await assert.rejects(anon(c=>c.query('select public.app_csp_report_add($1::jsonb)',[JSON.stringify(item)])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('select public.app_csp_report_add($1::jsonb)',[JSON.stringify(item)])),{code:'42501'});
   assert.deepEqual(await rows(),[]);
  });

  await t.test('allowed shapes only: paths, queries, unknown directives, extra size and bad hits are refused',async()=>{
   for(const bad of [
    null,{},[],'x',
    [{directive:'img-src',blocked:'https://a.example/path',hits:1}],
    [{directive:'img-src',blocked:'https://a.example?token=1',hits:1}],
    [{directive:'img-src',blocked:'https://user@a.example',hits:1}],
    [{directive:'img-src',blocked:'HTTPS://A.EXAMPLE',hits:1}],
    [{directive:'img-src',blocked:'wss://a.example',hits:1}],
    [{directive:'img-src',blocked:'someone@mail.example',hits:1}],
    [{directive:'report-uri',blocked:'https://a.example',hits:1}],
    [{directive:'img-src',blocked:'https://a.example',hits:0}],
    [{directive:'img-src',blocked:'https://a.example',hits:21}],
    [{directive:'img-src',blocked:'https://a.example',hits:1.5}],
    [{directive:'img-src',blocked:'https://a.example',hits:'1'}],
    [{directive:'img-src',blocked:1,hits:1}],
    ['img-src'],
    Array.from({length:21},()=>({directive:'img-src',blocked:'inline',hits:1})),
   ]){
    await assert.rejects(add(bad),/CSP_REPORT_(SHAPE|VALUE)/,JSON.stringify(bad)?.slice(0,80));
   }
   assert.deepEqual(await rows(),[]);
  });

  await t.test('daily counts merge per directive and origin; other days stay separate',async()=>{
   assert.equal((await add([{directive:'img-src',blocked:'https://a.example',hits:2},{directive:'script-src-elem',blocked:'inline',hits:1}])).rows[0].r.count,3);
   await add([{directive:'img-src',blocked:'https://a.example',hits:5},{directive:'img-src',blocked:'data',hits:1}]);
   await pool.query("insert into public.app_csp_reports(day,directive,blocked,hits) values ($1::date - 1,'img-src','https://a.example',4)",[today]);
   await add([{directive:'img-src',blocked:'https://a.example',hits:1}]);
   const yesterday=(await pool.query("select ($1::date - 1)::text d",[today])).rows[0].d;
   assert.deepEqual(await rows(),[
    {day:yesterday,directive:'img-src',blocked:'https://a.example',hits:4},
    {day:today,directive:'img-src',blocked:'data',hits:1},
    {day:today,directive:'img-src',blocked:'https://a.example',hits:8},
    {day:today,directive:'script-src-elem',blocked:'inline',hits:1},
   ]);
  });

  await t.test('row cap: after 300 rows a day, new origins fold into other; known rows still count; hits cap at 1000000',async()=>{
   await pool.query("insert into public.app_csp_reports(day,directive,blocked,hits) select $1::date,'connect-src','https://h'||g||'.example',1 from generate_series(1,297) g",[today]);
   assert.equal((await pool.query('select count(*)::int n from public.app_csp_reports where day=$1::date',[today])).rows[0].n,300);
   await add([{directive:'connect-src',blocked:'https://new.example',hits:3},{directive:'img-src',blocked:'https://a.example',hits:1}]);
   const got=Object.fromEntries((await rows()).filter(r=>r.day===today).map(r=>[r.directive+' '+r.blocked,r.hits]));
   assert.equal(got['connect-src https://new.example'],undefined);
   assert.equal(got['connect-src other'],3);
   assert.equal(got['img-src https://a.example'],9);
   await add([{directive:'connect-src',blocked:'https://other2.example',hits:2}]);
   assert.equal((await pool.query("select hits from public.app_csp_reports where day=$1::date and directive='connect-src' and blocked='other'",[today])).rows[0].hits,5);
   await pool.query("update public.app_csp_reports set hits=999999 where day=$1::date and directive='img-src' and blocked='data'",[today]);
   await add([{directive:'img-src',blocked:'data',hits:20}]);await add([{directive:'img-src',blocked:'data',hits:20}]);
   assert.equal((await pool.query("select hits from public.app_csp_reports where day=$1::date and directive='img-src' and blocked='data'",[today])).rows[0].hits,1000000);
  });

  await t.test('table: no API role can read or write it directly',async()=>{
   for(const fn of [owner,server,anon]){
    await assert.rejects(fn(c=>c.query('select * from public.app_csp_reports')),{code:'42501'});
    await assert.rejects(fn(c=>c.query("insert into public.app_csp_reports values (current_date,'img-src','inline',1)")),{code:'42501'});
    await assert.rejects(fn(c=>c.query('delete from public.app_csp_reports where hits > 0')),{code:'42501'});
   }
  });

  await t.test('rollback removes the function and record; the table stays; re-apply stops',async()=>{
   const count=(await pool.query('select count(*)::int n from public.app_csp_reports')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select to_regprocedure('public.app_csp_report_add(jsonb)') f")).rows[0].f,null);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_csp_reports')).rows[0].n,count);
   const c=await pool.connect();try{await assert.rejects(c.query(migration),/CSP_REPORTS_PREREQUISITE_CHANGED/);await c.query('rollback');}finally{c.release();}
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
