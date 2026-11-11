-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(앱 표의 행 값은 읽지 않는다).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 해시 항목은 기록만 하고 사후 확인에서 같은 이름의 값과 같아야 한다(권한·정책·기존 칸·기존 트리거 그대로).
-- 'profiles authenticated table update'가 예여야 새 칸에 따로 권한을 주지 않아도 된다(칸 단위 권한이면 멈춤).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: documents old triggers hash = 기록
-- expect: profiles policies hash = 기록
-- expect: profiles table grants hash = 기록
-- expect: profiles old column grants hash = 기록
-- expect: profiles old constraints hash = 기록
-- expect: folder items policies hash = 기록
-- expect: folder items table grants hash = 기록
-- expect: folders policies hash = 기록
-- expect: folders table grants hash = 기록
with p as (select to_regclass('public.app_profiles') as r),
     d as (select to_regclass('public.app_documents') as r),
     f as (select to_regclass('public.app_library_folders') as r),
     i as (select to_regclass('public.app_library_folder_items') as r),
     m as (select to_regclass('public.app_workspace_members') as r)
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261111181000') then '예' else '아니오' end as value
union all select 'prerequisite recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261025180000' and name='trash_library_folder_db')=1 then '예' else '아니오' end
union all select 'folder tables shape',case when (select r from f) is not null and (select r from i) is not null
  and (select count(*) from pg_attribute where attrelid=(select r from f) and attnum>0 and not attisdropped
    and ((attname in ('id','workspace_id') and atttypid='uuid'::regtype) or (attname='deleted_at' and atttypid='timestamptz'::regtype)))=3
  and (select count(*) from pg_attribute where attrelid=(select r from i) and attnum>0 and not attisdropped and attname in ('document_id','folder_id','workspace_id') and atttypid='uuid'::regtype)=3
  and exists(select 1 from pg_constraint where conrelid=(select r from i) and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (document_id)') then '예' else '아니오' end
union all select 'documents members profiles shape',case when (select r from d) is not null and (select r from m) is not null and (select r from p) is not null
  and (select count(*) from pg_attribute where attrelid=(select r from d) and attnum>0 and not attisdropped and attname in ('id','workspace_id') and atttypid='uuid'::regtype)=2
  and (select count(*) from pg_attribute where attrelid=(select r from m) and attnum>0 and not attisdropped
    and ((attname in ('workspace_id','user_id') and atttypid='uuid'::regtype) or (attname='role' and atttypid='text'::regtype)))=3
  and (select count(*) from pg_attribute where attrelid=(select r from p) and attnum>0 and not attisdropped and attname='user_id' and atttypid='uuid'::regtype)=1 then '예' else '아니오' end
union all select 'receive column function trigger absent',case when not exists(select 1 from pg_attribute where attrelid=(select r from p) and not attisdropped and attname='library_receive_folder')
  and not exists(select 1 from pg_constraint where conrelid=(select r from p) and conname='app_profiles_library_receive_folder_fkey')
  and to_regclass('public.app_profiles_library_receive_folder_idx') is null
  and to_regprocedure('private.app_documents_receive_folder()') is null
  and not exists(select 1 from pg_trigger where tgrelid=(select r from d) and tgname='app_documents_receive_folder') then '예' else '아니오' end
union all select 'profiles RLS on and no anon or PUBLIC',case when (select relrowsecurity from pg_class where oid=(select r from p))
  and not exists(select 1 from pg_class where oid=(select r from p) and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'profiles authenticated table update',case when exists(select 1 from pg_class where oid=(select r from p) and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w') then '예' else '아니오' end
union all select 'two owner policies',case when (select count(*) from pg_policy where polrelid=(select r from p))=2
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_owner_all' and permissive='PERMISSIVE' and cmd='ALL' and roles=array['authenticated']::name[])
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_profile_self_select' and permissive='PERMISSIVE' and cmd='SELECT' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'folder item document tables RLS and no anon or PUBLIC',case when not exists(select 1 from pg_class where oid in ((select r from f),(select r from i),(select r from d))
  and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?=')) then '예' else '아니오' end
union all select 'documents old triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=(select r from d) and not tgisinternal and tgname<>'app_documents_receive_folder'
union all select 'profiles policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=(select r from p)
union all select 'profiles table grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=(select r from p)
union all select 'profiles old column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),''))
  from pg_attribute where attrelid=(select r from p) and attnum>0 and not attisdropped and attname<>'library_receive_folder'
union all select 'profiles old constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=(select r from p) and conname<>'app_profiles_library_receive_folder_fkey'
union all select 'folder items policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=(select r from i)
union all select 'folder items table grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=(select r from i)
union all select 'folders policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=(select r from f)
union all select 'folders table grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=(select r from f);
