-- SELECT only. Aggregates and hashes; no report or event text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema는 쓰지 않고 pg_catalog만 읽는다(#978).
-- 적용 전 기대: 이번 기록·새 표·새 칸·새 검사·새 색인 없음, 사업 보고 표 RLS 켜짐, anon 권한 없음, 넓히는 정책은 task12a 하나.
--   그 밖의 개수·해시는 기록만 하고 사후 확인에서 같은 값이어야 한다(권한·다른 칸·다른 검사·다른 색인·정책·트리거 변화 없음).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: new migration absent = 예
-- expect: report plans table absent = 예
-- expect: owner check function present = 예
-- expect: new link column count = 0
-- expect: new link check count = 0
-- expect: new link index count = 0
-- expect: meetings RLS enabled = 예
-- expect: anon or public privilege on meetings = 아니오
-- expect: one permissive owner policy (task12a shape) = 예
-- expect: meetings other columns hash = 기록
-- expect: meetings other constraints hash = 기록
-- expect: meetings other indexes hash = 기록
-- expect: meetings owner RLS grants hash = 기록
-- expect: meetings policies hash = 기록
-- expect: meetings triggers count = 기록
-- expect: meetings triggers hash = 기록
-- expect: workspaces grants policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261111020000') then '예' else '아니오' end as value
union all select 'report plans table absent',case when to_regclass('public.app_calendar_report_plans') is null then '예' else '아니오' end
union all select 'owner check function present',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'new link column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_meetings') and attname in ('google_calendar_id','google_event_id') and not attisdropped
union all select 'new link check count',count(*)::text from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname in ('app_meetings_google_link_pair_check','app_meetings_google_event_id_check','app_meetings_google_calendar_id_check')
union all select 'new link index count',count(*)::text from pg_indexes where schemaname='public' and indexname='app_meetings_google_event_idx'
union all select 'meetings RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public privilege on meetings',case when has_table_privilege('anon',to_regclass('public.app_meetings'),'select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'one permissive owner policy (task12a shape)',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_meetings') and polpermissive)=1
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_meetings') and polname='task12a_owner_all' and polpermissive and polcmd='*'
    and polroles=array['authenticated'::regrole]::oid[]
    and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id'
    and regexp_replace(pg_get_expr(polwithcheck,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id') then '예' else '아니오' end
union all select 'meetings other columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':'||coalesce(a.attacl::text,'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attnum>0 and not a.attisdropped and a.attname not in ('google_calendar_id','google_event_id')
union all select 'meetings other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname not in ('app_meetings_google_link_pair_check','app_meetings_google_event_id_check','app_meetings_google_calendar_id_check')
union all select 'meetings other indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_meetings' and indexname<>'app_meetings_google_event_idx'
union all select 'meetings owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_meetings')
union all select 'meetings policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_meetings')
union all select 'meetings triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal
union all select 'meetings triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal
union all select 'workspaces grants policies hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_workspaces')),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_workspaces')),''));
