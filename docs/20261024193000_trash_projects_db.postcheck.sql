-- SELECT only. Run after apply (all 예 expected) or after rollback ('objects and history agree' = 예, 'trash installed' = 아니오).
-- 숫자·해시 항목(project row count·top project count·foreign keys·triggers·constraints·columns·grants·policies·rows hash)은
-- 사전 확인의 같은 이름 항목과 같아야 한다. 휴지통 트리거·정책·제약·칸은 해시에서 뺀다(새로 생긴 것만 다르다).
with history as (
  select count(*) as n,count(*) filter(where name='trash_projects_db') as named
  from supabase_migrations.schema_migrations where version='20261024193000'
), cols as (
  select count(*) as n from pg_attribute where attrelid=to_regclass('public.app_spaces') and not attisdropped
    and ((attname='deleted_at' and atttypid='timestamptz'::regtype) or (attname='deleted_root_id' and atttypid='uuid'::regtype)) and not attnotnull
), trg as (
  select count(*) as n,count(*) filter(where tgenabled='O' and tgfoid=to_regprocedure('private.app_trash_space_before_delete()')
    and pg_get_triggerdef(oid) like '%BEFORE DELETE ON public.app_spaces FOR EACH ROW%') as valid
  from pg_trigger where tgrelid=to_regclass('public.app_spaces') and tgname='app_spaces_a_trash_before_delete'
), first_delete as (
  select tgname from pg_trigger where tgrelid=to_regclass('public.app_spaces') and not tgisinternal and (tgtype & 1)=1 and (tgtype & 2)=2 and (tgtype & 8)=8
  order by tgname limit 1
), pol as (
  select count(*) as n,count(*) filter(where not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
    and pg_get_expr(polqual,polrelid)='(deleted_at IS NULL)'
    and pg_get_expr(polwithcheck,polrelid)='((deleted_at IS NULL) AND (deleted_root_id IS NULL))') as valid
  from pg_policy where polrelid=to_regclass('public.app_spaces') and polname='app_spaces_trash_hidden'
), con as (
  select count(*) as n from pg_constraint where conrelid=to_regclass('public.app_spaces') and conname='app_spaces_trash_pair_check' and contype='c'
), fns as (
  select count(*) as n,
    count(*) filter(where p.prosecdef and p.proconfig=array['search_path=""']
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0)
      and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
      and (has_function_privilege('authenticated',p.oid,'execute') = (p.oid<>to_regprocedure('private.app_trash_space_before_delete()')))) as valid
  from pg_proc p where p.oid in (to_regprocedure('private.app_trash_space_before_delete()'),to_regprocedure('public.app_trash_list(text)'),
    to_regprocedure('public.app_trash_restore(text,uuid)'),to_regprocedure('public.app_trash_purge(text,uuid)'))
), installed as (
  select (select n from cols)=2 and (select n from trg)=1 and (select valid from trg)=1 and (select n from pol)=1 and (select valid from pol)=1
    and (select n from con)=1 and to_regclass('public.app_spaces_trash_root_idx') is not null and (select n from fns)=4 and (select valid from fns)=4 as ok
), removed as (
  select (select n from cols)=0 and (select n from trg)=0 and (select n from pol)=0 and (select n from con)=0
    and to_regclass('public.app_spaces_trash_root_idx') is null and (select n from fns)=0 as ok
)
select 'objects and history agree' as item,case when ((select n from history)=0 and (select ok from removed))
  or ((select n from history)=1 and (select named from history)=1 and (select ok from installed)) then '예' else '아니오' end as ok
union all select 'trash installed',case when (select ok from installed) then '예' else '아니오' end
union all select 'trash trigger runs before unlink',case when (select n from trg)=0 or (select tgname from first_delete)='app_spaces_a_trash_before_delete' then '예' else '아니오' end
union all select 'unlink trigger still enabled',case when exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_spaces') and tgname='app_spaces_unlink_retained_records_before_delete' and tgenabled='O') then '예' else '아니오' end
union all select 'RLS still enabled and not forced',case when exists(select 1 from pg_class where oid=to_regclass('public.app_spaces') and relrowsecurity and not relforcerowsecurity) then '예' else '아니오' end
union all select 'project row count',count(*)::text from public.app_spaces
union all select 'top project count',count(*)::text from public.app_spaces where parent_id is null
union all select 'foreign keys to app_spaces by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_spaces') group by confdeltype) f),'')
union all select 'triggers',coalesce((select string_agg(tgname::text||':'||tgenabled::text,', ' order by tgname) from pg_trigger where tgrelid=to_regclass('public.app_spaces') and not tgisinternal and tgname<>'app_spaces_a_trash_before_delete'),'')
union all select 'constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_spaces') and conname<>'app_spaces_trash_pair_check'),''))
union all select 'columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_spaces') and attnum>0 and not attisdropped and attname not in ('deleted_at','deleted_root_id')),''))
union all select 'owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_spaces')),''))
union all select 'policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_spaces') and polname<>'app_spaces_trash_hidden'),''))
union all select 'rows hash (parent links only)',md5(coalesce((select string_agg(id::text||':'||coalesce(parent_id::text,''),',' order by id) from public.app_spaces),''));
