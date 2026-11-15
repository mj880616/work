-- SELECT only. 20261115234500_signup_notify 적용 전(시험 적용 전후 비교에도 씀). 카탈로그·migration 기록·줄 수만 읽는다(이름·메일·알림 기록 내용 없음).
-- 기대: 예/아니오 항목은 모두 예. 줄 수·해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous steps applied = 예
-- expect: push log kind check without signup = 예
-- expect: notify prefs check without signup = 예
-- expect: signup functions absent = 예
-- expect: columns present = 예
-- expect: dev_inbox rows = 1
-- expect: push log rows = 기록
-- expect: push log and profiles grants policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261115234500') then '예' else '아니오' end as value
union all select 'previous steps applied',case when (select count(*) from supabase_migrations.schema_migrations where (version,name) in (('20261105120000','family_push_kind'),('20261103100000','dev_inbox_feature')))=2 and to_regprocedure('private.app_workspace_has_feature(uuid,text)') is not null and to_regprocedure('public.app_operator_feature_workspace(text)') is not null then '예' else '아니오' end
union all select 'push log kind check without signup',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_push_log') and conname='app_push_log_kind_check' and pg_get_constraintdef(oid) ~ '''family''' and pg_get_constraintdef(oid) !~ '''signup''')=1 then '예' else '아니오' end
union all select 'notify prefs check without signup',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_notify_prefs_check' and pg_get_constraintdef(oid) ~ 'family' and pg_get_constraintdef(oid) !~ 'signup')=1 then '예' else '아니오' end
union all select 'signup functions absent',case when to_regprocedure('private.app_signup_people()') is null and to_regprocedure('public.app_signup_list()') is null and to_regprocedure('public.app_signup_since(timestamp with time zone)') is null then '예' else '아니오' end
union all select 'columns present',case when (select count(*) from pg_attribute a where not a.attisdropped and ((a.attrelid=to_regclass('public.app_workspace_members') and a.attname in('user_id','role','created_at')) or (a.attrelid=to_regclass('public.app_profiles') and a.attname in('user_id','display_name')) or (a.attrelid=to_regclass('auth.users') and a.attname in('id','raw_user_meta_data','last_sign_in_at'))))=8 then '예' else '아니오' end
union all select 'dev_inbox rows',(select count(*) from public.app_operator_features where feature='dev_inbox')::text
union all select 'push log rows',(select count(*)::text from public.app_push_log)
union all select 'push log and profiles grants policies hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in(to_regclass('public.app_push_log'),to_regclass('public.app_profiles'))),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid in(to_regclass('public.app_push_log'),to_regclass('public.app_profiles'))),''));
