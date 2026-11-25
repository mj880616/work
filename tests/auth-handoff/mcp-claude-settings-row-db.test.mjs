// Fresh local PostgreSQL only. No Supabase, Google, OpenAI, Anthropic or production credentials. All data synthetic.
// MCP-Claude읽기 M-6 설정 행(20261125180000_mcp_claude_settings_row): 운영자 작업공간 하나에 app_mcp_settings 1행(enabled=false,
// allowed_client_id = 'Claude' 공개 클라이언트 id)을 적용 때 DB에서 읽어 넣는다.
// 지키는 것: 조건 맞으면 정확히 1행, 클라이언트 0개·2개(지운 것·confidential·다른 주소는 안 셈)·운영자 작업공간 2개면 멈춤(아무것도 안 바뀜),
// 다시 실행하면 멈춤, 행이 이미 있으면 멈춤, 파일에 ID 값 없음, 표·권한·정책은 그대로, 되돌리기 뒤 카탈로그 원래대로.
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
import {fixture,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261125180000',name='mcp_claude_settings_row',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const CALLBACK='https://claude.ai/api/mcp/auth_callback';
const CLAUDE='50000000-0000-4000-8000-000000000001',CLAUDE_2='50000000-0000-4000-8000-000000000002';

// 설정 표는 앞 단계 migration 원문에서 그 표의 문장만 뽑아 만든다(운영과 같은 칸·검사·권한·정책).
function settingsTableSQL(m3){
 const parts=[...m3.matchAll(/^create table public\.app_mcp_settings \([\s\S]*?\n\);|^(?:alter table|revoke|grant|create policy)[^;]*\bpublic\.app_mcp_settings\b[^;]*;/gm)].map(m=>m[0]);
 assert.equal(parts.length,7,'settings statements');
 return parts.join('\n');
}
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  create function auth.jwt() returns jsonb language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create type auth.oauth_client_type as enum ('public', 'confidential');
  create table auth.oauth_clients(id uuid primary key, client_name text, client_type auth.oauth_client_type not null default 'confidential',
    redirect_uris text not null, deleted_at timestamptz, created_at timestamptz not null default now());
  create table public.app_operator_features (
    workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
    feature text not null,
    created_at timestamptz not null default now(),
    constraint app_operator_features_pkey primary key (workspace_id, feature),
    constraint app_operator_features_feature_check check (feature in ('calls', 'telegram')));
  alter table public.app_operator_features enable row level security;
  revoke all on table public.app_operator_features from public, anon, authenticated, service_role;
  insert into supabase_migrations.schema_migrations(version, name, statements) values ('20261120090000', 'mcp_claude_read', array['synthetic']);`;

test('mcp claude settings row db: plan, refusals (client 0/2, operator 2, row present), dry-run, apply 1 row, rerun refused, rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'mcp-settings-row-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(settingsTableSQL(await read('supabase/migrations/20261120090000_mcp_claude_read.sql')));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  let runId=9800;
  const run=mode=>runMigrationPlan(prepareMigration({mode,version,runId:String(++runId),root}),query,{saveSnapshot:async()=>{}});
  // 파일 원문을 그대로 한 연결에서 실행(멈추면 그 연결을 rollback).
  const direct=async sql=>{const c=await pool.connect();try{await c.query(sql);}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const rows=async()=>(await pool.query('select workspace_id::text w,enabled,allowed_client_id,revoked_before from public.app_mcp_settings')).rows;
  const history=async()=>(await pool.query(`select count(*)::int n from supabase_migrations.schema_migrations where version='${version}'`)).rows[0].n;
  const nothingChanged=async()=>{assert.deepEqual(await rows(),[]);assert.equal(await history(),0);};
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: expanded rules, data only (no grant/policy/function), no ids, summary 3 lines, read-only checks',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const plan=prepareMigration({mode,version,runId:'1',root});assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.functions,[]);assert.deepEqual(plan.createdTables,[]);}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   // 주석과 마지막 기록 행(설명 글에 'policy'·'grant' 낱말이 있음)을 빼고 본다.
   const code=migration.replace(/--.*$/gm,'').replace(/insert into supabase_migrations\.schema_migrations[\s\S]*?\]\);/,'');
   assert.doesNotMatch(code,/\b(grant|revoke|create|alter|drop|policy|security definer)\b/i);
   assert.equal([...code.matchAll(/^insert into public\./gm)].length,1);
   for(const f of [migration,precheck,postcheck,snapshot,rollbackSQL,summary]){
    assert.doesNotMatch(f,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no id in files');
    assert.doesNotMatch(f,/@[a-z0-9-]+\.[a-z]/i,'no email in files');
   }
  });

  await pool.query(`insert into public.app_workspaces(id) values ('${WS_A}'),('${WS_B}') on conflict do nothing;
   insert into public.app_operator_features(workspace_id,feature) values ('${WS_A}','calls'),('${WS_A}','telegram');
   insert into auth.oauth_clients(id,client_name,client_type,redirect_uris,deleted_at) values
    ('50000000-0000-4000-8000-0000000000a1','Claude','public','${CALLBACK}',now()),
    ('50000000-0000-4000-8000-0000000000a2','Claude','confidential','${CALLBACK}',null),
    ('50000000-0000-4000-8000-0000000000a3','Claude','public','${CALLBACK},https://example.invalid/cb',null),
    ('50000000-0000-4000-8000-0000000000a4','Other','public','${CALLBACK}',null)`);

  await t.test('no matching Claude client (deleted, confidential, other address, other name do not count): stops, nothing changes',async()=>{
   assert.equal((await readOnly(precheck)).find(r=>r.item==='claude public clients').value,'0');
   const apply=await run('apply');assert.equal(apply.ok,false);
   await assert.rejects(direct(migration),/MCP_SETTINGS_ROW_CLIENT_NOT_ONE/);
   await nothingChanged();
  });

  await pool.query(`insert into auth.oauth_clients(id,client_name,client_type,redirect_uris) values ('${CLAUDE}','Claude','public','${CALLBACK}'),('${CLAUDE_2}','Claude','public','${CALLBACK}')`);
  await t.test('two matching Claude clients: stops, nothing changes',async()=>{
   assert.equal((await readOnly(precheck)).find(r=>r.item==='claude public clients').value,'2');
   assert.equal((await run('apply')).ok,false);
   await assert.rejects(direct(migration),/MCP_SETTINGS_ROW_CLIENT_NOT_ONE/);
   await nothingChanged();
  });

  await pool.query(`delete from auth.oauth_clients where id='${CLAUDE_2}'; insert into public.app_operator_features(workspace_id,feature) values ('${WS_B}','calls')`);
  await t.test('two operator workspaces: stops, nothing changes',async()=>{
   assert.equal((await readOnly(precheck)).find(r=>r.item==='operator workspaces').value,'2');
   assert.equal((await run('apply')).ok,false);
   await assert.rejects(direct(migration),/MCP_SETTINGS_ROW_OPERATOR_WORKSPACE_NOT_ONE/);
   await nothingChanged();
  });

  await pool.query(`delete from public.app_operator_features where workspace_id='${WS_B}'`);
  await t.test('settings row already present (without history): stops, existing row untouched',async()=>{
   await pool.query(`insert into public.app_mcp_settings(workspace_id,enabled,allowed_client_id) values ('${WS_B}',true,'x')`);
   assert.equal((await readOnly(precheck)).find(r=>r.item==='settings rows absent').value,'아니오');
   await assert.rejects(direct(migration),/MCP_SETTINGS_ROW_ALREADY_PRESENT/);
   assert.deepEqual(await rows(),[{w:WS_B,enabled:true,allowed_client_id:'x',revoked_before:null}]);
   await pool.query('delete from public.app_mcp_settings');
  });

  let beforeCheck;
  await t.test('conditions met: precheck yes, dry-run changes nothing, apply puts exactly 1 row (off, Claude client), postcheck yes',async()=>{
   beforeCheck=await readOnly(precheck);
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   assert.equal(beforeCheck.find(r=>r.item==='operator workspaces').value,'1');
   assert.equal(beforeCheck.find(r=>r.item==='claude public clients').value,'1');
   const dry=await run('dry-run');assert.equal(dry.ok,true,dry.summary);
   await nothingChanged();
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply');assert.equal(apply.ok,true,apply.summary);
   assert.deepEqual(await rows(),[{w:WS_A,enabled:false,allowed_client_id:CLAUDE,revoked_before:null}]);
   assert.equal(await history(),1);
   const post=await readOnly(postcheck);
   for(const r of post){const pre=beforeCheck.find(b=>b.item===r.item);assert.equal(r.value,pre&&!/^(예|아니오)$/.test(pre.value)?pre.value:'예',r.item);}
   // 표·칸·권한·정책은 그대로(카탈로그는 기록 행만 늘어남).
   assert.deepEqual((await pool.query(snapshot)).rows.filter(r=>r.kind!=='history'),before.filter(r=>r.kind!=='history'));
  });

  await t.test('second run refused (workflow and direct), row unchanged',async()=>{
   assert.equal((await run('apply')).ok,false);
   await assert.rejects(direct(migration),/MCP_SETTINGS_ROW_PREREQUISITE_CHANGED/);
   assert.deepEqual(await rows(),[{w:WS_A,enabled:false,allowed_client_id:CLAUDE,revoked_before:null}]);
  });

  await t.test('rollback: removes the row and history, catalog back to snapshot, precheck as before',async()=>{
   await pool.query(rollbackSQL);
   await nothingChanged();
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.deepEqual(await readOnly(precheck),beforeCheck);
   await assert.rejects(direct(rollbackSQL),/MCP_SETTINGS_ROW_ROLLBACK_BLOCKED/);
  });
 }finally{
  await closePool(pool);
  await cluster.stop();
 }
});
