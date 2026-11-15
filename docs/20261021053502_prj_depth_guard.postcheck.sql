-- SELECT only. Run after apply (all 예 expected) or after rollback (trigger and history agree = 예, guard installed = 아니오).
-- Compare project row count, max depth, constraints/grants/policies hash and rows hash with the precheck capture (must be equal).
with recursive t(id, lvl, path) as (
  select s.id, 1, array[s.id] from public.app_spaces s where s.parent_id is null
  union all
  select s.id, t.lvl + 1, t.path || s.id
  from public.app_spaces s join t on s.parent_id = t.id
  where s.id <> all(t.path) and t.lvl < 10
), history as (
  select count(*) as n,count(*) filter(where name='prj_depth_guard') as named
  from supabase_migrations.schema_migrations where version='20261021053502'
), trg as (
  select count(*) as n,count(*) filter(where tgenabled='O' and tgfoid=to_regprocedure('private.app_enforce_space_depth()')
    and pg_get_triggerdef(oid) like '%BEFORE INSERT OR UPDATE OF parent_id ON public.app_spaces FOR EACH ROW%') as valid
  from pg_trigger where tgrelid=to_regclass('public.app_spaces') and tgname='app_spaces_depth_guard'
), fn as (
  select count(*) as n,count(*) filter(where not prosecdef and proconfig=array['search_path=""']
    and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('authenticated',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0)) as valid
  from pg_proc where oid=to_regprocedure('private.app_enforce_space_depth()')
)
select 'trigger and history agree' as item,case when (history.n=0 and trg.n=0 and fn.n=0)
  or (history.n=1 and history.named=1 and trg.n=1 and trg.valid=1 and fn.n=1 and fn.valid=1) then '예' else '아니오' end as ok from history,trg,fn
union all select 'guard installed',case when trg.n=1 and trg.valid=1 and fn.n=1 and fn.valid=1 then '예' else '아니오' end from trg,fn
union all select 'no rows deeper than 3 levels',case when not exists(select 1 from t where lvl>3) then '예' else '아니오' end
union all select 'no unreachable rows (cycle or broken parent)',case when not exists(select 1 from public.app_spaces s where not exists(select 1 from t where t.id=s.id)) then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_spaces') and relrowsecurity) then '예' else '아니오' end
union all select 'project row count',count(*)::text from public.app_spaces
union all select 'max depth',coalesce(max(lvl),0)::text from t
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_spaces')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_spaces')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_spaces')
union all select 'rows hash (parent links only)',md5(coalesce(string_agg(id::text||':'||coalesce(parent_id::text,''),',' order by id),'')) from public.app_spaces;
