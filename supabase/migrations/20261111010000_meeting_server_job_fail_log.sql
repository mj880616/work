begin;
-- S56-47 REC-정리멈춤반복-긴구간(요청함 11/09 13:23·13:43, CC 지시 PR 2330 댓글: 실패 이력을 덮어쓰지 않고 남기기).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: 서버 정리 작업 표(app_meeting_server_jobs)에 실패 이력 칸 fail_log(jsonb 배열, 기본 '[]') 하나·검사 1개·트리거 1개.
--   [다시]가 error_code·stage·attempts를 덮어써 실패 당시 모양이 남지 않던 것(11/09 녹음 원인 특정 불가)을 DB가 직접 남긴다.
--   트리거(BEFORE UPDATE)가 상태가 바뀔 때 한 줄을 더한다. 한 줄 = {at, kind, stage, code, step, of, attempts, ms}
--     kind fail  = 실패로 바뀜(그 이유 코드·단계·걸린 ms = 앞 잡기 시각부터)
--     kind retry = 실패에서 다시 대기로(앞 실패 코드)
--     kind cut   = 단계가 실행 시간 안에 끝나지 못하고 끊긴 것을 처음 봄(error_code 'step_cut' 표시)
--     kind slow  = 단계 하나가 120초 넘게 걸리고 끝남(Edge 실행 한도에 가까워지는지)
--   이유 코드·단계·번호·시각·걸린 시간만, 글 내용 없음. 최근 20줄만 둔다.
--   Edge(service_role)에 새 권한을 주지 않는다(트리거가 NEW를 고침). authenticated는 기존 표 단위 select(소유자 RLS)로 읽는다.
--   트리거 함수는 security invoker·search_path='', 실행 권한을 모두 걷는다. 정책·RLS·기존 권한은 바꾸지 않는다.
-- 짝: docs/20261111010000_meeting_server_job_fail_log.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meeting_server_jobs in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261111010000')
     or to_regclass('public.app_meeting_server_jobs') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_meeting_server_jobs')
           and attname = 'fail_log' and not attisdropped)
     or exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_meeting_server_jobs')
           and conname = 'app_meeting_server_jobs_fail_log_check')
     or to_regprocedure('private.app_meeting_server_jobs_fail_log()') is not null
     or not exists (select 1 from pg_namespace where nspname = 'private') then
    raise exception 'MEETING_SERVER_JOB_FAIL_LOG_PRECONDITION: unexpected state';
  end if;
end
$$;

alter table public.app_meeting_server_jobs
  add column fail_log jsonb not null default '[]'::jsonb,
  add constraint app_meeting_server_jobs_fail_log_check check (
    jsonb_typeof(fail_log) = 'array' and jsonb_array_length(fail_log) <= 20 and octet_length(fail_log::text) <= 20000);

create function private.app_meeting_server_jobs_fail_log()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $log$
declare
  kind text := null;
  code text := null;
  ms bigint := null;
  logs jsonb;
begin
  new.fail_log := old.fail_log; -- 이력은 트리거만 고친다(다른 쓰기가 칸을 바꿔도 앞 이력 그대로)
  if new.status = 'failed' and old.status is distinct from 'failed' then
    kind := 'fail'; code := new.error_code;
  elsif old.status = 'failed' and new.status = 'queued' then
    kind := 'retry'; code := old.error_code;
  elsif new.error_code = 'step_cut' and old.error_code is distinct from 'step_cut' then
    kind := 'cut'; code := 'step_cut';
  elsif old.lease_until is not null and new.lease_until is null and new.status in ('queued', 'running', 'done')
        and old.updated_at < pg_catalog.now() - interval '120 seconds' then
    kind := 'slow';
  end if;
  if kind is null then
    return new;
  end if;
  if kind in ('fail', 'slow') and old.lease_until is not null then
    ms := (extract(epoch from (pg_catalog.now() - old.updated_at)) * 1000)::bigint;
  end if;
  logs := old.fail_log || pg_catalog.jsonb_build_array(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'at', pg_catalog.now(), 'kind', kind, 'stage', old.stage,
    'code', case when code ~ '^[a-z_]{1,40}$' then code end,
    'step', old.step_no, 'of', old.step_total, 'attempts', old.attempts, 'ms', ms)));
  if pg_catalog.jsonb_array_length(logs) > 20 then
    select coalesce(pg_catalog.jsonb_agg(e.value order by e.n), '[]'::jsonb) into logs
      from pg_catalog.jsonb_array_elements(logs) with ordinality as e(value, n)
      where e.n > pg_catalog.jsonb_array_length(logs) - 20;
  end if;
  new.fail_log := logs;
  return new;
end
$log$;
revoke all on function private.app_meeting_server_jobs_fail_log() from public, anon, authenticated, service_role;

create trigger app_meeting_server_jobs_fail_log
before update on public.app_meeting_server_jobs
for each row execute function private.app_meeting_server_jobs_fail_log();

do $$
declare t regclass := 'public.app_meeting_server_jobs'::regclass;
begin
  if (select count(*) from pg_attribute where attrelid = t and attname = 'fail_log'
        and atttypid = 'jsonb'::regtype and attnotnull and atthasdef and not attisdropped and attacl is null) <> 1
     or not exists (select 1 from pg_constraint where conrelid = t and conname = 'app_meeting_server_jobs_fail_log_check')
     or not exists (select 1 from pg_trigger where tgrelid = t and tgname = 'app_meeting_server_jobs_fail_log' and not tgisinternal)
     or has_column_privilege('service_role', t, 'fail_log', 'update')
     or has_column_privilege('authenticated', t, 'fail_log', 'update')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or not (select relrowsecurity from pg_class where oid = t) then
    raise exception 'MEETING_SERVER_JOB_FAIL_LOG_POSTCONDITION: column, check, trigger or grants differ';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261111010000', 'meeting_server_job_fail_log', array['S56-47 REC-정리멈춤반복-긴구간: app_meeting_server_jobs.fail_log jsonb not null default [] + check (array, <=20, <=20000 bytes) + before update trigger app_meeting_server_jobs_fail_log (fail·retry·cut·slow, invoker, search_path empty, no execute grants)']);
commit;
