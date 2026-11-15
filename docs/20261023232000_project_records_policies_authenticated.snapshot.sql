-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 프로젝트 기록 표(app_project_progress_updates)의 정책 원문(이름·명령·대상 역할·permissive·조건식), 표 소유자·RLS·권한, 앞뒤 기록.
-- 이 표의 정책은 저장소 migration에 정의가 없어 이 결과가 운영 정의의 유일한 사본이다. 되돌리기·검토 때 이 캡처와 대조한다.
with t as (select to_regclass('public.app_project_progress_updates') as rel)
select 'policy' as kind,p.polname::text as name,
  'cmd='||p.polcmd::text||':roles='||coalesce((select string_agg(case when r=0 then 'PUBLIC' else coalesce(g.rolname::text,r::text) end,',')
    from unnest(p.polroles) as r left join pg_roles g on g.oid=r),'')||':permissive='||p.polpermissive::text
  ||':using='||coalesce(pg_get_expr(p.polqual,p.polrelid),'none')||':check='||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'none') as definition
from t join pg_policy p on p.polrelid=t.rel
union all select 'owner RLS grants','project records',c.relowner::regrole::text||':rls='||c.relrowsecurity::text||':force='||c.relforcerowsecurity::text||':acl='||coalesce(c.relacl::text,'none') from t join pg_class c on c.oid=t.rel
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261023180000','20261023232000','20261023233000')
order by 1,2;
