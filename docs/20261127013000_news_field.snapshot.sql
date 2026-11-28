-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- Schema snapshot of app_news_articles (columns, constraints, indexes, policies, triggers, grants).
-- 긴 정의(4천 자 넘는 것)는 snapshot 한 값 상한 8192자 때문에 해시·길이로 기록한다.
select 'column' as kind,a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid=to_regclass('public.app_news_articles') and a.attnum>0 and not a.attisdropped
union all select 'constraint',conname,case when length(pg_get_constraintdef(oid))>4000 then 'md5:'||md5(pg_get_constraintdef(oid))||':length='||length(pg_get_constraintdef(oid)) else pg_get_constraintdef(oid) end from pg_constraint where conrelid=to_regclass('public.app_news_articles')
union all select 'index',indexname,indexdef from pg_indexes where schemaname='public' and tablename='app_news_articles'
union all select 'policy',polname,polcmd::text||polroles::text||polpermissive::text||case when length(coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''))>4000
  then 'md5:'||md5(coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'')) else coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') end
  from pg_policy where polrelid=to_regclass('public.app_news_articles')
union all select 'trigger',tgname,tgenabled::text||':'||pg_get_triggerdef(oid) from pg_trigger where tgrelid=to_regclass('public.app_news_articles') and not tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from pg_class where oid=to_regclass('public.app_news_articles')
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261116130000','20261127013000')
order by 1,2;
