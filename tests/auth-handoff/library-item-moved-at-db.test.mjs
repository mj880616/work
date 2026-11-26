// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic (no real folder or document names).
// S70-73c LIB-드라이브위치따라가기 DB: 20261126150000_library_item_moved_at — app_library_folder_items.moved_at(옮긴 시각) +
// 넣기·고치기 앞 트리거(폴더가 바뀔 때만 서버 시계로 적음, 보낸 값은 쓰지 않음). 승인형 DB workflow 실행기로 dry-run·apply를 시험하고,
// 앱 옮기기(owner RLS)·서버 쪽 폴더 비우기(휴지통 트리거)가 시각을 새로 적는지, 권한이 넓어지지 않는지, 되돌리기를 본다.
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
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261126150000',name='library_item_moved_at',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 운영과 같은 앞 모양: 자료 표(owner RLS) + 진짜 폴더 표 migration 두 개(연결 표 칸 단위 권한·owner 정책).
const shapes=`
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
    project_id uuid references public.app_spaces(id) on delete set null,title text);
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_documents from anon;
  revoke usage on schema private from service_role;
`;

test('LIB-드라이브위치따라가기 DB: precheck, dry-run, apply, moved_at set by the server on insert and folder change only, access not widened, rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'library-item-moved-at-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(shapes);
  await pool.query(await read('supabase/migrations/20261022120000_library_folders.sql'));
  await pool.query(await read('supabase/migrations/20261026170000_library_folders_free.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const summary=await read('docs/'+stem+'.summary.md');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const folder=(c,{ws=WS_A,parent=null,label='예시 폴더',order=0}={})=>c.query('insert into public.app_library_folders(workspace_id,project_id,parent_id,name,sort_order) values($1,null,$2,$3,$4) returning id',[ws,parent,label,order]).then(r=>r.rows[0].id);
  const addDoc=(c,ws=WS_A)=>c.query("insert into public.app_documents(workspace_id,title) values($1,'예시 자료') returning id",[ws]).then(r=>r.rows[0].id);
  const file=(c,doc,f,ws=WS_A)=>c.query('insert into public.app_library_folder_items(document_id,folder_id,workspace_id) values($1,$2,$3)',[doc,f,ws]);
  // 시험용으로 옛 시각 만들기: 장치를 잠깐 끄고 관리자가 적는다(장치가 켜져 있으면 누구도 시각을 직접 못 바꿈 — 아래에서 확인).
  const age=async doc=>{await pool.query('alter table public.app_library_folder_items disable trigger app_library_folder_items_moved_at');try{await pool.query("update public.app_library_folder_items set moved_at='2000-01-01T00:00:00Z' where document_id=$1",[doc])}finally{await pool.query('alter table public.app_library_folder_items enable trigger app_library_folder_items_moved_at')}};
  const row=async doc=>(await pool.query('select folder_id,moved_at from public.app_library_folder_items where document_id=$1',[doc])).rows[0];

  const A1=await owner(c=>folder(c,{label:'예시 가'})),A2=await owner(c=>folder(c,{label:'예시 나',order:1})),A3=await owner(c=>folder(c,{parent:A1,label:'예시 가 안'}));
  const B1=await stranger(c=>folder(c,{ws:WS_B,label:'남의 폴더'}));
  const OLD1=await owner(c=>addDoc(c));await owner(c=>file(c,OLD1,A1));
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const pre=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));

  await t.test('precheck: every yes/no item is yes before apply; summary has three everyday lines',()=>{
   const yesNo=beforeCheck.filter(r=>/^(예|아니오)$/.test(r.value));
   assert.equal(yesNo.length,6);assert.ok(yesNo.every(r=>r.value==='예'),JSON.stringify(yesNo));
   assert.deepEqual(summary.trim().split('\n').map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
  });
  await t.test('static plan accepts dry-run and apply under the expanded rules (one invoker trigger function, no grants or policies)',()=>{
   for(const mode of ['dry-run','apply']){const p=plan(mode,'1');assert.equal(p.expanded,true);assert.deepEqual(p.review.definer,[]);assert.equal(p.review.grants,0);assert.equal(p.review.policies,0);assert.equal(p.review.triggers,1)}
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9921');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    ['grant select on public.app_library_folder_items to anon','revoke select on public.app_library_folder_items from anon'],
    ['alter table public.app_library_folder_items disable row level security','alter table public.app_library_folder_items enable row level security'],
    ['grant insert on public.app_library_folder_items to authenticated','revoke insert on public.app_library_folder_items from authenticated; grant insert (document_id, folder_id, workspace_id) on public.app_library_folder_items to authenticated'],
    ['grant update on public.app_library_folder_items to authenticated','revoke update on public.app_library_folder_items from authenticated; grant update (folder_id) on public.app_library_folder_items to authenticated'],
    ["create policy synthetic_extra on public.app_library_folder_items for select to authenticated using (true)",'drop policy synthetic_extra on public.app_library_folder_items'],
    ["insert into supabase_migrations.schema_migrations(version,name) values('20261126150000','library_item_moved_at')","delete from supabase_migrations.schema_migrations where version='20261126150000'"],
   ];
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/LIBRARY_ITEM_MOVED_AT_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; hashes equal precheck; existing rows keep their folder and get a time',async()=>{
   const apply=await run('apply','9922');assert.equal(apply.ok,true,apply.summary);
   const post=(await pool.query(postcheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
   for(const r of post.filter(r=>!/^(예|아니오)$/.test(r.value)))assert.equal(r.value,pre[r.item],r.item);
   const r=await row(OLD1);assert.equal(r.folder_id,A1);assert.ok(r.moved_at instanceof Date);
  });
  await t.test('insert: the server writes the time; the owner cannot send one',async()=>{
   const d=await owner(c=>addDoc(c));await owner(c=>file(c,d,A1));
   const r=await row(d);assert.ok(Date.now()-r.moved_at.getTime()<60000);
   await assert.rejects(owner(c=>c.query("insert into public.app_library_folder_items(document_id,folder_id,workspace_id,moved_at) values($1,$2,$3,'2000-01-01')",[d,A1,WS_A])),{code:'42501'});
  });
  await t.test('update: moving to another folder writes a new time; same folder keeps the old time; the owner cannot write the time',async()=>{
   const d=await owner(c=>addDoc(c));await owner(c=>file(c,d,A1));
   const first=(await row(d)).moved_at.toISOString();
   await pool.query("update public.app_library_folder_items set moved_at='2000-01-01T00:00:00Z' where document_id=$1",[d]);
   assert.equal((await row(d)).moved_at.toISOString(),first,'관리자가 시각만 바꿔도 장치가 옛 값을 지킨다');
   await age(d);
   assert.equal((await owner(c=>c.query('update public.app_library_folder_items set folder_id=$1 where document_id=$2 and workspace_id=$3',[A1,d,WS_A]))).rowCount,1);
   assert.equal((await row(d)).moved_at.toISOString(),'2000-01-01T00:00:00.000Z','같은 폴더로 다시 써도 옛 시각');
   assert.equal((await owner(c=>c.query('update public.app_library_folder_items set folder_id=$1 where document_id=$2 and workspace_id=$3',[A2,d,WS_A]))).rowCount,1);
   const r=await row(d);assert.equal(r.folder_id,A2);assert.ok(Date.now()-r.moved_at.getTime()<60000,'옮기면 새 시각');
   await assert.rejects(owner(c=>c.query("update public.app_library_folder_items set moved_at='2000-01-01' where document_id=$1",[d])),{code:'42501'});
  });
  await t.test('compare-and-set: an update that expects the old folder and an old time changes nothing after the app moved it',async()=>{
   const d=await owner(c=>addDoc(c));await owner(c=>file(c,d,A1));
   const cutoff=new Date(Date.now()-30*60000).toISOString();
   const r=await owner(c=>c.query('update public.app_library_folder_items set folder_id=$1 where workspace_id=$2 and folder_id=$3 and moved_at<$4 and document_id=$5',[A2,WS_A,A1,cutoff,d]));
   assert.equal(r.rowCount,0,'방금 넣은(옮긴) 줄은 따라가기가 고치지 않음');assert.equal((await row(d)).folder_id,A1);
  });
  await t.test('a server-side folder change (as the folder delete/lift triggers do) also writes a new time',async()=>{
   const d=await owner(c=>addDoc(c));await owner(c=>file(c,d,A3));
   await age(d);
   await pool.query("update public.app_library_folder_items set folder_id=$1 where document_id=$2",[A1,d]);
   assert.ok(Date.now()-(await row(d)).moved_at.getTime()<60000);
  });
  await t.test('other workspace rows stay unreadable; anon has nothing; function is run only by the trigger',async()=>{
   const d=await stranger(c=>addDoc(c,WS_B));await stranger(c=>file(c,d,B1,WS_B));
   assert.equal((await owner(c=>c.query('select moved_at from public.app_library_folder_items where document_id=$1',[d]))).rowCount,0);
   await assert.rejects(as('anon','',c=>c.query('select moved_at from public.app_library_folder_items limit 1')),{code:'42501'});
   for(const role of ['anon','authenticated','service_role'])assert.equal((await pool.query("select has_function_privilege($1,'private.app_library_folder_items_moved_at()','execute') ok",[role])).rows[0].ok,false,role);
   assert.equal((await pool.query("select has_table_privilege('service_role','public.app_library_folder_items','select') ok")).rows[0].ok,false,'서버 키에 연결 표 권한을 주지 않음');
  });
  await t.test('rollback removes trigger, function and column; folders stay; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.deepEqual((await pool.query('select folder_id from public.app_library_folder_items where document_id=$1',[OLD1])).rows,[{folder_id:A1}]);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   const again=await run('apply','9925');assert.equal(again.ok,true,again.summary);
   const post=(await pool.query(postcheck)).rows;assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),JSON.stringify(post));
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
