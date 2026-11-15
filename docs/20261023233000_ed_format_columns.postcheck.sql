-- SELECT only. Works after apply (record + 3 doc columns + 3 checks) and after rollback/dry-run (none of them).
-- The count/hash/rows items must equal the precheck values of the same name (no grant, policy, trigger, index or other column/constraint change; no row added or removed).
with t(label,rel,textcol) as (values
  ('notes',to_regclass('public.app_notes'),'raw_text'),
  ('org updates',to_regclass('public.app_suborganization_updates'),'raw_text'),
  ('project records',to_regclass('public.app_project_progress_updates'),'summary')),
history as (
  select count(*) as n,count(*) filter(where name='ed_format_columns') as named from supabase_migrations.schema_migrations where version='20261023233000'
), cols as (
  select count(*) as n from t join pg_attribute a on a.attrelid=t.rel and a.attname='doc' and not a.attisdropped and a.atttypid='jsonb'::regtype
), checks as (
  select count(*) as n from pg_constraint where connamespace='public'::regnamespace and contype='c' and convalidated
    and conname in ('app_notes_doc_check','app_suborganization_updates_doc_check','app_project_progress_updates_doc_check')
)
select 'doc columns checks and history agree' as item,case when
  (history.n=0 and cols.n=0 and checks.n=0)
  or (history.n=1 and history.named=1 and cols.n=3 and checks.n=3) then '예' else '아니오' end as value
  from history,cols,checks
union all select 'every doc empty (or no column)',case when
  not exists(select 1 from public.app_notes n where coalesce(to_jsonb(n)->'doc','null'::jsonb)<>'null'::jsonb)
  and not exists(select 1 from public.app_suborganization_updates n where coalesce(to_jsonb(n)->'doc','null'::jsonb)<>'null'::jsonb)
  and not exists(select 1 from public.app_project_progress_updates n where coalesce(to_jsonb(n)->'doc','null'::jsonb)<>'null'::jsonb) then '예' else '아니오' end
union all select 'RLS still enabled on all three',case when (select count(*) from t join pg_class c on c.oid=t.rel and c.relrowsecurity)=3 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not exists(select 1 from t join pg_class c on c.oid=t.rel where c.relacl::text ~ '(^|[{,])(anon)?=')
  and not exists(select 1 from t where has_table_privilege('anon',t.rel,'select') or has_table_privilege('anon',t.rel,'insert') or has_table_privilege('anon',t.rel,'update') or has_table_privilege('anon',t.rel,'delete')) then '예' else '아니오' end
union all select 'no anon or public policy',case when not exists(select 1 from t join pg_policy p on p.polrelid=t.rel where 0::oid=any(p.polroles) or 'anon'::regrole::oid=any(p.polroles)) then '예' else '아니오' end
union all select 'authenticated can read insert update on all three',case when (select count(*) from t where has_table_privilege('authenticated',t.rel,'select') and has_table_privilege('authenticated',t.rel,'insert') and has_table_privilege('authenticated',t.rel,'update'))=3 then '예' else '아니오' end
union all select 'notes one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_notes'))=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_notes' and policyname='notes_owner_all' and permissive='PERMISSIVE' and cmd='ALL' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'notes rows',count(*)::text from public.app_notes
union all select 'org updates rows',count(*)::text from public.app_suborganization_updates
union all select 'project records rows',count(*)::text from public.app_project_progress_updates
union all select t.label||' text column length limits',coalesce((select string_agg(c.contype::text||':'||pg_get_constraintdef(c.oid),' / ' order by c.conname) from pg_constraint c where c.conrelid=t.rel and c.contype='c' and pg_get_constraintdef(c.oid) ~ ('(length|char_length|octet_length)[ (]*'||t.textcol)),'none') from t
union all select t.label||' all constraints hash',md5(coalesce((select string_agg(c.conname||':'||pg_get_constraintdef(c.oid),',' order by c.conname) from pg_constraint c where c.conrelid=t.rel and c.conname not in ('app_notes_doc_check','app_suborganization_updates_doc_check','app_project_progress_updates_doc_check')),'')) from t
union all select t.label||' columns hash',md5(coalesce((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),',' order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=t.rel and a.attnum>0 and not a.attisdropped and a.attname<>'doc'),'')) from t
union all select t.label||' policies count',(select count(*) from pg_policy where polrelid=t.rel)::text from t
union all select t.label||' policies hash',md5(coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=t.rel),'')) from t
union all select t.label||' owner RLS grants hash',md5(coalesce((select c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=t.rel),'')) from t
union all select t.label||' column grants hash',md5(coalesce((select string_agg(a.attname||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=t.rel and a.attnum>0 and not a.attisdropped and a.attname<>'doc'),'')) from t
union all select t.label||' triggers count',(select count(*) from pg_trigger g where g.tgrelid=t.rel and not g.tgisinternal)::text from t
union all select t.label||' triggers hash',md5(coalesce((select string_agg(g.tgname||':'||g.tgenabled::text||':'||pg_get_triggerdef(g.oid),',' order by g.tgname) from pg_trigger g where g.tgrelid=t.rel and not g.tgisinternal),'')) from t
union all select t.label||' indexes hash',md5(coalesce((select string_agg(ic.relname||':'||pg_get_indexdef(x.indexrelid),',' order by ic.relname) from pg_index x join pg_class ic on ic.oid=x.indexrelid where x.indrelid=t.rel),'')) from t;

