-- SELECT only. Aggregates and hashes; no page title or block text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite 예 / new migration absent 예 / blocks check is the 6-kind original 예 / doc blocks 0 / RLS 예 /
--   anon 아니오 / one owner policy 예. 그 밖의 해시·개수는 사후 확인과 같은 값이어야 한다(기록만).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- read_only 요청은 postgres가 아닌 읽기 전용 역할로 돈다. information_schema.check_constraints는 표 소유자 기준으로 행을 숨기므로
-- (2026-10-22 apply 사전 확인이 이 때문에 '아니오'로 멈춤) pg_constraint·pg_get_constraintdef로 읽는다(docs/ops-db-workflow.md 사전·사후 확인 절).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: blocks check is the 6-kind original = 예
-- expect: doc blocks = 0
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: one owner policy = 예
-- expect: share pages rows = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: triggers hash = 기록
-- expect: indexes hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261020005000' and name='share_pages_links')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261022130000') then '예' else '아니오' end
union all select 'blocks check is the 6-kind original',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_share_pages') and conname='app_share_pages_blocks_check' and contype='c' and convalidated
  and btrim(regexp_replace(pg_get_constraintdef(oid),'\s+',' ','g'))=btrim(regexp_replace('CHECK (((jsonb_typeof(blocks) = ''array''::text) AND (jsonb_array_length(blocks) <= 60) AND (octet_length((blocks)::text) <= 262144) AND (jsonb_array_length(jsonb_path_query_array(blocks, ''strict $[*]."type"?(((((@ == "summary" || @ == "stages") || @ == "schedule") || @ == "issues") || @ == "links") || @ == "updates")''::jsonpath, ''{}''::jsonb, true)) = jsonb_array_length(blocks))))','\s+',' ','g')))=1 then '예' else '아니오' end
union all select 'doc blocks',count(*)::text from public.app_share_pages where jsonb_path_exists(blocks,'$[*] ? (@.type == "doc")')
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_share_pages') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_share_pages','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_share_pages') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_share_pages'))=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_share_pages' and policyname='share_pages_owner_all' and cmd='ALL' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'share pages rows',count(*)::text from public.app_share_pages
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_share_pages'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_share_pages')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_share_pages') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_share_pages')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_share_pages') and not tgisinternal;
