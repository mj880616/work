-- SELECT only. Run after apply. 예/아니오 항목은 모두 예, 그 밖의 값은 아래 expect 줄 또는 precheck의 같은 이름 항목과 같은 값이어야 한다
-- (회의 출처 칸 밖의 칸·제약·색인·권한·소유자 정책·트리거·회의 행 수 변화 없음).
-- 읽기 전용 역할에서 돈다: information_schema 대신 pg_catalog만 읽는다(#978).
-- expect: meeting source links = 기록
-- expect: record links rows without meeting source = 기록
select 'history, column, FKs, rules, policy and function agree' as item,case when
  (select count(*) from supabase_migrations.schema_migrations where version='20261023023500' and name='bizreport_meeting_links')=1
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_record_links') and attname='source_meeting_id' and not attisdropped and atttypid='uuid'::regtype and not attnotnull)
  and (select count(*) from pg_constraint where conrelid=to_regclass('public.app_record_links') and contype='f' and confrelid=to_regclass('public.app_meetings'))=2
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_meeting_id_fkey' and contype='f')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_source_meeting_id_fkey' and contype='f' and confdeltype='c')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_one_source'
    and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g')='CHECKnum_nonnullsgoogle_task_id,note_id,source_meeting_id=1')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_unique'
    and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g')='UNIQUENULLSNOTDISTINCTgoogle_task_id,note_id,project_id,organization_id,meeting_id,document_id,source_meeting_id')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_source_meeting_shape')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname='app_meetings_location_length_check')
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_record_links') and polname='record_links_source_meeting_ws' and not polpermissive
    and polroles=array['authenticated'::regrole]::oid[])
  and exists(select 1 from pg_proc where oid=to_regprocedure('public.app_meeting_set_links(uuid,timestamptz,jsonb)') and not prosecdef and proconfig=array['search_path=""'])
  then '예' else '아니오' end as value
union all select 'function executable by authenticated only',case when has_function_privilege('authenticated','public.app_meeting_set_links(uuid,timestamptz,jsonb)','execute')
  and not has_function_privilege('anon','public.app_meeting_set_links(uuid,timestamptz,jsonb)','execute')
  and not exists(select 1 from pg_proc where oid=to_regprocedure('public.app_meeting_set_links(uuid,timestamptz,jsonb)') and (proacl is null or proacl::text ~ '(^|[{,])(anon|service_role)?='))
  then '예' else '아니오' end
union all select 'every meeting project has its source link',case when not exists(select 1 from public.app_meetings m where m.project_id is not null
  and not exists(select 1 from public.app_record_links l where l.source_meeting_id=m.id and l.project_id=m.project_id)) then '예' else '아니오' end
union all select 'meeting source links have no summary yet',case when not exists(select 1 from public.app_record_links where source_meeting_id is not null and summary is not null) then '예' else '아니오' end
union all select 'location is text and at most 200',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_meetings') and attname='location' and not attisdropped and atttypid='text'::regtype)
  and not exists(select 1 from public.app_meetings m where length(m.location)>200) then '예' else '아니오' end
union all select 'RLS enabled on both tables',case when (select count(*) from pg_class where oid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links')) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_meetings','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_record_links','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links')) and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'meeting source links',count(*)::text from public.app_record_links where source_meeting_id is not null
union all select 'record links rows without meeting source',count(*)::text from public.app_record_links where source_meeting_id is null
union all select 'meetings rows',count(*)::text from public.app_meetings
union all select 'meetings with project rows',count(*) filter(where project_id is not null)::text from public.app_meetings
union all select 'meetings other columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attnum>0 and not a.attisdropped and a.attname<>'location'
union all select 'record links other columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_record_links') and a.attnum>0 and not a.attisdropped and a.attname<>'source_meeting_id'
union all select 'meetings other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname<>'app_meetings_location_length_check'
union all select 'record links kept constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_record_links')
    and conname not in ('app_record_links_one_source','app_record_links_unique','app_record_links_source_meeting_id_fkey','app_record_links_source_meeting_shape')
union all select 'indexes hash',md5(coalesce(string_agg(tablename||':'||indexname||':'||indexdef,',' order by tablename,indexname),''))
  from pg_indexes where schemaname='public' and tablename in ('app_meetings','app_record_links')
    and indexname not in ('app_record_links_unique','app_record_links_source_meeting_idx')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links'))
union all select 'record links owner policy hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_record_links') and polname<>'record_links_source_meeting_ws'
union all select 'meetings policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_meetings')
union all select 'triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||':'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links')) and not tgisinternal;
