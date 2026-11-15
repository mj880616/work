begin;
-- ED③ 선행(ED③-DB 사전 확인 멈춤, 승인형 DB workflow run #58): 프로젝트 기록 표(app_project_progress_updates)의
-- 정책 대상 역할을 PUBLIC(모든 역할)에서 authenticated(로그인 사용자)로 좁힌다. 조건식(using·with check)·명령·permissive는 그대로다.
-- 원인: 이 표의 정책 4개는 저장소 migration에 없고 운영에만 있다(2026-09-27 조회 기록 docs/web2-task-impl-plan.md: roles=public,
--   공간 권한 함수 기반 4개). Task 12a(20260925084844)가 정책을 authenticated 소유자 정책으로 바꾼 32개 표 목록에 이 표가 빠져 있었다.
-- 이 표는 anon·PUBLIC 표 권한이 없어(run #58 사전 확인: anon or public table privilege = 아니오) 지금도 비로그인 접근은 표 권한 단계에서 막힌다.
-- 그래도 정책이 PUBLIC 대상이면 권한 경계가 표 권한 하나에만 기대므로, 같은 조건으로 대상만 authenticated로 좁힌다(권한 축소, 넓히지 않음).
-- 정책 이름은 저장소에 없으므로 이름을 추측하지 않고, 사전 조건이 정확히 맞을 때만(정책 4개 모두 PUBLIC 대상) 대상 역할만 바꾼다.
-- 같은 트랜잭션 안에서 바꾸기 전후의 정책 이름·명령·permissive·조건식 해시가 같은지 확인한다(다르면 전체 취소).
-- 적용 순서: 이 파일 → 20261023233000_ed_format_columns(그대로 재적용). 적용은 SQL Editor(폰 경로 C)로 한다
--   (승인형 DB workflow 확장 규칙은 기존 정책 ALTER를 `policy-drop-alter`로 거절한다). 짝 파일 5개는 docs/에 있다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_project_progress_updates in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록 없음, 앞선 기록(20261023180000) 있음, 표가 있고 RLS 켜짐·force 꺼짐,
-- anon·PUBLIC 표 권한 없음, 표 권한을 가진 역할은 소유자·authenticated·service_role·RLS 우회 역할뿐,
-- 정책은 정확히 4개이고 4개 모두 대상 역할이 PUBLIC 하나뿐(anon 등 다른 역할 섞임 없음).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023232000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261023180000' and name = 'profile_view_prefs') <> 1
     or to_regclass('public.app_project_progress_updates') is null
     or exists (select 1 from pg_class where oid = 'public.app_project_progress_updates'::regclass
           and (relrowsecurity = false or relforcerowsecurity = true))
     or exists (select 1 from pg_class where oid = 'public.app_project_progress_updates'::regclass
           and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) x
           left join pg_roles r on r.oid = x.grantee
           where c.oid = 'public.app_project_progress_updates'::regclass
             and x.grantee <> c.relowner
             and x.grantee not in ('authenticated'::regrole::oid, 'service_role'::regrole::oid)
             and not coalesce(r.rolbypassrls or r.rolsuper, false))
     or (select count(*) from pg_policy where polrelid = 'public.app_project_progress_updates'::regclass) <> 4
     or exists (select 1 from pg_policy where polrelid = 'public.app_project_progress_updates'::regclass
           and polroles <> array[0::oid]) then
    raise exception 'PROJECT_RECORDS_POLICIES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 대상 역할만 바꾼다(ALTER POLICY … TO authenticated는 using·with check를 건드리지 않는다).
do $$
declare
  p record;
  before_hash text;
  after_hash text;
begin
  select md5(string_agg(polname || ':' || polcmd::text || ':' || polpermissive::text || ':' || coalesce(pg_get_expr(polqual, polrelid), '')
         || ':' || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' order by polname))
    into before_hash
    from pg_policy where polrelid = 'public.app_project_progress_updates'::regclass;
  for p in select polname from pg_policy
           where polrelid = 'public.app_project_progress_updates'::regclass and polroles = array[0::oid]
           order by polname loop
    execute format('alter policy %I on public.app_project_progress_updates to authenticated', p.polname);
  end loop;
  select md5(string_agg(polname || ':' || polcmd::text || ':' || polpermissive::text || ':' || coalesce(pg_get_expr(polqual, polrelid), '')
         || ':' || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' order by polname))
    into after_hash
    from pg_policy where polrelid = 'public.app_project_progress_updates'::regclass;
  if after_hash is distinct from before_hash then
    raise exception 'PROJECT_RECORDS_POLICIES_CONDITION_CHANGED; stop';
  end if;
end
$$;

-- 사후 확인: 정책 4개 그대로, 모두 대상 authenticated 하나, PUBLIC·anon 대상 정책 없음, RLS·표 권한 그대로. 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_policy where polrelid = 'public.app_project_progress_updates'::regclass) <> 4
     or exists (select 1 from pg_policy where polrelid = 'public.app_project_progress_updates'::regclass
           and polroles <> array['authenticated'::regrole::oid])
     or exists (select 1 from pg_policy where polrelid = 'public.app_project_progress_updates'::regclass
           and (polroles @> array[0::oid] or polroles @> array['anon'::regrole::oid]))
     or exists (select 1 from pg_class where oid = 'public.app_project_progress_updates'::regclass
           and (relrowsecurity = false or relforcerowsecurity = true or relacl::text ~ '(^|[{,])(anon)?=')) then
    raise exception 'PROJECT_RECORDS_POLICIES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261023232000', 'project_records_policies_authenticated', array['ED③ prerequisite: app_project_progress_updates 4 policies PUBLIC -> authenticated (same conditions; no table privilege, RLS, function or data change)']);
commit;
