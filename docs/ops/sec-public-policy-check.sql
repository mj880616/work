-- SEC-PUBLIC정책표: 운영 DB에 PUBLIC(누구나)·anon(로그인 안 한 방문자) 역할의 정책·권한이 남았는지 보는 읽기 전용 점검.
-- 1) 결과 줄이 하나도 없으면 정상입니다.
-- 2) '2 표권한' 줄이 '1 정책' 줄과 함께(같은 표에) 나오면 로그인 없이 열려 있을 수 있으니 가장 먼저 알립니다.
-- 3) '3 RLS꺼짐' 줄은 일부러 공개하는 표인지 확인합니다(공개용이면 정상, 아니면 알림).
-- 4) Supabase는 새 표를 만들 때 anon 권한을 기본으로 붙이므로, 이 권한이 정책 없이 단독으로 남아 있는 것만으로는 바로 열린 것이 아닙니다(정책·RLS가 막음). 그래도 정리 후보로 봅니다.
-- 5) app_project_progress_updates는 어느 종류로도 0건이어야 합니다(1건이라도 나오면 알립니다).
-- 안전: SELECT 하나뿐이며 카탈로그(pg_policies, information_schema, pg_class)만 읽습니다. 표의 행 데이터는 읽지 않고 쓰기 문장도 없습니다.
-- 사용: Supabase SQL Editor에 통째로 붙여 한 번 실행합니다. in_target=true는 점검 대상 18개 표(docs/ed3-precheck-public-policy.md 6절 16개 + app_project_update_labels + app_project_progress_updates).
with target(table_name) as (
  values
    ('app_project_milestones'), ('app_project_workstreams'), ('app_project_sections'),
    ('app_project_blocks'), ('app_project_checkitems'), ('app_project_modules'),
    ('app_project_updates'), ('app_project_drive_folders'), ('app_project_suborganizations'),
    ('app_space_members'), ('app_meeting_drive_folders'), ('app_drive_settings'),
    ('app_drive_download_tokens'), ('app_google_calendar_connections'),
    ('app_google_oauth_states'), ('app_private_feature_access'),
    ('app_project_update_labels'), ('app_project_progress_updates')
),
found as (
  select '1 정책'::text as check_kind, tablename::text as table_name, policyname::text as item_name,
         cmd::text as command, array_to_string(roles, ',') as roles
    from pg_policies
   where schemaname = 'public'
     and (roles && array['public', 'anon']::name[])
  union all
  select '2 표권한', table_name::text, privilege_type::text, 'GRANT', grantee::text
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'PUBLIC')
  union all
  select '3 RLS꺼짐', c.relname::text, '(RLS off)', '-', '-'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and c.relrowsecurity = false
)
select f.check_kind, f.table_name, f.item_name, f.command, f.roles,
       (f.table_name in (select table_name from target)) as in_target
  from found f
 order by f.check_kind, f.table_name, f.item_name, f.roles;
