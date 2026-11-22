-- SELECT only. Run before dry-run/apply (approved DB workflow or SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: 아래 예/아니오 항목 모두 예. 함수 해시·최근 기록은 값만 남긴다.
-- expect: search function source hash = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261122100000') then '예' else '아니오' end as value
union all select 'previous search migration applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261029061500' and name='ask_web2')=1 then '예' else '아니오' end
union all select 'previous highlight migration applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261115194000' and name='news_highlights_note')=1 then '예' else '아니오' end
union all select 'one search function',case when (select count(*) from pg_proc where proname='app_search_records' and pronamespace='public'::regnamespace)=1 then '예' else '아니오' end
union all select 'search function is the file text version',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_search_records(text,text[],integer,integer,text)')
  and not prosecdef and provolatile='s' and proconfig=array['search_path=""'] and length(prosrc)=15146 and md5(prosrc)='10498473a70dbfbe5e22d0361ae29745') then '예' else '아니오' end
union all select 'authenticated can execute search',case when has_function_privilege('authenticated',to_regprocedure('public.app_search_records(text,text[],integer,integer,text)'),'execute') then '예' else '아니오' end
union all select 'anon cannot execute search',case when not has_function_privilege('anon',to_regprocedure('public.app_search_records(text,text[],integer,integer,text)'),'execute') then '예' else '아니오' end
union all select 'highlight type check has four kinds',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_news_highlights') and conname='app_news_highlights_type_check'
  and contype='c' and convalidated and pg_get_constraintdef(oid)~'''note''' and pg_get_constraintdef(oid)!~'''reading''')=1 then '예' else '아니오' end
union all select 'highlights RLS on with one policy',case when (select relrowsecurity from pg_class where oid=to_regclass('public.app_news_highlights'))
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_news_highlights'))=1 then '예' else '아니오' end
union all select 'owner and space functions',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
  and to_regprocedure('private.app_space_in_workspace(uuid,uuid)') is not null then '예' else '아니오' end
union all select 'new table absent',case when to_regclass('public.app_reading_items') is null then '예' else '아니오' end
union all select 'search function source hash',(select md5(prosrc) from pg_proc where oid=to_regprocedure('public.app_search_records(text,text[],integer,integer,text)'))
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
