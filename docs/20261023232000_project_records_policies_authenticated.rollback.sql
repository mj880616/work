begin;
-- 20261023232000_project_records_policies_authenticated의 짝 되돌리기(SQL Editor 전용). 프로젝트 기록 표 정책 4개의 대상 역할을
-- authenticated에서 원래의 PUBLIC으로 되돌리고 이번 기록 1행만 지운다. 조건식·명령·permissive는 건드리지 않는다.
-- 원래 상태로 되돌리는 것이므로 정책 대상이 다시 넓어진다(표 권한에 anon·PUBLIC이 없어 실제 비로그인 접근은 지금처럼 표 권한 단계에서 막힘).
-- ED③(20261023233000)이 이미 적용된 뒤라도 ED③ 칸·검사에는 영향이 없다. 다만 ED③을 다시 적용하려면 이 파일을 먼저 다시 적용해야 한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_project_progress_updates in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261023232000' and name = 'project_records_policies_authenticated') <> 1 then
    raise exception 'PROJECT_RECORDS_POLICIES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if (select count(*) from pg_policy where polrelid = 'public.app_project_progress_updates'::regclass) <> 4
     or exists (select 1 from pg_policy where polrelid = 'public.app_project_progress_updates'::regclass
           and polroles <> array['authenticated'::regrole::oid]) then
    raise exception 'PROJECT_RECORDS_POLICIES_ROLLBACK_BLOCKED: policies changed after apply';
  end if;
end
$$;

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
           where polrelid = 'public.app_project_progress_updates'::regclass and polroles = array['authenticated'::regrole::oid]
           order by polname loop
    execute format('alter policy %I on public.app_project_progress_updates to public', p.polname);
  end loop;
  select md5(string_agg(polname || ':' || polcmd::text || ':' || polpermissive::text || ':' || coalesce(pg_get_expr(polqual, polrelid), '')
         || ':' || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' order by polname))
    into after_hash
    from pg_policy where polrelid = 'public.app_project_progress_updates'::regclass;
  if after_hash is distinct from before_hash
     or exists (select 1 from pg_policy where polrelid = 'public.app_project_progress_updates'::regclass
           and polroles <> array[0::oid]) then
    raise exception 'PROJECT_RECORDS_POLICIES_ROLLBACK_FAILED; stop';
  end if;
end
$$;

delete from supabase_migrations.schema_migrations
  where version = '20261023232000' and name = 'project_records_policies_authenticated';
commit;
