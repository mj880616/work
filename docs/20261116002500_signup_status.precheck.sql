-- SELECT only. 20261116002500_signup_status 적용 전(시험 적용 전후 비교에도 씀). 카탈로그·migration 기록·줄 수만 읽는다(이름·메일·기록 내용 없음).
-- 기대: 예/아니오 항목은 모두 예. 줄 수·해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous steps applied = 예
-- expect: list function definer authenticated only = 예
-- expect: columns present = 예
-- expect: sessions readable by owner = 예
-- expect: dev_inbox rows = 1
-- expect: profiles grants policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261116002500') then '예' else '아니오' end as value
union all select 'previous steps applied',case when (select count(*) from supabase_migrations.schema_migrations where (version,name) in (('20261115234500','signup_notify'),('20261115223000','profile_union_department')))=2 and to_regprocedure('private.app_workspace_has_feature(uuid,text)') is not null and to_regprocedure('private.app_signup_people()') is not null and to_regprocedure('public.app_signup_since(timestamp with time zone)') is not null then '예' else '아니오' end
union all select 'list function definer authenticated only',case when (select count(*) from pg_proc where oid=to_regprocedure('public.app_signup_list()') and prosecdef and proconfig=array['search_path=""'] and prorettype='jsonb'::regtype)=1 and has_function_privilege('authenticated','public.app_signup_list()','execute') and not has_function_privilege('anon','public.app_signup_list()','execute') and not has_function_privilege('service_role','public.app_signup_list()','execute') then '예' else '아니오' end
union all select 'columns present',case when (select count(*) from pg_attribute a where not a.attisdropped and ((a.attrelid=to_regclass('public.app_workspace_members') and a.attname in('user_id','role','created_at')) or (a.attrelid=to_regclass('public.app_profiles') and a.attname in('user_id','display_name','job_title','union_name','department_name')) or (a.attrelid=to_regclass('auth.users') and a.attname in('id','email','raw_user_meta_data','last_sign_in_at')) or (a.attrelid=to_regclass('auth.sessions') and a.attname in('user_id','updated_at'))))=14 then '예' else '아니오' end
union all select 'sessions readable by owner',case when to_regclass('auth.sessions') is not null and has_table_privilege((select pg_get_userbyid(p.proowner) from pg_proc p where p.oid=to_regprocedure('public.app_signup_list()')),'auth.sessions','select') then '예' else '아니오' end
union all select 'dev_inbox rows',(select count(*) from public.app_operator_features where feature='dev_inbox')::text
union all select 'profiles grants policies hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_profiles')),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_profiles')),''));
