// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S61-36 REC-상세녹음 ①(20261113160000_meeting_recording_meetings): 녹음(session) → 회의 연결 표.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예·기존 표 해시 그대로, 두 번째 apply는 거절.
// - 표: anon·authenticated(owner 포함)는 읽기·쓰기 모두 거절. service_role은 정한 4칸만 넣고 읽음, 고치기·지우기 없음, 한 녹음에 한 회의.
// - 회의·작업공간을 영구 삭제하면 연결 행도 지워진다.
// - 되돌리기(SQL Editor 전용)는 표·기록만 지우고, 다시 적용할 수 있다.
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
const version='20261113160000',name='meeting_recording_meetings',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const uuid=n=>`36000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const M1=uuid(1),M2=uuid(2),MB=uuid(3),S1=uuid(11),S2=uuid(12),S3=uuid(13);
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  alter table public.app_meetings enable row level security;
  create policy task12a_owner_all on public.app_meetings for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_meetings from anon, service_role;`;
const BEFORE=['20261029071500_meeting_transcribe_jobs','20261029200000_meeting_recordings'];

test('meeting recording meetings: server-only session→meeting table, dry-run clean, apply postcheck, cascade, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rec-meeting-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1']});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  for(const f of BEFORE)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),anon=fn=>as('anon','',fn),service=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);};
  const link=(c,s,ws,by,m)=>c.query('insert into public.app_meeting_recording_meetings(session_id,workspace_id,created_by,meeting_id) values($1,$2,$3,$4)',[s,ws,by,m]);
  const rows=async()=>(await pool.query('select session_id,meeting_id from public.app_meeting_recording_meetings order by session_id')).rows;

  await t.test('files: expanded rules, pair files, summary three lines, no fixed ids, no anon/public grant',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['dry-run','apply']){const plan=prepareMigration({mode,version,runId:'1',root});assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
    assert.deepEqual(plan.review.definer,[]);assert.equal(plan.review.policies,0);assert.deepEqual(plan.targets,[]);}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
   assert.doesNotMatch(code,/disable row level security|\bto (anon|public|authenticated)\b|rtw_|create policy|create trigger|create function/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  let before;
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; existing tables unchanged; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   await allYes(postcheck);
   before=(await pool.query(snapshot)).rows;
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const applied=await run('apply','9992');assert.equal(applied.ok,true,applied.summary);
   await allYes(postcheck);
   const after=values(await readOnly(postcheck));
   for(const item of ['existing tables RLS policies grants hash','existing tables column grants hash'])assert.equal(after[item],v[item],item);
   assert.equal((await run('apply','9993')).ok,false);
  });

  await pool.query('insert into public.app_meetings(id,workspace_id,title,created_by) values($1,$4,$5,$6),($2,$4,$5,$6),($3,$7,$5,$8)',[M1,M2,MB,WS_A,'가상 회의',OWNER,WS_B,STRANGER]);

  await t.test('service role: 4 columns insert + read only, one meeting per recording; screen and anon cannot touch it',async()=>{
   await service(c=>link(c,S1,WS_A,OWNER,M1));
   await service(c=>link(c,S2,WS_A,OWNER,M2));
   await assert.rejects(service(c=>link(c,S1,WS_A,OWNER,M2)),{code:'23505'},'one meeting per recording');
   await assert.rejects(service(c=>link(c,S3,WS_A,OWNER,uuid(99))),{code:'23503'},'meeting must exist');
   assert.equal((await service(c=>c.query('select count(*)::int as n from public.app_meeting_recording_meetings'))).rows[0].n,2);
   await assert.rejects(service(c=>c.query('update public.app_meeting_recording_meetings set meeting_id=$1 where session_id=$2',[M2,S1])),{code:'42501'});
   await assert.rejects(service(c=>c.query('delete from public.app_meeting_recording_meetings where session_id=$1',[S1])),{code:'42501'});
   await assert.rejects(service(c=>c.query('insert into public.app_meeting_recording_meetings(session_id,workspace_id,created_by,meeting_id,created_at) values($1,$2,$3,$4,now())',[S3,WS_A,OWNER,M1])),{code:'42501'});
   for(const who of [owner,anon]){
    await assert.rejects(who(c=>c.query('select session_id from public.app_meeting_recording_meetings')),{code:'42501'});
    await assert.rejects(who(c=>link(c,S3,WS_A,OWNER,M1)),{code:'42501'});
   }
   assert.deepEqual(await rows(),[{session_id:S1,meeting_id:M1},{session_id:S2,meeting_id:M2}]);
  });

  await t.test('deleting a meeting removes only its recording link',async()=>{
   await pool.query('delete from public.app_meetings where id=$1',[M2]);
   assert.deepEqual(await rows(),[{session_id:S1,meeting_id:M1}]);
  });

  await t.test('rollback (SQL Editor) drops the table and the record only; re-apply works',async()=>{
   const meetings=(await pool.query('select count(*)::int as n from public.app_meetings')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal((await pool.query('select count(*)::int as n from public.app_meetings')).rows[0].n,meetings,'meetings untouched');
   await assert.rejects(pool.query(rollbackSQL),/MEETING_RECORDING_MEETINGS_ROLLBACK_BLOCKED/);
   const again=await run('apply','9994');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
