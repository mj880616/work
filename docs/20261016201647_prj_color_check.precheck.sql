-- Aggregates only; no project names or metadata values.
select 'app_spaces metadata jsonb' as item,case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_spaces') and attname='metadata' and atttypid='jsonb'::regtype and not attisdropped) then '예' else '아니오' end as value
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_spaces') and relrowsecurity) then '예' else '아니오' end
union all select 'project row count',count(*)::text from public.app_spaces
union all select 'rows with color key',count(*)::text from public.app_spaces where jsonb_typeof(metadata)='object' and metadata ? 'color'
union all select 'rows with invalid color (=0)',count(*)::text from public.app_spaces where jsonb_typeof(metadata)='object' and metadata ? 'color'
  and metadata->'color' not in ('"green"'::jsonb,'"blue"'::jsonb,'"orange"'::jsonb,'"purple"'::jsonb,'"pink"'::jsonb,'"yellow"'::jsonb,'"red"'::jsonb,'"gray"'::jsonb)
union all select 'color constraint count',count(*)::text from pg_constraint where conrelid=to_regclass('public.app_spaces') and conname='app_spaces_metadata_color_check'
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_spaces') and conname<>'app_spaces_metadata_color_check'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_spaces')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_spaces')
union all select 'triggers hash',md5(coalesce(string_agg(tgname::text||':'||tgenabled::text,',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_spaces') and not tgisinternal
union all select 'PRJ-color history count',count(*)::text from supabase_migrations.schema_migrations where version='20261016201647';
