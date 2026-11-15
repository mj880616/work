begin;
-- S54-27 ORG-기록하나로 O-2 DB(설계 docs/design/record-one.md 2-2·2-5·2-8·5절 O-2, 명진 결정 Q1~Q3·Q-A·Q-B).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇:
--  1) 조직 기록(app_suborganization_updates)에 칸 3개(모두 null 허용, 기존 행은 그대로 null):
--     end_day(기간 기록의 끝 날, 서울 날짜 기준 시작일과 같거나 뒤), source_kind(어디서 넣었나), source_id(원래 줄 번호).
--     같은 원래 줄을 같은 조직에 두 번 넣지 못하는 고유 색인, 주 창 읽기용 (organization_id, occurred_at) 색인,
--     검사 트리거(출처 칸은 넣은 뒤 고칠 수 없음, 옮긴 종류 status_row·weekly_line은 로그인 사용자·서버 키가 넣지 못함,
--     feed·memorable·update 원래 줄은 그 조직과 같은 작업공간 것만).
--     기존 정책(task12a_owner_all)·표 권한·RLS는 바꾸지 않는다. 이 표는 authenticated에 표 단위 읽기·넣기·고치기 권한이
--     있어(사전 확인으로 판정, 칸 단위 아님) 새 칸에 따로 권한을 주지 않는다(기존 표 권한을 늘리지 않음).
--     created_at(기존 칸)이 timestamptz로 있어야 한다('확정 뒤 추가' 판정용). 없으면 이 파일은 멈춘다(사전 확인 항목).
--  2) 새 표 app_report_line_marks: 보고용 표시(그 주부터 × 그 줄의 보고용 글·빼기/넣기·상세 여부). 이어짐 규칙은 화면 규칙.
--     ref_kind = org_update·biz_record·meeting·space·event(구글 캘린더 일정 id, 모양만 검사, section='org'에서만).
--     같은 작업공간 검사 트리거, 작업공간당 5,000행 상한. biz_record는 B-1(사업 기록 표)이 적용되기 전에는 거절한다.
--  3) 새 표 app_report_snapshots: [확정] 때 표 사진(주당 1행, rows jsonb 배열 128KiB 상한, confirmed_at = 서버 시각,
--     document_id = 같은 작업공간 자료만, 자료를 지우면 null). 지우기 권한 없음.
-- 권한: 새 표 2개는 owner만(private.app_is_workspace_owner). anon·PUBLIC·service_role 권한 없음, authenticated는 칸 단위 넣기·고치기.
--   트리거 함수 3개는 security invoker·search_path='', 실행 권한을 모두 걷는다. RTW 표·app_spaces·app_meetings 모양은 바꾸지 않는다.
-- 짝: docs/20261109100000_record_one_org.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_suborganization_updates in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109100000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_suborganizations') is null
     or to_regclass('public.app_suborganization_updates') is null
     or to_regclass('public.app_documents') is null
     or to_regclass('public.app_meetings') is null
     or to_regclass('public.app_spaces') is null
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_journal_memorable') is null
     or to_regclass('public.app_notes') is null
     or (select count(*) from pg_attribute where attnum > 0 and not attisdropped and atttypid = 'uuid'::regtype and attname = 'workspace_id'
           and attrelid in ('public.app_suborganizations'::regclass, 'public.app_documents'::regclass, 'public.app_meetings'::regclass,
                            'public.app_feed_items'::regclass, 'public.app_journal_memorable'::regclass, 'public.app_notes'::regclass)) <> 6
     or (select count(*) from pg_attribute where attrelid = 'public.app_suborganization_updates'::regclass and attnum > 0 and not attisdropped
           and ((attname = 'organization_id' and atttypid = 'uuid'::regtype)
             or (attname = 'occurred_at' and atttypid = 'timestamptz'::regtype)
             or (attname = 'created_at' and atttypid = 'timestamptz'::regtype))) <> 3
     or exists (select 1 from pg_attribute where attrelid = 'public.app_suborganization_updates'::regclass and not attisdropped
           and attname in ('end_day', 'source_kind', 'source_id'))
     or not (select relrowsecurity from pg_class where oid = 'public.app_suborganization_updates'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_suborganization_updates'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_suborganization_updates'::regclass
           and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*r' and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*a'
           and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     or (select count(*) from pg_policy where polrelid = 'public.app_suborganization_updates'::regclass) < 1
     or exists (select 1 from pg_policy where polrelid = 'public.app_suborganization_updates'::regclass
           and (polroles @> array[0::oid] or polroles @> array['anon'::regrole::oid]))
     or to_regclass('public.app_report_line_marks') is not null
     or to_regclass('public.app_report_snapshots') is not null
     or to_regclass('public.app_suborganization_updates_source_once') is not null
     or to_regclass('public.app_suborganization_updates_org_occurred_idx') is not null
     or exists (select 1 from pg_constraint where conrelid = 'public.app_suborganization_updates'::regclass
           and conname in ('app_suborganization_updates_end_day_check', 'app_suborganization_updates_source_check'))
     or to_regprocedure('private.app_suborganization_updates_source_guard()') is not null
     or to_regprocedure('private.app_report_line_marks_guard()') is not null
     or to_regprocedure('private.app_report_snapshots_guard()') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or to_regprocedure('private.app_space_in_workspace(uuid,uuid)') is null then
    raise exception 'RECORD_ONE_ORG_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 조직 기록 넓히기: 칸 3개 + 검사 2개 + 색인 2개.
alter table public.app_suborganization_updates
  add column end_day date,
  add column source_kind text,
  add column source_id uuid,
  add constraint app_suborganization_updates_end_day_check check (
    end_day is null or (occurred_at is not null and end_day >= (occurred_at at time zone 'Asia/Seoul')::date)),
  add constraint app_suborganization_updates_source_check check (
    (source_kind is null or source_kind in ('user', 'update', 'feed', 'memorable', 'status_row', 'weekly_line'))
    and ((source_kind is null or source_kind = 'user') = (source_id is null)));
create unique index app_suborganization_updates_source_once
  on public.app_suborganization_updates(organization_id, source_kind, source_id) where source_id is not null;
create index app_suborganization_updates_org_occurred_idx
  on public.app_suborganization_updates(organization_id, occurred_at);

-- 출처 칸 검사. 거절 오류(고정): SQLSTATE 23514, 문구 앞머리 'ORG_RECORD_SOURCE_FIXED:' / 'ORG_RECORD_SOURCE_MOVED_ONLY:' / 'ORG_RECORD_SOURCE_SCOPE:'.
create function private.app_suborganization_updates_source_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
declare
  ws uuid;
begin
  if tg_op = 'UPDATE' then
    if new.source_kind is distinct from old.source_kind or new.source_id is distinct from old.source_id then
      raise exception using errcode = '23514',
        message = 'ORG_RECORD_SOURCE_FIXED: source_kind and source_id cannot change';
    end if;
    return new;
  end if;
  if new.source_kind in ('status_row', 'weekly_line') and current_user in ('anon', 'authenticated', 'service_role') then
    raise exception using errcode = '23514',
      message = 'ORG_RECORD_SOURCE_MOVED_ONLY: moved rows are written by migration SQL only';
  end if;
  if new.source_kind in ('feed', 'memorable', 'update') then
    select o.workspace_id into ws from public.app_suborganizations o where o.id = new.organization_id;
    if ws is null
       or (new.source_kind = 'feed' and not exists (
             select 1 from public.app_feed_items f where f.id = new.source_id and f.workspace_id = ws))
       or (new.source_kind = 'memorable' and not exists (
             select 1 from public.app_journal_memorable m where m.id = new.source_id and m.workspace_id = ws))
       or (new.source_kind = 'update' and not exists (
             select 1 from public.app_notes n where n.id = new.source_id and n.workspace_id = ws)) then
      raise exception using errcode = '23514',
        message = 'ORG_RECORD_SOURCE_SCOPE: source row must be in the same workspace';
    end if;
  end if;
  return new;
end
$guard$;
revoke all on function private.app_suborganization_updates_source_guard() from public, anon, authenticated, service_role;

create trigger app_suborganization_updates_source_guard
before insert or update on public.app_suborganization_updates
for each row execute function private.app_suborganization_updates_source_guard();

-- 2) 보고용 표시 표.
create table public.app_report_line_marks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  week_start date not null,
  section text not null,
  ref_kind text not null,
  ref_key text not null,
  report_body text,
  choice text,
  detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_report_line_marks_week_check check (extract(isodow from week_start) = 1),
  constraint app_report_line_marks_section_check check (section in ('org', 'site', 'biz_summary', 'biz_detail')),
  constraint app_report_line_marks_kind_check check (ref_kind in ('org_update', 'biz_record', 'meeting', 'space', 'event')),
  constraint app_report_line_marks_key_check check (
    (ref_kind = 'event' and ref_key ~ '^[A-Za-z0-9_.@-]{1,200}$')
    or (ref_kind <> 'event' and ref_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
  constraint app_report_line_marks_event_check check (ref_kind <> 'event' or section = 'org'),
  constraint app_report_line_marks_body_check check (
    report_body is null or (char_length(report_body) between 1 and 1000 and report_body = btrim(report_body)
      and translate(report_body, chr(10), '') !~ '[[:cntrl:]]')),
  constraint app_report_line_marks_choice_check check (choice is null or choice in ('out', 'in')),
  constraint app_report_line_marks_detail_check check (detail is null or (detail in ('oneline', 'full') and section = 'biz_detail')),
  constraint app_report_line_marks_once unique (workspace_id, week_start, section, ref_kind, ref_key)
);
create index app_report_line_marks_ref_idx on public.app_report_line_marks(workspace_id, section, ref_kind, ref_key, week_start);

alter table public.app_report_line_marks enable row level security;
revoke all on table public.app_report_line_marks from public, anon, authenticated, service_role;
grant select, delete on table public.app_report_line_marks to authenticated;
grant insert (workspace_id, week_start, section, ref_kind, ref_key, report_body, choice, detail) on table public.app_report_line_marks to authenticated;
grant update (report_body, choice, detail) on table public.app_report_line_marks to authenticated;

create policy report_line_marks_owner_all on public.app_report_line_marks for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 같은 작업공간 검사·상한·updated_at. 거절 오류(고정): SQLSTATE 23514, 'REPORT_MARKS_SCOPE:' / 'REPORT_MARKS_LIMIT:'.
-- event는 모양만(제약). 캘린더는 DB 밖이고, 남의 일정 id를 넣어도 내 창에 그 일정이 없으면 쓰이지 않는다.
create function private.app_report_line_marks_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if tg_op = 'INSERT' then
    if new.ref_kind <> 'event' then
      if new.ref_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '23514', message = 'REPORT_MARKS_SCOPE: ref_key must be a uuid';
      end if;
      if (new.ref_kind = 'org_update' and not exists (
            select 1 from public.app_suborganization_updates u
            join public.app_suborganizations o on o.id = u.organization_id
            where u.id = new.ref_key::uuid and o.workspace_id = new.workspace_id))
         or (new.ref_kind = 'meeting' and not exists (
            select 1 from public.app_meetings m where m.id = new.ref_key::uuid and m.workspace_id = new.workspace_id))
         or (new.ref_kind = 'space' and not private.app_space_in_workspace(new.ref_key::uuid, new.workspace_id)) then
        raise exception using errcode = '23514', message = 'REPORT_MARKS_SCOPE: ref must be in the same workspace';
      end if;
      if new.ref_kind = 'biz_record' then
        -- 사업 기록 표는 B-1에서 생긴다. 그 전에는 거절한다.
        if to_regclass('public.app_business_records') is null then
          raise exception using errcode = '23514', message = 'REPORT_MARKS_SCOPE: business records are not ready';
        end if;
        if not exists (select 1 from public.app_business_records b
                       where b.id = new.ref_key::uuid and b.workspace_id = new.workspace_id) then
          raise exception using errcode = '23514', message = 'REPORT_MARKS_SCOPE: ref must be in the same workspace';
        end if;
      end if;
    end if;
    if (select count(*) from public.app_report_line_marks r where r.workspace_id = new.workspace_id) >= 5000 then
      raise exception using errcode = '23514', message = 'REPORT_MARKS_LIMIT: at most 5000 rows per workspace';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$guard$;
revoke all on function private.app_report_line_marks_guard() from public, anon, authenticated, service_role;

create trigger app_report_line_marks_guard
before insert or update on public.app_report_line_marks
for each row execute function private.app_report_line_marks_guard();

-- 3) 확정 사진 표. 같은 주를 새 판으로 확정하면 그 행을 통째로 바꾼다(update). 지우기 권한 없음.
create table public.app_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  week_start date not null,
  document_id uuid references public.app_documents(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  rows jsonb not null,
  constraint app_report_snapshots_week_check check (extract(isodow from week_start) = 1),
  constraint app_report_snapshots_rows_check check (jsonb_typeof(rows) = 'array' and octet_length(rows::text) <= 131072),
  constraint app_report_snapshots_once unique (workspace_id, week_start)
);

alter table public.app_report_snapshots enable row level security;
revoke all on table public.app_report_snapshots from public, anon, authenticated, service_role;
grant select on table public.app_report_snapshots to authenticated;
grant insert (workspace_id, week_start, document_id, rows) on table public.app_report_snapshots to authenticated;
grant update (document_id, rows) on table public.app_report_snapshots to authenticated;

create policy report_snapshots_owner_all on public.app_report_snapshots for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 자료는 같은 작업공간 것만, confirmed_at은 서버 시각(사진 글이 바뀔 때만 새로 찍음 — 자료를 지워 null이 될 때는 그대로).
-- 거절 오류(고정): SQLSTATE 23514, 'REPORT_SNAPSHOT_SCOPE:'.
create function private.app_report_snapshots_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if new.document_id is not null and (tg_op = 'INSERT' or new.document_id is distinct from old.document_id)
     and not exists (select 1 from public.app_documents d where d.id = new.document_id and d.workspace_id = new.workspace_id) then
    raise exception using errcode = '23514', message = 'REPORT_SNAPSHOT_SCOPE: document must be in the same workspace';
  end if;
  if tg_op = 'INSERT' or new.rows is distinct from old.rows then
    new.confirmed_at := now();
  else
    new.confirmed_at := old.confirmed_at;
  end if;
  return new;
end
$guard$;
revoke all on function private.app_report_snapshots_guard() from public, anon, authenticated, service_role;

create trigger app_report_snapshots_guard
before insert or update on public.app_report_snapshots
for each row execute function private.app_report_snapshots_guard();

-- 사후 확인: 새 표 2개 RLS 켜짐·정책 1개(authenticated만)·anon·service_role 권한 없음·고칠 수 없는 칸, 트리거 각 1개,
-- 조직 기록은 칸 3개·트리거 1개가 더해졌고 RLS·anon 권한 없음 그대로. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_report_line_marks'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.app_report_snapshots'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.app_suborganization_updates'::regclass)
     or exists (select 1 from pg_class where oid in ('public.app_report_line_marks'::regclass, 'public.app_report_snapshots'::regclass)
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_report_line_marks'::regclass, 'public.app_report_snapshots'::regclass)
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_report_line_marks', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_report_snapshots', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_suborganization_updates', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_report_line_marks', 'truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_report_snapshots', 'delete,truncate,references,trigger')
     or has_column_privilege('authenticated', 'public.app_report_line_marks', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_report_line_marks', 'ref_key', 'update')
     or has_column_privilege('authenticated', 'public.app_report_line_marks', 'id', 'insert')
     or not has_column_privilege('authenticated', 'public.app_report_line_marks', 'report_body', 'update')
     or has_column_privilege('authenticated', 'public.app_report_snapshots', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_report_snapshots', 'week_start', 'update')
     or has_column_privilege('authenticated', 'public.app_report_snapshots', 'confirmed_at', 'insert')
     or not has_column_privilege('authenticated', 'public.app_report_snapshots', 'rows', 'update')
     or not has_column_privilege('authenticated', 'public.app_suborganization_updates', 'source_kind', 'insert')
     or (select count(*) from pg_policy where polrelid = 'public.app_report_line_marks'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_report_line_marks'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_report_snapshots'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_report_snapshots'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_report_line_marks'::regclass and not tgisinternal) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_report_snapshots'::regclass and not tgisinternal) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_suborganization_updates'::regclass
         and tgname = 'app_suborganization_updates_source_guard' and not tgisinternal) <> 1
     or (select count(*) from pg_attribute where attrelid = 'public.app_suborganization_updates'::regclass and not attisdropped
         and not attnotnull and attname in ('end_day', 'source_kind', 'source_id')) <> 3 then
    raise exception 'RECORD_ONE_ORG_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261109100000', 'record_one_org', array['S54-27 ORG-기록하나로 O-2: app_suborganization_updates end_day/source_kind/source_id + source guard + indexes, app_report_line_marks, app_report_snapshots (owner RLS, same-workspace guards, column grants)']);
commit;
