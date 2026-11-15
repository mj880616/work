begin;
-- S54-27 BIZ-기록하나로 B-1 DB(설계 docs/design/record-one.md 2-3·2-4·5절 B-1, 명진 결정 Q1~Q3·Q-A·Q-B).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
-- 앞 단계: 20261109100000_record_one_org(O-2) 기록이 있어야 한다(없으면 멈춘다). 표시 표의 ref_kind='biz_record'는 이 표가 생기면 받는다.
--
-- 무엇: 새 표 2개와 그 트리거 함수 2개. 기존 표·정책·권한·자료는 한 줄도 바꾸지 않는다. app_spaces·app_meetings·RTW 표 모양도 그대로다.
--  app_business_records: 사업마다 '날짜 + 한 줄' 기록(서울 날짜 day, 기간이면 end_day, 글 1~300자, 출처 user·update·feed·memorable·progress).
--   같은 원래 줄은 한 작업공간에 한 번만. progress(옛 사업 진행 기록 옮기기)는 옮기기 SQL만 넣는다. 사업 하나에 하루 50줄까지.
--   사업 보고(app_meetings)는 복사하지 않는다(창이 읽을 때 함께 보여 줌).
--  app_business_now: 사업마다 그 주의 '지금 상황'(0~1000자)·담당(글자 0~100자). 사업·주(월요일)마다 1행.
--   그 주의 지금 상황 = week_start가 그 주 이하인 가장 나중 행(화면 규칙).
-- 권한: owner만(private.app_is_workspace_owner). anon·PUBLIC·service_role 권한 없음. 작업공간·사업·출처 칸은 고칠 수 없다.
--   트리거 함수는 security invoker·search_path='', 실행 권한을 모두 걷는다.
-- 짝: docs/20261109110000_record_one_biz.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109110000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261109100000' and name = 'record_one_org') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_spaces') is null
     or to_regclass('public.app_report_line_marks') is null
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_journal_memorable') is null
     or to_regclass('public.app_notes') is null
     or (select count(*) from pg_attribute where attnum > 0 and not attisdropped and atttypid = 'uuid'::regtype and attname = 'workspace_id'
           and attrelid in ('public.app_spaces'::regclass, 'public.app_feed_items'::regclass,
                            'public.app_journal_memorable'::regclass, 'public.app_notes'::regclass)) <> 4
     or to_regclass('public.app_business_records') is not null
     or to_regclass('public.app_business_now') is not null
     or to_regprocedure('private.app_business_records_guard()') is not null
     or to_regprocedure('private.app_business_now_guard()') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or to_regprocedure('private.app_space_in_workspace(uuid,uuid)') is null then
    raise exception 'RECORD_ONE_BIZ_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 사업 기록. 사업·작업공간을 지우면 함께 지움.
create table public.app_business_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  space_id uuid not null references public.app_spaces(id) on delete cascade,
  day date not null,
  end_day date,
  body text not null,
  source_kind text not null,
  source_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_business_records_body_check check (
    char_length(body) between 1 and 300 and body = btrim(body) and body !~ '[[:cntrl:]]'),
  constraint app_business_records_end_check check (end_day is null or end_day >= day),
  constraint app_business_records_source_check check (
    source_kind in ('user', 'update', 'feed', 'memorable', 'progress') and ((source_kind = 'user') = (source_id is null)))
);
create unique index app_business_records_source_once
  on public.app_business_records(workspace_id, source_kind, source_id) where source_id is not null;
create index app_business_records_space_day_idx on public.app_business_records(workspace_id, space_id, day);
create index app_business_records_day_idx on public.app_business_records(workspace_id, day);

alter table public.app_business_records enable row level security;
revoke all on table public.app_business_records from public, anon, authenticated, service_role;
grant select, delete on table public.app_business_records to authenticated;
grant insert (workspace_id, space_id, day, end_day, body, source_kind, source_id) on table public.app_business_records to authenticated;
grant update (day, end_day, body) on table public.app_business_records to authenticated;

create policy business_records_owner_all on public.app_business_records for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사업·원래 줄은 같은 작업공간, progress는 옮기기 SQL만, 사업 하나에 하루 50줄, updated_at은 서버 시각.
-- 거절 오류(고정): SQLSTATE 23514, 'BIZ_RECORDS_SCOPE:' / 'BIZ_RECORDS_MOVED_ONLY:' / 'BIZ_RECORDS_LIMIT:'.
create function private.app_business_records_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if tg_op = 'INSERT' then
    if not private.app_space_in_workspace(new.space_id, new.workspace_id) then
      raise exception using errcode = '23514', message = 'BIZ_RECORDS_SCOPE: business must be in the same workspace';
    end if;
    if new.source_kind = 'progress' and current_user in ('anon', 'authenticated', 'service_role') then
      raise exception using errcode = '23514',
        message = 'BIZ_RECORDS_MOVED_ONLY: moved rows are written by migration SQL only';
    end if;
    if (new.source_kind = 'feed' and not exists (
          select 1 from public.app_feed_items f where f.id = new.source_id and f.workspace_id = new.workspace_id))
       or (new.source_kind = 'memorable' and not exists (
          select 1 from public.app_journal_memorable m where m.id = new.source_id and m.workspace_id = new.workspace_id))
       or (new.source_kind = 'update' and not exists (
          select 1 from public.app_notes n where n.id = new.source_id and n.workspace_id = new.workspace_id)) then
      raise exception using errcode = '23514', message = 'BIZ_RECORDS_SCOPE: source row must be in the same workspace';
    end if;
    if (select count(*) from public.app_business_records r
        where r.space_id = new.space_id and r.day = new.day) >= 50 then
      raise exception using errcode = '23514', message = 'BIZ_RECORDS_LIMIT: at most 50 rows per business per day';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$guard$;
revoke all on function private.app_business_records_guard() from public, anon, authenticated, service_role;

create trigger app_business_records_guard
before insert or update on public.app_business_records
for each row execute function private.app_business_records_guard();

-- 2) 사업 지금 상황·담당. 사업·주마다 1행.
create table public.app_business_now (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  space_id uuid not null references public.app_spaces(id) on delete cascade,
  week_start date not null,
  body text not null default '',
  owner_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_business_now_week_check check (extract(isodow from week_start) = 1),
  constraint app_business_now_body_check check (
    char_length(body) <= 1000 and body = btrim(body) and translate(body, chr(10), '') !~ '[[:cntrl:]]'),
  constraint app_business_now_owner_check check (
    char_length(owner_text) <= 100 and owner_text = btrim(owner_text) and owner_text !~ '[[:cntrl:]]'),
  constraint app_business_now_once unique (workspace_id, space_id, week_start)
);

alter table public.app_business_now enable row level security;
revoke all on table public.app_business_now from public, anon, authenticated, service_role;
grant select, delete on table public.app_business_now to authenticated;
grant insert (workspace_id, space_id, week_start, body, owner_text) on table public.app_business_now to authenticated;
grant update (body, owner_text) on table public.app_business_now to authenticated;

create policy business_now_owner_all on public.app_business_now for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사업은 같은 작업공간, updated_at은 서버 시각. 거절 오류(고정): SQLSTATE 23514, 'BIZ_NOW_SCOPE:'.
create function private.app_business_now_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if tg_op = 'INSERT' and not private.app_space_in_workspace(new.space_id, new.workspace_id) then
    raise exception using errcode = '23514', message = 'BIZ_NOW_SCOPE: business must be in the same workspace';
  end if;
  new.updated_at := now();
  return new;
end
$guard$;
revoke all on function private.app_business_now_guard() from public, anon, authenticated, service_role;

create trigger app_business_now_guard
before insert or update on public.app_business_now
for each row execute function private.app_business_now_guard();

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·service_role 권한 없음, 고칠 수 없는 칸, 트리거 각 1개. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_business_records'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.app_business_now'::regclass)
     or exists (select 1 from pg_class where oid in ('public.app_business_records'::regclass, 'public.app_business_now'::regclass)
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_business_records'::regclass, 'public.app_business_now'::regclass)
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_business_records', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_business_now', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_business_records', 'truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_business_now', 'truncate,references,trigger')
     or has_column_privilege('authenticated', 'public.app_business_records', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_business_records', 'space_id', 'update')
     or has_column_privilege('authenticated', 'public.app_business_records', 'source_kind', 'update')
     or has_column_privilege('authenticated', 'public.app_business_records', 'source_id', 'update')
     or has_column_privilege('authenticated', 'public.app_business_records', 'created_by', 'insert')
     or has_column_privilege('authenticated', 'public.app_business_records', 'id', 'insert')
     or not has_column_privilege('authenticated', 'public.app_business_records', 'body', 'update')
     or has_column_privilege('authenticated', 'public.app_business_now', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_business_now', 'space_id', 'update')
     or has_column_privilege('authenticated', 'public.app_business_now', 'week_start', 'update')
     or not has_column_privilege('authenticated', 'public.app_business_now', 'body', 'update')
     or (select count(*) from pg_policy where polrelid = 'public.app_business_records'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_business_records'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_business_now'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_business_now'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_business_records'::regclass and not tgisinternal) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_business_now'::regclass and not tgisinternal) <> 1 then
    raise exception 'RECORD_ONE_BIZ_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261109110000', 'record_one_biz', array['S54-27 BIZ-기록하나로 B-1: app_business_records, app_business_now (owner RLS, same-workspace guards, column grants)']);
commit;
