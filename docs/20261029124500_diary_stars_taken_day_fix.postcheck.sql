-- SELECT only. Works after apply (record, 0 stars off by a day) and after rollback/dry-run (no record; stars may still differ).
-- The hash/count items must equal the precheck values of the same name (no grant, policy, trigger, constraint or index change; no row added or removed).
select 'stars agree with history' as item,case
  when (select count(*) from supabase_migrations.schema_migrations where version='20261029124500' and name='diary_stars_taken_day_fix')=1
    then case when exists(select 1 from public.app_diary_stars s join public.app_onedrive_photos p on p.workspace_id=s.workspace_id and p.item_id=s.item_key
      where s.source='onedrive' and p.updated_at >= timestamptz '2026-10-28 23:00:00+00' and s.taken_day <> p.taken_day) then '아니오' else '예' end
  when not exists(select 1 from supabase_migrations.schema_migrations where version='20261029124500') then '예' else '아니오' end as value
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_diary_stars') and relrowsecurity) then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_diary_stars'))=1 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_diary_stars','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_diary_stars') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'stars rows',count(*)::text from public.app_diary_stars
union all select 'onedrive stars rows',count(*)::text from public.app_diary_stars where source='onedrive'
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_diary_stars')
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_diary_stars'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_diary_stars')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_diary_stars') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_diary_stars')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_diary_stars') and not tgisinternal;
