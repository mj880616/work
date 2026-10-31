// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real photo, folder or file names).
// S46-24 사진 출처 구글 드라이브 ① DB(20261031120000): 새 표 3개 + 운영자 기능 키 gdrive_photos.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 허용 행은 calls가 허용된 Drive 작업공간(kptu-work)에만 1행. 그 조건이 아니면 멈추고 아무것도 바꾸지 않는다.
// - service_role(Edge gdrive-photos)만 새 표를 읽고 쓴다. authenticated·anon은 어디도 못 읽고 못 쓴다(권한을 넓히지 않음).
// - 되돌리기는 새 표·허용 행·검사·기록만 원래대로 하고, 다른 허용 행은 그대로 둔다.
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
const version='20261031120000',name='gdrive_photo_index',stem=version+'_'+name;
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
const NEW=['app_gdrive_sync','app_gdrive_folders','app_gdrive_photos'];

test('gdrive photo index: service_role-only tables, operator feature for the Drive workspace only, rollback restores',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'gdrive-index-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  // operator_features가 seed할 수 있게 통화 자료를 운영 작업공간(WS_A)에만 둔다(운영과 같음).
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:gd1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: expanded rules pass, three new tables, grants only to service_role, summary 3 lines, no fixed id, no information_schema',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');
    assert.deepEqual([...plan.createdTables].sort(),[...NEW].sort());
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,NEW.map(t=>`grant select, insert, update, delete on table public.${t} to service_role;`));
   assert.doesNotMatch(code,/create (or replace )?(function|policy|trigger)|disable row level security|security definer|\bto (anon|authenticated|public)\b|rtw_/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['gdrive_photos rows'],'0');
   await allYes(postcheck);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9973')).ok,false);
  });

  await t.test('feature: gdrive_photos only for the Drive workspace owner; the allow table stays closed to API roles',async()=>{
   assert.deepEqual((await pool.query('select workspace_id,feature from public.app_operator_features order by feature')).rows,
    [{workspace_id:WS_A,feature:'calls'},{workspace_id:WS_A,feature:'gdrive_photos'},{workspace_id:WS_A,feature:'telegram'}]);
   assert.deepEqual((await owner(c=>c.query('select public.app_my_features() f'))).rows[0].f,['calls','gdrive_photos','telegram']);
   assert.deepEqual((await stranger(c=>c.query('select public.app_my_features() f'))).rows[0].f,[]);
   assert.equal((await owner(c=>c.query("select private.app_workspace_has_feature($1,'gdrive_photos') v",[WS_A]))).rows[0].v,true);
   assert.equal((await stranger(c=>c.query("select private.app_workspace_has_feature($1,'gdrive_photos') v",[WS_A]))).rows[0].v,false);
   assert.equal((await server(c=>c.query("select public.app_operator_feature_workspace('gdrive_photos') w"))).rows[0].w,WS_A);
   for(const fn of [owner,stranger,server])await assert.rejects(fn(c=>c.query('select * from public.app_operator_features')),{code:'42501'});
   await assert.rejects(pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'photos_any')",[WS_B]),{code:'23514'});
  });

  await t.test('service_role: folders off by default, photos upsert/delete, sync lock; checks refuse bad ids',async()=>{
   await server(c=>c.query("insert into public.app_gdrive_sync(workspace_id,synced_at,index_lock_until) values($1,now(),now())",[WS_A]));
   await server(c=>c.query("insert into public.app_gdrive_folders(workspace_id,item_id,parent_id,name) values($1,'fold_A-1','root_0','가상 폴더')",[WS_A]));
   assert.equal((await server(c=>c.query('select enabled from public.app_gdrive_folders'))).rows[0].enabled,false);
   await server(c=>c.query("update public.app_gdrive_folders set enabled=true where workspace_id=$1",[WS_A]));
   const up=`insert into public.app_gdrive_photos(workspace_id,item_id,parent_id,name,video,size_bytes,taken_at,approx,taken_day,updated_at)
    select b.* from json_populate_recordset(null::public.app_gdrive_photos,$1::json) b
    on conflict (workspace_id,item_id) do update set parent_id=excluded.parent_id,name=excluded.name,video=excluded.video,size_bytes=excluded.size_bytes,
     taken_at=excluded.taken_at,approx=excluded.approx,taken_day=excluded.taken_day,updated_at=excluded.updated_at`;
   const p=(id,day,video=false)=>({workspace_id:WS_A,item_id:id,parent_id:'fold_A-1',name:'img-'+id+'.jpg',video,size_bytes:10,taken_at:day+'T03:00:00Z',approx:false,taken_day:day,updated_at:'2026-10-31T00:00:00Z'});
   await server(c=>c.query(up,[JSON.stringify([p('ph_1','2026-10-01'),p('ph_2','2026-10-02',true)])]));
   await server(c=>c.query(up,[JSON.stringify([p('ph_1','2026-09-30')])]));
   assert.deepEqual((await pool.query("select item_id,taken_day::text d,video from public.app_gdrive_photos order by item_id")).rows,
    [{item_id:'ph_1',d:'2026-09-30',video:false},{item_id:'ph_2',d:'2026-10-02',video:true}]);
   await server(c=>c.query("delete from public.app_gdrive_photos where workspace_id=$1 and item_id='ph_2'",[WS_A]));
   await assert.rejects(server(c=>c.query("insert into public.app_gdrive_photos(workspace_id,item_id,parent_id,name,taken_at,taken_day) values ($1,'bad id','fold_A-1','n',now(),current_date)",[WS_A])),{code:'23514'});
   await assert.rejects(server(c=>c.query("insert into public.app_gdrive_folders(workspace_id,item_id,name) values ($1,'fold_9','')",[WS_A])),{code:'23514'});
   await assert.rejects(server(c=>c.query("insert into public.app_gdrive_photos(workspace_id,item_id,parent_id,name,size_bytes,taken_at,taken_day) values ($1,'ph_3','fold_A-1','n',-1,now(),current_date)",[WS_A])),{code:'23514'});
   await assert.rejects(server(c=>c.query('truncate public.app_gdrive_photos')),{code:'42501'});
  });

  await t.test('client roles have nothing on the new tables',async()=>{
   for(const role of ['authenticated','anon'])for(const table of NEW){
    await assert.rejects(as(role,OWNER,c=>c.query(`select * from public.${table}`)),{code:'42501'});
    await assert.rejects(as(role,OWNER,c=>c.query(`delete from public.${table}`)),{code:'42501'});
    await assert.rejects(as(role,OWNER,c=>c.query(`update public.${table} set updated_at=now()`)),{code:'42501'});
   }
   await assert.rejects(owner(c=>c.query("insert into public.app_gdrive_folders(workspace_id,item_id,name) values ($1,'fold_x','x')",[WS_A])),{code:'42501'});
  });

  await t.test('rollback restores the check, removes the tables, the feature row and the record; other allow rows stay; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   for(const table of NEW)assert.equal((await pool.query(`select to_regclass('public.${table}') is null as gone`)).rows[0].gone,true,table);
   assert.deepEqual((await pool.query('select feature from public.app_operator_features order by feature')).rows.map(r=>r.feature),['calls','telegram']);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   const again=await run('apply','9974');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });

  await t.test('guard: stops without changes when the calls workspace is not the Drive workspace',async()=>{
   await pool.query(rollbackSQL);
   await pool.query("update public.app_workspaces set slug='renamed' where id=$1",[WS_A]);
   const c=await pool.connect();
   try{await assert.rejects(c.query(migration),/GDRIVE_INDEX_SEED_WORKSPACE_NOT_SINGLE/);await c.query('rollback');}finally{c.release();}
   assert.equal((await pool.query("select to_regclass('public.app_gdrive_photos') is null as gone")).rows[0].gone,true);
   assert.deepEqual((await pool.query('select feature from public.app_operator_features order by feature')).rows.map(r=>r.feature),['calls','telegram']);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
