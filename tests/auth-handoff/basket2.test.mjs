// Synthetic settings schema, not a statement about production. No production calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';

for(const name of Object.keys(process.env)) if(name.startsWith('PG')) delete process.env[name];
test('BASKET-2 real approval dry-run, apply, guarded rollback and reapply preserve rows/ACL/RLS', {timeout:90000}, async()=>{
  const directory=await mkdtemp(join(tmpdir(),'basket2-pg-'));
  const socket=createServer(); await new Promise(r=>socket.listen(0,'127.0.0.1',r));
  const port=socket.address().port; await new Promise(r=>socket.close(r));
  const password=randomBytes(24).toString('hex');
  const cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,
    createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],
    postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  let pool; const ended=[];
  try {
    await cluster.initialise(); await cluster.start();
    pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
    pool.on('connect',c=>ended.push(new Promise(r=>c.once('end',r))));
    await pool.query(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
      insert into supabase_migrations.schema_migrations values ('20261010120000','basket1_notes_links',array['synthetic']);
      create table public.app_drive_settings(workspace_id uuid primary key,root_folder_id text,library_folder_id text);
      alter table public.app_drive_settings enable row level security;
      create policy synthetic_owner on public.app_drive_settings to authenticated using (false);
      grant select on public.app_drive_settings to authenticated; grant all on public.app_drive_settings to service_role;
      insert into public.app_drive_settings values ('10000000-0000-4000-8000-000000000001','synthetic-root','synthetic-library');`);
    const original=async()=> (await pool.query('select workspace_id,root_folder_id,library_folder_id from public.app_drive_settings')).rows;
    const security=async()=> (await pool.query(`select relowner,relacl::text,relrowsecurity,relforcerowsecurity,
      (select string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),''),',' order by polname)
        from pg_policy where polrelid=c.oid) policies from pg_class c where oid='public.app_drive_settings'::regclass`)).rows;
    const before={rows:await original(),security:await security()};
    const snapshot=await readFile(new URL('../../docs/20261010180000_basket2_drive_folder.snapshot.sql',import.meta.url),'utf8');
    const beforeSnapshot=(await pool.query(snapshot)).rows;
    const root=new URL('../../',import.meta.url).pathname;
    const plan=(mode,runId)=>prepareMigration({mode,version:'20261010180000',runId,root});
    const query=async(sql,{readOnly=false}={})=>{
      const c=await pool.connect();
      try {if(readOnly)await c.query('begin read only');const r=await c.query(sql);
        if(readOnly)await c.query('commit');return Array.isArray(r)?r.at(-1).rows:r.rows;
      }catch(e){await c.query('rollback');throw e;}finally{c.release();}
    };
    // Missing/incorrect workspace key and required unsupported columns fail before ALTER.
    for(const mutate of ['alter table public.app_drive_settings drop constraint app_drive_settings_pkey',
      'alter table public.app_drive_settings add column unsupported text not null default \'x\'; alter table public.app_drive_settings alter column unsupported drop default']){
      await pool.query('begin'); await pool.query(mutate);
      await assert.rejects(pool.query(plan('apply','12340').file.sql),/BASKET-2/); await pool.query('rollback');
    }
    for(const [mode,id] of [['dry-run','12341'],['apply','12342']]) {
      const result=await runMigrationPlan(plan(mode,id),query); assert.equal(result.ok,true,result.summary);
      assert.doesNotMatch(result.summary,/synthetic-root|synthetic-library|baseline NULL/);
      assert.deepEqual(await original(),before.rows); assert.deepEqual(await security(),before.security);
    }
    assert.equal((await pool.query('select basket_folder_id from public.app_drive_settings')).rows[0].basket_folder_id,null);
    await pool.query("update public.app_drive_settings set basket_folder_id='synthetic-used'");
    await assert.rejects(pool.query(plan('rollback','12343').file.sql),/BASKET-2 rollback blocked/); await pool.query('rollback');
    await pool.query('update public.app_drive_settings set basket_folder_id=null');
    for(const [mode,id] of [['rollback','12344'],['apply','12345']]){
      const result=await runMigrationPlan(plan(mode,id),query); assert.equal(result.ok,true,result.summary);
      assert.deepEqual(await original(),before.rows); assert.deepEqual(await security(),before.security);
      if(mode==='rollback')assert.deepEqual((await pool.query(snapshot)).rows,beforeSnapshot);
    }
    const post=await readFile(new URL('../../docs/20261010180000_basket2_drive_folder.postcheck.sql',import.meta.url),'utf8');
    await pool.query('alter table public.app_drive_settings alter column basket_folder_id set default \'bad\'');
    assert.equal((await pool.query(post)).rows.find(r=>r.item==='column and history agree').ok,'아니오');
  }finally {if(pool){await pool.end();await Promise.all(ended);}await cluster.stop();}
});
