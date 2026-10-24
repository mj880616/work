// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic (no real names, rooms or numbers).
// CALL-통화메뉴·TG-소식메뉴 1단계: 20261024140000_call_tg_feed — app_feed_items + app_feed_days, owner-only RLS for authenticated,
// column grants (authenticated: pin/hide/clear raw/link; service_role: insert + day counters), guard trigger, guarded rollback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261024140000',name='call_tg_feed',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const CALL={source:'call',day:'2026-10-24',occurred_at:'2026-10-24T01:10:00Z',title:'가상 지부 교섭 일정 연기',
 points:['다음 주 화요일로 연기(예정)','자료 금요일까지 보내기로(확정)'],counterpart:'가상노조 홍길동 위원장',speaker_split:true,
 raw_text:'나: 안녕하세요.\n가상노조 홍길동 위원장: 네, 교섭 일정 말인데요.',source_ref:'call:fakefileid001',
 drive_url:'https://drive.google.com/file/d/fakefileid001/view',model:'gemini-fake',judged_at:'2026-10-24T01:20:00Z'};
const TG={source:'telegram',day:'2026-10-24',occurred_at:'2026-10-24T00:05:00Z',room_key:'room-a1',room_label:'가상 단체방',
 summary:'가상 지부 총회 날짜 확정',raw_text:'A: 총회 다음 달 3일\nB: 확인',raw_count:2,source_ref:'tg:room-a1:2026-10-24:1'};
const COLS=['workspace_id','source','day','occurred_at','room_key','room_label','title','summary','points','counterpart','speaker_split',
 'raw_text','raw_count','organization_id','suggested_project_id','source_ref','drive_url','model','judged_at'];

test('call/telegram feed: migration, owner-only RLS, column grants, guard trigger, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'call-tg-feed-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  // What collector-feed will send (service role, return=minimal, duplicates ignored).
  const put=(c,row,over={})=>{const r={workspace_id:WS_A,points:[],speaker_split:false,raw_count:0,...row,...over};
   const cols=COLS.filter(k=>k in r);
   return c.query(`insert into public.app_feed_items(${cols.join(',')}) values(${cols.map((k,i)=>k==='points'?`$${i+1}::jsonb`:`$${i+1}`).join(',')}) on conflict (workspace_id,source,source_ref) do nothing`,
    cols.map(k=>k==='points'?JSON.stringify(r[k]):r[k]));};
  const count=async()=>(await pool.query('select count(*)::int n from public.app_feed_items')).rows[0].n;

  await t.test('files: read-only checks, three-line summary, expanded approved workflow accepts the file, no anon/PUBLIC',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   }
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|update public|truncate|cascade|grant |policy/i);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/security definer|disable row level|to anon|to public|rtw_|grant delete|grant all|drop policy|alter policy|with grant option/i);
   assert.equal((code.match(/create policy [a-z_]+ on public\.app_feed_(items|days) for all to authenticated/g)||[]).length,2);
   assert.match(code,/revoke all on table public\.app_feed_items, public\.app_feed_days from public, anon, authenticated, service_role;/);
   assert.match(code,/revoke all on function private\.app_feed_item_guard\(\) from public, anon, authenticated, service_role;/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261024140000', 'call_tg_feed'/);
  });
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck before apply is all 예',async()=>{
   for(const r of (await pool.query(precheck)).rows.filter(r=>r.item!=='recent migrations'))assert.equal(r.value,'예',r.item);
  });
  await t.test('apply once, postcheck all 예, a second apply is refused',async()=>{
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(),1);
   await assert.rejects(pool.query(migration),/CALL_TG_FEED_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });
  await t.test('server: inserts calls and telegram rows once, cannot pin/hide/confirm project, update or delete, or read raw text',async()=>{
   await server(c=>put(c,CALL,{organization_id:ORG_A,suggested_project_id:PROJECT_A}));
   await server(c=>put(c,TG));
   await server(c=>put(c,CALL,{title:'다른 제목'}));
   assert.equal(await count(),2,'same source_ref is stored once');
   assert.equal((await pool.query("select title from public.app_feed_items where source='call'")).rows[0].title,CALL.title);
   assert.equal((await server(c=>c.query("select source_ref from public.app_feed_items where workspace_id=$1",[WS_A]))).rowCount,2);
   await assert.rejects(server(c=>c.query('select raw_text from public.app_feed_items')),{code:'42501'});
   await assert.rejects(server(c=>c.query('insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,source_ref,pinned_at) values($1,$2,$3,$4,$5,$6,now())',[WS_A,'call','2026-10-24','2026-10-24T00:00:00Z','가상','call:x2'])),{code:'42501'});
   await assert.rejects(server(c=>c.query('insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,source_ref,project_id) values($1,$2,$3,$4,$5,$6,$7)',[WS_A,'call','2026-10-24','2026-10-24T00:00:00Z','가상','call:x3',PROJECT_A])),{code:'42501'});
   await assert.rejects(server(c=>c.query("update public.app_feed_items set summary='x' where source='telegram'")),{code:'42501'});
   await assert.rejects(server(c=>c.query("delete from public.app_feed_items where source='telegram'")),{code:'42501'});
  });
  await t.test('server: day counters insert and update, no delete, workspace/day/source fixed',async()=>{
   await server(c=>c.query("insert into public.app_feed_days(workspace_id,day,source,total_count,kept_count,personal_count,unsure_count) values($1,'2026-10-24','call',5,1,2,2)",[WS_A]));
   await server(c=>c.query("insert into public.app_feed_days(workspace_id,day,source,total_count,kept_count,room_count,batch_count,ai_requests,ai_input_tokens,ai_output_tokens) values($1,'2026-10-24','telegram',40,1,1,1,1,5000,600) on conflict (workspace_id,day,source) do update set total_count=excluded.total_count, kept_count=excluded.kept_count, updated_at=now()",[WS_A]));
   await server(c=>c.query("update public.app_feed_days set kept_count=kept_count+1,updated_at=now() where workspace_id=$1 and day='2026-10-24' and source='call'",[WS_A]));
   assert.equal((await pool.query("select kept_count from public.app_feed_days where source='call'")).rows[0].kept_count,2);
   await assert.rejects(server(c=>c.query("update public.app_feed_days set day='2026-10-25' where source='call'")),{code:'42501'});
   await assert.rejects(server(c=>c.query("delete from public.app_feed_days where source='call'")),{code:'42501'});
   await assert.rejects(server(c=>c.query("insert into public.app_feed_days(workspace_id,day,source,kept_count) values($1,'2026-10-23','call',-1)",[WS_A])),{code:'23514'});
  });
  await t.test('shape rules: source, call/telegram shape, lengths, points, control characters, refs, drive link',async()=>{
   const bad=[
    [{...CALL,source:'mail'},'unknown source'],[{...CALL,title:null},'call without title'],[{...CALL,room_key:'r'},'call with room'],
    [{...CALL,title:'가'.repeat(81)},'81 title'],[{...CALL,title:'a\nb'},'newline title'],[{...CALL,points:['a',1]},'number point'],
    [{...CALL,points:Array.from({length:9},(_,i)=>'p'+i)},'9 points'],[{...CALL,points:['  ']},'blank point'],[{...CALL,points:['가'.repeat(301)]},'301 point'],
    [{...CALL,counterpart:'가'.repeat(101)},'101 counterpart'],[{...CALL,source_ref:'call:a b'},'bad ref'],[{...CALL,drive_url:'http://example.com/x'},'not drive'],
    [{...CALL,raw_text:''},'empty raw'],[{...CALL,raw_text:'가'.repeat(70000)},'raw over 200 KB'],
    [{...TG,room_key:null},'telegram without room'],[{...TG,counterpart:'가상'},'telegram counterpart'],[{...TG,speaker_split:true},'telegram speaker split'],
    [{...TG,summary:'가'.repeat(401)},'401 summary'],[{...TG,raw_count:5001},'5001 raw'],[{...TG,room_label:'a\u0007'},'control label'],
   ];
   for(const [row,label] of bad)await assert.rejects(server(c=>put(c,row,{source_ref:(row.source_ref||'x')})),{code:/^(23514|23502)$/},label);
   assert.equal(await count(),2);
  });
  await t.test('guard: linked organization and projects must be in the same workspace, for every role',async()=>{
   await assert.rejects(server(c=>put(c,CALL,{source_ref:'call:o1',organization_id:ORG_B})),/FEED_LINK_SCOPE/);
   await assert.rejects(server(c=>put(c,CALL,{source_ref:'call:o2',suggested_project_id:PROJECT_B})),/FEED_LINK_SCOPE/);
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set project_id=$1 where source='call'",[PROJECT_B])),/FEED_LINK_SCOPE/);
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set organization_id=$1 where source='call'",[ORG_B])),/FEED_LINK_SCOPE/);
  });
  await t.test('owner: reads, pins, hides, clears raw text only, confirms project; cannot insert, delete, edit content or restore raw text',async()=>{
   assert.equal((await owner(c=>c.query('select id from public.app_feed_items'))).rowCount,2);
   assert.equal((await owner(c=>c.query('select day from public.app_feed_days'))).rowCount,2);
   assert.equal((await owner(c=>c.query("update public.app_feed_items set pinned_at=now(),updated_at=now() where source='telegram'"))).rowCount,1);
   assert.equal((await owner(c=>c.query("update public.app_feed_items set hidden_at=now() where source='telegram'"))).rowCount,1);
   assert.equal((await owner(c=>c.query("update public.app_feed_items set project_id=$1,organization_id=null where source='call'",[PROJECT_A]))).rowCount,1);
   assert.equal((await owner(c=>c.query("update public.app_feed_items set raw_text=null where source='call'"))).rowCount,1);
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set raw_text='되살리기' where source='call'")),/FEED_RAW_TEXT_CLEAR_ONLY/);
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set raw_text='바꾸기' where source='telegram'")),/FEED_RAW_TEXT_CLEAR_ONLY/);
   await assert.rejects(server(c=>c.query("update public.app_feed_items set raw_text=null")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set summary='x' where source='telegram'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set suggested_project_id=null")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set workspace_id=$1",[WS_B])),{code:'42501'});
   await assert.rejects(owner(c=>put(c,CALL,{source_ref:'call:own'})),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_feed_items')),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_days set kept_count=0")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("delete from public.app_feed_days")),{code:'42501'});
   const row=(await pool.query("select raw_text,project_id,pinned_at from public.app_feed_items where source='call'")).rows[0];
   assert.equal(row.raw_text,null);assert.equal(row.project_id,PROJECT_A);
  });
  await t.test('stranger and anon see and change nothing',async()=>{
   assert.equal((await stranger(c=>c.query('select id from public.app_feed_items'))).rowCount,0);
   assert.equal((await stranger(c=>c.query('select day from public.app_feed_days'))).rowCount,0);
   assert.equal((await stranger(c=>c.query("update public.app_feed_items set pinned_at=now()"))).rowCount,0);
   await assert.rejects(anon(c=>c.query('select id from public.app_feed_items')),{code:'42501'});
   await assert.rejects(anon(c=>c.query('select day from public.app_feed_days')),{code:'42501'});
   await assert.rejects(as('public_probe','',c=>c.query('select id from public.app_feed_items')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('select private.app_feed_item_guard()')),{code:/^(42501|0A000)$/});
  });
  await t.test('rollback stops while rows exist; after cleanup it restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/CALL_TG_FEED_ROLLBACK_BLOCKED: feed rows exist/);await pool.query('rollback');
   assert.equal(await history(),1);
   await pool.query('delete from public.app_feed_items where id is not null');
   await assert.rejects(pool.query(rollbackSQL),/CALL_TG_FEED_ROLLBACK_BLOCKED: feed rows exist/);await pool.query('rollback');
   await pool.query('delete from public.app_feed_days where day is not null');
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal((await pool.query('select count(*)::int n from public.app_suborganizations')).rows[0].n,2,'organizations untouched');
   await pool.query(migration);assert.equal(await history(),1);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await pool?.end();
  await cluster?.stop();
 }
});
