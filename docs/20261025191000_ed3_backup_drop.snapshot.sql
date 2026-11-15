-- SELECT only. Save before apply. Records what the drop removes (columns, policy, privileges, row counts per source) so the rollback can be
-- compared with it. No row values: only names, privileges and counts. Dropped backup text cannot be restored from this snapshot.
select 'column' as kind,a.attnum::text||' '||a.attname as name,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':'||coalesce(a.attacl::text,'none') as definition
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_ed3_text_backups') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.conname,pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid=to_regclass('public.app_ed3_text_backups')
union all select 'policy',p.polname,p.polcmd::text||':'||p.polroles::text||':'||pg_get_expr(p.polqual,p.polrelid) from pg_policy p where p.polrelid=to_regclass('public.app_ed3_text_backups')
union all select 'table',c.oid::regclass::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid=to_regclass('public.app_ed3_text_backups')
union all select 'rows by source',b.source,count(*)::text from public.app_ed3_text_backups b group by b.source
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261024190000','20261025191000')
order by 1,2;
