-- SELECT only. Run after apply. 예/아니오 항목은 모두 예, 그 밖의 값은 아래 expect 줄 또는 precheck의 같은 이름 항목과 같은 값이어야 한다
-- (참고 연결 칸 밖의 칸·제약·색인·권한·기존 정책·트리거·연결/업무공간/메모 행 수 변화 없음).
-- 읽기 전용 역할에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- expect: reference bundles rows = 기록
-- expect: reference links = 0
-- expect: record links policies = 3
select 'history, table, column, FK, rules, policies and functions agree' as item,case when
  (select count(*) from supabase_migrations.schema_migrations where version='20261023231500' and name='ref_bundle_db')=1
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_record_links') and attname='bundle_id' and not attisdropped and atttypid='uuid'::regtype and not attnotnull)
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_bundle_id_fkey' and contype='f'
    and confrelid=to_regclass('public.app_reference_bundles') and confdeltype='r')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_one_target'
    and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g')='CHECKnum_nonnullsproject_id,organization_id,meeting_id,document_id,bundle_id=1')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_unique'
    and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g')='UNIQUENULLSNOTDISTINCTgoogle_task_id,note_id,project_id,organization_id,meeting_id,document_id,source_meeting_id,bundle_id')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_bundle_shape')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_one_source'
    and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g')='CHECKnum_nonnullsgoogle_task_id,note_id,source_meeting_id=1')
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_record_links') and polname='record_links_bundle_ws' and not polpermissive
    and polroles=array['authenticated'::regrole]::oid[])
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_reference_bundles') and polname='reference_bundles_owner_all' and polpermissive and polcmd='*'
    and polroles=array['authenticated'::regrole]::oid[] and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id')
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_reference_bundles'))=1
  and (select count(*) from pg_proc where oid in (to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)'),to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)'))
    and not prosecdef and proconfig=array['search_path=""'] and prosrc like '%app_reference_bundles%')=2
  then '예' else '아니오' end as value
union all select 'both functions executable by authenticated only',case when has_function_privilege('authenticated','public.app_basket_confirm_links(uuid,timestamptz,jsonb)','execute')
  and has_function_privilege('authenticated','public.app_basket_update_link_summary(uuid,text,text)','execute')
  and not has_function_privilege('anon','public.app_basket_confirm_links(uuid,timestamptz,jsonb)','execute')
  and not has_function_privilege('anon','public.app_basket_update_link_summary(uuid,text,text)','execute')
  and not exists(select 1 from pg_proc where oid in (to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)'),to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)'))
    and (proacl is null or proacl::text ~ '(^|[{,])(anon)?=')) then '예' else '아니오' end
union all select 'reference bundles table: RLS on, no anon, public or service_role privilege, no truncate',case when exists(select 1 from pg_class where oid=to_regclass('public.app_reference_bundles') and relrowsecurity
    and coalesce(relacl::text,'') !~ '(^|[{,])(anon|service_role)?=')
  and not has_table_privilege('anon','public.app_reference_bundles','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.app_reference_bundles','truncate,references,trigger')
  and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_reference_bundles') and coalesce(attacl::text,'') ~ '(^|[{,])(anon|service_role)?=') then '예' else '아니오' end
union all select 'every workspace has the three starter bundles',case when not exists(select 1 from public.app_workspaces w where (select count(*) from public.app_reference_bundles b
    where b.workspace_id=w.id and ((b.name='공공운수노조' and b.sort_order=10) or (b.name='공공기관사업(본부)' and b.sort_order=20) or (b.name='기타 조직' and b.sort_order=30)))<>3) then '예' else '아니오' end
union all select 'RLS enabled on record links',case when exists(select 1 from pg_class where oid=to_regclass('public.app_record_links') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege on record links',case when not has_table_privilege('anon','public.app_record_links','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_record_links') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'record links policies',count(*)::text from pg_policy where polrelid=to_regclass('public.app_record_links')
union all select 'reference bundles rows',count(*)::text from public.app_reference_bundles
union all select 'reference links',count(*)::text from public.app_record_links where bundle_id is not null
union all select 'workspaces',count(*)::text from public.app_workspaces
union all select 'notes rows',count(*)::text from public.app_notes
union all select 'record links rows',count(*)::text from public.app_record_links
union all select 'record links other columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_record_links') and a.attnum>0 and not a.attisdropped and a.attname<>'bundle_id'
union all select 'record links kept constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_record_links')
    and conname not in ('app_record_links_one_target','app_record_links_unique','app_record_links_bundle_id_fkey','app_record_links_bundle_shape')
union all select 'record links indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),''))
  from pg_indexes where schemaname='public' and tablename='app_record_links'
    and indexname not in ('app_record_links_unique','app_record_links_bundle_idx')
union all select 'record links owner RLS grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid=to_regclass('public.app_record_links')
union all select 'record links kept policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_record_links') and polname<>'record_links_bundle_ws'
union all select 'record links triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=to_regclass('public.app_record_links') and not tgisinternal
union all select 'confirm function acl hash',md5(coalesce(proacl::text,'none')) from pg_proc where oid=to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)')
union all select 'summary function acl hash',md5(coalesce(proacl::text,'none')) from pg_proc where oid=to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)');
