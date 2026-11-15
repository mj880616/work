-- SELECT only. Aggregates and hashes; no note, link or bundle text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- 적용 전 기대: 묶음 표·bundle_id 칸·새 제약·새 정책 없음, 선행 20261023023500 적용됨, 연결 표의 출처·중복·도착지 규칙이 저장소 마지막 모양,
--   연결 표 RLS 켜짐·anon/PUBLIC 권한 없음·정책은 소유자 정책 + 회의 좁히기 정책 둘, 넓힐 함수 2개의 본문이 저장소(20261012100000)와 같고
--   INVOKER·search_path 고정·anon/PUBLIC 실행권 없음. 하나라도 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- 개수·해시는 기록만 하고 사후 확인에서 같은 이름 항목이 같은 값이어야 한다(바뀌는 칸·제약·색인·정책은 해시에서 뺐다).
-- expect: reference bundles table count = 0
-- expect: bundle column count = 0
-- expect: record links policies = 2
-- expect: workspaces = 기록
-- expect: notes rows = 기록
-- expect: record links rows = 기록
-- expect: record links other columns hash = 기록
-- expect: record links kept constraints hash = 기록
-- expect: record links indexes hash = 기록
-- expect: record links owner RLS grants hash = 기록
-- expect: record links kept policies hash = 기록
-- expect: record links triggers hash = 기록
-- expect: confirm function acl hash = 기록
-- expect: summary function acl hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261023231500') then '예' else '아니오' end as value
union all select 'prerequisite bizreport_meeting_links recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261023023500' and name='bizreport_meeting_links')=1 then '예' else '아니오' end
union all select 'tables and owner helper exist',case when to_regclass('public.app_record_links') is not null and to_regclass('public.app_workspaces') is not null
  and to_regclass('public.app_notes') is not null and to_regprocedure('private.app_is_workspace_owner(uuid)') is not null then '예' else '아니오' end
union all select 'reference bundles table count',(case when to_regclass('public.app_reference_bundles') is null then 0 else 1 end)::text
union all select 'bundle column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_record_links') and attname='bundle_id' and not attisdropped
union all select 'new constraints, policy and index absent',case when not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links')
    and conname in ('app_record_links_bundle_id_fkey','app_record_links_one_target_bundle','app_record_links_unique_bundle','app_record_links_bundle_shape'))
  and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_record_links') and polname='record_links_bundle_ws')
  and not exists(select 1 from pg_indexes where schemaname='public' and indexname='app_record_links_bundle_idx') then '예' else '아니오' end
union all select 'source, unique and target rules are the repository shape',case when
  exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_one_source'
    and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g')='CHECKnum_nonnullsgoogle_task_id,note_id,source_meeting_id=1')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_unique'
    and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g')='UNIQUENULLSNOTDISTINCTgoogle_task_id,note_id,project_id,organization_id,meeting_id,document_id,source_meeting_id')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_one_target'
    and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g')='CHECKnum_nonnullsproject_id,organization_id,meeting_id,document_id=1') then '예' else '아니오' end
union all select 'RLS enabled on record links',case when exists(select 1 from pg_class where oid=to_regclass('public.app_record_links') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_record_links','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_record_links') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'record links policies',count(*)::text from pg_policy where polrelid=to_regclass('public.app_record_links')
union all select 'owner policy and meeting restrictive policy only',case when
  exists(select 1 from pg_policy where polrelid=to_regclass('public.app_record_links') and polname='record_links_owner_all' and polpermissive and polcmd='*'
    and polroles=array['authenticated'::regrole]::oid[] and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id')
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_record_links') and polname='record_links_source_meeting_ws' and not polpermissive) then '예' else '아니오' end
union all select 'confirm function is the repository body, invoker, fixed path, no anon or public',case when exists(select 1 from pg_proc
  where oid=to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)') and not prosecdef and proconfig=array['search_path=""']
    and md5(prosrc)='d668d59c4a495730dfb93dcca8f73304' and proacl::text !~ '(^|[{,])(anon)?=' and has_function_privilege('authenticated',oid,'execute')) then '예' else '아니오' end
union all select 'summary function is the repository body, invoker, fixed path, no anon or public',case when exists(select 1 from pg_proc
  where oid=to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)') and not prosecdef and proconfig=array['search_path=""']
    and md5(prosrc)='91ae418dace64f47a48deff88a65074f' and proacl::text !~ '(^|[{,])(anon)?=' and has_function_privilege('authenticated',oid,'execute')) then '예' else '아니오' end
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
