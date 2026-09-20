-- Local catalog structure only. Never read rows, defaults, policy expressions, or function bodies.
select json_build_object(
  'table', c.relname,
  'rls', c.relrowsecurity,
  'columns', (
    select json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'required',a.attnotnull,'default',d.oid is not null,'generated',a.attgenerated <> '') order by a.attnum)
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  ),
  'foreignKeys', (
    select coalesce(json_agg(json_build_object('name',k.conname,'references',k.confrelid::regclass::text)), '[]'::json)
    from pg_constraint k where k.conrelid=c.oid and k.contype='f'
  ),
  'triggers', (
    select coalesce(json_agg(json_build_object('name',t.tgname,'function',p.proname)), '[]'::json)
    from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid=c.oid and not t.tgisinternal
  )
)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p') and
  (c.relname in ('app_workspaces','app_workspace_members','app_pages','app_documents',
    'app_spaces','app_project_sections','app_project_blocks','app_events','app_meetings',
    'app_tasks','app_project_updates') or c.relname like 'app_%profile%')
order by c.relname;
