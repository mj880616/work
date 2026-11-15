-- SELECT only. Aggregates and hashes; no note text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite 예 / new migration absent 예 / new columns 0 / RLS 예 / owner policy 예 / anon 아니오 / triggers 0.
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261013034836' and name='basket_photo_ocr_db')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261017052234') then '예' else '아니오' end
union all select 'new columns count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_notes') and attnum>0 and not attisdropped and attname in('kind','title','journal_day')
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_notes') and relrowsecurity) then '예' else '아니오' end
union all select 'owner policy only',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_notes'))=1
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_notes') and polname='notes_owner_all' and polcmd='*' and polroles=array['authenticated'::regrole::oid]) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_notes','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_notes') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_notes') and not tgisinternal
union all select 'raw text CHECK validated',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_notes') and conname='app_notes_raw_text_check' and contype='c' and convalidated) then '예' else '아니오' end
union all select 'notes rows',count(*)::text from public.app_notes
union all select 'notes full-row hash',md5(coalesce(string_agg(to_jsonb(n)::text,E'\n' order by n.id),'')) from public.app_notes n
union all select 'columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),',' order by a.attnum),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.app_notes') and a.attnum>0 and not a.attisdropped
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_notes')
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_notes'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_notes')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_notes');
