-- SELECT only. Run before apply (approved DB workflow or SQL Editor, phone path C). Aggregates and hashes only; no row values or text.
-- 적용 전 기대: 아래 예/아니오 항목 모두 예. 자료 행 수·글자 읽기 상태별 수는 기록만(색인·채우기 판단용).
-- 승인형 DB workflow 기대값(DB-승인형확장): 아래에 없는 항목은 모두 예여야 한다. 기록 = 값만 남기고 판정하지 않음.
-- expect: documents rows = 기록
-- expect: documents text ready = 기록
-- expect: documents text not read yet = 기록
-- expect: documents text error = 기록
-- expect: search function source hash = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261023013000') then '예' else '아니오' end as value
union all select 'previous search migration applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261022150000' and name='search_records')=1 then '예' else '아니오' end
union all select 'one search function',case when (select count(*) from pg_proc where proname='app_search_records' and pronamespace='public'::regnamespace)=1 then '예' else '아니오' end
union all select 'search function invoker, stable, search_path empty',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_search_records(text,text[],integer,integer,text)')
  and not prosecdef and provolatile='s' and proconfig=array['search_path=""']) then '예' else '아니오' end
union all select 'search function does not read file text yet',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_search_records(text,text[],integer,integer,text)')
  and prosrc not like '%extracted_text%') then '예' else '아니오' end
union all select 'authenticated can execute',case when has_function_privilege('authenticated',to_regprocedure('public.app_search_records(text,text[],integer,integer,text)'),'execute') then '예' else '아니오' end
union all select 'anon cannot execute',case when not has_function_privilege('anon',to_regprocedure('public.app_search_records(text,text[],integer,integer,text)'),'execute') then '예' else '아니오' end
union all select 'documents text columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_documents') and not attisdropped
  and ((attname='extracted_text' and atttypid='text'::regtype) or (attname='extraction_status' and atttypid='text'::regtype)))=2 then '예' else '아니오' end
union all select 'documents RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relrowsecurity) then '예' else '아니오' end
union all select 'search function source hash',(select md5(prosrc) from pg_proc where oid=to_regprocedure('public.app_search_records(text,text[],integer,integer,text)'))
union all select 'documents rows',(select count(*)::text from public.app_documents)
union all select 'documents text ready',(select count(*)::text from public.app_documents where extraction_status='ready')
union all select 'documents text not read yet',(select count(*)::text from public.app_documents where extraction_status is null or extraction_status not in('ready','error'))
union all select 'documents text error',(select count(*)::text from public.app_documents where extraction_status='error')
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
