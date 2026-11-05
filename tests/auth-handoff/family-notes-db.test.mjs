// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// S50-3 FAMILY-잊지말기 DB(20261105100000): 가족 1명 '잊지 말기' 한 줄 표 app_family_notes + 운영자 기능 키 family.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 원문 칸이 없다. 소유자만 읽고 상태 칸만 고친다. 서버(service_role)는 넣기와 여덟 칸 읽기만.
// - 운영자 기능 family가 없는 작업공간에는 어떤 역할로도 줄이 생기지 않고(트리거), 허용이 빠지면 소유자도 못 읽는다(restrictive 정책).
// - 되돌리기는 줄이 있으면 멈추고, 없으면 표·함수·허용 행·검사·기록만 원래대로. 다른 허용 행은 그대로.
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
const version='20261105100000',name='family_notes',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];
const NOTE={kind:'plan',body:'토요일 저녁에 동네 산책 가자고 함',said_when:'토요일 저녁',firmness:'planned',origin:'telegram',origin_day:'2026-11-05',
 drive_url:'https://drive.google.com/drive/folders/fakeFolder01',source_ref:'fam:tg:abc123:1',model:'fake-model'};

test('family notes: operator-only table, no raw text, owner decides, server inserts only; rollback guarded',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'family-notes-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('revoke usage on schema private from service_role');
  await pool.query('grant select on public.app_spaces to authenticated');
  await pool.query('alter table public.app_spaces enable row level security');
  await pool.query('create policy fake_owner_read on public.app_spaces for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
  await pool.query(`create table public.app_documents(id uuid primary key, workspace_id uuid not null, file_id text, extraction_status text, extracted_text text);
   alter table public.app_documents enable row level security;
   create policy fake_docs_owner on public.app_documents for select to authenticated using (private.app_is_workspace_owner(workspace_id));
   grant select on public.app_documents to authenticated;`);
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:fn1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  await pool.query(await read('supabase/migrations/20261031120000_gdrive_photo_index.sql'));
  await pool.query(await read('supabase/migrations/20261102160000_cloud_files_index.sql'));
  const devInbox=await read('supabase/migrations/20261103100000_dev_inbox_feature.sql');
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const guardFails=async(pattern)=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const feats=async()=>(await pool.query('select feature from public.app_operator_features order by feature')).rows.map(r=>r.feature);

  await t.test('guard: stops without changes before the dev_inbox step (20261103100000) is applied',async()=>{
   await guardFails(/FAMILY_NOTES_PREREQUISITE_CHANGED/);
   assert.equal((await pool.query("select to_regclass('public.app_family_notes') t")).rows[0].t,null);
   await pool.query(devInbox);
  });
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};
  const put=(c,ws,over={})=>{const r={...NOTE,...over};const cols=Object.keys(r);
   return c.query(`insert into public.app_family_notes(workspace_id,${cols.join(',')}) values($1,${cols.map((_,i)=>'$'+(i+2)).join(',')})`,[ws,...cols.map(k=>r[k])]);};
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: expanded rules pass, one new table and one guard function, summary 3 lines, no fixed id, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
    assert.deepEqual([...plan.createdTables],['app_family_notes']);
    assert.deepEqual([...plan.functions],['private.app_family_feature_guard']);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b|disable row level security|alter policy|drop policy|rtw_|grant usage on schema|raw_text|transcript/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261105100000', 'family_notes'/);
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);assert.match(rollbackSQL,/FAMILY_NOTES_ROLLBACK_BLOCKED: rows exist/);
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['family rows'],'0');
   await allYes(postcheck);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await feats(),['calls','dev_inbox','files','gdrive_photos','telegram']);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9983')).ok,false);
  });

  await t.test('shape: no raw text column; checks reject bad kind, long body, control chars, odd links and refs',async()=>{
   const cols=(await pool.query("select attname from pg_attribute where attrelid='public.app_family_notes'::regclass and attnum>0 and not attisdropped order by attnum")).rows.map(r=>r.attname);
   assert.deepEqual(cols,['id','workspace_id','kind','body','said_when','firmness','origin','origin_day','drive_url','source_ref','status','decided_at','done_at','model','created_at','updated_at']);
   const bad=[{kind:'feeling'},{body:'가'.repeat(151)},{body:''},{body:'첫 줄\n둘째 줄'},{said_when:'가'.repeat(61)},{firmness:'sure'},{origin:'mail'},
    {drive_url:'https://example.com/x'},{drive_url:'javascript:alert(1)'},{source_ref:'tg:abc'},{source_ref:'fam:tg:한글'}];
   for(const [i,over] of bad.entries())await assert.rejects(server(c=>put(c,WS_A,{source_ref:'fam:tg:bad'+i,...over})),{code:'23514'},JSON.stringify(over));
  });

  await t.test('server: inserts into the operator workspace only, reads eight columns, never updates or deletes; duplicates refused',async()=>{
   await server(c=>put(c,WS_A));
   await server(c=>put(c,WS_A,{kind:'like',body:'새로 생긴 빵집 소금빵이 맛있었다고 함',said_when:null,firmness:'firm',origin:'call',origin_day:'2026-11-06',source_ref:'fam:call:fakeCall01:1'}));
   await assert.rejects(server(c=>put(c,WS_A)),{code:'23505'});
   await assert.rejects(server(c=>put(c,WS_B,{source_ref:'fam:tg:other:1'})),/OPERATOR_FEATURE_REQUIRED/);
   const seen=(await server(c=>c.query('select id,workspace_id,kind,body,origin_day,source_ref,status,created_at from public.app_family_notes order by source_ref'))).rows;
   assert.equal(seen.length,2);
   await assert.rejects(server(c=>c.query('select drive_url from public.app_family_notes')),{code:'42501'});
   await assert.rejects(server(c=>c.query('select said_when from public.app_family_notes')),{code:'42501'});
   await assert.rejects(server(c=>c.query("update public.app_family_notes set status='kept'")),{code:'42501'});
   await assert.rejects(server(c=>c.query('delete from public.app_family_notes')),{code:'42501'});
   await assert.rejects(server(c=>c.query("insert into public.app_family_notes(workspace_id,kind,body,origin,origin_day,source_ref,status) values($1,'plan','가','telegram','2026-11-05','fam:tg:st:1','kept')",[WS_A])),{code:'42501'});
  });

  await t.test('owner: reads own rows, changes only decision columns; stranger and anon see nothing',async()=>{
   const mine=(await owner(c=>c.query('select id,kind,status,drive_url from public.app_family_notes order by source_ref'))).rows;
   assert.equal(mine.length,2);assert.ok(mine.every(r=>r.status==='new'));
   const id=mine.find(r=>r.kind==='plan').id;
   await owner(c=>c.query("update public.app_family_notes set status='tasked',decided_at=now(),updated_at=now() where id=$1",[id]));
   await owner(c=>c.query('update public.app_family_notes set done_at=now() where id=$1',[id]));
   await assert.rejects(owner(c=>c.query("update public.app_family_notes set status='kept' where id=$1",[mine.find(r=>r.kind==='like').id])),{code:'23514'},'decided_at must come with a decision');
   await assert.rejects(owner(c=>c.query("update public.app_family_notes set done_at=now(),status='kept',decided_at=now() where kind='like'")),{code:'23514'},'done only for plan/ask/remind');
   await assert.rejects(owner(c=>c.query("update public.app_family_notes set body='고침'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_family_notes set workspace_id=$1',[WS_B])),{code:'42501'});
   await assert.rejects(owner(c=>put(c,WS_A,{source_ref:'fam:tg:own:1'})),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_family_notes')),{code:'42501'});
   assert.equal((await stranger(c=>c.query('select id from public.app_family_notes'))).rows.length,0);
   assert.equal((await stranger(c=>c.query("update public.app_family_notes set status='dismissed',decided_at=now() returning id"))).rows.length,0);
   await assert.rejects(anon(c=>c.query('select id from public.app_family_notes')),{code:'42501'});
   assert.equal((await pool.query("select status from public.app_family_notes where id=$1",[id])).rows[0].status,'tasked');
  });

  await t.test('feature: family only on the operator workspace; removing it hides rows from the owner and blocks writes',async()=>{
   assert.deepEqual((await owner(c=>c.query('select public.app_my_features() f'))).rows[0].f,['calls','dev_inbox','family','files','gdrive_photos','telegram']);
   assert.deepEqual((await stranger(c=>c.query('select public.app_my_features() f'))).rows[0].f,[]);
   assert.equal((await server(c=>c.query("select public.app_operator_feature_workspace('family') w"))).rows[0].w,WS_A);
   await pool.query("delete from public.app_operator_features where feature='family'");
   assert.equal((await owner(c=>c.query('select id from public.app_family_notes'))).rows.length,0);
   await assert.rejects(server(c=>put(c,WS_A,{source_ref:'fam:tg:off:1'})),/OPERATOR_FEATURE_REQUIRED/);
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'family')",[WS_A]);
   assert.equal((await owner(c=>c.query('select id from public.app_family_notes'))).rows.length,2);
  });

  await t.test('isolation: no DB function names the table; nobody executes the guard function',async()=>{
   const fns=(await pool.query("select p.oid::regprocedure::text f from pg_proc p where p.prosrc ~ 'app_family_notes'")).rows.map(r=>r.f);
   assert.deepEqual(fns,[],'the guard reads only the operator table (NEW row), so no function body names the notes table');
   for(const role of ['authenticated','anon','service_role'])
    assert.equal((await pool.query("select has_function_privilege($1,'private.app_family_feature_guard()','execute') x",[role])).rows[0].x,false,role);
   assert.equal((await pool.query("select count(*)::int n from pg_views where definition ~ 'app_family_notes'")).rows[0].n,0);
   assert.equal((await pool.query("select count(*)::int n from pg_policy where polrelid<>'public.app_family_notes'::regclass and (pg_get_expr(polqual,polrelid) ~ 'app_family_notes' or coalesce(pg_get_expr(polwithcheck,polrelid),'') ~ 'app_family_notes')")).rows[0].n,0);
  });

  await t.test('rollback: blocked while rows exist; then restores table, function, feature row, check and record; re-apply works',async()=>{
   {const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/FAMILY_NOTES_ROLLBACK_BLOCKED: rows exist/);await c.query('rollback');}finally{c.release();}}
   assert.notEqual((await pool.query("select to_regclass('public.app_family_notes') t")).rows[0].t,null);
   await pool.query('delete from public.app_family_notes');
   await pool.query(rollbackSQL);
   assert.deepEqual(await feats(),['calls','dev_inbox','files','gdrive_photos','telegram']);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   const again=await run('apply','9984');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });

  await t.test('guard: stops without changes when calls is not on exactly one workspace',async()=>{
   await pool.query(rollbackSQL);
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'calls')",[WS_B]);
   await guardFails(/FAMILY_NOTES_SEED_WORKSPACE_NOT_SINGLE/);
   await pool.query("delete from public.app_operator_features where workspace_id=$1 and feature='calls'",[WS_B]);
   assert.deepEqual(await feats(),['calls','dev_inbox','files','gdrive_photos','telegram']);
   assert.equal((await pool.query("select to_regclass('public.app_family_notes') t")).rows[0].t,null);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
