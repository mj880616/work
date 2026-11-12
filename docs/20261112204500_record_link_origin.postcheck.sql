-- SELECT only. Run after apply. 예/아니오 항목은 모두 예, 그 밖의 값은 precheck의 같은 이름 항목과 같은 값이어야 한다
-- (origin 칸 밖의 칸·제약·색인·권한·정책·트리거·메모/연결 행 수 변화 없음). 읽기 전용 역할에서 돈다: pg_catalog만 읽는다.
-- expect: origin column count = 1
-- expect: record links policies = 3
-- expect: origin marked rows = 0
select 'history recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261112204500' and name='record_link_origin')=1 then '예' else '아니오' end as value
union all select 'origin column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_record_links') and attname='origin' and not attisdropped
  and atttypid='text'::regtype and not attnotnull and not atthasdef
union all select 'origin constraint present',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_origin_check' and contype='c') then '예' else '아니오' end
union all select 'RLS enabled on record links',case when exists(select 1 from pg_class where oid=to_regclass('public.app_record_links') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_record_links','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_record_links') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'record links policies',count(*)::text from pg_policy where polrelid=to_regclass('public.app_record_links')
union all select 'confirm function stores origin, invoker, fixed path, authenticated only',case when exists(select 1 from pg_proc
  where oid=to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)') and not prosecdef and proconfig=array['search_path=""']
    and prosrc like '%record_input%' and proacl::text !~ '(^|[{,])(anon)?=' and has_function_privilege('authenticated',oid,'execute')
    and not has_function_privilege('anon',oid,'execute')) then '예' else '아니오' end
union all select 'origin marked rows',count(*)::text from public.app_record_links where origin is not null
union all select 'notes rows',count(*)::text from public.app_notes
union all select 'record links rows',count(*)::text from public.app_record_links
union all select 'record links other columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_record_links') and a.attnum>0 and not a.attisdropped and a.attname<>'origin'
union all select 'record links kept constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname<>'app_record_links_origin_check'
union all select 'record links indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),''))
  from pg_indexes where schemaname='public' and tablename='app_record_links'
union all select 'record links owner RLS grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid=to_regclass('public.app_record_links')
union all select 'record links policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_record_links')
union all select 'record links triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=to_regclass('public.app_record_links') and not tgisinternal
union all select 'confirm function acl hash',md5(coalesce(proacl::text,'none')) from pg_proc where oid=to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)');
