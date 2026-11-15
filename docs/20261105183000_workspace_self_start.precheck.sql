-- SELECT only. 20261105183000_workspace_self_start 적용 전(시험 적용 전후 비교에도 씀). 개수·참거짓·해시만, 행 내용·id·메일은 읽지 않는다.
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- 적용 전 기대: 앞 단계(②-3 org_order) 기록 있음, 이번 기록·새 표·새 함수 없음, 함수가 넣는 칸 밖에 기본값 없는 필수 칸 없음(칸 형식 일치),
--   프로필 user_id에 고유 인덱스 있음. owner 행 수·세 표의 정책·권한·트리거·인덱스 해시와 역할 트리거 정의 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- 역할 트리거(trg_app_enforce_workspace_member_role, 운영 전용, 정의는 저장소에 없음)는 여기서 바꾸지 않는다. 그 정의는 PR 본문의 읽기 SQL로 커맨드센터가 먼저 본다.
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: switch table and functions absent = 예
-- expect: required columns covered = 예
-- expect: profile user_id unique = 예
-- expect: owner rows = 기록
-- expect: workspaces rows = 기록
-- expect: member role trigger count = 기록
-- expect: member role trigger function hash = 기록
-- expect: three tables policies hash = 기록
-- expect: three tables grants and RLS hash = 기록
-- expect: three tables triggers hash = 기록
-- expect: three tables indexes hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261105131500' and name='profile_view_prefs_org_order')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261105183000') then '예' else '아니오' end
union all select 'switch table and functions absent',case when to_regclass('public.app_workspace_signup') is null and to_regprocedure('public.app_workspace_start()') is null and to_regprocedure('public.app_workspace_start_status()') is null then '예' else '아니오' end
union all select 'required columns covered',case when to_regclass('public.app_workspaces') is not null and to_regclass('public.app_workspace_members') is not null and to_regclass('public.app_profiles') is not null
  and not exists(select 1 from pg_attribute a where a.attrelid in(to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_profiles'))
    and a.attnum>0 and not a.attisdropped and a.attnotnull and not a.atthasdef and a.attidentity='' and a.attgenerated=''
    and not((a.attrelid=to_regclass('public.app_workspaces') and a.attname in('id','slug','name')) or (a.attrelid=to_regclass('public.app_workspace_members') and a.attname in('workspace_id','user_id','role')) or (a.attrelid=to_regclass('public.app_profiles') and a.attname='user_id')))
  and (select count(*) from pg_attribute a where not a.attisdropped and ((a.attrelid=to_regclass('public.app_workspaces') and a.attname='id' and a.atttypid='uuid'::regtype)
    or (a.attrelid=to_regclass('public.app_workspaces') and a.attname in('slug','name') and a.atttypid='text'::regtype)
    or (a.attrelid=to_regclass('public.app_workspace_members') and a.attname in('workspace_id','user_id') and a.atttypid='uuid'::regtype)
    or (a.attrelid=to_regclass('public.app_workspace_members') and a.attname='role' and a.atttypid='text'::regtype)
    or (a.attrelid=to_regclass('public.app_profiles') and a.attname='user_id' and a.atttypid='uuid'::regtype)))=7 then '예' else '아니오' end
union all select 'profile user_id unique',case when exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[0] where i.indrelid=to_regclass('public.app_profiles') and i.indisunique and i.indnatts=1 and a.attname='user_id') then '예' else '아니오' end
union all select 'owner rows',(select count(*)::text from public.app_workspace_members where role='owner')
union all select 'workspaces rows',(select count(*)::text from public.app_workspaces)
union all select 'member role trigger count',(select count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_workspace_members') and tgname='trg_app_enforce_workspace_member_role' and not tgisinternal)
union all select 'member role trigger function hash',md5(coalesce((select string_agg(t.tgenabled::text||':'||md5(pg_get_functiondef(t.tgfoid)),',' order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('public.app_workspace_members') and t.tgname='trg_app_enforce_workspace_member_role' and not t.tgisinternal),''))
union all select 'three tables policies hash',md5(coalesce((select string_agg(c.relname||':'||p.polname::text||':'||p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid where p.polrelid in(to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_profiles'))),''))
union all select 'three tables grants and RLS hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in(to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_profiles'))),''))
union all select 'three tables triggers hash',md5(coalesce((select string_agg(c.relname||':'||t.tgname::text||':'||t.tgenabled::text||':'||md5(pg_get_triggerdef(t.oid)),',' order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgrelid in(to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_profiles')) and not t.tgisinternal),''))
union all select 'three tables indexes hash',md5(coalesce((select string_agg(md5(pg_get_indexdef(i.indexrelid)),',' order by pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid in(to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_profiles'))),''));
