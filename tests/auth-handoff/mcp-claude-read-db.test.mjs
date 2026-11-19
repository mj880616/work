// Fresh local PostgreSQL only. No Supabase, Google, OpenAI, Anthropic or production credentials. All data synthetic (made-up names).
// MCP-Claude읽기 M-3(20261120090000_mcp_claude_read + docs/ops/mcp-claude-read-guard.*): Claude가 Web2를 읽기만 하는 DB 쪽 문.
// 지키는 것: 문지기 거절(client_id 없음·다른 client·설정 없음·꺼짐·연결 끊기 전 세션·상한 1분 20번·하루 300번), 거절은 기록을 남기지 않음,
// 읽기 함수는 정해진 칸만(조직 요지 300자·원장 S2 제목만·노트 앞 200자), 빼는 것(일기·정리함·업무일지·AI 금지·잠근 폴더·휴지통·
// 통화·텔레그램·바깥 수집·다른 제품 표)은 어떤 함수로도 안 나옴, 남의 작업공간 0, 표·함수 권한(anon·service_role 없음),
// 설정 표는 화면 칸만 고침·위임 열쇠로는 못 고침, 요청 전 함수(L1)는 위임 열쇠를 app_mcp_ 읽기 7개 말고 모두 거절·일반 열쇠는 그대로,
// Storage 제한 정책(L2), 되돌리기 뒤 카탈로그 원래대로.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_A2,PROJECT_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261120090000',name='mcp_claude_read',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const CLIENT='claude-test-client-0001',OTHER_CLIENT='someone-else-client';
const SESSION_OLD='40000000-0000-4000-8000-000000000001',SESSION_NEW='40000000-0000-4000-8000-000000000002',SESSION_B='40000000-0000-4000-8000-000000000003';
const ORG_A2='23000000-0000-4000-8000-000000000003',ORG_A3='23000000-0000-4000-8000-000000000004';
const PROJECT_ARCH='22000000-0000-4000-8000-000000000004',PROJECT_OLD='22000000-0000-4000-8000-000000000005',PROJECT_TRASH='22000000-0000-4000-8000-000000000006';
const F_LOCK='32000000-0000-4000-8000-000000000001',F_LOCK_CHILD='32000000-0000-4000-8000-000000000002',F_OPEN='32000000-0000-4000-8000-000000000003';
const WORD='가상검색어';
const fakeCrypto=`
  create function extensions.gen_salt(p_type text, p_rounds integer) returns text language sql volatile as $$
    select '$2a$' || lpad(p_rounds::text, 2, '0') || '$' || substr(translate(encode(decode(md5(random()::text || clock_timestamp()::text), 'hex') || decode(md5(random()::text), 'hex'), 'base64'), '+/=', '.ab'), 1, 22) $$;
  create function extensions.crypt(p_password text, p_salt text) returns text language sql immutable as $$
    select substr(p_salt, 1, 29) || substr(md5(substr(p_salt, 1, 29) || p_password) || md5(p_password || substr(p_salt, 1, 29)), 1, 31) $$;`;
const owned=['app_suborganization_updates','app_suborganization_dispute_stages','app_business_records','app_project_workstreams','app_project_progress_updates',
  'app_project_milestones','app_record_links','app_documents','app_call_probe','app_tg_probe','app_feed_items'];
// 운영과 같은 모양의 칸(이 migration이 읽는 칸만) + 빼야 하는 표(통화·텔레그램·바깥 수집·다른 제품). 모두 owner RLS.
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  create role authenticator noinherit login;
  grant anon, authenticated, service_role to authenticator;
  create function auth.jwt() returns jsonb language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create table auth.sessions(id uuid primary key, user_id uuid not null, created_at timestamptz not null default now());
  revoke usage on schema private from service_role;
  create schema extensions;
  alter table public.app_spaces add column name text, add column parent_id uuid, add column status text default 'active',
    add column metadata jsonb not null default '{"project_system":"v2"}', add column deleted_at timestamptz;
  alter table public.app_spaces enable row level security;
  grant select on public.app_spaces to authenticated;
  create policy synthetic_owner on public.app_spaces for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  alter table public.app_suborganizations add column active boolean default true, add column recent_month_summary text, add column year_summary text,
    add column memo text, add column aliases text[] default '{}', add column deleted_at timestamptz;
  grant select on public.app_suborganizations to authenticated;
  create table public.app_suborganization_assignees(organization_id uuid not null, user_id uuid not null, workspace_id uuid not null);
  alter table public.app_suborganization_assignees enable row level security;
  grant select on public.app_suborganization_assignees to authenticated;
  create policy synthetic_owner on public.app_suborganization_assignees for all to authenticated using (private.app_is_workspace_owner(workspace_id));
  create table public.app_suborganization_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, organization_id uuid not null,
    raw_text text, detail_text text, occurred_at timestamptz);
  create table public.app_suborganization_dispute_stages(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, organization_id uuid not null,
    stage_name text not null, stage_date date not null, created_at timestamptz not null default now());
  create table public.app_business_records(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, space_id uuid not null,
    day date not null, end_day date, body text not null, source_kind text not null default 'user', source_id uuid);
  create table public.app_project_workstreams(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
    title text, phase text, sort_order integer default 0);
  create table public.app_project_progress_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
    workstream_id uuid, effective_on date, status_label text, summary text, next_step text);
  create table public.app_project_milestones(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
    title text, start_at timestamptz);
  create table public.app_record_links(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid,
    google_task_id text, task_completed boolean, status text default 'confirmed');
  create table public.app_documents(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid, title text, extracted_text text);
  create table public.app_call_probe(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, title text, raw_text text);
  create table public.app_tg_probe(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, one_line text);
  create table public.app_feed_items(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, title text, raw_text text);
  ${owned.map(t=>`
  grant select on public.${t} to authenticated;
  alter table public.${t} enable row level security;
  create policy synthetic_owner on public.${t} for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`).join('')}
  create table public.rtw_probe(id uuid primary key default gen_random_uuid(), user_id uuid, body text);
  alter table public.rtw_probe enable row level security;
  grant select on public.rtw_probe to authenticated;
  create policy synthetic_self on public.rtw_probe for all to authenticated using (user_id = (select auth.uid()));
  create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    kind text not null default 'note', title text, raw_text text not null default '', archived_at timestamptz, deleted_at timestamptz,
    ai_export_allowed boolean not null default true, metadata jsonb not null default '{}'::jsonb,
    occurred_at timestamptz not null default now(), updated_at timestamptz not null default now());
  alter table public.app_notes enable row level security;
  grant select, insert, update, delete on public.app_notes to authenticated;
  create policy notes_owner_all on public.app_notes for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create table public.app_profiles(user_id uuid primary key, view_prefs jsonb not null default '{}'::jsonb, ledger_calendar jsonb not null default '{}'::jsonb);
  alter table public.app_profiles enable row level security;
  grant select, update on public.app_profiles to authenticated;
  create policy task12a_owner_all on public.app_profiles for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets(id text primary key, name text);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.buckets enable row level security;
  alter table storage.objects enable row level security;
  grant select on storage.buckets, storage.objects to authenticated;
  create policy synthetic_read on storage.buckets for select to authenticated using (true);
  create policy synthetic_owner on storage.objects for select to authenticated using (owner = (select auth.uid()));`;

test('mcp claude read db: plan, dry-run, apply, gate refusals and limits, fixed columns, excluded data, L1 pre-request, L2 storage, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'mcp-claude-read-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  try{await pool.query('create extension if not exists pgcrypto with schema extensions');}catch{await pool.query(fakeCrypto);}
  await pool.query('grant usage on schema extensions to anon, authenticated, service_role');
  // 앞 단계 표·함수는 저장소 migration 원문 그대로(운영에 적용된 대로).
  for(const f of ['20261021082000_ledger_schema','20261028170000_note_folders','20261119200000_feature_pin_lock','20261119233000_note_folder_lock'])
   await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const [guardPre,guardApply,guardRollback]=await Promise.all(['precheck','apply','rollback'].map(k=>read('docs/ops/mcp-claude-read-guard.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  // claims: 요청마다 PostgREST가 넣는 값 흉내(request.jwt.claims·request.path·request.method).
  async function as(role,claims,sql,params=[],req={}){const c=await pool.connect();try{await c.query('begin');
   await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true), set_config('request.path',$3,true), set_config('request.method',$4,true)",
    [claims?.sub||'',claims?JSON.stringify(claims):'',req.path||'',req.method||'POST']);
   await c.query('set local role '+role);const r=await c.query(sql,params);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const delegated=(sub=OWNER,extra={})=>({sub,role:'authenticated',client_id:CLIENT,session_id:sub===STRANGER?SESSION_B:SESSION_NEW,...extra});
  const normal=(sub=OWNER)=>({sub,role:'authenticated',session_id:SESSION_NEW});
  const rpc=(claims,fn,args=[])=>as('authenticated',claims,`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as r`,args).then(r=>r[0].r);
  const refuse=async(p,msg)=>{await assert.rejects(p,e=>{assert.equal(e.message,msg);return true;});};
  const logCount=async(ws=WS_A)=>(await pool.query('select count(*)::int n from public.app_mcp_read_log where workspace_id=$1',[ws])).rows[0].n;
  const clearLog=()=>pool.query('delete from public.app_mcp_read_log');
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const readFns=['app_mcp_org_status(text)','app_mcp_business_reports(date,date,text)','app_mcp_project_status(text)','app_mcp_ledger_search(text,text,text,date,date,integer)',
   'app_mcp_ledger_get(text)','app_mcp_notes_search(text,text,integer)','app_mcp_google_where()'];
  const helpers=['app_mcp_gate(text)','app_mcp_gate_done(text,integer,integer)','app_mcp_note_locks()','app_mcp_clip(text,integer)','app_mcp_arg(text,integer)'];

  await t.test('files: expanded rules, 12 functions, authenticated-only grants, summary 3 lines, read-only checks',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const plan=prepareMigration({mode,version,runId:'1',root});assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');assert.equal(plan.functions.length,12);}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   for(const g of [...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' ')))assert.match(g,/ to authenticated;$/,g);
   assert.doesNotMatch(code,/\bto (anon|public|service_role)\b|alter role|db_pre_request|storage\./i);
  });

  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   assert.equal(beforeCheck.find(r=>r.item==='realtime publication public tables').value,'0');
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   const post=await readOnly(postcheck);
   for(const r of post)if(r.item!=='existing boundary hash')assert.equal(r.ok,'예',r.item);
   assert.equal(post.find(r=>r.item==='existing boundary hash').ok,beforeCheck.find(r=>r.item==='existing boundary hash').value);
   assert.equal((await run('apply','9973')).ok,false);
  });

  // 합성 자료(지어낸 이름). 남의 작업공간(WS_B)에도 같은 검색어를 넣어 섞이지 않는지 본다.
  await pool.query(`
   insert into auth.sessions(id,user_id,created_at) values ('${SESSION_OLD}','${OWNER}',now()-interval '2 days'),('${SESSION_NEW}','${OWNER}',now()-interval '1 hour'),('${SESSION_B}','${STRANGER}',now()-interval '1 hour');
   update public.app_suborganizations set name='가상 가지부',recent_month_summary=repeat('요',400),year_summary='연 요약 비밀',memo='메모 비밀',aliases=array['가지'] where id='${ORG_A}';
   update public.app_suborganizations set name='남의 지부',recent_month_summary='남의 요약' where id='${ORG_B}';
   insert into public.app_suborganizations(id,workspace_id,name,active,recent_month_summary) values ('${ORG_A2}','${WS_A}','가상 나지부',true,'나 요약'),('${ORG_A3}','${WS_A}','가상 쉬는지부',false,'쉬는 요약');
   insert into public.app_suborganization_assignees values ('${ORG_A}','${OWNER}','${WS_A}');
   insert into public.app_suborganization_dispute_stages(workspace_id,organization_id,stage_name,stage_date) values ('${WS_A}','${ORG_A}','조정','2026-10-01'),('${WS_A}','${ORG_A}','쟁의','2026-11-01');
   insert into public.app_suborganization_updates(workspace_id,organization_id,raw_text,occurred_at) values
    ('${WS_A}','${ORG_A}','최근 기록 '||repeat('가',400),now()-interval '1 day'),('${WS_A}','${ORG_A}','오래된 기록',now()-interval '40 days'),('${WS_B}','${ORG_B}','남의 기록',now());
   update public.app_spaces set name='가상 사업 갑',status='active' where id='${PROJECT_A}';
   update public.app_spaces set name='가상 사업 을',status='active',parent_id='${PROJECT_A}',metadata='{}' where id='${PROJECT_A2}';
   update public.app_spaces set name='남의 사업',status='active' where id='${PROJECT_B}';
   insert into public.app_spaces(id,workspace_id,name,status,metadata) values ('${PROJECT_ARCH}','${WS_A}','가상 끝난 사업','archived','{"project_system":"v2"}'),
    ('${PROJECT_OLD}','${WS_A}','가상 옛 체계','active','{}'),('${PROJECT_TRASH}','${WS_A}','가상 버린 사업','active','{"project_system":"v2"}');
   update public.app_spaces set deleted_at=now() where id='${PROJECT_TRASH}';
   insert into public.app_project_workstreams(workspace_id,project_id,title,phase) values ('${WS_A}','${PROJECT_A}','갈래 하나','진행');
   insert into public.app_project_progress_updates(workspace_id,project_id,effective_on,status_label,summary,next_step) values ('${WS_A}','${PROJECT_A}',current_date,'순조','진행 요약','다음 할 일');
   insert into public.app_project_milestones(workspace_id,project_id,title,start_at) values ('${WS_A}','${PROJECT_A}','다가올 일',now()+interval '3 days'),('${WS_A}','${PROJECT_A}','지난 일',now()-interval '3 days');
   insert into public.app_record_links(workspace_id,project_id,google_task_id,task_completed,status) values ('${WS_A}','${PROJECT_A}','t1',false,'confirmed'),('${WS_A}','${PROJECT_A}','t2',true,'confirmed'),('${WS_A}','${PROJECT_A}','t3',false,'suggested');
   insert into public.app_documents(workspace_id,project_id,title,extracted_text) values ('${WS_A}','${PROJECT_A}','자료 제목 비밀','자료 원문 비밀'),('${WS_A}','${PROJECT_A}','둘째 자료','x');
   insert into public.app_business_records(workspace_id,space_id,day,body) values ('${WS_A}','${PROJECT_A}',current_date-1,'사업 보고 하나'),('${WS_A}','${PROJECT_A2}',current_date-5,'사업 보고 둘'),
    ('${WS_A}','${PROJECT_A}',current_date-60,'오래된 보고'),('${WS_A}','${PROJECT_TRASH}',current_date-1,'버린 사업 보고'),('${WS_B}','${PROJECT_B}',current_date-1,'남의 보고');
   insert into public.app_note_folders(id,workspace_id,parent_id,name,sort_order) values ('${F_LOCK}','${WS_A}',null,'잠긴 폴더',1),('${F_LOCK_CHILD}','${WS_A}','${F_LOCK}','잠긴 안 폴더',1),('${F_OPEN}','${WS_A}',null,'열린 폴더',2);
   insert into public.app_note_folder_locks(user_id,folder_id) values ('${OWNER}','${F_LOCK}');
   insert into public.app_notes(workspace_id,kind,title,raw_text,metadata,ai_export_allowed,deleted_at) values
    ('${WS_A}','note','보이는 노트','${WORD} '||repeat('나',300),'{"folder_id":"${F_OPEN}","folder":"열린 폴더"}',true,null),
    ('${WS_A}','note','폴더 없는 노트','${WORD} 둘','{}',true,null),
    ('${WS_A}','note','잠긴 노트','${WORD} 잠김','{"folder_id":"${F_LOCK}"}',true,null),
    ('${WS_A}','note','잠긴 안 노트','${WORD} 잠김 안','{"folder_id":"${F_LOCK_CHILD}"}',true,null),
    ('${WS_A}','note','이름만 잠긴 옛 노트','${WORD} 옛','{"folder":"잠긴 폴더"}',true,null),
    ('${WS_A}','note','AI 금지 노트','${WORD} 금지','{}',false,null),
    ('${WS_A}','note','휴지통 노트','${WORD} 휴지통','{}',true,now()),
    ('${WS_A}','diary',null,'${WORD} 일기 비밀','{}',false,null),
    ('${WS_A}','basket',null,'${WORD} 정리함 비밀','{}',true,null),
    ('${WS_A}','work',null,'${WORD} 업무일지 비밀','{}',true,null),
    ('${WS_B}','note','남의 노트','${WORD} 남','{}',true,null);
   insert into public.app_call_probe(workspace_id,title,raw_text) values ('${WS_A}','${WORD}','통화 비밀');
   insert into public.app_tg_probe(workspace_id,one_line) values ('${WS_A}','${WORD} 텔레그램 비밀');
   insert into public.app_feed_items(workspace_id,title,raw_text) values ('${WS_A}','${WORD}','바깥 비밀');
   insert into public.rtw_probe(user_id,body) values ('${OWNER}','${WORD} 다른 제품 비밀');
   insert into public.app_profiles(user_id,view_prefs,ledger_calendar) values ('${OWNER}','{"report_calendar":"가상 보고 캘린더"}','{"calendar":"secret-calendar-id@group.example"}');
   insert into storage.buckets values ('b1','가상 버킷');
   insert into storage.objects(bucket_id,name,owner) values ('b1','가상 파일','${OWNER}');
   set session_replication_role = replica;
   insert into public.app_ledger_topics(id,workspace_id,ledger_id,name) values ('50000000-0000-4000-8000-000000000001','${WS_A}','TOP-0001','가상 주제');
   insert into public.app_ledger_organizations(id,workspace_id,ledger_id,name,suborganization_id) values ('51000000-0000-4000-8000-000000000001','${WS_A}','ORG-0001','가상 가지부','${ORG_A}');
   insert into public.app_ledger_sources(id,workspace_id,ledger_id,title,doc_type,sensitivity,location,drive_file_id) values
    ('52000000-0000-4000-8000-000000000001','${WS_A}','SRC-0001','가상 회의자료','meeting_material','S1','비밀 위치','driveidsecret01'),
    ('52000000-0000-4000-8000-000000000002','${WS_A}','SRC-0002','가상 통화 전사','call_transcript','S2','','driveidsecret02');
   insert into public.app_ledger_records(id,workspace_id,kind,ledger_id,title,summary,sensitivity,scope,date_start,date_precision,topic_id,note,counterparty,commitment_status) values
    ('53000000-0000-4000-8000-000000000001','${WS_A}','change','CHG-0001','${WORD} 보통 기록','보통 요지 '||repeat('다',400),'S1','work','2026-11-01','day','50000000-0000-4000-8000-000000000001','메모 비밀',null,null),
    ('53000000-0000-4000-8000-000000000002','${WS_A}','commitment','COM-0002','${WORD} 민감 기록','민감 요지 비밀','S2','work','2026-11-02','day',null,'민감 메모 비밀','상대측 비밀','waiting'),
    ('53000000-0000-4000-8000-000000000003','${WS_A}','change','CHG-0003','${WORD} 관심 기록','관심 요지','S0','interest','2026-11-03','day',null,'',null,null),
    ('53000000-0000-4000-8000-000000000004','${WS_B}','change','CHG-0001','${WORD} 남의 원장','남의 요지','S0','work','2026-11-03','day',null,'',null,null);
   insert into public.app_ledger_record_sources(workspace_id,record_id,source_id,locator) values
    ('${WS_A}','53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','쪽 비밀'),('${WS_A}','53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000002','');
   insert into public.app_ledger_links(workspace_id,record_id,target_organization_id,relation) values ('${WS_A}','53000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','direct');
   insert into public.app_ledger_links(workspace_id,record_id,target_record_id,relation) values ('${WS_A}','53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002','related');
   set session_replication_role = origin;`);

  await t.test('closed: anon and service_role run nothing; tables give no API role extra rights; settings only screen columns',async()=>{
   for(const fn of [...readFns.map(f=>'public.'+f),...helpers.map(f=>'private.'+f)]){
    const [{anon,svc,auth,pub}]=(await pool.query(`select has_function_privilege('anon','${fn}','execute') anon,has_function_privilege('service_role','${fn}','execute') svc,has_function_privilege('authenticated','${fn}','execute') auth,
      exists(select 1 from pg_proc p, aclexplode(p.proacl) x where p.oid='${fn}'::regprocedure and x.grantee=0) pub`)).rows;
    assert.deepEqual([anon,svc,auth,pub],[false,false,true,false],fn);
   }
   for(const tb of ['app_mcp_settings','app_mcp_read_log']){
    await assert.rejects(as('anon',null,`select count(*) from public.${tb}`),/permission denied/);
    await assert.rejects(as('authenticated',normal(),`insert into public.${tb}(workspace_id) values ('${WS_A}')`),/permission denied/);
    await assert.rejects(as('authenticated',normal(),`delete from public.${tb} where true`),/permission denied/);
   }
   await assert.rejects(as('anon',null,"select public.app_mcp_google_where()"),/permission denied/);
   await assert.rejects(as('authenticated',normal(),"update public.app_mcp_settings set allowed_client_id='x' where true"),/permission denied/);
   await assert.rejects(as('authenticated',normal(),"update public.app_mcp_read_log set status='ok' where true"),/permission denied/);
  });

  await t.test('gate refuses: no client_id, no settings row, other client, switch off; refusals write no log row',async()=>{
   await refuse(rpc(normal(),'app_mcp_google_where'),'NOT_ALLOWED');
   await refuse(rpc(delegated(),'app_mcp_google_where'),'NOT_ALLOWED'); // 설정 행 없음(migration은 행을 넣지 않는다)
   await refuse(rpc({role:'authenticated',client_id:CLIENT},'app_mcp_google_where'),'NOT_ALLOWED'); // 로그인 없음
   await pool.query(`insert into public.app_mcp_settings(workspace_id,enabled,allowed_client_id) values ('${WS_A}',false,'${CLIENT}')`);
   await refuse(rpc(normal(),'app_mcp_google_where'),'NOT_ALLOWED');
   await refuse(rpc(delegated(OWNER,{client_id:OTHER_CLIENT}),'app_mcp_google_where'),'NOT_ALLOWED');
   await refuse(rpc(delegated(),'app_mcp_google_where'),'DISCONNECTED');
   assert.equal(await logCount(),0);
   // 스위치는 화면(일반 로그인)만 켠다. 위임 열쇠로는 0줄(정책), 남의 행도 0줄.
   assert.equal((await as('authenticated',delegated(),"update public.app_mcp_settings set enabled=true where true returning 1")).length,0);
   assert.equal((await as('authenticated',normal(STRANGER),"update public.app_mcp_settings set enabled=true where true returning 1")).length,0);
   assert.equal((await as('authenticated',normal(),"update public.app_mcp_settings set enabled=true, updated_at=now() where true returning 1")).length,1);
   const r=await rpc(delegated(),'app_mcp_google_where');
   assert.deepEqual(r.records[0].calendars,['가상 보고 캘린더']);
   assert.doesNotMatch(JSON.stringify(r),/secret-calendar-id/);
   const log=(await pool.query('select tool,status,result_count,withheld_count from public.app_mcp_read_log')).rows;
   assert.deepEqual(log,[{tool:'google_where',status:'ok',result_count:1,withheld_count:0}]);
   // 작업공간 owner가 아닌 사람(설정 행 없음)과 남의 작업공간 설정은 서로 섞이지 않는다.
   await refuse(rpc(delegated(STRANGER),'app_mcp_google_where'),'NOT_ALLOWED');
   // 기록은 owner만 읽는다.
   assert.equal((await as('authenticated',normal(STRANGER),'select count(*)::int n from public.app_mcp_read_log'))[0].n,0);
   assert.equal((await as('authenticated',normal(),'select count(*)::int n from public.app_mcp_read_log'))[0].n,1);
  });

  await t.test('disconnect all: sessions made before revoked_before are refused at once, a new session works',async()=>{
   await pool.query(`update public.app_mcp_settings set revoked_before=now()-interval '1 day' where workspace_id='${WS_A}'`);
   await refuse(rpc(delegated(OWNER,{session_id:SESSION_OLD}),'app_mcp_google_where'),'DISCONNECTED');
   await refuse(rpc(delegated(OWNER,{session_id:undefined}),'app_mcp_google_where'),'DISCONNECTED');
   await refuse(rpc(delegated(OWNER,{session_id:'40000000-0000-4000-8000-0000000000ff'}),'app_mcp_google_where'),'DISCONNECTED');
   await refuse(rpc(delegated(STRANGER,{sub:OWNER,session_id:SESSION_B}),'app_mcp_google_where'),'DISCONNECTED'); // 남의 세션 번호
   assert.equal((await rpc(delegated(),'app_mcp_google_where')).records.length,1);
   await pool.query(`update public.app_mcp_settings set revoked_before=now() where workspace_id='${WS_A}'`);
   await refuse(rpc(delegated(),'app_mcp_google_where'),'DISCONNECTED');
   await pool.query(`update public.app_mcp_settings set revoked_before=null where workspace_id='${WS_A}'`);
   await clearLog();
  });

  await t.test('limits: the 21st call within a minute and the 301st call of the KST day are refused',async()=>{
   for(let i=0;i<20;i++)await rpc(delegated(),'app_mcp_google_where');
   await refuse(rpc(delegated(),'app_mcp_google_where'),'RATE_LIMITED');
   assert.equal(await logCount(),20);
   await clearLog();
   await pool.query(`insert into public.app_mcp_read_log(workspace_id,tool,status,called_at)
     select '${WS_A}','ledger_search','ok',((now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul' from generate_series(1,299)`);
   const first=await rpc(delegated(),'app_mcp_google_where').then(()=>'ok',e=>e.message);
   // 오늘 0시(KST) 바로 뒤 1분 안에 돌면 같은 줄이 분당 상한에도 걸린다 — 어느 쪽이든 거절 문구는 RATE_LIMITED.
   if(first==='ok')await refuse(rpc(delegated(),'app_mcp_google_where'),'RATE_LIMITED');else assert.equal(first,'RATE_LIMITED');
   // 다른 작업공간의 기록은 내 상한에 셈하지 않는다.
   await pool.query(`insert into public.app_mcp_settings(workspace_id,enabled,allowed_client_id) values ('${WS_B}',true,'${CLIENT}')`);
   assert.equal((await rpc(delegated(STRANGER),'app_mcp_google_where')).records.length,1);
   await clearLog();
  });

  await t.test('org status: my assigned orgs; one org adds 28-day updates clipped to 300; no history, memo, year summary or other workspace',async()=>{
   await clearLog(); // 상한(1분 20번)은 앞 시험과 따로 센다
   const list=await rpc(delegated(),'app_mcp_org_status',[null]);
   assert.deepEqual(list.records.map(r=>r.name),['가상 가지부']);
   assert.equal(list.records[0].summary.length,300);
   assert.deepEqual(list.records[0].dispute_stage,{name:'쟁의',date:'2026-11-01'});
   const one=await rpc(delegated(),'app_mcp_org_status',['가지']);
   assert.deepEqual(one.records.map(r=>r.type),['organization','org_update']);
   assert.equal(one.records[1].text.length,300);
   const text=JSON.stringify([list,one]);
   assert.doesNotMatch(text,/연 요약 비밀|메모 비밀|오래된 기록|남의/);
   assert.deepEqual((await rpc(delegated(),'app_mcp_org_status',['남의 지부'])).records,[]);
   assert.deepEqual((await rpc(delegated(),'app_mcp_org_status',[ORG_B])).records,[]);
   assert.deepEqual((await rpc(delegated(),'app_mcp_org_status',['지부'])).records.map(r=>r.name),['가상 가지부','가상 나지부','가상 쉬는지부']);
   await refuse(rpc(delegated(),'app_mcp_org_status',['가'.repeat(51)]),'BAD_INPUT');
  });

  await t.test('business reports: 30 days by default, 90-day cap, project filter, trash and other workspace out',async()=>{
   await clearLog(); // 상한(1분 20번)은 앞 시험과 따로 센다
   const r=await rpc(delegated(),'app_mcp_business_reports',[null,null,null]);
   assert.deepEqual(r.records.map(x=>x.text).sort(),['사업 보고 둘','사업 보고 하나']);
   assert.deepEqual((await rpc(delegated(),'app_mcp_business_reports',[null,null,'가상 사업 을'])).records.map(x=>x.text),['사업 보고 둘']);
   await refuse(rpc(delegated(),'app_mcp_business_reports',['2026-01-01','2026-06-01',null]),'BAD_INPUT');
   await refuse(rpc(delegated(),'app_mcp_business_reports',['2026-06-02','2026-06-01',null]),'BAD_INPUT');
   assert.doesNotMatch(JSON.stringify(r),/버린|남의|오래된/);
  });

  await t.test('project status: active v2 list; one project shows streams, progress, upcoming milestones and counts only; archived is one line',async()=>{
   await clearLog(); // 상한(1분 20번)은 앞 시험과 따로 센다
   const list=await rpc(delegated(),'app_mcp_project_status',[null]);
   assert.deepEqual(list.records.map(x=>x.name),['가상 사업 갑','가상 사업 을']);
   const one=await rpc(delegated(),'app_mcp_project_status',['가상 사업 갑']);
   assert.deepEqual(one.records.map(x=>x.type),['project','workstream','progress','milestone']);
   assert.equal(one.records[0].open_task_count,1);assert.equal(one.records[0].document_count,2);
   assert.equal(one.records[3].title,'다가올 일');
   assert.doesNotMatch(JSON.stringify(one),/자료 제목 비밀|자료 원문 비밀|지난 일/);
   const arch=await rpc(delegated(),'app_mcp_project_status',['가상 끝난 사업']);
   assert.deepEqual(arch.records.map(x=>[x.type,x.status,x.open_task_count]),[['project','archived',null]]);
   for(const q of ['가상 옛 체계','가상 버린 사업','남의 사업',PROJECT_B])assert.deepEqual((await rpc(delegated(),'app_mcp_project_status',[q])).records,[],q);
  });

  await t.test('ledger: search fixes S2 to title only and work scope; get shows S0-S1 sources only, no location, drive id, memo or counterparty',async()=>{
   await clearLog(); // 상한(1분 20번)은 앞 시험과 따로 센다
   const s=await rpc(delegated(),'app_mcp_ledger_search',[WORD,null,null,null,null,20]);
   assert.deepEqual(s.records.map(x=>x.ledger_id).sort(),['CHG-0001','COM-0002']);
   const s2=s.records.find(x=>x.ledger_id==='COM-0002');
   assert.deepEqual(Object.keys(s2).sort(),['date','kind','ledger_id','sensitivity','title','type','validity']);
   assert.equal(s.withheld.s2_summaries,1);
   assert.equal(s.records.find(x=>x.ledger_id==='CHG-0001').summary.length,300);
   assert.deepEqual((await rpc(delegated(),'app_mcp_ledger_search',[WORD,'가상 가지부',null,null,null,20])).records.map(x=>x.ledger_id),['CHG-0001']);
   assert.deepEqual((await rpc(delegated(),'app_mcp_ledger_search',[WORD,'없는 조직',null,null,null,20])).records,[]);
   assert.deepEqual((await rpc(delegated(),'app_mcp_ledger_search',[WORD,null,'TOP-0001',null,null,20])).records.map(x=>x.ledger_id),['CHG-0001']);
   await refuse(rpc(delegated(),'app_mcp_ledger_search',[WORD,null,null,null,null,51]),'BAD_INPUT');
   const g=await rpc(delegated(),'app_mcp_ledger_get',['CHG-0001']);
   assert.deepEqual(g.records[0].sources.map(x=>x.ledger_id),['SRC-0001']);
   assert.deepEqual(g.records[0].organizations,['가상 가지부']);
   assert.deepEqual(g.records[0].links.map(x=>[x.ledger_id,x.direction]),[['COM-0002','to']]);
   assert.equal(g.withheld.s2_sources,1);
   const g2=await rpc(delegated(),'app_mcp_ledger_get',['COM-0002']);
   assert.deepEqual(Object.keys(g2.records[0]).sort(),['date','kind','ledger_id','sensitivity','title','type','validity']);
   assert.deepEqual((await rpc(delegated(),'app_mcp_ledger_get',['CHG-0003'])).records,[]); // 관심 범위
   assert.deepEqual((await rpc(delegated(),'app_mcp_ledger_get',['CHG-0009'])).records,[]);
   await refuse(rpc(delegated(),'app_mcp_ledger_get',["CHG-1' or 1=1"]),'BAD_INPUT');
   assert.doesNotMatch(JSON.stringify([s,g,g2]),/민감 요지|메모 비밀|상대측|비밀 위치|driveidsecret|쪽 비밀|남의|관심 기록/);
  });

  await t.test('notes: kind note only, 200-char text; diary, basket, work journal, AI-off, locked folders, trash and other workspace never appear',async()=>{
   await clearLog(); // 상한(1분 20번)은 앞 시험과 따로 센다
   const r=await rpc(delegated(),'app_mcp_notes_search',[WORD,null,20]);
   assert.deepEqual(r.records.map(x=>x.title).sort(),['보이는 노트','폴더 없는 노트']);
   const seen=r.records.find(x=>x.title==='보이는 노트');
   assert.equal(seen.folder,'열린 폴더');assert.equal(seen.text.length,200);
   assert.doesNotMatch(JSON.stringify(r),/잠긴|이름만|금지|휴지통|일기|정리함|업무일지|남의|비밀/);
   assert.deepEqual((await rpc(delegated(),'app_mcp_notes_search',[WORD,'열린 폴더',20])).records.map(x=>x.title),['보이는 노트']);
   assert.deepEqual((await rpc(delegated(),'app_mcp_notes_search',[WORD,'잠긴 폴더',20])).records,[]);
   assert.equal((await rpc(delegated(),'app_mcp_notes_search',[WORD,null,1])).truncated,true);
   // 잠금을 풀면 그 폴더 노트가 다시 보인다(잠금 목록을 매번 서버에서 읽음).
   await pool.query('delete from public.app_note_folder_locks');
   assert.equal((await rpc(delegated(),'app_mcp_notes_search',[WORD,null,20])).records.length,5);
   await pool.query(`insert into public.app_note_folder_locks(user_id,folder_id) values ('${OWNER}','${F_LOCK}')`);
   // 통화·텔레그램·바깥 수집·다른 제품 자료는 어떤 읽기 함수 결과에도 없다.
   const all=[];
   for(const [fn,args] of [['app_mcp_org_status',[null]],['app_mcp_business_reports',[null,null,null]],['app_mcp_project_status',[null]],
     ['app_mcp_ledger_search',[WORD,null,null,null,null,50]],['app_mcp_notes_search',[WORD,null,50]],['app_mcp_google_where',[]]])all.push(await rpc(delegated(),fn,args));
   assert.doesNotMatch(JSON.stringify(all),/통화 비밀|텔레그램 비밀|바깥 비밀|다른 제품 비밀|일기 비밀|정리함 비밀|업무일지 비밀/);
   await clearLog();
  });

  await t.test('static: read functions name no excluded table and take no workspace or user id',()=>{
   const code=migration.replace(/--.*$/gm,'');
   const fam='app_'+'family';
   assert.doesNotMatch(code,new RegExp(`app_call_|app_tg_|app_feed_|app_outside_|app_meeting|transcript_text|${fam}|rtw_|app_ai_|app_documents\\.title|extracted_text|year_summary|memo\\b|decision_reason|counterparty|location|drive_file_id|locator`,'i'));
   assert.equal((code.match(/from public\.app_notes\b/g)||[]).length,1);
   assert.match(code,/n\.kind = 'note' and n\.deleted_at is null and n\.ai_export_allowed is true/);
   for(const m of code.matchAll(/create function (public|private)\.app_mcp_\w+\(([^)]*)\)/g))assert.doesNotMatch(m[2],/workspace|user/i,m[0]);
   for(const fn of readFns){const at=code.indexOf('create function public.'+fn.split('(')[0]+'(');const body=code.slice(at,code.indexOf('\n$$;',at));
    assert.match(body,/security invoker\s+set search_path = ''/,fn);assert.match(body,/v_ws := private\.app_mcp_gate\('[a-z_0-9]+'\);/,fn);assert.match(body,/perform private\.app_mcp_gate_done\(/,fn);}
  });

  await t.test('L1 pre-request and L2 storage (SQL Editor file): delegated tokens reach only the seven read RPCs; normal tokens unchanged',async()=>{
   const [pre]=(await pool.query(guardPre)).rows;
   for(const [k,v] of Object.entries(pre))if(k.startsWith('ok_'))assert.equal(v,true,k);
   assert.equal(pre.switch_roles,'anon,authenticated,service_role');
   await pool.query(guardApply);
   assert.match((await pool.query("select array_to_string(setconfig,',') s from pg_db_role_setting s join pg_roles r on r.oid=s.setrole where r.rolname='authenticator'")).rows[0].s,/pgrst\.db_pre_request=public\.app_mcp_pre_request/);
   assert.equal((await pool.query(guardPre)).rows[0].ok_pre_request_unset,false);
   const preq=(role,claims,path,method='POST')=>as(role,claims,'select public.app_mcp_pre_request()',[],{path,method});
   for(const path of ['/app_notes','/rtw_probe','/app_feed_items','/rpc/app_search_records','/rpc/app_mcp_pre_request','/rpc/app_mcp_org_status_x','/rpc/graphql','/','/rpc/app_lock_note_folders'])
    await refuse(preq('authenticated',delegated(),path),'NOT_ALLOWED');
   await refuse(preq('authenticated',delegated(),'/rpc/app_mcp_notes_search','GET'),'NOT_ALLOWED');
   for(const tool of ['org_status','business_reports','project_status','ledger_search','ledger_get','notes_search','google_where'])
    await preq('authenticated',delegated(),'/rpc/app_mcp_'+tool);
   for(const path of ['/app_notes','/rtw_probe','/rpc/app_search_records','/']){
    await preq('authenticated',normal(),path,'GET');
    await preq('anon',{role:'anon'},path,'GET');
    await preq('anon',null,path,'GET');
    await preq('service_role',{role:'service_role'},path,'PATCH');
   }
   // L2: 위임 열쇠는 Storage 파일·버킷 0개, 일반 로그인은 그대로.
   assert.equal((await as('authenticated',normal(),'select count(*)::int n from storage.objects'))[0].n,1);
   assert.equal((await as('authenticated',normal(),'select count(*)::int n from storage.buckets'))[0].n,1);
   assert.equal((await as('authenticated',delegated(),'select count(*)::int n from storage.objects'))[0].n,0);
   assert.equal((await as('authenticated',delegated(),'select count(*)::int n from storage.buckets'))[0].n,0);
   // 본 파일 되돌리기는 요청 전 함수가 걸려 있으면 멈춘다.
   await assert.rejects(pool.query(rollbackSQL),/undo docs\/ops\/mcp-claude-read-guard first/);await pool.query('rollback');
   await pool.query(guardRollback);
   const [after]=(await pool.query(guardPre)).rows;
   for(const k of ['ok_pre_request_unset','ok_function_absent','ok_policies_absent'])assert.equal(after[k],true,k);
   // 되돌린 뒤에는 제한 정책이 없어 합성 owner 정책만 남는다(위임 열쇠도 같은 사람이라 1개).
   assert.equal((await as('authenticated',delegated(),'select count(*)::int n from storage.objects'))[0].n,1);
  });

  await t.test('rollback: blocked while settings or log rows exist; then restores the catalog snapshot',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/settings or log rows exist/);await pool.query('rollback');
   await pool.query('delete from public.app_mcp_read_log; delete from public.app_mcp_settings');
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const again=await readOnly(precheck);
   assert.deepEqual(again,beforeCheck);
  });
 }finally{
  await closePool(pool);
  await cluster.stop();
 }
});
