-- SELECT only. Aggregates and hashes; no meeting text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema는 쓰지 않고 pg_catalog만 읽는다(#978).
-- 적용 전 기대: 새 기록·칸·검사·외래키·정책 없음, 같은 업무공간 확인 함수 있음, RLS 켜짐, anon 권한 없음, 넓히는 정책은 task12a 하나.
--   그 밖의 개수·해시는 기록만 하고 사후 확인에서 같은 값이어야 한다(권한·다른 칸·다른 검사·색인·트리거·행 수 변화 없음).
-- expect: new columns count = 0
-- expect: new constraints count = 0
-- expect: new policy count = 0
-- expect: anon or public table privilege = 아니오
-- expect: meetings rows = 기록
-- expect: meetings with project rows = 기록
-- expect: projects rows = 기록
-- expect: other columns hash = 기록
-- expect: other constraints hash = 기록
-- expect: indexes hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: other policies hash = 기록
-- expect: triggers count = 기록
-- expect: triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261028191500') then '예' else '아니오' end as value
union all select 'meetings and projects tables exist',case when to_regclass('public.app_meetings') is not null and to_regclass('public.app_spaces') is not null then '예' else '아니오' end
union all select 'new columns count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_meetings') and attname in ('business_area_id','next_plan') and not attisdropped
union all select 'new constraints count',count(*)::text from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname in ('app_meetings_business_area_id_fkey','app_meetings_next_plan_check')
union all select 'new policy count',count(*)::text from pg_policy where polrelid=to_regclass('public.app_meetings') and polname='app_meetings_business_area_ws'
union all select 'workspace check function is definer',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_space_in_workspace(uuid,uuid)') and prosecdef and prorettype='boolean'::regtype) then '예' else '아니오' end
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_meetings','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'one permissive owner policy (task12a shape)',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_meetings') and polpermissive)=1
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_meetings') and polname='task12a_owner_all' and polpermissive and polcmd='*'
    and polroles=array['authenticated'::regrole]::oid[]
    and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id'
    and regexp_replace(pg_get_expr(polwithcheck,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id') then '예' else '아니오' end
union all select 'meetings rows',count(*)::text from public.app_meetings
union all select 'meetings with project rows',count(*) filter(where project_id is not null)::text from public.app_meetings
union all select 'projects rows',count(*)::text from public.app_spaces
union all select 'other columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':'||coalesce(a.attacl::text,'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attnum>0 and not a.attisdropped and a.attname not in ('business_area_id','next_plan')
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname not in ('app_meetings_business_area_id_fkey','app_meetings_next_plan_check')
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_meetings'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_meetings')
union all select 'other policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_meetings') and polname<>'app_meetings_business_area_ws'
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal;
