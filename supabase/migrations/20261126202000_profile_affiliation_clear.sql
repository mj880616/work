begin;
-- S71-40 DATA-정리두가지 (나) (사용자 결정 2026-11-26 18:11 "지워"): 내 프로필 기본 정보의 소속(조직)·부서·직책 값을 모든 사람에게서 비운다.
-- 대상 칸: app_profiles.union_name(소속·조직명), department_name(부서명), job_title(직책). 이름(display_name)과 다른 칸은 그대로 둔다.
-- 칸(칼럼) 자체는 지우지 않는다(코드가 아직 읽는다 — AI 안내문의 소속·직책, 묶음 만들기·들어가기의 직책 사본, 가입 현황 함수). 칸 지우기는 따로 제안한다.
-- 적용 순서: S71-34(화면에서 그 칸을 없애고 더 이상 저장하지 않음)가 main에 들어가 배포된 뒤에 적용한다. 그 전에 비우면 옛 화면이 다시 저장할 수 있다.
-- 비우기 전 같은 transaction 안에서 비울 사람의 옛 값 세 칸을 백업 표 public.app_cleanup_s71_40_profiles에 복사한다(RLS 켬·정책 없음·API 역할 권한 없음).
--   승인형 DB workflow 확장 규칙은 public 표만 받으므로 private 스키마가 아니라 public에 두고 권한을 모두 걷는다.
-- 다른 표·권한·정책·함수·트리거는 바꾸지 않는다. 프로필 줄에 걸린 트리거가 담당 표·조직·묶음 구성원 줄을 바꾸면 전체 취소한다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
-- 출력: 사전·사후 확인은 개수·예/아니오·해시만(이름·소속·직책 글자는 읽어 보이지 않음, AGENTS.md 3절).
-- 되돌리기: 짝 rollback(SQL Editor 전용) — 백업 표의 옛 값을 지금도 비어 있는 칸에만 되돌려 넣고 백업 표·기록 1행을 지운다.
-- 짝: docs/20261126202000_profile_affiliation_clear.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in share row exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261126202000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261115223000' and name = 'profile_union_department') <> 1
     or to_regclass('public.app_cleanup_s71_40_profiles') is not null
     -- 세 칸이 글자 칸이고 비울 수 있음(not null 아님).
     or (select count(*) from pg_attribute where attrelid = 'public.app_profiles'::regclass and not attisdropped and not attnotnull
         and attname in ('union_name', 'department_name', 'job_title') and atttypid = 'text'::regtype) <> 3
     or (select count(*) from pg_attribute where attrelid = 'public.app_profiles'::regclass and not attisdropped
         and attname in ('user_id', 'display_name')) <> 2
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=') then
    raise exception 'PROFILE_AFFILIATION_CLEAR_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 백업 표: 비울 사람의 옛 값 세 칸. RLS 켬·정책 없음·API 역할 권한 없음.
create table public.app_cleanup_s71_40_profiles (
  user_id uuid primary key,
  union_name text,
  department_name text,
  job_title text,
  cleared_at timestamptz not null default now()
);
alter table public.app_cleanup_s71_40_profiles enable row level security;
revoke all on table public.app_cleanup_s71_40_profiles from public, anon, authenticated, service_role;

insert into public.app_cleanup_s71_40_profiles (user_id, union_name, department_name, job_title)
select p.user_id, p.union_name, p.department_name, p.job_title
  from public.app_profiles p
 where p.union_name is not null or p.department_name is not null or p.job_title is not null;

update public.app_profiles p
   set union_name = null, department_name = null, job_title = null
 where p.union_name is not null or p.department_name is not null or p.job_title is not null;

-- 사후 확인(같은 transaction): 세 칸이 모두 비었고, 이번에 바뀐 프로필 줄 수 = 백업 줄 수, 담당 표·조직·묶음 구성원 줄은 이번에 바뀌지 않음,
-- 백업 표 RLS 켜짐·API 역할 권한 없음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from public.app_profiles p where p.union_name is not null or p.department_name is not null or p.job_title is not null)
     or (select count(*) from public.app_profiles p where p.xmin = pg_catalog.pg_current_xact_id()::xid)
        <> (select count(*) from public.app_cleanup_s71_40_profiles)
     or exists (select 1 from public.app_suborganization_assignees x where x.xmin = pg_catalog.pg_current_xact_id()::xid)
     or exists (select 1 from public.app_profile_workplaces x where x.xmin = pg_catalog.pg_current_xact_id()::xid)
     or exists (select 1 from public.app_suborganizations x where x.xmin = pg_catalog.pg_current_xact_id()::xid)
     or exists (select 1 from public.app_collab_members x where x.xmin = pg_catalog.pg_current_xact_id()::xid)
     or exists (select 1 from pg_class where oid = 'public.app_cleanup_s71_40_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_policy where polrelid = 'public.app_cleanup_s71_40_profiles'::regclass)
     or has_table_privilege('anon', 'public.app_cleanup_s71_40_profiles', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_cleanup_s71_40_profiles', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_cleanup_s71_40_profiles', 'select,insert,update,delete,truncate,references,trigger') then
    raise exception 'PROFILE_AFFILIATION_CLEAR_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261126202000', 'profile_affiliation_clear', array['S71-40 DATA (b): app_profiles.union_name, department_name and job_title set to null for every profile that had any of them; old values copied to public.app_cleanup_s71_40_profiles (RLS on, no policy, no API grants); display_name and columns kept; stops if a profile trigger changes assignees, profile workplaces, organizations or collab members; no other table, grant, policy, function or trigger change']);
commit;
