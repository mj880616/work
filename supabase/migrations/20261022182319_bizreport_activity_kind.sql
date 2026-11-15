begin;
-- MTG-사업보고 3단계 DB-1 (docs/design/business-report.md 3·4.1·7.4·8절, 결정 1 [기타] 칸 둔다 = 'other' 포함, 2026-10-22 18:21 사용자 승인).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
-- 선행: 설계 8절 2단계(화면 이름 '사업 보고'·basket-data.js FK 이름 지정, 화면이 activity_kind 없어도 동작) merge 뒤 적용.
--
-- 무엇: 회의 표(app_meetings)에 '칸'(activity_kind) 하나를 더한다. 한 건은 한 칸.
--   meeting(회의) · policy(정책) · negotiation(교섭) · press(언론) · assembly(국회) · struggle(투쟁) · education(교육) · other(기타)
--   기본값 'meeting' — 기존 기록은 모두 '회의'가 되고, 칸을 모르는 지금 화면·Edge가 저장해도 '회의'로 들어간다.
--   표 이름은 바꾸지 않는다(읽생기와 같은 DB, 바꾸면 Edge·시험·원장 전부 영향). 화면 글자는 앱 한 곳에서만 정한다.
-- 장소 칸(location): 저장소 migration 어디에도 app_meetings.location을 만들거나 더하는 문장이 없다(표 생성문은 운영 초기 스키마).
--   이 파일은 장소 칸을 더하지 않는다(있을 때만 더하는 분기를 쓰지 않음). 운영 유무는 precheck가 기록만 한다.
-- 권한: 표 grant·정책·RLS·함수·트리거·색인 변경 없음. 기존 owner 정책(task12a_owner_all) 그대로 소유자만 읽고 쓴다.
--   기존 표·정책이 지금 모양일 때만 진행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022182319')
     or to_regclass('public.app_meetings') is null
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_meetings'::regclass and not attisdropped and attname = 'activity_kind')
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_meetings_activity_kind_check')
     -- app_meetings: RLS 켜짐, anon·PUBLIC 표 권한 없음.
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     -- 정책은 task12a 한 개 그대로(소유자만, 20260925084844_task12a_sole_owner_db.sql).
     or (select count(*) from pg_policy where polrelid = 'public.app_meetings'::regclass) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_meetings' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]
           and regexp_replace(qual, '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id'
           and regexp_replace(with_check, '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id') <> 1 then
    raise exception 'BIZREPORT_ACTIVITY_KIND_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 칸. 기존 행은 기본값으로 모두 'meeting'(표 다시 쓰기 없이 기본값만 기록, PostgreSQL 11+).
alter table public.app_meetings
  add column activity_kind text not null default 'meeting';
alter table public.app_meetings
  add constraint app_meetings_activity_kind_check check (activity_kind in
    ('meeting', 'policy', 'negotiation', 'press', 'assembly', 'struggle', 'education', 'other'));

-- 사후 확인: 권한 경계 그대로, 모든 기록이 '회의', 검사 조건이 여덟 값 그대로. 다르면 전체 취소.
-- check_clause의 바깥 괄호는 PostgreSQL 판에 따라 다르다(16: 한 겹 더, 17: 한 겹 덜 — 20261022130000 #980).
-- 그래서 두 판의 글자만 받는다(이 확인은 쓰기 요청 = 표 소유자로 돌아 information_schema가 행을 본다).
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_meetings'::regclass) <> 1
     or exists (select 1 from public.app_meetings where activity_kind <> 'meeting')
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_meetings_activity_kind_check'
           and btrim(regexp_replace(check_clause, '\s+', ' ', 'g')) in (
             '((activity_kind = ANY (ARRAY[''meeting''::text, ''policy''::text, ''negotiation''::text, ''press''::text, ''assembly''::text, ''struggle''::text, ''education''::text, ''other''::text])))',
             '(activity_kind = ANY (ARRAY[''meeting''::text, ''policy''::text, ''negotiation''::text, ''press''::text, ''assembly''::text, ''struggle''::text, ''education''::text, ''other''::text]))')) <> 1 then
    raise exception 'BIZREPORT_ACTIVITY_KIND_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022182319', 'bizreport_activity_kind', array['MTG-사업보고 DB-1: app_meetings.activity_kind text not null default meeting + CHECK 8 kinds (existing owner RLS, no grants/policies/functions)']);
commit;
