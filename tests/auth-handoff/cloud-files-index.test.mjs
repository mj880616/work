// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real file, folder or account names).
// S48-12b 파일 탐색기 ② DB(20261102160000): 기능 키 files + 색인 표 3개 + 읽기 함수 3개.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 허용 행은 gdrive_photos(= calls) 작업공간에만 1행. 그 조건이 아니면 멈추고 아무것도 바꾸지 않는다.
// - 화면(authenticated)은 그 작업공간 owner이고 files 허용이 있을 때만 items·stars를 읽는다. 쓰기는 service_role만. anon은 아무것도.
// - 되돌리기는 새 함수·표·허용 행·검사·기록만 원래대로 하고, 다른 허용 행은 그대로 둔다.
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
const version='20261102160000',name='cloud_files_index',stem=version+'_'+name;
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
const NEW=['app_cloud_sync','app_cloud_items','app_cloud_stars'];
const DOC_A='26000000-0000-4000-8000-0000000000a1';

test('cloud files index: owner + files feature read, service_role writes, operator workspace only, rollback restores',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'cloud-files-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  // 자료실(app_documents) 최소 모양: 파일 id·읽은 글자·상태와 owner 읽기 정책(운영과 같은 경계).
  await pool.query(`create table public.app_documents(id uuid primary key, workspace_id uuid not null, file_id text, extraction_status text, extracted_text text);
   alter table public.app_documents enable row level security;
   create policy fake_docs_owner on public.app_documents for select to authenticated using (private.app_is_workspace_owner(workspace_id));
   grant select on public.app_documents to authenticated;`);
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:cf1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  await pool.query(await read('supabase/migrations/20261031120000_gdrive_photo_index.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: expanded rules pass, three new tables, summary 3 lines, no fixed id, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
    assert.deepEqual([...plan.createdTables].sort(),[...NEW].sort());
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level security|\bto (anon|public)\b|rtw_/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['files rows'],'0');
   await allYes(postcheck);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9983')).ok,false);
  });

  await t.test('feature: files only for the operator workspace owner; the allow table stays closed to API roles',async()=>{
   assert.deepEqual((await pool.query('select workspace_id,feature from public.app_operator_features order by feature')).rows,
    [{workspace_id:WS_A,feature:'calls'},{workspace_id:WS_A,feature:'files'},{workspace_id:WS_A,feature:'gdrive_photos'},{workspace_id:WS_A,feature:'telegram'}]);
   assert.deepEqual((await owner(c=>c.query('select public.app_my_features() f'))).rows[0].f,['calls','files','gdrive_photos','telegram']);
   assert.deepEqual((await stranger(c=>c.query('select public.app_my_features() f'))).rows[0].f,[]);
   assert.equal((await server(c=>c.query("select public.app_operator_feature_workspace('files') w"))).rows[0].w,WS_A);
   for(const fn of [owner,stranger,server])await assert.rejects(fn(c=>c.query('select * from public.app_operator_features')),{code:'42501'});
  });

  const item=(ws,source,id,parent,nm,folder=false,size=null,mod='2026-11-01T00:00:00Z',hash=null)=>({workspace_id:ws,source,item_id:id,parent_id:parent,name:nm,is_folder:folder,
   mime:folder?null:'application/octet-stream',size_bytes:size,modified_at:mod,created_at:mod,hash,trashed:false});
  const upsert=`insert into public.app_cloud_items(workspace_id,source,item_id,parent_id,name,is_folder,mime,size_bytes,modified_at,created_at,hash,trashed)
   select b.workspace_id,b.source,b.item_id,b.parent_id,b.name,b.is_folder,b.mime,b.size_bytes,b.modified_at,b.created_at,b.hash,b.trashed
     from json_populate_recordset(null::public.app_cloud_items,$1::json) b
   on conflict (workspace_id,source,item_id) do update set parent_id=excluded.parent_id,name=excluded.name,size_bytes=excluded.size_bytes,
     modified_at=excluded.modified_at,hash=excluded.hash,trashed=excluded.trashed,seen_at=now(),updated_at=now()`;

  await t.test('service_role writes the index, sync state and stars; checks refuse bad ids, hashes, sources and self-parent',async()=>{
   await server(c=>c.query(upsert,[JSON.stringify([
    item(WS_A,'gd','fold_1',null,'가상폴더',true),item(WS_A,'gd','fold_2','fold_1','하위',true),
    item(WS_A,'gd','file_a','fold_2','가상_초안.pdf',false,5000,'2026-10-30T00:00:00Z','md5:abc123'),
    item(WS_A,'gd','file_b','fold_2','회의록.docx',false,90000,'2026-11-01T00:00:00Z'),
    item(WS_A,'gd','file_t','fold_2','버린것.txt',false,1),
    item(WS_A,'od','ODX!101',null,'사진.jpg',false,100,'2026-11-01T05:00:00Z','qx:AAA='),
    item(WS_B,'gd','file_z',null,'남의파일.txt',false,1)])]));
   await server(c=>c.query("update public.app_cloud_items set trashed=true where item_id='file_t'"));
   await server(c=>c.query("insert into public.app_cloud_sync(workspace_id,source,cursor,synced_at,lock_until) values($1,'od','delta-cursor-x',now(),now()),($1,'gd','42',now(),null)",[WS_A]));
   await server(c=>c.query("insert into public.app_cloud_stars(workspace_id,source,item_id) values($1,'gd','file_b')",[WS_A]));
   await pool.query("insert into public.app_documents values($1,$2,'file_b','ready','가상 합의 내용')",[DOC_A,WS_A]);
   const bad=[["'gd','bad id',null,'n'",'id'],["'gd','x_1','x_1','n'",'self parent'],["'xx','x_2',null,'n'",'source'],["'gd','x_3',null,''",'name']];
   for(const [v,why] of bad)await assert.rejects(server(c=>c.query(`insert into public.app_cloud_items(workspace_id,source,item_id,parent_id,name) values($1,${v})`,[WS_A])),{code:'23514'},why);
   await assert.rejects(server(c=>c.query("insert into public.app_cloud_items(workspace_id,source,item_id,name,hash) values($1,'gd','x_4','n','crc:1')",[WS_A])),{code:'23514'});
   await assert.rejects(server(c=>c.query("update public.app_cloud_sync set last_error='token leaked here' where workspace_id=$1",[WS_A])),{code:'23514'});
   await assert.rejects(server(c=>c.query('truncate public.app_cloud_items')),{code:'42501'});
  });

  await t.test('owner with files reads own rows; list counts direct files only, trash hidden, library and star shown',async()=>{
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_cloud_items'))).rows[0].n,6);
   assert.deepEqual((await owner(c=>c.query("select item_id,child_count from public.app_cloud_list('gd',null)"))).rows,[{item_id:'fold_1',child_count:0}]);
   assert.deepEqual((await owner(c=>c.query("select item_id,child_count,starred,library_doc_id from public.app_cloud_list('gd','fold_1')"))).rows,
    [{item_id:'fold_2',child_count:2,starred:false,library_doc_id:null}]);
   assert.deepEqual((await owner(c=>c.query("select item_id,starred,library_doc_id from public.app_cloud_list('gd','fold_2')"))).rows,
    [{item_id:'file_a',starred:false,library_doc_id:null},{item_id:'file_b',starred:true,library_doc_id:DOC_A}]);
   assert.deepEqual((await owner(c=>c.query("select item_id,depth from public.app_cloud_trail('gd','file_a')"))).rows,
    [{item_id:'file_a',depth:0},{item_id:'fold_2',depth:1},{item_id:'fold_1',depth:2}]);
   assert.deepEqual((await owner(c=>c.query("select item_id from public.app_cloud_list('xx',null)"))).rows,[]);
  });

  await t.test('find: name and ready library text, literal wildcards, shelves; bad input refused',async()=>{
   const find=(q,s,l=50)=>owner(c=>c.query('select item_id,match_in,folder_path from public.app_cloud_find($1,$2,$3)',[q,s,l])).then(r=>r.rows);
   assert.deepEqual(await find('초안',null),[{item_id:'file_a',match_in:'name',folder_path:'가상폴더 › 하위'}]);
   assert.deepEqual(await find('합의 회의록',null),[{item_id:'file_b',match_in:'text',folder_path:'가상폴더 › 하위'}]);
   assert.deepEqual(await find('100%',null),[]);
   assert.deepEqual(await find('버린것',null),[],'휴지통은 찾지 않음');
   assert.deepEqual((await find(null,'big')).map(r=>r.item_id),['file_b','file_a','ODX!101']);
   assert.deepEqual((await find(null,'recent')).map(r=>r.item_id),['ODX!101','file_b','file_a']);
   assert.deepEqual((await find(null,'starred')).map(r=>r.item_id),['file_b']);
   await pool.query("update public.app_documents set extraction_status='pending' where id=$1",[DOC_A]);
   assert.deepEqual(await find('합의',null),[],'읽기가 끝나지 않은 글자는 찾지 않음');
   for(const [q,s,l] of [[null,'bogus',10],['a','recent',10],['a',null,0],['a',null,301],['x'.repeat(201),null,10],['a\tb',null,10],['a b c d e f g',null,10]])
    await assert.rejects(find(q,s,l),{code:'22023'});
  });

  await t.test('stranger and owner without files see nothing; client roles cannot write; anon has nothing',async()=>{
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_cloud_items'))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query("select count(*)::int n from public.app_cloud_find(null,'recent',10)"))).rows[0].n,0);
   await pool.query("delete from public.app_operator_features where feature='files'");
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_cloud_items'))).rows[0].n,0);
   assert.equal((await owner(c=>c.query('select count(*)::int n from public.app_cloud_stars'))).rows[0].n,0);
   assert.equal((await owner(c=>c.query("select count(*)::int n from public.app_cloud_list('gd','fold_2')"))).rows[0].n,0);
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'files')",[WS_A]);
   await assert.rejects(owner(c=>c.query('select * from public.app_cloud_sync')),{code:'42501'});
   await assert.rejects(owner(c=>c.query("insert into public.app_cloud_stars(workspace_id,source,item_id) values($1,'gd','file_a')",[WS_A])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_cloud_items set name='x'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_cloud_items')),{code:'42501'});
   for(const table of NEW)await assert.rejects(anon(c=>c.query(`select * from public.${table}`)),{code:'42501'});
   await assert.rejects(anon(c=>c.query("select * from public.app_cloud_list('gd',null)")),{code:'42501'});
   await assert.rejects(anon(c=>c.query("select * from public.app_cloud_find(null,'recent',10)")),{code:'42501'});
  });

  await t.test('rollback restores the check, removes functions, tables, feature row and record; other allow rows stay; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   for(const table of NEW)assert.equal((await pool.query(`select to_regclass('public.${table}') is null as gone`)).rows[0].gone,true,table);
   assert.equal((await pool.query("select to_regprocedure('public.app_cloud_find(text,text,integer)') is null as gone")).rows[0].gone,true);
   assert.deepEqual((await pool.query('select feature from public.app_operator_features order by feature')).rows.map(r=>r.feature),['calls','gdrive_photos','telegram']);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   const again=await run('apply','9984');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });

  await t.test('guard: stops without changes when gdrive_photos is not on the calls workspace',async()=>{
   await pool.query(rollbackSQL);
   await pool.query("delete from public.app_operator_features where feature='gdrive_photos'");
   const c=await pool.connect();
   try{await assert.rejects(c.query(migration),/CLOUD_FILES_SEED_WORKSPACE_NOT_SINGLE/);await c.query('rollback');}finally{c.release();}
   assert.equal((await pool.query("select to_regclass('public.app_cloud_items') is null as gone")).rows[0].gone,true);
   assert.deepEqual((await pool.query('select feature from public.app_operator_features order by feature')).rows.map(r=>r.feature),['calls','telegram']);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
