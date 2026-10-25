-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 바뀌는 것 전부의 되돌릴 기준: 트리거 함수(보안·설정·권한·본문 해시), 피드 표의 칸 목록·CHECK 정의·index·RLS·권한·정책, 새 함수 둘(적용 전엔 없음), 기록.
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.oid in(to_regprocedure('private.app_feed_item_guard()'),to_regprocedure('public.app_feed_call_move(uuid,text)'),to_regprocedure('public.app_feed_call_work_info(uuid,text,text,uuid)'))
union all select 'trigger',t.tgname::text,t.tgenabled::text||':'||pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid=to_regclass('public.app_feed_items') and not t.tgisinternal
union all select 'feed table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid in(to_regclass('public.app_feed_items'),to_regclass('public.app_feed_days'))
union all select 'feed column',a.attname::text,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||a.atthasdef::text||':'||coalesce(a.attacl::text,'none') from pg_attribute a where a.attrelid=to_regclass('public.app_feed_items') and a.attnum>0 and not a.attisdropped
union all select 'feed constraint',k.conname::text,pg_get_constraintdef(k.oid) from pg_constraint k where k.conrelid=to_regclass('public.app_feed_items') and k.contype in('c','u')
union all select 'feed index',ic.relname::text,pg_get_indexdef(i.indexrelid) from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=to_regclass('public.app_feed_items')
union all select 'feed policy',p.polname::text,p.polcmd::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') from pg_policy p where p.polrelid in(to_regclass('public.app_feed_items'),to_regclass('public.app_feed_days'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261024140000','20261024210000','20261025190000')
order by 1,2;
