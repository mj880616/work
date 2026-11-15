begin;
-- WEEKLY-임시저장 DB (docs/design/weekly-draft-feedback.md 2.2·4.1, 명진 결정 2026-10-23 23:09): 주간보고 한글 파일 상자에서 고치던 초안을
-- 서버에 임시저장할 칸을 주마다 1행인 기존 표 app_weekly_exec_requests에 더한다. 새 표는 만들지 않는다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: 칸 둘과 값 모양 검사 하나.
--   draft         jsonb        고친 값 묶음(비어 있음 = 임시저장 없음). 비어 있지 않으면 {"v":1,…} 객체이고 글자로 200 KiB(204,800바이트)까지.
--                              칸 안쪽 모양(줄·제목·이름)은 화면이 검사하고 서버는 형태와 크기만 본다(글이 길고 칸이 많아 전수 검사는 과함).
--   draft_saved_at timestamptz 마지막 임시저장 시각 = 두 기기가 같은 칸을 고쳤는지 알아보는 판 번호. 화면이 `draft_saved_at=eq.<읽은 값>`
--                              조건으로 PATCH하고, 0행이면 그사이 다른 기기가 저장한 것이다. draft가 있으면 이 시각도 반드시 있다.
--   임시저장은 updated_at을 바꾸지 않는다(요청 표를 고치는 다른 기기가 헛충돌을 겪지 않게). 요청 줄(items)·carried_at은 그대로다.
-- 기존 행은 모두 두 칸 비어 있음으로 남는다(표를 다시 쓰지 않음, 기존 데이터 변경 없음).
-- 권한: 정책·RLS·삭제 권한은 그대로(정책 weekly_exec_requests_owner_all 하나, 지우기 권한 없음). 이 표는 칸 단위 넣기·고치기 권한이라
--   새 칸은 권한이 없으면 아무도 쓸 수 없다. 그래서 새 칸 둘에만 authenticated의 넣기·고치기 권한을 준다(기존 칸과 같은 방식·같은 역할,
--   anon·PUBLIC·service_role 없음, 기존 칸의 권한은 그대로). 쓰기는 기존 소유자 정책(내 작업공간 행만) 아래에서만 된다.
-- 짝 rollback은 draft가 들어 있는 행이 하나라도 있으면 멈춘다(임시저장본이 사라지므로).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_weekly_exec_requests in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록 없음, 앞선 표 기록 있음, 새 칸·검사 이름 없음, RLS 켜짐, anon·PUBLIC 표 권한 없음,
-- authenticated 지우기 권한 없음, 정책은 소유자 정책 하나(authenticated만).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024001000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261023140000' and name = 'weekly_exec_requests') <> 1
     or to_regclass('public.app_weekly_exec_requests') is null
     or exists (select 1 from pg_attribute where attrelid = 'public.app_weekly_exec_requests'::regclass and not attisdropped
                and attname in ('draft', 'draft_saved_at'))
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_weekly_exec_requests_draft_check')
     or exists (select 1 from pg_class where oid = 'public.app_weekly_exec_requests'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_weekly_exec_requests'::regclass and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('authenticated', 'public.app_weekly_exec_requests', 'delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_weekly_exec_requests'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_weekly_exec_requests'::regclass
         and polname = 'weekly_exec_requests_owner_all' and polcmd = '*'
         and polroles = array['authenticated'::regrole::oid]) <> 1 then
    raise exception 'WEEKLY_DRAFT_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 두 칸. 비어 있으면(null) 임시저장 없음. 검사는 모양이 틀린 값도 NULL이 아니라 거절로 끝나게 coalesce(…, false)로 감싼다
-- (속 칸이 없어 NULL이 되면 CHECK는 통과해 버린다). draft가 있는데 draft_saved_at이 비면 거절.
alter table public.app_weekly_exec_requests
  add column draft jsonb,
  add column draft_saved_at timestamptz,
  add constraint app_weekly_exec_requests_draft_check check (
    draft is null or (
      coalesce(
        jsonb_typeof(draft) = 'object'
        and draft -> 'v' = '1'::jsonb
        and octet_length(draft::text) <= 204800, false)
      and draft_saved_at is not null));

-- 새 칸 둘에만 권한(기존 칸 권한은 그대로).
grant insert (draft, draft_saved_at) on table public.app_weekly_exec_requests to authenticated;
grant update (draft, draft_saved_at) on table public.app_weekly_exec_requests to authenticated;

-- 사후 확인: 두 칸·검사(검증됨)가 있고 모든 행의 draft는 비어 있음, 권한 경계 그대로(RLS 켜짐, anon·PUBLIC·service_role 없음, 지우기 없음,
-- 정책 하나), 새 칸 권한은 authenticated에만. 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_attribute where attrelid = 'public.app_weekly_exec_requests'::regclass and not attisdropped
        and ((attname = 'draft' and atttypid = 'jsonb'::regtype) or (attname = 'draft_saved_at' and atttypid = 'timestamptz'::regtype))) <> 2
     or (select count(*) from pg_constraint where connamespace = 'public'::regnamespace and contype = 'c' and convalidated
           and conname = 'app_weekly_exec_requests_draft_check') <> 1
     or exists (select 1 from public.app_weekly_exec_requests where draft is not null or draft_saved_at is not null)
     or exists (select 1 from pg_class where oid = 'public.app_weekly_exec_requests'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_weekly_exec_requests'::regclass and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_weekly_exec_requests'::regclass and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('authenticated', 'public.app_weekly_exec_requests', 'delete')
     or has_any_column_privilege('anon', 'public.app_weekly_exec_requests', 'select,insert,update,references')
     or not (has_column_privilege('authenticated', 'public.app_weekly_exec_requests', 'draft', 'insert')
         and has_column_privilege('authenticated', 'public.app_weekly_exec_requests', 'draft', 'update')
         and has_column_privilege('authenticated', 'public.app_weekly_exec_requests', 'draft_saved_at', 'insert')
         and has_column_privilege('authenticated', 'public.app_weekly_exec_requests', 'draft_saved_at', 'update'))
     or has_column_privilege('authenticated', 'public.app_weekly_exec_requests', 'week_start', 'update')
     or (select count(*) from pg_policy where polrelid = 'public.app_weekly_exec_requests'::regclass) <> 1 then
    raise exception 'WEEKLY_DRAFT_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024001000', 'weekly_draft', array['WEEKLY-임시저장 DB: app_weekly_exec_requests.draft jsonb + draft_saved_at timestamptz + shape CHECK (column insert/update grants for the two new columns to authenticated only; existing owner RLS, no policy/function changes)']);
commit;
