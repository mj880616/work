-- SELECT only. Aggregates and hashes; no organization name, stage name or history text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- 적용 전 기대: 단계 표·이력 표·삭제 함수 없음, 담당조직 표 RLS 켜짐·anon/PUBLIC 권한 없음·소유자 정책 그대로, 소유자 도우미 함수 둘 있음.
--   하나라도 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다). 담당조직 표의 정책·권한 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: dispute stages table count = 0
-- expect: dispute history table count = 0
-- expect: dispute delete function count = 0
-- expect: suborganizations rows = 기록
-- expect: suborganizations policies hash = 기록
-- expect: suborganizations owner RLS grants hash = 기록
-- expect: suborganizations triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261024100000') then '예' else '아니오' end as value
union all select 'tables and owner helpers exist',case when to_regclass('public.app_suborganizations') is not null and to_regclass('public.app_workspaces') is not null
  and to_regprocedure('private.app_is_workspace_owner(uuid)') is not null and to_regprocedure('private.app_is_owner_organization(uuid)') is not null then '예' else '아니오' end
union all select 'dispute stages table count',(case when to_regclass('public.app_dispute_stages') is null then 0 else 1 end)::text
union all select 'dispute history table count',(case when to_regclass('public.app_suborganization_dispute_stages') is null then 0 else 1 end)::text
union all select 'dispute delete function count',(case when to_regprocedure('public.app_dispute_stage_delete(uuid,boolean)') is null then 0 else 1 end)::text
union all select 'RLS enabled on suborganizations',case when exists(select 1 from pg_class where oid=to_regclass('public.app_suborganizations') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege on suborganizations',case when not has_table_privilege('anon','public.app_suborganizations','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_suborganizations') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'suborganizations owner policy is authenticated owner-only',case when exists(select 1 from pg_policy where polrelid=to_regclass('public.app_suborganizations') and polname='task12a_owner_all' and polpermissive and polcmd='*'
    and polroles=array['authenticated'::regrole]::oid[] and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id') then '예' else '아니오' end
union all select 'suborganizations rows',count(*)::text from public.app_suborganizations
union all select 'suborganizations policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_suborganizations')
union all select 'suborganizations owner RLS grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid=to_regclass('public.app_suborganizations')
union all select 'suborganizations triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=to_regclass('public.app_suborganizations') and not tgisinternal;
