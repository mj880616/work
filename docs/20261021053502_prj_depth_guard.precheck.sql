-- SELECT only. Run before apply (SQL Editor, phone path C). Aggregates only; no project names, ids or row values.
-- 적용 전 기대: new migration absent 예 / depth trigger absent 예 / depth function absent 예 / parent_id uuid 예 / RLS enabled 예 /
--   max depth 1~3 / rows deeper than 3 levels 0 / rows not reachable from a top project 0 / rows whose parent is itself 0 /
--   rows whose parent is missing 0 / rows whose parent is in another workspace 0.
--   project row count·rows at level 3·hash 항목은 사후 확인과 비교용으로 캡처만 한다.
with recursive t(id, lvl, path) as (
  select s.id, 1, array[s.id] from public.app_spaces s where s.parent_id is null
  union all
  select s.id, t.lvl + 1, t.path || s.id
  from public.app_spaces s join t on s.parent_id = t.id
  where s.id <> all(t.path) and t.lvl < 10
)
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261021053502') then '예' else '아니오' end as value
union all select 'depth trigger absent',case when not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_spaces') and tgname='app_spaces_depth_guard') then '예' else '아니오' end
union all select 'depth function absent',case when to_regprocedure('private.app_enforce_space_depth()') is null then '예' else '아니오' end
union all select 'parent_id uuid',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_spaces') and attname='parent_id' and atttypid='uuid'::regtype and not attisdropped) then '예' else '아니오' end
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_spaces') and relrowsecurity) then '예' else '아니오' end
union all select 'project row count',count(*)::text from public.app_spaces
union all select 'max depth',coalesce(max(lvl),0)::text from t
union all select 'rows at level 3',count(*)::text from t where lvl=3
union all select 'rows deeper than 3 levels (=0)',count(*)::text from t where lvl>3
union all select 'rows not reachable from a top project (=0)',count(*)::text from public.app_spaces s where not exists(select 1 from t where t.id=s.id)
union all select 'rows whose parent is itself (=0)',count(*)::text from public.app_spaces where parent_id=id
union all select 'rows whose parent is missing (=0)',count(*)::text from public.app_spaces s where s.parent_id is not null and not exists(select 1 from public.app_spaces p where p.id=s.parent_id)
union all select 'rows whose parent is in another workspace (=0)',count(*)::text from public.app_spaces s join public.app_spaces p on p.id=s.parent_id where p.workspace_id<>s.workspace_id
union all select 'triggers',coalesce(string_agg(tgname::text||':'||tgenabled::text,', ' order by tgname),'') from pg_trigger where tgrelid=to_regclass('public.app_spaces') and not tgisinternal
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_spaces')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_spaces')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_spaces')
union all select 'rows hash (parent links only)',md5(coalesce(string_agg(id::text||':'||coalesce(parent_id::text,''),',' order by id),'')) from public.app_spaces
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
