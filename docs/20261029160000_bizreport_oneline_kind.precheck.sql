-- SELECT only. Aggregates and hashes; no meeting text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema는 쓰지 않고 pg_catalog만 읽는다(#978).
-- 적용 전 기대: 앞 기록 둘 있음, 이번 기록 없음, 칸 검사가 여덟 값(oneline 없음), 한 줄 기록 0, RLS 켜짐, anon 권한 없음, 넓히는 정책은 task12a 하나.
--   그 밖의 개수·해시는 기록만 하고 사후 확인에서 같은 값이어야 한다(권한·칸·다른 검사·색인·정책·트리거·행 수 변화 없음).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: prerequisites recorded = 예
-- expect: new migration absent = 예
-- expect: kind check has eight kinds only = 예
-- expect: oneline rows = 0
-- expect: kinds outside the eight = 0
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: one permissive owner policy (task12a shape) = 예
-- expect: meetings rows = 기록
-- expect: tagged meetings rows = 기록
-- expect: columns hash = 기록
-- expect: other constraints hash = 기록
-- expect: indexes hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: policies hash = 기록
-- expect: triggers count = 기록
-- expect: triggers hash = 기록
select 'prerequisites recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where (version='20261022182319' and name='bizreport_activity_kind') or (version='20261028191500' and name='bizreport_area_next_plan'))=2 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261029160000') then '예' else '아니오' end
union all select 'kind check has eight kinds only',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname='app_meetings_activity_kind_check' and contype='c' and convalidated
  and pg_get_constraintdef(oid) ~ 'education' and pg_get_constraintdef(oid) ~ 'other' and pg_get_constraintdef(oid) !~ 'oneline')=1 then '예' else '아니오' end
union all select 'oneline rows',count(*)::text from public.app_meetings where activity_kind='oneline'
union all select 'kinds outside the eight',count(*)::text from public.app_meetings where activity_kind not in ('meeting','policy','negotiation','press','assembly','struggle','education','other')
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_meetings','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'one permissive owner policy (task12a shape)',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_meetings') and polpermissive)=1
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_meetings') and polname='task12a_owner_all' and polpermissive and polcmd='*'
    and polroles=array['authenticated'::regrole]::oid[]
    and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id'
    and regexp_replace(pg_get_expr(polwithcheck,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id') then '예' else '아니오' end
union all select 'meetings rows',count(*)::text from public.app_meetings
union all select 'tagged meetings rows',count(*) filter(where business_area_id is not null)::text from public.app_meetings
union all select 'columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':'||coalesce(a.attacl::text,''),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attnum>0 and not a.attisdropped
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname<>'app_meetings_activity_kind_check'
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_meetings'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_meetings')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_meetings')
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal;
