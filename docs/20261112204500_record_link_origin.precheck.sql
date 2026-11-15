-- SELECT only. Aggregates and hashes; no note or link text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- 적용 전 기대: origin 칸·제약 없음, 선행 20261023231500 적용됨, 연결 표 RLS 켜짐·anon/PUBLIC 권한 없음·정책 셋,
--   넓힐 함수 본문이 저장소(20261023231500)와 같고 INVOKER·search_path 고정·anon/PUBLIC 실행권 없음. 하나라도 다르면 멈춘다.
-- 개수·해시는 기록만 하고 사후 확인에서 같은 이름 항목이 같은 값이어야 한다(바뀌는 칸·제약은 해시에서 뺐다).
-- expect: origin column count = 0
-- expect: record links policies = 3
-- expect: notes rows = 기록
-- expect: record links rows = 기록
-- expect: record links other columns hash = 기록
-- expect: record links kept constraints hash = 기록
-- expect: record links indexes hash = 기록
-- expect: record links owner RLS grants hash = 기록
-- expect: record links policies hash = 기록
-- expect: record links triggers hash = 기록
-- expect: confirm function acl hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261112204500') then '예' else '아니오' end as value
union all select 'prerequisite ref_bundle_db recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261023231500' and name='ref_bundle_db')=1 then '예' else '아니오' end
union all select 'origin column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_record_links') and attname='origin' and not attisdropped
union all select 'origin constraint absent',case when not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_origin_check') then '예' else '아니오' end
union all select 'RLS enabled on record links',case when exists(select 1 from pg_class where oid=to_regclass('public.app_record_links') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_record_links','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_record_links') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'record links policies',count(*)::text from pg_policy where polrelid=to_regclass('public.app_record_links')
union all select 'confirm function is the repository body, invoker, fixed path, no anon or public',case when exists(select 1 from pg_proc
  where oid=to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)') and not prosecdef and proconfig=array['search_path=""']
    and md5(prosrc)='09b630287dc131bff594407893c58d0f' and proacl::text !~ '(^|[{,])(anon)?=' and has_function_privilege('authenticated',oid,'execute')) then '예' else '아니오' end
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
