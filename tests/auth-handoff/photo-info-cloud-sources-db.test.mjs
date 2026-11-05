// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S50-31 PHOTO-정보고치기 ② DB(20261105220000_photo_info_cloud_sources): 되돌리기 기록 표의 출처 허용 값에 'onedrive'·'gdrive'를 더한다 — 승인형 DB workflow 실행기로.
// 앞 단계 20261103140000_photo_info_edits는 저장소 파일 그대로 적용한다.
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
const version='20261105220000',name='photo_info_cloud_sources',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;
const BATCH='c0000000-0000-4000-8000-0000000000c2';

test('photo info cloud sources db: guard, plan, dry-run, apply, cloud sources accepted, boundary kept, rollback guarded',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'photo-info-cloud-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const add=(sub,ws,source,key)=>as('authenticated',sub,c=>c.query(
   "insert into public.app_photo_info_edits(workspace_id,batch_id,source,item_key,before_taken,after_taken) values ($1,$2,$3,$4,'2026-10-01T10:00:00Z','2026-10-01T02:00:00Z') returning id",
   [ws,BATCH,source,key]).then(r=>r.rows[0].id));
  const guardFails=async(pattern)=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));

  await t.test('guard: stops without changes until the photo info edits table is applied',async()=>{
   await guardFails(/relation "public.app_photo_info_edits" does not exist|PHOTO_INFO_CLOUD_SOURCES_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/20261103140000_photo_info_edits.sql'));
  });
  await add(OWNER,WS_A,'phone','ms:101');
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules, full flow, no grant/policy/definer, three-line summary, expect lines, no row counts',()=>{
   for(const mode of ['apply','dry-run']){const plan=prepareMigration({mode,version,runId:'1',root});assert.equal(plan.flow,'full');assert.deepEqual(plan.review.definer,[]);}
   const code=migration.replace(/--.*$/gm,'').replace(/insert into supabase_migrations\.schema_migrations[\s\S]*?\]\);/,'');
   assert.doesNotMatch(code,/\bgrant\b|\brevoke\b|create policy|drop policy|security definer|disable row level security|rtw_|\bto (anon|public)\b/i);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   for(const sql of [precheck,postcheck]){
    for(const r of (sql.match(/^-- expect: .*$/gm)||[]))assert.match(r,/^-- expect: .+ = (예|기록)$/);
    assert.doesNotMatch(sql.replace(/--.*$/gm,''),/from public\./i,'checks read no app rows (rows change while people edit photos)');
   }
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   for(const r of (snapshot.match(/.{8193,}/g)||[]))assert.fail('snapshot line too long');
  });
  await t.test('precheck all yes; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   const after=values(await readOnly(postcheck)),pre=values(beforeCheck);
   for(const [item,value] of Object.entries(after)){if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);else assert.equal(value,pre[item],item);}
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('onedrive and gdrive accepted; unknown source refused; owner boundary and grants unchanged',async()=>{
   await add(OWNER,WS_A,'onedrive','od:ABC!123');
   await add(OWNER,WS_A,'gdrive','gd:1AbC_dEf-2');
   await assert.rejects(add(OWNER,WS_A,'gphotos','gp:1'),{code:'23514'});
   await assert.rejects(add(OWNER,WS_B,'onedrive','od:X'),{code:'42501'});
   await assert.rejects(add(STRANGER,WS_A,'gdrive','gd:X'),{code:'42501'});
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select count(*)::int n from public.app_photo_info_edits'))).rows[0].n,0);
   await assert.rejects(as('anon','',c=>c.query('select 1 from public.app_photo_info_edits')),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query('select 1 from public.app_photo_info_edits')),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query('delete from public.app_photo_info_edits')),{code:'42501'});
   assert.equal((await as('authenticated',OWNER,c=>c.query("select count(*)::int n from public.app_photo_info_edits where source='phone'"))).rows[0].n,1);
  });
  await t.test('rollback: refused while cloud rows exist; after clearing returns to the snapshot',async()=>{
   {const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/PHOTO_INFO_CLOUD_SOURCES_ROLLBACK_BLOCKED: cloud rows exist/);await c.query('rollback');}finally{c.release();}}
   await pool.query("delete from public.app_photo_info_edits where source<>'phone'");
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop().catch(()=>{});
 }
});
