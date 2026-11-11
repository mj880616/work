import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// REC-한회의로잇기 PR-1(DB만, 설계 docs/design/rec-join.md 3-2절): 잇기 작업 표 1개 + 서버 전용 함수 2개.
// 정적 검사만 한다. 실제 PostgreSQL 동작은 tests/auth-handoff/meeting-join-jobs-db.test.mjs가 본다.
const version='20261111142100',name='meeting_join_jobs',stem=`${version}_${name}`;
const code=readFileSync(`supabase/migrations/${stem}.sql`,'utf8').replace(/--.*$/gm,'');
const T='public\\.app_meeting_join_jobs';
const body=tag=>code.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`))[1];
// SET 목록에서 칸 이름만 뽑는다(괄호 안·case 식의 쉼표는 세지 않는다).
const setColumns=list=>{let s=list.replace(/case[\s\S]*?end/g,'x'),p;do{p=s;s=s.replace(/\([^()]*\)/g,'');}while(s!==p);return s.split(',').map(c=>c.trim().split(/\s*=/)[0]);};
const FIXED=['JOIN_REPORT_CHANGED','JOIN_REPORT_GONE','JOIN_SOURCE_CHANGED','JOIN_SOURCE_GONE','JOIN_ALREADY_JOINED','JOIN_NOT_APPLIED'];

test('migration: one new table, owner read RLS, no anon/PUBLIC, nothing added to existing tables, expanded rules',()=>{
 assert.doesNotMatch(code,/\bto\s+(?:anon|public)\b|disable row level|alter policy|drop policy|create trigger|rtw_|grant delete|grant all|cron\./i);
 // 기존 표에는 칸·제약·정책·권한을 더하지 않는다: ALTER TABLE은 새 표의 RLS 켜기 하나뿐, 정책도 새 표 하나뿐.
 assert.deepEqual(code.match(/alter table[^;]*;/g),['alter table public.app_meeting_join_jobs enable row level security;']);
 assert.equal((code.match(/create table/g)||[]).length,1);
 assert.equal((code.match(/create policy/g)||[]).length,1);
 assert.match(code,new RegExp(`create policy meeting_join_jobs_owner_read on ${T} for select to authenticated\\s+using \\(private\\.app_is_workspace_owner\\(workspace_id\\)\\);`));
 assert.match(code,new RegExp(`revoke all on table ${T} from public, anon, authenticated, service_role;`));
 assert.match(code,new RegExp(`grant select on table ${T} to authenticated;`));
 assert.doesNotMatch(code,/grant (?:insert|update|execute)[^;]*to authenticated/i);
 // 권한은 새 표와 새 함수 둘에만 준다. 함수 실행권은 service_role뿐.
 const grants=code.match(/grant [^;]*;/g);
 assert.equal(grants.length,6);
 for(const g of grants)assert.match(g,new RegExp(`on (?:table ${T} to (?:authenticated|service_role)|function public\\.app_meeting_join_(?:apply\\(uuid\\)|undo\\(uuid, text\\)) to service_role);$`));
 for(const mode of ['apply','dry-run']){
  const plan=prepareMigration({mode,version,runId:'1',root:process.cwd()});
  assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');assert.equal(plan.summaryLines.length,3);
  assert.deepEqual(plan.createdTables,['app_meeting_join_jobs']);
  assert.deepEqual(plan.targets,[],'no existing table is altered or rewritten by the migration itself');
  assert.deepEqual(plan.review.definer,['public.app_meeting_join_apply','public.app_meeting_join_undo']);
  assert.equal(plan.review.policies,1);assert.equal(plan.review.triggers,0);
 }
 assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261111142100', 'meeting_join_jobs'/);
});

test('table: columns, value checks, three one-at-a-time indexes, and no "one source must be set" check',()=>{
 const table=code.match(/create table public\.app_meeting_join_jobs \(([\s\S]*?)\n\);/)[1];
 const cols=[...table.matchAll(/^\s{2}([a-z_]+) (?:uuid\[\]|uuid|text|jsonb|integer|timestamptz)/gm)].map(m=>m[1]);
 assert.deepEqual(cols,['id','workspace_id','created_by','mode','target_meeting_id','source_job_id','source_meeting_id','source_text','source_record_jobs',
  'source_result_sha','source_notes_sha','before_result','before_notes','status','stage','step_no','step_total','summary_parts','transcript_text','draft',
  'result_text','error_code','lease_until','attempts','started_at','finished_at','applied_at','moved','kept_result','undone_at','seen_at','candidates_closed_at',
  'created_at','updated_at']);
 // 진행 칸 이름은 서버 정리 작업 표와 같다(Edge가 단계 돌리기를 함께 쓴다).
 const serverJobs=readFileSync('supabase/migrations/20261103170000_meeting_server_jobs.sql','utf8');
 for(const c of ['status','stage','step_no','step_total','summary_parts','transcript_text','draft','lease_until','attempts','error_code'])assert.match(serverJobs,new RegExp(`^\\s{2}${c} `,'m'),c);
 assert.match(table,/workspace_id uuid not null references public\.app_workspaces\(id\) on delete cascade/);
 assert.match(table,/target_meeting_id uuid not null references public\.app_meetings\(id\) on delete cascade/);
 assert.match(table,/source_job_id uuid references public\.app_meeting_server_jobs\(id\) on delete set null/);
 assert.match(table,/source_meeting_id uuid references public\.app_meetings\(id\) on delete set null/);
 assert.match(table,/mode in \('job', 'report', 'text'\)/);
 assert.match(table,/status in \('queued', 'running', 'done', 'failed', 'undone'\)/);
 assert.match(table,/stage in \('summary', 'apply', 'done'\)/);
 assert.match(table,/char_length\(transcript_text\) <= 1000000/);
 assert.match(table,/cardinality\(source_record_jobs\) <= 20/);
 assert.match(table,/error_code ~ '\^\[a-z_\]\{1,40\}\$'/);
 // 없어진 보고를 휴지통에서 영구 삭제하면 재료 칸이 빈다(set null). '재료 하나는 꼭'을 걸면 그 삭제가 막힌다.
 assert.doesNotMatch(table,/num_nonnulls|source_job_id is not null|source_meeting_id is not null|source_text is not null/);
 assert.match(code,/create unique index app_meeting_join_jobs_one_target_idx on public\.app_meeting_join_jobs\(target_meeting_id\)\s+where status in \('queued', 'running'\);/);
 assert.match(code,/create unique index app_meeting_join_jobs_one_source_job_idx on public\.app_meeting_join_jobs\(source_job_id\)\s+where status in \('queued', 'running', 'done'\);/);
 assert.match(code,/create unique index app_meeting_join_jobs_one_source_meeting_idx on public\.app_meeting_join_jobs\(source_meeting_id\)\s+where status in \('queued', 'running'\);/);
});

test('service_role: listed columns only; "before" text, source and apply/undo record columns are never updatable',()=>{
 const list=kind=>code.match(new RegExp(`grant ${kind} \\(([^)]*)\\)\\s+on table ${T} to service_role;`))[1].split(',').map(s=>s.trim());
 const insert=list('insert'),update=list('update');
 assert.deepEqual(insert,['workspace_id','created_by','mode','target_meeting_id','source_job_id','source_meeting_id','source_text','source_record_jobs',
  'source_result_sha','source_notes_sha','before_result','before_notes','status','stage','step_no','step_total','summary_parts','transcript_text']);
 assert.deepEqual(update,['status','stage','step_no','step_total','summary_parts','transcript_text','draft','result_text','error_code',
  'lease_until','attempts','started_at','finished_at','seen_at','candidates_closed_at','updated_at']);
 for(const c of ['applied_at','moved','kept_result','undone_at','id','created_at'])assert.ok(!insert.includes(c)&&!update.includes(c),c);
 for(const c of ['workspace_id','created_by','mode','target_meeting_id','source_job_id','source_meeting_id','source_text','source_record_jobs',
  'source_result_sha','source_notes_sha','before_result','before_notes'])assert.ok(!update.includes(c),c);
});

test('functions: definer with empty search_path, service_role only, ids in, fixed-word errors, every table schema-qualified',()=>{
 for(const [sig,tag] of [['public.app_meeting_join_apply(p_job uuid)','apply'],['public.app_meeting_join_undo(p_job uuid, p_scope text)','undo']]){
  const head=code.slice(code.indexOf(`create function ${sig}`),code.indexOf(`$${tag}$`));
  assert.match(head,/returns jsonb\s+language plpgsql\s+security definer\s+set search_path = ''\s+as $/,sig);
  const b=body(tag);
  // 예외는 고정 글자뿐(글 내용·id를 싣지 않는다).
  const raised=[...b.matchAll(/raise\s+([^;]*);/g)].map(m=>m[1]);
  assert.ok(raised.length>=5);
  for(const r of raised)assert.match(r,new RegExp(`^exception '(?:${FIXED.join('|')})'$`),r);
  assert.doesNotMatch(b,/\bexecute\b|\bformat\s*\(|set_config|auth\.uid|current_user|session_user|raise notice|raise log|raise warning/i);
  // 쓰는 표는 모두 public.을 붙여 부른다(search_path가 비어 있음). 손대는 표는 아래 일곱뿐이고, 스키마 없는 이름은 함수 안 임시 이름(moved_rows)뿐.
  const ALLOWED=['public.app_meeting_join_jobs','public.app_meetings','public.app_workspace_members','public.app_documents','public.app_record_links',
   'public.app_meeting_server_jobs','public.app_meeting_transcribe_jobs'];
  const relations=new Set([...b.matchAll(/\b(?:from|join|update|insert into)\s+(?:only\s+)?([a-z_]+(?:\.[a-z_]+)?)/g)].map(m=>m[1]));
  // 'is distinct from j.<지문 칸>'은 비교식이지 표가 아니다.
  for(const local of ['moved_rows','j.source_result_sha','j.source_notes_sha'])relations.delete(local);
  for(const t of relations)assert.ok(ALLOWED.includes(t),t);
  const tables=relations;
  assert.ok(tables.has('public.app_meetings')&&tables.has('public.app_workspace_members'));
  // 다시 확인: 만든 사람이 지금도 owner, 같은 작업공간, 휴지통 아님.
  assert.match(b,/from public\.app_workspace_members wm\s+where wm\.workspace_id = j\.workspace_id and wm\.user_id = j\.created_by and wm\.role = 'owner'/);
  assert.match(b,/where id = j\.target_meeting_id and workspace_id = j\.workspace_id for update;\s+if not found or m\.deleted_at is not null then\s+raise exception 'JOIN_REPORT_GONE';/);
  // 보고에서 고치는 칸은 두 글·고친 시각·휴지통 표시뿐(회의명·일시·참석인원·종류·연결은 건드리지 않는다).
  for(const u of b.matchAll(/update public\.app_meetings(?:\s+[a-z])?\s+set ([\s\S]*?)\s+where/g))
   for(const c of setColumns(u[1]))
    assert.ok(['transcript_text','notes','updated_at','deleted_at'].includes(c),c);
  // 다른 표에서 고치는 칸은 '어느 보고'(meeting_id)와 녹음 결과의 '열었음'뿐.
  for(const u of b.matchAll(/update public\.(app_documents|app_record_links|app_meeting_server_jobs|app_meeting_transcribe_jobs)(?:\s+[a-z])?\s+set ([\s\S]*?)\s+where/g))
   for(const c of setColumns(u[2]))
    assert.ok(c==='meeting_id'||(u[1]==='app_meeting_server_jobs'&&c==='opened_at'),`${u[1]}.${c}`);
  assert.doesNotMatch(b,/delete from public\.(?!app_documents\b)/,'only file rows made by apply are ever deleted');
 }
 for(const sig of ['public.app_meeting_join_apply(uuid)','public.app_meeting_join_undo(uuid, text)']){
  const at=code.indexOf(`revoke all on function ${sig} from public, anon, authenticated, service_role;`);
  assert.ok(at>0,sig);
  assert.ok(code.indexOf(`grant execute on function ${sig} to service_role;`)>at,'grant comes after the revoke');
 }
});

test('apply: compares the text itself, builds the file row from DB rows, trashes instead of deleting; undo keeps both originals',()=>{
 const a=body('apply'),u=body('undo');
 // 차례가 아니면 아무것도 안 한다(두 번 불러도 한 번만).
 assert.match(a,/if j\.status <> 'running' or j\.stage <> 'apply' or j\.applied_at is not null/);
 assert.match(a,/coalesce\(m\.transcript_text, ''\) <> coalesce\(j\.before_result, ''\)\s+or coalesce\(m\.notes, ''\) <> coalesce\(j\.before_notes, ''\)/);
 assert.doesNotMatch(a,/m\.updated_at/,'the report clock is not trusted');
 assert.match(a,/set transcript_text = j\.result_text, notes = j\.transcript_text, updated_at = pg_catalog\.now\(\)/);
 // 자료 행은 받은 값이 아니라 녹음 작업 행에서 만든다. 공개 범위는 private, 올린 사람은 작업 만든 사람.
 assert.match(a,/insert into public\.app_documents \(workspace_id, project_id, meeting_id, title, category, source, document_date,\s+description, tags, drive_url, file_id, file_name, mime_type, file_size, visibility, uploaded_by, auto_classified\)/);
 assert.match(a,/values \(m\.workspace_id, m\.project_id, m\.id,/);
 assert.match(a,/'회의자료', null, null, null, array\['회의자료', '회의녹음'\]::text\[\],\s+'https:\/\/drive\.google\.com\/file\/d\/' \|\| r\.drive_file_id \|\| '\/view', r\.drive_file_id, r\.file_name, r\.mime_type, r\.size_bytes,\s+'private', j\.created_by, false\)/);
 assert.match(a,/if not found or r\.status <> 'done' or r\.trashed_at is not null then\s+raise exception 'JOIN_SOURCE_GONE';/);
 assert.match(a,/elsif r\.meeting_id <> m\.id then\s+raise exception 'JOIN_ALREADY_JOINED';/);
 assert.match(a,/if sj\.meeting_id is not null and sj\.meeting_id <> m\.id then\s+raise exception 'JOIN_ALREADY_JOINED';/);
 // 합치기: 없어질 보고의 두 글 지문을 다시 보고, 지우지 않고 휴지통으로.
 assert.match(a,/sha256\(pg_catalog\.convert_to\(coalesce\(s\.transcript_text, ''\), 'UTF8'\)\), 'hex'\)\s+is distinct from j\.source_result_sha/);
 assert.match(a,/sha256\(pg_catalog\.convert_to\(coalesce\(s\.notes, ''\), 'UTF8'\)\), 'hex'\)\s+is distinct from j\.source_notes_sha/);
 assert.match(a,/update public\.app_meetings set deleted_at = pg_catalog\.now\(\)\s+where id = s\.id and deleted_at is null;/);
 assert.doesNotMatch(a,/delete from/);
 assert.match(a,/l\.google_task_id is not null\s+and not exists \(select 1 from public\.app_record_links t\s+where t\.meeting_id = m\.id and t\.google_task_id = l\.google_task_id\)/);
 assert.match(a,/summary_parts = '\[\]'::jsonb, source_text = null/);
 assert.doesNotMatch(a.match(/update public\.app_meeting_join_jobs[\s\S]*?where id = j\.id;/)[0],/before_result|before_notes|transcript_text\s*=|result_text\s*=/);
 // 되돌리기: 적용됐고 통째로 되돌린 적 없을 때만. 두 원본은 고치지 않는다.
 assert.match(u,/if not found or j\.applied_at is null or j\.undone_at is not null or j\.status <> 'done' then\s+raise exception 'JOIN_NOT_APPLIED';/);
 for(const set of u.matchAll(/update public\.app_meeting_join_jobs\s+set ([\s\S]*?)\s+where id = j\.id;/g))assert.doesNotMatch(set[1],/before_result\s*=|before_notes\s*=|result_text\s*=|transcript_text\s*=|moved\s*=/);
 assert.match(u,/set kept_result = m\.transcript_text/);
 assert.match(u,/o\.applied_at is not null and o\.undone_at is null and o\.applied_at >= j\.applied_at/);
 assert.match(u,/if not found or s\.deleted_at is null/);
 assert.match(u,/delete from public\.app_documents d\s+where d\.id = any\(made_docs\) and d\.meeting_id = m\.id and d\.workspace_id = j\.workspace_id;/);
});

test('pair files: catalog only, three summary lines, rollback (SQL Editor) drops only the two functions, the table and the record',()=>{
 for(const f of ['snapshot','precheck','postcheck']){
  const sql=readFileSync(`docs/${stem}.${f}.sql`,'utf8');
  assert.match(sql,/20261111142100/);
  assert.doesNotMatch(sql,/information_schema|from public\.app_|current_user/i,f);
 }
 const pre=readFileSync(`docs/${stem}.precheck.sql`,'utf8'),post=readFileSync(`docs/${stem}.postcheck.sql`,'utf8');
 assert.match(pre,/-- expect: recent migrations = 기록/);
 // 기존 표의 RLS·정책·권한이 그대로인지: 같은 이름 해시 항목을 적용 전·후에 비교한다.
 for(const item of ['existing tables RLS policies grants hash','existing tables column grants hash']){
  assert.match(pre,new RegExp(`-- expect: ${item} = 기록`));
  const pick=sql=>sql.slice(sql.indexOf(`union all select '${item}'`)).split('\nunion all select')[0].replace(/;\s*$/,'');
  assert.equal(pick(post),pick(pre),item);
 }
 for(const item of ['anon and PUBLIC have nothing on the table','authenticated: read only','functions: definer, empty search_path, service_role only',
  'service_role cannot write before text, source or apply/undo record columns'])assert.ok(post.includes(`'${item}'`),item);
 const lines=readFileSync(`docs/${stem}.summary.md`,'utf8').trim().split('\n');
 assert.equal(lines.length,3);
 ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
 assert.match(lines[2],/합치기 전 글도 같이 없어/);
 const rollback=readFileSync(`docs/${stem}.rollback.sql`,'utf8').replace(/--.*$/gm,'');
 assert.deepEqual(rollback.match(/drop [^;]*;/g),['drop function public.app_meeting_join_undo(uuid, text);','drop function public.app_meeting_join_apply(uuid);','drop table public.app_meeting_join_jobs;']);
 assert.match(rollback,/status in \('queued', 'running'\)\) then\s+raise exception 'MEETING_JOIN_JOBS_ROLLBACK_BLOCKED: join job in progress';/);
 assert.match(rollback,/delete from supabase_migrations\.schema_migrations\s+where version = '20261111142100' and name = 'meeting_join_jobs';\s*commit;\s*$/);
 assert.match(readFileSync('docs/migration-history.md','utf8'),/`20261111142100_meeting_join_jobs\.sql` \| 미적용/);
});
