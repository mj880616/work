-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 공용 기사 표 검사·정책, 하루 사용량 표 칸·검사, 새 함수가 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'constraint' as kind,c.conrelid::regclass::text||'.'||c.conname as name,md5(pg_get_constraintdef(c.oid)) as definition
  from pg_constraint c where c.conrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_news_days'))
union all select 'policy',p.polname::text,md5(coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')||'|'||p.polroles::text||'|'||p.polcmd::text||'|'||p.polpermissive::text)
  from pg_policy p where p.polrelid=to_regclass('public.app_news_articles')
union all select 'columns','public.app_news_days',coalesce((select string_agg(a.attname::text||' '||format_type(a.atttypid,a.atttypmod),', ' order by a.attnum) from pg_attribute a where a.attrelid=to_regclass('public.app_news_days') and a.attnum>0 and not a.attisdropped),'absent')
union all select 'table ACL',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none')
  from pg_class c where c.oid in (to_regclass('public.app_news_articles'),to_regclass('public.app_news_days'),to_regclass('public.app_news_marks'))
union all select 'function','private.app_news_marked_by_me(uuid)',coalesce(to_regprocedure('private.app_news_marked_by_me(uuid)')::text,'absent')
union all select 'function','public.app_news_user_save(uuid,text,text,jsonb)',coalesce(to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)')::text,'absent')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261115230000'
order by 1,2;
