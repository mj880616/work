begin;
-- S62-29 OPS-가입자현황 PR①(DB, 명진 확정 11/15 22:19·22:24·22:29·23:15·23:17).
-- 운영자 전용 '가입자 현황': 맨 위 숫자 한 줄(전체 · 이번 주 새로 · 최근 7일 쓴 사람 — 화면이 이 목록에서 센다)과 가입자 목록.
-- 목록 칸은 명진 확정 문장 그대로: 조직(노조명) · 부서(부서명) · 이름 · 직책 · 이메일주소 · 가입일 · 마지막 사용 시각.
-- 원칙(11/15 22:24 확정): "운영자는 누가 가입했는지만 보고, 기록한 내용은 보지 않습니다." 이 함수는 위 칸과 개수만 돌려준다.
--   노트·보고·일정·할 일·자료·조직 목록·AI 사용 내용·작업공간 id·사용자 id는 돌려주지 않는다.
-- 무엇: OPS-새가입알림(20261115234500)이 만든 public.app_signup_list()를 같은 서명·같은 반환형(jsonb)으로 다시 정의한다(새 표·새 함수 없음).
--   돌려주는 모양은 어제와 같은 배열(새 가입부터)이고 줄마다 칸만 늘어난다: [{union_name, department_name, name, job_title, email, signed_up_at, last_seen_at}]
--   배열 모양을 지키는 까닭: 이미 배포된 phone-push 알림 줄과 지금 화면이 이 배열(name·signed_up_at)을 읽는다(두 곳 고치지 않고 그대로 동작).
--   - 가입 = 작업공간 owner 행이 처음 생긴 때(기존과 같음). 숫자 셋을 화면이 정확히 세도록 상한을 500 → 2000명으로 올린다.
--   - 마지막 사용 = 로그인 시각과 로그인 유지(세션 갱신) 시각 중 늦은 것(auth.users.last_sign_in_at, auth.sessions.updated_at). 기기·주소 정보는 읽지 않는다.
--   - 노조명·부서명·직책은 각자 내 프로필에 쓴 그대로(없으면 null). 이름은 기존과 같은 순서(구글 이름 → 프로필 이름 → '이름 없음').
-- 운영자 판정은 기존 그대로: 서버 허용 표의 dev_inbox 기능이 있는 작업공간 owner(private.app_workspace_has_feature). 아니면 42501 OPERATOR_FEATURE_REQUIRED.
-- 권한: authenticated만 실행(기존 그대로), anon·PUBLIC·service_role 실행 없음. 표·칸·정책·RLS·허용 행·다른 함수 변경 없음. rtw_* 객체 없음.
-- 짝: docs/20261116002500_signup_status.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261116002500')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115234500' and name = 'signup_notify') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115223000' and name = 'profile_union_department') <> 1
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null
     or to_regprocedure('private.app_signup_people()') is null
     or to_regprocedure('public.app_signup_since(timestamp with time zone)') is null
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_signup_list()')
           and prosecdef and proconfig = array['search_path=""'] and prorettype = 'jsonb'::regtype) <> 1
     or has_function_privilege('anon', 'public.app_signup_list()', 'execute')
     or has_function_privilege('service_role', 'public.app_signup_list()', 'execute')
     or not has_function_privilege('authenticated', 'public.app_signup_list()', 'execute')
     or (select count(*) from pg_attribute a where not a.attisdropped and (
            (a.attrelid = 'public.app_workspace_members'::regclass and a.attname in ('user_id', 'role', 'created_at'))
         or (a.attrelid = 'public.app_profiles'::regclass and a.attname in ('user_id', 'display_name', 'job_title', 'union_name', 'department_name'))
         or (a.attrelid = 'auth.users'::regclass and a.attname in ('id', 'email', 'raw_user_meta_data', 'last_sign_in_at'))
         or (a.attrelid = 'auth.sessions'::regclass and a.attname in ('user_id', 'updated_at')))) <> 14
     or not has_table_privilege('auth.sessions', 'select') then
    raise exception 'SIGNUP_STATUS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create or replace function public.app_signup_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not exists (select 1 from public.app_operator_features f
                     where f.feature = 'dev_inbox' and private.app_workspace_has_feature(f.workspace_id, 'dev_inbox')) then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'union_name', t.union_name, 'department_name', t.department_name, 'name', t.name,
             'job_title', t.job_title, 'email', t.email,
             'signed_up_at', t.signed_up_at, 'last_seen_at', t.last_seen_at)
           order by t.signed_up_at desc, t.name)
      from (
        select o.signed_up_at,
               pg_catalog.left(coalesce(nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                                        nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'name'), ''),
                                        nullif(pg_catalog.btrim(p.display_name), ''), '이름 없음'), 40) as name,
               nullif(pg_catalog.btrim(p.union_name), '') as union_name,
               nullif(pg_catalog.btrim(p.department_name), '') as department_name,
               pg_catalog.left(nullif(pg_catalog.btrim(p.job_title), ''), 60) as job_title,
               u.email::text as email,
               greatest(u.last_sign_in_at, s.last_refresh) as last_seen_at
          from (select m.user_id, pg_catalog.min(m.created_at) as signed_up_at
                  from public.app_workspace_members m
                 where m.role = 'owner' and m.user_id is not null and m.created_at is not null
                 group by m.user_id) o
          join auth.users u on u.id = o.user_id
          left join public.app_profiles p on p.user_id = o.user_id
          left join (select x.user_id, pg_catalog.max(x.updated_at) as last_refresh
                       from auth.sessions x where x.user_id is not null group by x.user_id) s on s.user_id = o.user_id
         order by o.signed_up_at desc
         limit 2000) t), '[]'::jsonb);
end
$$;

revoke all on function public.app_signup_list() from public, anon, authenticated, service_role;
grant execute on function public.app_signup_list() to authenticated;

-- 마지막 확인: 함수 DEFINER·빈 search_path·authenticated만, 도우미·폰 알림 함수 권한 그대로. 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_proc where oid = to_regprocedure('public.app_signup_list()')
        and prosecdef and proconfig = array['search_path=""'] and prorettype = 'jsonb'::regtype) <> 1
     or has_function_privilege('anon', 'public.app_signup_list()', 'execute')
     or has_function_privilege('service_role', 'public.app_signup_list()', 'execute')
     or not has_function_privilege('authenticated', 'public.app_signup_list()', 'execute')
     or has_function_privilege('anon', 'private.app_signup_people()', 'execute')
     or has_function_privilege('authenticated', 'private.app_signup_people()', 'execute')
     or has_function_privilege('anon', 'public.app_signup_since(timestamp with time zone)', 'execute')
     or has_function_privilege('authenticated', 'public.app_signup_since(timestamp with time zone)', 'execute')
     or not has_function_privilege('service_role', 'public.app_signup_since(timestamp with time zone)', 'execute') then
    raise exception 'SIGNUP_STATUS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261116002500', 'signup_status', array['S62-29 OPS signup status: public.app_signup_list() re-defined with the same signature and return type (jsonb, SECURITY DEFINER, search_path empty, authenticated only, operator dev_inbox owner check unchanged); still an array newest first (limit 2000), each row now union name, department name, name, job title, email, signed-up time, last used time; no record content; no table, column, policy, RLS, grant-on-table or row change; no anon, PUBLIC or service_role execute']);
commit;
