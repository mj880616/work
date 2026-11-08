// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S54-27 ORG-기록하나로 O-2 DB(20261109100000_record_one_org): 조직 기록 새 칸(end_day·source_kind·source_id)·출처 검사,
// 보고용 표시 표(app_report_line_marks)·확정 사진 표(app_report_snapshots) — through the approved DB workflow runner.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,ORG_A,ORG_B,PROJECT_A,PROJECT_B,MEETING_A,MEETING_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261109100000',name='record_one_org',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
import {prerequisites,UPD_A,UPD_B,FEED_A,FEED_B,MEM_A,NOTE_A,NOTE_B,DOC_A,DOC_B,OLD} from './record-one-fixture.mjs';

test('record one org db: plan, dry-run, apply, owner boundary, source guard, marks, snapshots, rollback and re-apply',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'record-one-org-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const refused=e=>['42501','23514'].includes(e.code);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=values(await readOnly(precheck));
  const oldRows=async()=>(await pool.query('select id,organization_id,raw_text,occurred_at,created_at from public.app_suborganization_updates order by id')).rows;
  const oldBefore=await oldRows();

  const addRecord=(sub,org,extra={})=>as('authenticated',sub,async c=>(await c.query(
   'insert into public.app_suborganization_updates(workspace_id,organization_id,raw_text,occurred_at,end_day,source_kind,source_id) values ($1,$2,$3,$4,$5,$6,$7) returning id',
   [extra.ws??WS_A,org,extra.text??'합성 기록',extra.at??'2026-11-10T12:00:00+09:00',extra.end??null,extra.kind??null,extra.src??null])).rows[0].id);
  const addMark=(sub,ws,m)=>as('authenticated',sub,async c=>(await c.query(
   'insert into public.app_report_line_marks(workspace_id,week_start,section,ref_kind,ref_key,report_body,choice,detail) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id,updated_at',
   [ws,m.week??'2026-11-09',m.section??'org',m.kind??'org_update',m.key??UPD_A,m.body??null,m.choice??null,m.detail??null])).rows[0]);
  const addSnap=(sub,ws,s={})=>as('authenticated',sub,async c=>(await c.query(
   'insert into public.app_report_snapshots(workspace_id,week_start,document_id,rows) values ($1,$2,$3,$4) returning id,confirmed_at',
   [ws,s.week??'2026-11-09',s.doc===undefined?DOC_A:s.doc,JSON.stringify(s.rows??[{section:'org',ref_kind:'space',ref_key:ORG_A,label:'합성 조직',lines:[{ref_kind:'org_update',ref_key:UPD_A,day:'2026-11-03',end_day:null,text:'합성 조직 기록'}],seen_events:['evt_1']}])])).rows[0]);

  await t.test('approval plan: expanded rules, full flow, no definer function, no grant on the existing table',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,[]);
   assert.equal(prepareMigration({mode:'dry-run',version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
   assert.doesNotMatch(migration,/grant[^;]*on table public\.app_suborganization_updates/i);
  });
  await t.test('precheck: every yes/no item is yes before apply; hashes recorded',()=>{
   for(const [item,value] of Object.entries(beforeCheck))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.match(beforeCheck['org records policies hash'],/^[0-9a-f]{32}$/);
  });
  await t.test('dry-run leaves schema, history and rows unchanged',async()=>{
   const dry=await run('dry-run','9921');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await oldRows(),oldBefore);
  });
  await t.test('apply passes postcheck (hashes equal precheck); second apply refused; old rows untouched',async()=>{
   const apply=await run('apply','9922');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post))assert.equal(value,/hash$/.test(item)?beforeCheck[item]:'예',item);
   const again=await run('apply','9923');assert.equal(again.ok,false);
   assert.deepEqual(await oldRows(),oldBefore);
   assert.equal((await pool.query('select count(*)::int n from public.app_suborganization_updates where end_day is null and source_kind is null and source_id is null')).rows[0].n,3);
  });
  await t.test('org records: old app writes still work; end_day and source rules',async()=>{
   // 지금 화면처럼 새 칸 없이 넣기·고치기.
   const plain=await addRecord(OWNER,ORG_A);assert.ok(plain);
   assert.equal((await owner(c=>c.query("update public.app_suborganization_updates set raw_text='고친 글' where id=$1",[plain]))).rowCount,1);
   assert.ok(await addRecord(OWNER,ORG_A,{kind:'user',end:'2026-12-05',at:'2026-11-02T12:00:00+09:00'}));
   // 서울 날짜 기준: 11/02 00:30 서울 = 11/01 UTC. 끝 날 11/02는 받는다.
   assert.ok(await addRecord(OWNER,ORG_A,{at:'2026-11-01T15:30:00Z',end:'2026-11-02'}));
   await assert.rejects(addRecord(OWNER,ORG_A,{at:'2026-11-03T12:00:00+09:00',end:'2026-11-02'}),{code:'23514'});
   await assert.rejects(addRecord(OWNER,ORG_A,{kind:'robot',src:FEED_A}),{code:'23514'});
   await assert.rejects(addRecord(OWNER,ORG_A,{kind:'feed'}),{code:'23514'});
   await assert.rejects(addRecord(OWNER,ORG_A,{kind:'user',src:FEED_A}),{code:'23514'});
   const fromFeed=await addRecord(OWNER,ORG_A,{kind:'feed',src:FEED_A});
   assert.ok(await addRecord(OWNER,ORG_A,{kind:'memorable',src:MEM_A}));
   assert.ok(await addRecord(OWNER,ORG_A,{kind:'update',src:NOTE_A}));
   // 같은 원래 줄을 같은 조직에 두 번 넣지 않음.
   await assert.rejects(addRecord(OWNER,ORG_A,{kind:'feed',src:FEED_A}),{code:'23505'});
   // 남의 작업공간 원래 줄은 거절.
   await assert.rejects(addRecord(OWNER,ORG_A,{kind:'feed',src:FEED_B}),{code:'23514'});
   await assert.rejects(addRecord(OWNER,ORG_A,{kind:'update',src:NOTE_B}),{code:'23514'});
   // 옮긴 종류는 로그인 사용자가 넣지 못하고, 옮기기 SQL(postgres)만 넣는다.
   await assert.rejects(addRecord(OWNER,ORG_A,{kind:'status_row',src:OLD}),{code:'23514'});
   await assert.rejects(addRecord(OWNER,ORG_A,{kind:'weekly_line',src:OLD}),{code:'23514'});
   await pool.query("insert into public.app_suborganization_updates(workspace_id,organization_id,raw_text,occurred_at,source_kind,source_id) values ($1,$2,'옮긴 현황 줄','2026-10-20T12:00:00+09:00','status_row',$3)",[WS_A,ORG_A,OLD]);
   // 출처 칸은 넣은 뒤 고칠 수 없다(글은 고칠 수 있음).
   await assert.rejects(owner(c=>c.query("update public.app_suborganization_updates set source_kind='user',source_id=null where id=$1",[fromFeed])),{code:'23514'});
   assert.equal((await owner(c=>c.query("update public.app_suborganization_updates set raw_text='통화에서 고침',end_day='2026-11-20' where id=$1",[fromFeed]))).rowCount,1);
   // 남의 조직·anon.
   await assert.rejects(addRecord(STRANGER,ORG_A,{ws:WS_B}),refused);
   await assert.rejects(as('anon','',c=>c.query('select end_day from public.app_suborganization_updates')),{code:'42501'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_suborganization_updates where organization_id=$1',[ORG_A]))).rows[0].n,0);
  });
  await t.test('report line marks: owner only, same workspace refs, event rules, inheritance rows, fixed scope columns',async()=>{
   const m=await addMark(OWNER,WS_A,{body:'보고용 글'});assert.ok(m.id);
   assert.ok(await addMark(OWNER,WS_A,{week:'2026-11-16',choice:'out'}));
   assert.ok(await addMark(OWNER,WS_A,{section:'site',choice:'out'}));
   assert.ok(await addMark(OWNER,WS_A,{kind:'event',key:'abc123_20261120T010000Z',choice:'out'}));
   assert.ok(await addMark(OWNER,WS_A,{kind:'event',key:'evt.2@group-x'}));
   assert.ok(await addMark(OWNER,WS_A,{section:'biz_detail',kind:'meeting',key:MEETING_A,detail:'full'}));
   assert.ok(await addMark(OWNER,WS_A,{section:'biz_summary',kind:'space',key:PROJECT_A,body:'지금 상황 보고용'}));
   // 전환 주에 끊는 빈 행(모두 null)도 받는다.
   assert.ok(await addMark(OWNER,WS_A,{week:'2026-11-23'}));
   await assert.rejects(addMark(OWNER,WS_A,{}),{code:'23505'});
   // 모양 검사.
   await assert.rejects(addMark(OWNER,WS_A,{week:'2026-11-10'}),{code:'23514'});
   await assert.rejects(addMark(OWNER,WS_A,{section:'site',kind:'event',key:'abc'}),{code:'23514'});
   await assert.rejects(addMark(OWNER,WS_A,{kind:'event',key:'bad key!'}),{code:'23514'});
   await assert.rejects(addMark(OWNER,WS_A,{kind:'event',key:'x'.repeat(201)}),{code:'23514'});
   await assert.rejects(addMark(OWNER,WS_A,{key:'ABCDEF00-0000-4000-8000-000000000001'}),{code:'23514'});
   await assert.rejects(addMark(OWNER,WS_A,{key:'not-a-uuid'}),{code:'23514'});
   await assert.rejects(addMark(OWNER,WS_A,{week:'2026-11-30',choice:'drop'}),{code:'23514'});
   await assert.rejects(addMark(OWNER,WS_A,{week:'2026-11-30',detail:'full'}),{code:'23514'});
   for(const bad of ['',' 앞 빈칸','가'.repeat(1001),'탭\t글'])await assert.rejects(addMark(OWNER,WS_A,{week:'2026-11-30',body:bad}),{code:'23514'},JSON.stringify(bad));
   assert.ok(await addMark(OWNER,WS_A,{week:'2026-11-30',body:'두 줄\n보고용'}));
   // 같은 작업공간 검사: 남의 조직 기록·회의·사업, 사업 기록은 B-1 전 거절.
   await assert.rejects(addMark(OWNER,WS_A,{week:'2026-12-07',key:UPD_B}),{code:'23514'});
   await assert.rejects(addMark(OWNER,WS_A,{week:'2026-12-07',section:'biz_detail',kind:'meeting',key:MEETING_B}),{code:'23514'});
   await assert.rejects(addMark(OWNER,WS_A,{week:'2026-12-07',section:'biz_summary',kind:'space',key:PROJECT_B}),{code:'23514'});
   await assert.rejects(addMark(OWNER,WS_A,{week:'2026-12-07',section:'biz_detail',kind:'biz_record',key:UPD_A}),{code:'23514'});
   // 남의 작업공간 행으로 넣기·읽기·고치기·지우기 불가, anon 거절.
   await assert.rejects(addMark(STRANGER,WS_A,{week:'2026-12-07'}),refused);
   await assert.rejects(addMark(STRANGER,WS_B,{week:'2026-12-07',key:UPD_A}),{code:'23514'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_report_line_marks'))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query("update public.app_report_line_marks set choice='in' where id=$1",[m.id]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_report_line_marks where id=$1',[m.id]))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_report_line_marks')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query("insert into public.app_report_line_marks(workspace_id,week_start,section,ref_kind,ref_key) values ($1,'2026-11-09','org','event','x')",[WS_A])),{code:'42501'});
   // 고치기: 보고용 글·빼기·상세만. 범위 칸은 고칠 수 없음. updated_at은 서버 시각.
   await pool.query("update public.app_report_line_marks set updated_at='2000-01-01' where id=$1",[m.id]);
   assert.equal((await owner(c=>c.query("update public.app_report_line_marks set report_body=null,choice='in' where id=$1",[m.id]))).rowCount,1);
   assert.ok((await pool.query('select updated_at from public.app_report_line_marks where id=$1',[m.id])).rows[0].updated_at.getFullYear()>2000);
   for(const col of ['workspace_id','week_start','section','ref_kind','ref_key'])
    await assert.rejects(owner(c=>c.query(`update public.app_report_line_marks set ${col}=${col} where id=$1`,[m.id])),{code:'42501'},col);
   await assert.rejects(owner(c=>c.query("insert into public.app_report_line_marks(id,workspace_id,week_start,section,ref_kind,ref_key) values (gen_random_uuid(),$1,'2026-12-14','org','event','x')",[WS_A])),{code:'42501'});
   assert.equal((await owner(c=>c.query("delete from public.app_report_line_marks where week_start='2026-11-23'"))).rowCount,1);
  });
  await t.test('report line marks: at most 5000 rows per workspace; the limit is per workspace',async()=>{
   await pool.query('alter table public.app_report_line_marks disable trigger app_report_line_marks_guard');
   const have=(await pool.query('select count(*)::int n from public.app_report_line_marks where workspace_id=$1',[WS_A])).rows[0].n;
   await pool.query(`insert into public.app_report_line_marks(workspace_id,week_start,section,ref_kind,ref_key)
     select $1,'2027-01-04','org','event','bulk_'||g from generate_series(1,$2::int) g`,[WS_A,4999-have]);
   await pool.query('alter table public.app_report_line_marks enable trigger app_report_line_marks_guard');
   assert.ok(await addMark(OWNER,WS_A,{week:'2027-01-11',kind:'event',key:'last_one'}));
   await assert.rejects(addMark(OWNER,WS_A,{week:'2027-01-11',kind:'event',key:'one_more'}),{code:'23514'});
   assert.ok(await addMark(STRANGER,WS_B,{week:'2027-01-11',kind:'event',key:'other_ws'}));
   await pool.query("delete from public.app_report_line_marks where ref_key like 'bulk\\_%'");
  });
  await t.test('report snapshots: one per week, server time, same-workspace document, size cap, no delete',async()=>{
   const s=await addSnap(OWNER,WS_A);assert.ok(s.id);
   await assert.rejects(addSnap(OWNER,WS_A),{code:'23505'});
   await assert.rejects(addSnap(OWNER,WS_A,{week:'2026-11-16',doc:DOC_B}),{code:'23514'});
   await assert.rejects(addSnap(OWNER,WS_A,{week:'2026-11-17'}),{code:'23514'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_report_snapshots(workspace_id,week_start,rows) values ($1,'2026-11-16','{}'::jsonb)",[WS_A])),{code:'23514'});
   await assert.rejects(addSnap(OWNER,WS_A,{week:'2026-11-16',rows:[{t:'가'.repeat(50000)}]}),{code:'23514'});
   assert.ok(await addSnap(OWNER,WS_A,{week:'2026-11-16',doc:null}));
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_report_snapshots(workspace_id,week_start,rows,confirmed_at) values ($1,'2026-11-23','[]','2000-01-01')",[WS_A])),{code:'42501'});
   // 새 판으로 확정 = 같은 행 update, confirmed_at은 서버가 새로 찍음.
   const force=at=>pool.query(`alter table public.app_report_snapshots disable trigger app_report_snapshots_guard;update public.app_report_snapshots set confirmed_at='${at}' where id='${s.id}';alter table public.app_report_snapshots enable trigger app_report_snapshots_guard`);
   // 서버 키 없이 확정 시각만 바꾸려 해도 트리거가 그대로 둔다.
   await pool.query("update public.app_report_snapshots set confirmed_at='2000-01-01' where id=$1",[s.id]);
   assert.ok((await pool.query('select confirmed_at from public.app_report_snapshots where id=$1',[s.id])).rows[0].confirmed_at.getFullYear()>2000);
   await force('2000-01-01');
   assert.equal((await owner(c=>c.query("update public.app_report_snapshots set rows='[]' where id=$1",[s.id]))).rowCount,1);
   const after=(await pool.query('select confirmed_at from public.app_report_snapshots where id=$1',[s.id])).rows[0].confirmed_at;
   assert.ok(after.getFullYear()>2000);
   for(const col of ['workspace_id','week_start','confirmed_at'])
    await assert.rejects(owner(c=>c.query(`update public.app_report_snapshots set ${col}=${col} where id=$1`,[s.id])),{code:'42501'},col);
   await assert.rejects(owner(c=>c.query('delete from public.app_report_snapshots where id=$1',[s.id])),{code:'42501'});
   // 남의 작업공간·anon.
   await assert.rejects(addSnap(STRANGER,WS_A,{week:'2026-11-30',doc:null}),refused);
   await assert.rejects(addSnap(STRANGER,WS_B,{week:'2026-11-30',doc:DOC_A}),{code:'23514'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_report_snapshots'))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query("update public.app_report_snapshots set rows='[]' where id=$1",[s.id]))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_report_snapshots')),{code:'42501'});
   // 자료를 지우면 사진은 남고 document_id만 비며, 확정 시각은 그대로.
   await force('2001-01-01');
   await pool.query('delete from public.app_documents where id=$1',[DOC_A]);
   const kept=(await pool.query('select document_id,confirmed_at from public.app_report_snapshots where id=$1',[s.id])).rows[0];
   assert.equal(kept.document_id,null);assert.equal(kept.confirmed_at.getFullYear(),2001);
  });
  await t.test('rollback stops while moved rows remain; after removing them it returns to the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/moved rows remain/);
   await pool.query("delete from public.app_suborganization_updates where source_kind in ('status_row','weekly_line')");
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post))assert.equal(value,/hash$/.test(item)?beforeCheck[item]:'예',item);
   const again=await run('apply','9924');assert.equal(again.ok,true,again.summary);
   for(const [item,value] of Object.entries(values(await readOnly(postcheck))))assert.equal(value,/hash$/.test(item)?beforeCheck[item]:'예',item);
   assert.ok(await addMark(OWNER,WS_A,{kind:'event',key:'after_reapply'}));
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
