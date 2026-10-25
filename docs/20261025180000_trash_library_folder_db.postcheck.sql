-- SELECT only. Run after apply (all 예 expected) or after rollback ('objects and history agree' = 예, 'trash installed' = 아니오).
-- 숫자·해시 항목(행 수·외래키·트리거·제약·칸·권한·정책·행 해시·service_role 읽기 권한)은 사전 확인의 같은 이름 항목과 같아야 한다.
-- 새로 생긴 칸·제약·트리거·정책은 해시와 목록에서 뺀다(새로 생긴 것만 다르다). 담당조직·사업 보고·프로젝트 휴지통은 이번에 바꾸지 않는다.
with history as (
  select count(*) as n,count(*) filter(where name='trash_library_folder_db') as named
  from supabase_migrations.schema_migrations where version='20261025180000'
), cols as (
  select count(*) as n,
    count(*) filter(where attname='deleted_at' and atttypid='timestamptz'::regtype and not attnotnull and not atthasdef) as at_ok,
    count(*) filter(where attname='deleted_root_id' and atttypid='uuid'::regtype and not attnotnull and not atthasdef) as root_ok
  from pg_attribute where attrelid=to_regclass('public.app_library_folders') and not attisdropped and attname in ('deleted_at','deleted_root_id')
), pair as (
  select count(*) as n,count(*) filter(where pg_get_constraintdef(oid) like '%deleted_at IS NULL%' and pg_get_constraintdef(oid) like '%deleted_root_id IS NULL%') as valid
  from pg_constraint where conrelid=to_regclass('public.app_library_folders') and conname='app_library_folders_trash_pair_check'
), trg as (
  select count(*) as n,count(*) filter(where tgenabled='O' and tgfoid=to_regprocedure('private.app_trash_library_folder_before_delete()')
    and pg_get_triggerdef(oid) like '%BEFORE DELETE ON public.app_library_folders FOR EACH ROW%') as valid
  from pg_trigger where tgrelid=to_regclass('public.app_library_folders') and tgname='app_library_folders_a_trash_before_delete'
), pol as (
  select count(*) as n,count(*) filter(where not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
    and pg_get_expr(polqual,polrelid)='(deleted_at IS NULL)' and pg_get_expr(polwithcheck,polrelid)='((deleted_at IS NULL) AND (deleted_root_id IS NULL))') as valid
  from pg_policy where polrelid=to_regclass('public.app_library_folders') and polname='app_library_folders_trash_hidden'
), first_trg as (
  select tgname from pg_trigger where tgrelid=to_regclass('public.app_library_folders') and not tgisinternal and (tgtype & 1)=1 and (tgtype & 2)=2 and (tgtype & 8)=8 order by convert_to(tgname::text,'UTF8') limit 1
), fns as (
  select count(*) as n,
    count(*) filter(where p.prosecdef and p.proconfig=array['search_path=""']
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0)
      and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')) as valid
  from pg_proc p where p.oid=to_regprocedure('private.app_trash_library_folder_before_delete()')
), rpc as (
  -- RPC 3개: 적용 뒤에는 자료실 폴더까지 알고, 되돌린 뒤에는 앞 단계(프로젝트·담당조직·사업 보고) 모양이다. 어느 쪽이든 서명·DEFINER·search_path·권한은 같아야 한다.
  select count(*) as n,
    count(*) filter(where p.prosecdef and p.proconfig=array['search_path=""']
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0)
      and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
      and has_function_privilege('authenticated',p.oid,'execute')) as valid,
    count(*) filter(where p.prosrc like '%app_library_folders%' and p.prosrc like '%app_suborganizations%' and p.prosrc like '%app_meetings%' and p.prosrc like '%public.app_spaces%') as wide,
    count(*) filter(where p.prosrc not like '%app_library_folders%' and p.prosrc like '%app_suborganizations%' and p.prosrc like '%app_meetings%' and p.prosrc like '%public.app_spaces%') as narrow
  from pg_proc p where p.oid in (to_regprocedure('public.app_trash_list(text)'),to_regprocedure('public.app_trash_restore(text,uuid)'),to_regprocedure('public.app_trash_purge(text,uuid)'))
), installed as (
  select (select n from cols)=2 and (select at_ok from cols)=1 and (select root_ok from cols)=1 and (select n from pair)=1 and (select valid from pair)=1
    and (select n from trg)=1 and (select valid from trg)=1 and (select n from pol)=1 and (select valid from pol)=1 and to_regclass('public.app_library_folders_trash_idx') is not null
    and (select n from fns)=1 and (select valid from fns)=1 and (select n from rpc)=3 and (select valid from rpc)=3 and (select wide from rpc)=3 as ok
), removed as (
  select (select n from cols)=0 and (select n from pair)=0 and (select n from trg)=0 and (select n from pol)=0 and to_regclass('public.app_library_folders_trash_idx') is null
    and (select n from fns)=0 and (select n from rpc)=3 and (select valid from rpc)=3 and (select narrow from rpc)=3 as ok
)
select 'objects and history agree' as item,case when ((select n from history)=0 and (select ok from removed))
  or ((select n from history)=1 and (select named from history)=1 and (select ok from installed)) then '예' else '아니오' end as ok
union all select 'trash installed',case when (select ok from installed) then '예' else '아니오' end
union all select 'folder trash trigger runs first',case when (select n from trg)=0 or (select tgname from first_trg)='app_library_folders_a_trash_before_delete' then '예' else '아니오' end
union all select 'existing folder guard and lift triggers still present',case when (select count(*) from pg_trigger where tgrelid=to_regclass('public.app_library_folders') and not tgisinternal and tgenabled='O' and tgname in ('app_library_folders_tree_guard','app_library_folders_lift_on_delete'))=2 then '예' else '아니오' end
union all select 'organization and report trash still installed',case when exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_suborganizations') and tgname='app_suborganizations_a_trash_before_delete' and tgenabled='O')
  and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_meetings') and tgname='app_meetings_a_trash_before_delete' and tgenabled='O') then '예' else '아니오' end
union all select 'project trash still installed',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_spaces') and attname in ('deleted_at') and not attisdropped)
  and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_spaces') and tgname='app_spaces_a_trash_before_delete' and tgenabled='O')
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_spaces') and polname='app_spaces_trash_hidden') then '예' else '아니오' end
union all select 'RLS still enabled and not forced on folders',case when (select count(*) from pg_class where oid=to_regclass('public.app_library_folders') and relrowsecurity and not relforcerowsecurity)=1 then '예' else '아니오' end
union all select 'folder row count',count(*)::text from public.app_library_folders
union all select 'folder item row count',count(*)::text from public.app_library_folder_items
union all select 'folder foreign keys in by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_library_folders') group by confdeltype) f),'')
union all select 'folder item foreign keys in by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_library_folder_items') group by confdeltype) f),'')
union all select 'folder triggers',coalesce((select string_agg(tgname::text||':'||tgenabled::text,', ' order by tgname) from pg_trigger where tgrelid=to_regclass('public.app_library_folders') and not tgisinternal and tgname<>'app_library_folders_a_trash_before_delete'),'')
union all select 'folder constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_library_folders') and conname<>'app_library_folders_trash_pair_check'),''))
union all select 'folder columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_library_folders') and attnum>0 and not attisdropped and attname not in ('deleted_at','deleted_root_id')),''))
union all select 'folder owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_library_folders')),''))
union all select 'folder policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_library_folders') and polname<>'app_library_folders_trash_hidden'),''))
union all select 'folder rows hash (ids only)',md5(coalesce((select string_agg(id::text,',' order by id) from public.app_library_folders),''))
union all select 'folder service_role select (table level)',has_table_privilege('service_role','public.app_library_folders','select')::text
union all select 'folder item constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_library_folder_items')),''))
union all select 'folder item columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_library_folder_items') and attnum>0 and not attisdropped),''))
union all select 'folder item owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_library_folder_items')),''))
union all select 'folder item policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_library_folder_items')),''))
union all select 'folder item rows hash (ids only)',md5(coalesce((select string_agg(document_id::text,',' order by document_id) from public.app_library_folder_items),''));
