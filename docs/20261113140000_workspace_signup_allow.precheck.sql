-- SELECT only. 20261113140000_workspace_signup_allow 적용 전(시험 적용 전후 비교에도 씀). 개수·참거짓·해시만, 행 내용·id·메일은 읽지 않는다.
-- 기대: 앞 단계(②-4 workspace_self_start) 기록 있음, 이번 기록·새 표 없음, 역할 트리거 함수 안에 고정 메일 비교가 정확히 1곳, 스위치 꺼짐.
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: allow table absent = 예
-- expect: role trigger has one fixed email check = 예
-- expect: switch off = 예
-- expect: owner rows = 기록
-- expect: workspaces rows = 기록
-- expect: members policies hash = 기록
-- expect: members triggers hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261105183000' and name='workspace_self_start')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261113140000') then '예' else '아니오' end
union all select 'allow table absent',case when to_regclass('public.app_workspace_signup_allow') is null then '예' else '아니오' end
union all select 'role trigger has one fixed email check',case when to_regprocedure('private.app_enforce_workspace_member_role()') is not null and (select count(*) from regexp_matches(pg_get_functiondef('private.app_enforce_workspace_member_role()'::regprocedure),'if v_email = ''[^'']+'' then','g'))=1 then '예' else '아니오' end
union all select 'switch off',case when (select count(*) from public.app_workspace_signup where id=1 and not open)=1 then '예' else '아니오' end
union all select 'owner rows',(select count(*)::text from public.app_workspace_members where role='owner')
union all select 'workspaces rows',(select count(*)::text from public.app_workspaces)
union all select 'members policies hash',md5(coalesce((select string_agg(p.polname::text||':'||p.polcmd::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_workspace_members')),''))
union all select 'members triggers hash',md5(coalesce((select string_agg(t.tgname::text||':'||t.tgenabled::text||':'||md5(pg_get_triggerdef(t.oid)),',' order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('public.app_workspace_members') and not t.tgisinternal),''));
