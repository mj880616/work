// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// PHOTO-사진메뉴 ②단계 DB(20261029150000_photo_tags): 앨범(#태그) 표 2개 — through the approved DB workflow runner.
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
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261029150000',name='photo_tags',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// 앞 단계 표 app_diary_stars는 이 migration이 있는지만 본다(모양은 쓰지 않음).
const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create table public.app_diary_stars(id uuid primary key);
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;

test('photo tags db: plan, dry-run, apply, owner boundary, same-workspace link, shape guard, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'photo-tags-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const addTag=(sub,ws,tag)=>as('authenticated',sub,c=>c.query('insert into public.app_photo_tags(workspace_id,name) values ($1,$2) returning id',[ws,tag]).then(r=>r.rows[0].id));
  const addItem=(sub,tagId,ws,key,source='onedrive')=>as('authenticated',sub,c=>c.query('insert into public.app_photo_tag_items(tag_id,workspace_id,source,item_key,taken_day) values ($1,$2,$3,$4,$5)',[tagId,ws,source,key,'2026-10-05']));
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('approval plan: expanded rules, full flow, no definer function',()=>{
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   assert.deepEqual(plan.review.definer,[]);
   assert.match(toDryRun(migration),/rollback;\s*$/);
  });
  await t.test('precheck: all yes before apply',()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
  await t.test('dry-run leaves schema and history unchanged',async()=>{
   const dry=await run('dry-run','9901');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; second apply refused',async()=>{
   const apply=await run('apply','9902');assert.equal(apply.ok,true,apply.summary);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
   assert.equal((await run('apply','9903')).ok,false);
  });
  let trip;
  await t.test('owner makes an album, puts photos in, renames, sets a cover, takes a photo out; items are never updated',async()=>{
   trip=await addTag(OWNER,WS_A,'여행');
   await addItem(OWNER,trip,WS_A,'A1');await addItem(OWNER,trip,WS_A,'A2');await addItem(OWNER,trip,WS_A,'up-1','upload');
   await assert.rejects(addItem(OWNER,trip,WS_A,'A1'),{code:'23505'},'same photo twice in one album');
   await owner(c=>c.query("update public.app_photo_tags set name='제주여행',cover_key='A2',updated_at=now() where id=$1",[trip]));
   assert.deepEqual((await owner(c=>c.query('select name,cover_key from public.app_photo_tags'))).rows,[{name:'제주여행',cover_key:'A2'}]);
   assert.equal((await owner(c=>c.query("delete from public.app_photo_tag_items where tag_id=$1 and item_key='A2'",[trip]))).rowCount,1);
   await assert.rejects(owner(c=>c.query("update public.app_photo_tag_items set item_key='B9'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query('update public.app_photo_tags set workspace_id=$1',[WS_B])),{code:'42501'});
   await assert.rejects(owner(c=>c.query('insert into public.app_photo_tags(id,workspace_id,name) values (gen_random_uuid(),$1,$2)',[WS_A,'x'])),{code:'42501'});
  });
  await t.test('anon has nothing; a stranger sees nothing and cannot write into the owner workspace or link to its album',async()=>{
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_photo_tags')),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_photo_tag_items')),{code:'42501'});
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_photo_tags'))).rows[0].n,0);
   assert.equal((await stranger(c=>c.query('select count(*)::int n from public.app_photo_tag_items'))).rows[0].n,0);
   await assert.rejects(addTag(STRANGER,WS_A,'남의것'),{code:'42501'});
   await assert.rejects(addItem(STRANGER,trip,WS_A,'Z1'),{code:'42501'});
   assert.equal((await stranger(c=>c.query("update public.app_photo_tags set name='바꿈'"))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_photo_tags'))).rowCount,0);
   // owner of WS_A is not owner of WS_B
   await assert.rejects(addTag(OWNER,WS_B,'다른곳'),{code:'42501'});
   // a link row must carry the album's own workspace (two-column foreign key)
   await pool.query("insert into public.app_photo_tags(id,workspace_id,name) values ('b0000000-0000-4000-8000-0000000000b1',$1,'B앨범')",[WS_B]);
   await assert.rejects(pool.query("insert into public.app_photo_tag_items(tag_id,workspace_id,source,item_key) values ('b0000000-0000-4000-8000-0000000000b1',$1,'onedrive','A1')",[WS_A]),{code:'23503'});
   await pool.query("delete from public.app_photo_tags where workspace_id=$1",[WS_B]);
  });
  await t.test('shape guard: name 1~40 without # or spaces, case-insensitive unique per workspace, known source, key length',async()=>{
   for(const bad of ['','#여행','두 단어','x'.repeat(41),'탭\t'])await assert.rejects(addTag(OWNER,WS_A,bad),{code:'23514'},JSON.stringify(bad));
   await addTag(OWNER,WS_A,'Family');
   await assert.rejects(addTag(OWNER,WS_A,'family'),{code:'23505'});
   await assert.rejects(addItem(OWNER,trip,WS_A,'A9','drive'),{code:'23514'});
   await assert.rejects(addItem(OWNER,trip,WS_A,'k'.repeat(301)),{code:'23514'});
  });
  await t.test('deleting an album removes its links only; rollback returns to the snapshot',async()=>{
   await owner(c=>c.query('delete from public.app_photo_tags where id=$1',[trip]));
   assert.equal((await pool.query('select count(*)::int n from public.app_photo_tag_items')).rows[0].n,0);
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(postcheck))assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
