-- SELECT only. Save before apply. pg_catalog와 기록만 읽고 행 값은 읽지 않는다.
-- 후보 표의 상태 검사식·정책 이름과 새 표가 아직 없음, 이번 기록이 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'constraint' as kind,c.conname::text as name,pg_get_constraintdef(c.oid) as definition
  from pg_constraint c where c.conrelid=to_regclass('public.app_todo_candidates') and c.conname='app_todo_candidates_status_check'
union all select 'policy',p.polname::text,pg_get_expr(p.polqual,p.polrelid)
  from pg_policy p where p.polrelid=to_regclass('public.app_todo_candidates')
union all select 'table',n,coalesce(to_regclass(n)::text,'absent')
  from unnest(array['public.app_todo_feedback','public.app_todo_rules']) n
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261101180000'
order by 1,2;
