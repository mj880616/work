-- SELECT only. Aggregates and hashes; no meeting text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema는 행을 숨기므로 쓰지 않고 pg_catalog(pg_attribute·pg_constraint·pg_policy 등)만 읽는다(#978).
-- 적용 전 기대: new migration absent 예 / meetings table exists 예 / new column 0 / new check 0 / RLS 예 / anon 아니오 / owner policy 예.
--   그 밖의 개수·해시는 기록만 하고 사후 확인에서 같은 값이어야 한다(권한·정책·트리거·색인·다른 칸·행 수 변화 없음).
-- 설계 9절 "착수 때 read-only로 확인할 것" 중 웹 세션이 못 본 것은 아래 '기록' 항목으로 적용 때 workflow가 확인한다
--   (장소 칸 유무·글자 칸인지·채워진 행 수, updated_at 기본값, 행 수, project_id 있는 행 수, 연결 표 행 수·회의로 가는 FK 수, B1 칸 유무).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: new column count = 0
-- expect: new check count = 0
-- expect: anon or public table privilege = 아니오
-- expect: location column count = 기록
-- expect: location column is text = 기록
-- expect: location filled rows = 기록
-- expect: updated_at has default = 기록
-- expect: meetings rows = 기록
-- expect: meetings with project rows = 기록
-- expect: record links rows = 기록
-- expect: record links FKs to meetings = 기록
-- expect: record links source_meeting_id column count = 기록
-- expect: other columns hash = 기록
-- expect: other constraints hash = 기록
-- expect: indexes hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: policies hash = 기록
-- expect: triggers count = 기록
-- expect: triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261022182319') then '예' else '아니오' end as value
union all select 'meetings table exists',case when to_regclass('public.app_meetings') is not null then '예' else '아니오' end
union all select 'new column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_meetings') and attname='activity_kind' and not attisdropped
union all select 'new check count',count(*)::text from pg_constraint where connamespace='public'::regnamespace and conname='app_meetings_activity_kind_check'
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_meetings','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'owner policy only (task12a shape)',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_meetings'))=1
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_meetings') and polname='task12a_owner_all' and polpermissive and polcmd='*'
    and polroles=array['authenticated'::regrole]::oid[]
    and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id'
    and regexp_replace(pg_get_expr(polwithcheck,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id') then '예' else '아니오' end
union all select 'location column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_meetings') and attname='location' and not attisdropped
union all select 'location column is text',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_meetings') and attname='location' and not attisdropped
  and atttypid='text'::regtype) then '예' else '아니오' end
union all select 'location filled rows',count(*) filter(where nullif(btrim(to_jsonb(m)->>'location'),'') is not null)::text from public.app_meetings m
union all select 'updated_at has default',case when exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attname='updated_at' and not a.attisdropped) then '예' else '아니오' end
union all select 'meetings rows',count(*)::text from public.app_meetings
union all select 'meetings with project rows',count(*) filter(where project_id is not null)::text from public.app_meetings
union all select 'record links rows',count(*)::text from public.app_record_links
union all select 'record links FKs to meetings',count(*)::text from pg_constraint where conrelid=to_regclass('public.app_record_links') and contype='f' and confrelid=to_regclass('public.app_meetings')
union all select 'record links source_meeting_id column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_record_links') and attname='source_meeting_id' and not attisdropped
union all select 'other columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attnum>0 and not a.attisdropped and a.attname<>'activity_kind'
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname<>'app_meetings_activity_kind_check'
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_meetings'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_meetings')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_meetings')
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal;
