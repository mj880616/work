-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 별표 폴더 검사는 되돌리기가 NOT VALID로 되살리므로 그 꼬리를 뺀 정의로 비교한다.
-- 다시 정의하는 세 함수(정의 해시·옵션·권한), 새 함수가 아직 없음, 읽을 거리 칸·검사·색인·정책, 별표 표시 표 검사를 기록한다(되돌린 뒤 같은지 대조).
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||p.provolatile::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.oid in (to_regprocedure('public.app_news_prune(timestamptz,integer)'),to_regprocedure('public.app_outside_prune(timestamptz,integer)'),
    to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)'),to_regprocedure('public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)'),
    to_regprocedure('private.app_reading_keep_row(uuid,text,uuid,timestamptz)'),to_regprocedure('private.app_reading_body(text,uuid)'))
union all select 'reading column',a.attname::text,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(md5(a.attacl::text),'none')
  from pg_attribute a where a.attrelid=to_regclass('public.app_reading_items') and a.attnum>0 and not a.attisdropped
union all select 'reading constraint',c.conname::text,md5(pg_get_constraintdef(c.oid))
  from pg_constraint c where c.conrelid=to_regclass('public.app_reading_items')
union all select 'reading index',i.indexname::text,md5(i.indexdef) from pg_indexes i where i.schemaname='public' and i.tablename='app_reading_items'
union all select 'reading policy',p.polname::text,md5(coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_policy p where p.polrelid=to_regclass('public.app_reading_items')
union all select 'reading table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||md5(coalesce(c.relacl::text,'none'))
  from pg_class c where c.oid=to_regclass('public.app_reading_items')
union all select 'marks constraint',c.conname::text,md5(replace(pg_get_constraintdef(c.oid),' NOT VALID',''))
  from pg_constraint c where c.conrelid=to_regclass('public.app_news_marks')
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261115230000','20261120130000','20261122100000','20261122230000')
order by 1,2,3;
