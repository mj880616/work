-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 새 표 넷·함수 하나가 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_now_details','public.app_outside_marks','public.app_now_signals','public.app_now_interests']) n
union all select 'function',n,coalesce(to_regprocedure(n)::text,'absent')
  from unnest(array['private.app_now_item_scope_guard()']) n
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261102140000'
order by 1,2;
