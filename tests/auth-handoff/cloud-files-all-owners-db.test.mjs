// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real file, folder or account names).
// S62-11 MULTI-구글드라이브사진모두 ①(20261115120000_cloud_files_all_owners): [파일] 읽기를 '자기 작업공간 owner'로(운영자 기능 files 조건만 뺌).
// - 승인형 DB workflow 확장 규칙(같은 이름·같은 표 정책 교체, 함수 재정의)을 통과하고, dry-run은 아무것도 안 바꾸며, apply 뒤 사후 확인이 모두 예.
// - 적용 전: files 허용이 없는 작업공간 owner는 자기 줄도 0줄. 적용 뒤: 자기 줄만 보이고, 다른 작업공간 줄은 여전히 0줄, anon은 못 읽음.
// - 운영자(files 허용) 작업공간의 결과는 적용 전후 같다(사용자 동작 고정).
// - 되돌리기는 정책 3개·찾기 함수·기록을 원래대로(snapshot 동일) 하고 다시 적용할 수 있다.
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
const version='20261115120000',name='cloud_files_all_owners',stem=version+'_'+name;
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

test('cloud files all owners: own workspace only, no feature key, operator unchanged, rollback restores',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'cloud-files-all-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
   revoke all on public.app_documents from anon;
   grant select on public.app_documents to authenticated;`);
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:cfa1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261031120000_gdrive_photo_index','20261102160000_cloud_files_index','20261104120000_cloud_find_sources','20261104162800_cloud_jobs'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};

  // 작업공간마다 가짜 색인 2줄·별표 1줄·작업 1줄(서버 쓰기와 같은 postgres 쓰기).
  for(const [ws,tag] of [[WS_A,'a'],[WS_B,'b']]){
   await pool.query(`insert into public.app_cloud_items(workspace_id,source,item_id,parent_id,name,is_folder,mime,size_bytes,modified_at,created_at,hash,trashed)
     values ($1,'gd','${tag}-f1',null,'가상 폴더 ${tag}',true,null,null,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z',null,false),
            ($1,'gd','${tag}-x1','${tag}-f1','가상 문서 ${tag}.pdf',false,'application/pdf',100,'2026-11-02T00:00:00Z','2026-11-02T00:00:00Z',null,false)`,[ws]);
   await pool.query(`insert into public.app_cloud_stars(workspace_id,source,item_id) values ($1,'gd','${tag}-x1')`,[ws]);
   await pool.query(`insert into public.app_cloud_jobs(workspace_id,created_by,kind,origin,src_source,src_id,dest_source,dest_parent,name,is_folder,status)
     values ($1,$2,'copy','cloud','gd','${tag}-x1','od','root','가상 문서 ${tag}.pdf',false,'queued')`,[ws,ws===WS_A?OWNER:STRANGER]);
  }
  const look=async who=>({
   items:(await who(c=>c.query('select workspace_id,item_id from public.app_cloud_items order by item_id'))).rows,
   stars:(await who(c=>c.query('select workspace_id,item_id from public.app_cloud_stars order by item_id'))).rows,
   jobs:(await who(c=>c.query('select workspace_id,src_id from public.app_cloud_jobs order by src_id'))).rows,
   find:(await who(c=>c.query("select item_id from public.app_cloud_find_in(array['gd','od'],'',$1,50) order by item_id",['recent']))).rows.map(r=>r.item_id),
   starred:(await who(c=>c.query("select item_id from public.app_cloud_find_in(array['gd'],'',$1,50)",['starred']))).rows.map(r=>r.item_id),
   query:(await who(c=>c.query("select item_id from public.app_cloud_find_in(array['gd'],'가상',null,50) order by item_id"))).rows.map(r=>r.item_id),
   list:(await who(c=>c.query("select item_id from public.app_cloud_list('gd',$1) order by item_id",['a-f1']))).rows.map(r=>r.item_id).concat(
    (await who(c=>c.query("select item_id from public.app_cloud_list('gd',$1) order by item_id",['b-f1']))).rows.map(r=>r.item_id)),
  });
  const before=(await pool.query(snapshot)).rows;
  const operatorBefore=await look(owner);

  await t.test('files: rules pass (policy replacement + function), summary 3 lines, no fixed id, rollback keeps the original definitions',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.expanded,true);
    assert.deepEqual(plan.functions,['public.app_cloud_find_in']);
    assert.deepEqual(plan.policyReplacements.map(r=>r.table+'.'+r.name).sort(),
     ['app_cloud_items.cloud_items_owner_read','app_cloud_jobs.cloud_jobs_owner_read','app_cloud_stars.cloud_stars_owner_read']);
    for(const r of plan.policyReplacements){assert.equal(r.cmd,'select');assert.deepEqual(r.roles,['authenticated']);assert.equal(r.rollback.cmd,'select');}
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto\s+(anon|public)\b|disable row level security|grant\s+(select|insert|update|delete|all)\b|rtw_|app_operator_features/i);
   assert.doesNotMatch(code,/app_workspace_has_feature\(\s*(workspace_id|v_ws)\s*,\s*'files'\)/,'files check removed everywhere in the new definitions');
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id');
   // 함수 본문은 files 줄 말고는 원문과 같다(되돌리기 파일 = 원문).
   const strip=s=>s.replace(/--.*$/gm,'').replace(/\s+/g,' ');
   const fnOf=s=>strip(s).match(/create (?:or replace )?function public\.app_cloud_find_in[\s\S]*?\$\$ ?;/)[0].replace('create function','create or replace function');
   const orig=fnOf(await read('supabase/migrations/20261104120000_cloud_find_sources.sql'));
   assert.equal(fnOf(rollbackSQL),orig);
   assert.equal(fnOf(migration),orig.replace(" or not private.app_workspace_has_feature(v_ws, 'files')",''));
  });

  await t.test('before apply: a workspace without the files key sees nothing, the operator sees own rows',async()=>{
   const s=await look(stranger);
   assert.deepEqual(s,{items:[],stars:[],jobs:[],find:[],starred:[],query:[],list:[]});
   assert.deepEqual(operatorBefore.items.map(r=>r.workspace_id),[WS_A,WS_A]);
   assert.deepEqual(operatorBefore.find,['a-x1']);
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['files feature rows'],'1');
   await allYes(postcheck);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9973')).ok,false);
  });

  await t.test('after apply: each owner reads only own workspace; operator unchanged; anon and other workspace refused',async()=>{
   assert.deepEqual(await look(owner),operatorBefore,'operator result unchanged');
   const s=await look(stranger);
   assert.deepEqual(s.items,[{workspace_id:WS_B,item_id:'b-f1'},{workspace_id:WS_B,item_id:'b-x1'}]);
   assert.deepEqual(s.stars,[{workspace_id:WS_B,item_id:'b-x1'}]);
   assert.deepEqual(s.jobs,[{workspace_id:WS_B,src_id:'b-x1'}]);
   assert.deepEqual(s.find,['b-x1']);assert.deepEqual(s.starred,['b-x1']);assert.deepEqual(s.query,['b-f1','b-x1']);
   assert.deepEqual(s.list,['b-x1'],'folder of another workspace lists nothing');
   // 화면이 다른 작업공간 id로 걸러도 0줄.
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_cloud_items where workspace_id=$1',[WS_A]))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_cloud_jobs where workspace_id=$1',[WS_A]))).rows[0].n,0);
   for(const sql of ['select 1 from public.app_cloud_items','select 1 from public.app_cloud_stars','select 1 from public.app_cloud_jobs',
    "select 1 from public.app_cloud_find_in(array['gd'],'',$$recent$$,10)"])await assert.rejects(anon(c=>c.query(sql)),{code:'42501'});
   // 화면(authenticated)은 여전히 쓰지 못한다.
   await assert.rejects(stranger(c=>c.query("insert into public.app_cloud_stars(workspace_id,source,item_id) values($1,'gd','b-f1')",[WS_B])),{code:'42501'});
   await assert.rejects(stranger(c=>c.query("update public.app_cloud_jobs set status='done' where workspace_id=$1",[WS_B])),{code:'42501'});
   // 운영자 허용 행은 그대로.
   assert.equal((await pool.query("select count(*)::int n from public.app_operator_features where feature in ('files','gdrive_photos')")).rows[0].n,2);
  });

  await t.test('rollback restores the policies, function and record (snapshot equal); stranger back to 0 rows; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   assert.deepEqual((await look(stranger)).items,[]);
   assert.deepEqual(await look(owner),operatorBefore);
   const again=await run('apply','9974');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
