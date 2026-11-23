-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 다시 정의하는 두 함수(본문 해시·옵션·권한), 새 함수 둘이 아직 없음, app_update_news 칸·검사를 기록한다(되돌린 뒤 같은지 대조).
select 'function' as kind, n as name, coalesce((select p.prosecdef::text||':'||p.provolatile::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) from pg_proc p where p.oid=to_regprocedure(n)),'absent') as definition
  from unnest(array['public.app_release_notes_put(jsonb,text)','public.app_update_news_admin()','private.app_update_news_auto(jsonb,jsonb)','public.app_update_news_resend(uuid)','private.app_update_news_operator()']) n
union all select 'news column',a.attname::text,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(md5(a.attacl::text),'none')
  from pg_attribute a where a.attrelid=to_regclass('public.app_update_news') and a.attnum>0 and not a.attisdropped
union all select 'news constraint',c.conname::text,md5(pg_get_constraintdef(c.oid))
  from pg_constraint c where c.conrelid=to_regclass('public.app_update_news')
union all select 'news table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none')
  from pg_class c where c.oid=to_regclass('public.app_update_news')
union all select 'history', version, name from supabase_migrations.schema_migrations where version in ('20261115190000','20261115200000','20261123150000')
order by 1, 2;
