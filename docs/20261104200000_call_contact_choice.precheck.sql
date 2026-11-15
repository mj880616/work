-- SELECT only. Run before dry-run/apply (also the before/after comparison for postcheck). Aggregates and hashes; no row text.
-- 읽기 전용 역할에서 돈다: pg_catalog만 읽는다.
-- 적용 전 기대: 앞 단계(20261025200000) 적용됨, 새 표 둘 없음, app_call_move는 앞 단계 본문(열쇠를 다루지 않음)·authenticated만 실행, 두 통화 표 줄 수는 기록만 한다.
-- expect: feed items rows = 기록
-- expect: personal box rows = 기록
-- expect: call tables grants policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261104200000') then '예' else '아니오' end as value
union all select 'previous step applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261025200000' and name='call_personal_box')=1 then '예' else '아니오' end
union all select 'choice and ref tables absent',case when to_regclass('public.app_call_contact_choice') is null and to_regclass('public.app_call_contact_ref') is null then '예' else '아니오' end
union all select 'app_call_move previous body, definer, empty search_path, only authenticated executes',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_call_move(uuid,text)') and prosecdef and proconfig=array['search_path=""'] and prosrc like '%CALL_MOVE_TARGET%' and prosrc not like '%contact_key%' and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')) then '예' else '아니오' end
union all select 'no anon or PUBLIC privilege on the two call tables',case when not exists(select 1 from pg_class where oid in(to_regclass('public.app_feed_items'),to_regclass('public.app_call_personal')) and coalesce(relacl::text,'')~'(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'feed items rows',(select count(*)::text from public.app_feed_items)
union all select 'personal box rows',(select count(*)::text from public.app_call_personal)
union all select 'call tables grants policies hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in(to_regclass('public.app_feed_items'),to_regclass('public.app_call_personal'))),'')
  ||coalesce((select string_agg(c.relname||'.'||a.attname::text||':'||a.attacl::text,',' order by c.relname,a.attname) from pg_attribute a join pg_class c on c.oid=a.attrelid where a.attrelid in(to_regclass('public.app_feed_items'),to_regclass('public.app_call_personal')) and a.attnum>0 and not a.attisdropped and a.attacl is not null),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid in(to_regclass('public.app_feed_items'),to_regclass('public.app_call_personal'))),''));
