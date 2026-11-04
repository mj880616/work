begin;
-- DESK-일정기간(요청함 11/04 16:49, 명진): 담당조직 현황 줄에 '끝나는 날'(선택) 칸을 더한다. 시작일(day)~끝나는 날(end_day) 기간 일정을 글이 아닌 날짜로 저장한다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_org_status_rows에 칸 1개 end_day date(null 허용, 기본 null)와 검사 1개(끝나는 날은 비었거나 시작일과 같거나 뒤)를 더한다.
--   기존 줄은 end_day가 null(하루 일정)로 그대로다. 기존 칸·행 값·정책·RLS·트리거는 바꾸지 않는다.
-- 권한: 새 칸에만 authenticated의 넣기·고치기 칸 권한을 더한다(다른 칸과 같은 모양). anon·PUBLIC·service_role 권한 없음, 정책 그대로(owner 한 개).
-- 앞 단계: 20261030234000_org_status_rows 기록이 있어야 한다(없으면 멈춘다).
-- 짝: docs/20261104201500_org_status_rows_end_day.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_org_status_rows in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104201500')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261030234000' and name = 'org_status_rows') <> 1
     or to_regclass('public.app_org_status_rows') is null
     or exists (select 1 from pg_attribute where attrelid = 'public.app_org_status_rows'::regclass and attname = 'end_day' and not attisdropped)
     or exists (select 1 from pg_constraint where conrelid = 'public.app_org_status_rows'::regclass and conname = 'app_org_status_rows_end_check') then
    raise exception 'ORG_STATUS_END_DAY_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_org_status_rows add column end_day date;
alter table public.app_org_status_rows add constraint app_org_status_rows_end_check check (end_day is null or end_day >= day);

grant insert (end_day) on table public.app_org_status_rows to authenticated;
grant update (end_day) on table public.app_org_status_rows to authenticated;

-- 사후 확인: 칸 있음(null 허용), 검사 있음(검증됨), authenticated 칸 권한 넣기·고치기, anon·service_role 칸 권한 없음, 정책 1개 그대로. 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_attribute where attrelid = 'public.app_org_status_rows'::regclass and attname = 'end_day'
        and atttypid = 'date'::regtype and not attnotnull and not attisdropped) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_org_status_rows'::regclass
         and conname = 'app_org_status_rows_end_check' and contype = 'c' and convalidated) <> 1
     or not has_column_privilege('authenticated', 'public.app_org_status_rows', 'end_day', 'insert')
     or not has_column_privilege('authenticated', 'public.app_org_status_rows', 'end_day', 'update')
     or has_any_column_privilege('anon', 'public.app_org_status_rows', 'select,insert,update,references')
     or has_any_column_privilege('service_role', 'public.app_org_status_rows', 'select,insert,update,references')
     or (select count(*) from pg_policy where polrelid = 'public.app_org_status_rows'::regclass) <> 1 then
    raise exception 'ORG_STATUS_END_DAY_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261104201500', 'org_status_rows_end_day', array['DESK-일정기간: app_org_status_rows.end_day (nullable date, end >= start check, authenticated column grants)']);
commit;
