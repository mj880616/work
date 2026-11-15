begin;
-- S56-18 ORG-기록날짜고치기(요청함 11/10, 시안 docs/design/mockups/org-record-day-edit.html #2294, 명진 17:31 ㄱ).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: 조직 기록(app_suborganization_updates)에 '날짜 없음' 표시 칸 day_none(boolean, 기본 false, null 불가) 하나와
--   검사 1개(날짜 없음이면 끝나는 날 없음)를 더한다. occurred_at은 그대로 필수(없음 기록은 쓴 날을 둔다 — 창 계산용).
--   기존 행은 모두 false(지금처럼 날짜 있음). 기존 정책(owner)·표 권한·RLS·트리거는 바꾸지 않는다.
--   이 표는 authenticated에 표 단위 읽기·넣기·수정 권한이 있어(사전 확인으로 판정, 칸 단위 아님) 새 칸에 따로 권한을 주지 않는다.
--   day_none = true면 화면 줄에는 날짜 없이 '-'만 보이고, occurred_at은 쓴 날 그대로 둔다(설명 주석은 DB에 남기지 않음 — 승인형 workflow 허용 명령만).
-- 짝: docs/20261110180000_org_update_day_none.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_suborganization_updates in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261110180000')
     or to_regclass('public.app_suborganization_updates') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_suborganization_updates')
           and attname = 'end_day' and atttypid = 'date'::regtype and not attisdropped)
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_suborganization_updates')
           and attname = 'day_none' and not attisdropped)
     or exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_suborganization_updates')
           and conname = 'app_suborganization_updates_day_none_check') then
    raise exception 'ORG_UPDATE_DAY_NONE_PRECONDITION: unexpected state';
  end if;
end
$$;

alter table public.app_suborganization_updates
  add column day_none boolean not null default false,
  add constraint app_suborganization_updates_day_none_check check (not day_none or end_day is null);

do $$
begin
  if (select count(*) from pg_attribute where attrelid = to_regclass('public.app_suborganization_updates')
        and attname = 'day_none' and atttypid = 'boolean'::regtype and attnotnull and not attisdropped) <> 1
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_suborganization_updates')
        and conname = 'app_suborganization_updates_day_none_check') then
    raise exception 'ORG_UPDATE_DAY_NONE_POSTCONDITION: column or check missing';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261110180000', 'org_update_day_none', array['S56-18 ORG-기록날짜고치기: app_suborganization_updates.day_none boolean not null default false + check (not day_none or end_day is null)']);
commit;
