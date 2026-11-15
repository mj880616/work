begin;
-- S47-40 UI-앱안알림 4·5단계 DB(명진 11/01 13:40·13:41 A1~A6 추천안). 설계: docs/design/in-app-notices.md 4절·6절 A6·7절 4·5.
-- 적용은 docs/ops-db-workflow.md "승인 한 번 흐름"(승인형 DB workflow)으로만 한다.
--
-- 새 표를 만들지 않고 폰 알림 기록 app_push_log(20261101010000_phone_push)를 넓힌다.
--  1) shown_at: 맨 위 알림 줄에 처음 뜬 시각(뒤에서 끝난 일). 폰 알림과 같은 (종류·기록 열쇠·날) 한 줄에 함께 적는다.
--  2) opened_at: 폰 알림이나 알림 줄을 눌러 연 시각. 한 번 열면 알림 줄에서 빠진다(같은 종류·기록 열쇠면 날이 달라도).
--  3) status에 'shown'(알림 줄에만 뜸, 폰으로는 안 보냄)을 더한다. 'shown'이면 shown_at이 있어야 한다.
--  제목·본문은 여전히 저장하지 않는다(종류·기록 열쇠·날짜·상태·시각만).
--
-- 권한: 바꾸지 않는다. 화면(authenticated)은 지금처럼 자기 작업공간 기록 읽기만(최근 알림 7일 목록), 쓰기는 Edge phone-push(service_role)만.
--   RLS·정책·anon·PUBLIC 권한 그대로. 새 함수·정책·권한 부여 없음.
-- 짝: docs/20261101210000_push_log_notices.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261101210000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261101010000')
     or to_regclass('public.app_push_log') is null
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_push_log'::regclass and not attisdropped and attname in ('shown_at', 'opened_at'))
     or not exists (select 1 from pg_constraint
         where conrelid = 'public.app_push_log'::regclass and conname = 'app_push_log_status_check')
     or exists (select 1 from pg_constraint
         where conrelid = 'public.app_push_log'::regclass and conname = 'app_push_log_shown_check')
     -- 지금 경계: RLS 켜짐, 정책 1개(authenticated 소유자 읽기), anon·PUBLIC 권한 없음, authenticated 읽기만.
     or not (select relrowsecurity from pg_class where oid = 'public.app_push_log'::regclass)
     or (select count(*) from pg_policy where polrelid = 'public.app_push_log'::regclass) <> 1
     or exists (select 1 from pg_class where oid = 'public.app_push_log'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_push_log', 'insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('authenticated', 'public.app_push_log', 'insert,update') then
    raise exception 'PUSH_LOG_NOTICES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_push_log
  add column shown_at timestamptz,
  add column opened_at timestamptz;

alter table public.app_push_log drop constraint app_push_log_status_check;
alter table public.app_push_log
  add constraint app_push_log_status_check check (status in ('sent', 'held_quiet', 'failed', 'skipped_off', 'shown'));
alter table public.app_push_log
  add constraint app_push_log_shown_check check (status <> 'shown' or shown_at is not null);

-- '최근 알림 7일'·열린 것 찾기용(작업공간 → 종류·열쇠는 기본 키 앞부분이 이미 맡음).
create index app_push_log_ws_sent_idx on public.app_push_log(workspace_id, sent_at desc);

-- 사후 확인: 권한·정책 경계 그대로, 새 칸 둘·검사 둘. 다르면 전체 취소.
do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.app_push_log'::regclass and not attisdropped and attname = 'shown_at')
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_push_log'::regclass and not attisdropped and attname = 'opened_at')
     or (select count(*) from pg_constraint where conrelid = 'public.app_push_log'::regclass
         and conname in ('app_push_log_status_check', 'app_push_log_shown_check')) <> 2
     or not (select relrowsecurity from pg_class where oid = 'public.app_push_log'::regclass)
     or (select count(*) from pg_policy where polrelid = 'public.app_push_log'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_push_log'::regclass
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = 'r') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_push_log'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_push_log'::regclass and attacl is not null)
     or has_table_privilege('anon', 'public.app_push_log', 'select,insert,update,delete,truncate,references,trigger')
     or not has_table_privilege('authenticated', 'public.app_push_log', 'select')
     or has_table_privilege('authenticated', 'public.app_push_log', 'insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('authenticated', 'public.app_push_log', 'insert,update')
     or not has_table_privilege('service_role', 'public.app_push_log', 'select,insert,update,delete')
     or has_table_privilege('service_role', 'public.app_push_log', 'truncate,references,trigger')
     or exists (select 1 from public.app_push_log where shown_at is not null or opened_at is not null) then
    raise exception 'PUSH_LOG_NOTICES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261101210000', 'push_log_notices', array['S47-40 UI-앱안알림 4·5: app_push_log shown_at·opened_at columns, status adds shown (with shown_at check), (workspace_id, sent_at) index; RLS, policies and grants unchanged']);
commit;
