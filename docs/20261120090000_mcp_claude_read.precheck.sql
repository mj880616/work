-- SELECT only. 20261120090000_mcp_claude_read 적용 전(시험 적용 전후 비교에도 씀). 카탈로그·migration 기록만 읽는다(행 값 없음).
-- 기대: 예/아니오 항목은 모두 예. 'realtime publication public tables'는 구독 표 수(기록만, CC가 0인지 보고 L1·L2 적용 전에 판단 — 설계 4.3).
-- 'authenticator pre-request unset'이 아니오면 읽생기 등 다른 요청 전 함수가 이미 있다는 뜻이므로 멈춘다(설계 7.4, T7).
-- 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다(기존 owner 경계·원장 검색·노트 폴더 잠금 함수가 그대로라는 뜻).
-- expect: new migration absent = 예
-- expect: ledger and note folder lock applied = 예
-- expect: prerequisite columns present = 예
-- expect: owner ledger lock auth functions present = 예
-- expect: authenticated can use private and auth schemas = 예
-- expect: auth sessions columns present = 예
-- expect: postgres can read auth sessions = 예
-- expect: mcp objects absent = 예
-- expect: authenticator pre-request unset = 예
-- expect: realtime publication public tables = 기록
-- expect: existing boundary hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261120090000') then '예' else '아니오' end as value
union all select 'ledger and note folder lock applied',case when (select count(*) from supabase_migrations.schema_migrations where (version='20261021082000' and name='ledger_schema') or (version='20261119233000' and name='note_folder_lock'))=2 then '예' else '아니오' end
union all select 'prerequisite columns present',case when (select count(*) from (values
    ('app_suborganizations','id'),('app_suborganizations','workspace_id'),('app_suborganizations','name'),('app_suborganizations','active'),('app_suborganizations','recent_month_summary'),('app_suborganizations','aliases'),('app_suborganizations','deleted_at'),
    ('app_suborganization_assignees','organization_id'),('app_suborganization_assignees','user_id'),
    ('app_suborganization_dispute_stages','organization_id'),('app_suborganization_dispute_stages','stage_name'),('app_suborganization_dispute_stages','stage_date'),('app_suborganization_dispute_stages','created_at'),
    ('app_suborganization_updates','id'),('app_suborganization_updates','organization_id'),('app_suborganization_updates','raw_text'),('app_suborganization_updates','occurred_at'),
    ('app_business_records','id'),('app_business_records','workspace_id'),('app_business_records','space_id'),('app_business_records','day'),('app_business_records','end_day'),('app_business_records','body'),
    ('app_spaces','id'),('app_spaces','workspace_id'),('app_spaces','name'),('app_spaces','status'),('app_spaces','parent_id'),('app_spaces','metadata'),('app_spaces','deleted_at'),
    ('app_project_workstreams','id'),('app_project_workstreams','project_id'),('app_project_workstreams','title'),('app_project_workstreams','phase'),('app_project_workstreams','sort_order'),
    ('app_project_progress_updates','id'),('app_project_progress_updates','project_id'),('app_project_progress_updates','effective_on'),('app_project_progress_updates','status_label'),('app_project_progress_updates','summary'),('app_project_progress_updates','next_step'),
    ('app_project_milestones','id'),('app_project_milestones','project_id'),('app_project_milestones','title'),('app_project_milestones','start_at'),
    ('app_record_links','workspace_id'),('app_record_links','project_id'),('app_record_links','google_task_id'),('app_record_links','task_completed'),('app_record_links','status'),
    ('app_documents','workspace_id'),('app_documents','project_id'),
    ('app_notes','id'),('app_notes','workspace_id'),('app_notes','kind'),('app_notes','title'),('app_notes','raw_text'),('app_notes','metadata'),('app_notes','deleted_at'),('app_notes','ai_export_allowed'),('app_notes','updated_at'),('app_notes','occurred_at'),
    ('app_note_folders','id'),('app_note_folders','workspace_id'),('app_note_folders','name'),
    ('app_profiles','user_id'),('app_profiles','view_prefs')) v(t,c)
    join pg_attribute a on a.attrelid=to_regclass('public.'||v.t) and a.attname=v.c and not a.attisdropped)=67 then '예' else '아니오' end
union all select 'owner ledger lock auth functions present',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
    and exists(select 1 from pg_proc where oid=to_regprocedure('public.app_ledger_search(text,text[],uuid,uuid,date,date,text,text,boolean,integer)') and not prosecdef)
    and to_regprocedure('private.app_lock_note_folder_list(uuid)') is not null and to_regprocedure('auth.uid()') is not null and to_regprocedure('auth.jwt()') is not null then '예' else '아니오' end
union all select 'authenticated can use private and auth schemas',case when has_schema_privilege('authenticated','private','usage') and has_schema_privilege('authenticated','auth','usage') then '예' else '아니오' end
union all select 'auth sessions columns present',case when (select count(*) from pg_attribute a where a.attrelid=to_regclass('auth.sessions') and not a.attisdropped and a.attname in('id','user_id','created_at'))=3 then '예' else '아니오' end
union all select 'postgres can read auth sessions',case when to_regclass('auth.sessions') is not null and has_table_privilege('postgres','auth.sessions','select') then '예' else '아니오' end
union all select 'mcp objects absent',case when to_regclass('public.app_mcp_settings') is null and to_regclass('public.app_mcp_read_log') is null and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'app\_mcp\_%') then '예' else '아니오' end
union all select 'authenticator pre-request unset',case when not exists(select 1 from pg_db_role_setting s join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig) x(v) where r.rolname='authenticator' and x.v like 'pgrst.db\_pre\_request=%') then '예' else '아니오' end
union all select 'realtime publication public tables',(select count(*)::text from pg_publication_tables t where t.pubname='supabase_realtime' and t.schemaname='public')
union all select 'existing boundary hash',md5(coalesce((select string_agg(p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,''),',' order by p.oid::regprocedure::text) from pg_proc p where p.oid in (to_regprocedure('private.app_is_workspace_owner(uuid)'),to_regprocedure('public.app_ledger_search(text,text[],uuid,uuid,date,date,text,text,boolean,integer)'),to_regprocedure('private.app_lock_note_folder_list(uuid)'))),'')||coalesce((select string_agg(c.relname::text||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in (to_regclass('public.app_workspace_members'),to_regclass('public.app_workspaces'),to_regclass('public.app_notes'),to_regclass('public.app_profiles'),to_regclass('public.app_ledger_records'),to_regclass('public.app_note_folder_locks'))),'')||coalesce((select string_agg(p.polrelid::regclass::text||p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polrelid::regclass::text,p.polname) from pg_policy p where p.polrelid in (to_regclass('public.app_workspace_members'),to_regclass('public.app_notes'),to_regclass('public.app_profiles'),to_regclass('public.app_ledger_records'))),''));
