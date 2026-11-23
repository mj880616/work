begin;
-- S68-58 운영자정보셋(명진 11/23 15:53 "운영자에게 제공되는 정보: 이메일주소, 가입일, 마지막 사용 시각."으로 변경).
-- 원칙(11/23): "내가 기록한 내용은 운영자가 볼 수 없습니다." 운영자에게 가는 사람 정보는 이메일주소·가입일·마지막 사용 시각 셋뿐이다.
--   조직(노조명)·부서·이름·직책은 운영자에게 가지 않는다. 기록 내용·작업공간 id·사용자 id도 가지 않는다(그대로).
-- 무엇(새 표·새 함수·권한 변경 없음 — 같은 서명·같은 반환형으로 본문만 다시 정의):
--  1) public.app_signup_list()(운영자 '가입자 현황'·알림 줄): 한 줄 = {email, signed_up_at, last_seen_at}. 배열·새 가입부터·2000명 상한·운영자 판정 그대로.
--  2) public.app_signup_since(p_since)(폰 알림 서버 15분 예약, service_role 전용): {count, newest}만 — 이름 다섯(names)을 빼서 알림은 '새 가입 n명'.
--  3) public.app_feedback_list(p_state)(운영자 '받은 의견'): 보낸 사람을 이름(name) 대신 이메일주소(email)로. 글·사진·화면·기기·판 번호는 그대로
--     (이용자가 '의견 보내기'로 운영자에게 직접 보낸 것). 거르기·300건 상한·운영자 판정 그대로.
-- 배포 순서: 이 DB 변경이 먼저 나가도 지금 배포된 화면·phone-push는 깨지지 않는다(이름 칸이 비면 '이름 없음'·'새 가입 n명'으로 그림).
-- 운영자 판정은 기존 그대로: 서버 허용 표의 dev_inbox 기능이 있는 작업공간 owner(private.app_workspace_has_feature). 아니면 42501 OPERATOR_FEATURE_REQUIRED.
-- 권한: list·feedback_list는 authenticated만, since는 service_role만(기존 그대로 — create or replace가 기존 실행권을 지키고, 이 파일은 회수만 한다).
--   표·칸·정책·RLS·허용 행·도우미 함수(private.app_signup_people 등) 변경 없음. anon·PUBLIC 실행 없음. rtw_* 객체 없음.
-- 짝: docs/20261123170000_operator_info_three.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261123170000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261116002500' and name = 'signup_status') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115234500' and name = 'signup_notify') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115210000' and name = 'feedback') <> 1
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null
     or to_regprocedure('private.app_signup_people()') is null
     or to_regprocedure('private.app_feedback_operator()') is null
     or (select count(*) from pg_proc where oid in (to_regprocedure('public.app_signup_list()'),
           to_regprocedure('public.app_signup_since(timestamp with time zone)'), to_regprocedure('public.app_feedback_list(text)'))
           and prosecdef and proconfig = array['search_path=""'] and prorettype = 'jsonb'::regtype) <> 3
     or has_function_privilege('anon', 'public.app_signup_list()', 'execute')
     or has_function_privilege('service_role', 'public.app_signup_list()', 'execute')
     or not has_function_privilege('authenticated', 'public.app_signup_list()', 'execute')
     or has_function_privilege('anon', 'public.app_signup_since(timestamp with time zone)', 'execute')
     or has_function_privilege('authenticated', 'public.app_signup_since(timestamp with time zone)', 'execute')
     or not has_function_privilege('service_role', 'public.app_signup_since(timestamp with time zone)', 'execute')
     or has_function_privilege('anon', 'public.app_feedback_list(text)', 'execute')
     or has_function_privilege('service_role', 'public.app_feedback_list(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_feedback_list(text)', 'execute')
     or (select count(*) from pg_attribute a where not a.attisdropped and (
            (a.attrelid = 'public.app_workspace_members'::regclass and a.attname in ('user_id', 'role', 'created_at'))
         or (a.attrelid = 'public.app_feedback'::regclass and a.attname in ('id', 'user_id', 'created_at', 'screen', 'device', 'client', 'app_version', 'body', 'photo_count', 'done_at'))
         or (a.attrelid = 'auth.users'::regclass and a.attname in ('id', 'email', 'last_sign_in_at'))
         or (a.attrelid = 'auth.sessions'::regclass and a.attname in ('user_id', 'updated_at')))) <> 18 then
    raise exception 'OPERATOR_INFO_THREE_PREREQUISITE_CHANGED; stop';
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
             'email', t.email, 'signed_up_at', t.signed_up_at, 'last_seen_at', t.last_seen_at)
           order by t.signed_up_at desc, t.email)
      from (
        select o.signed_up_at,
               u.email::text as email,
               greatest(u.last_sign_in_at, s.last_refresh) as last_seen_at
          from (select m.user_id, pg_catalog.min(m.created_at) as signed_up_at
                  from public.app_workspace_members m
                 where m.role = 'owner' and m.user_id is not null and m.created_at is not null
                 group by m.user_id) o
          join auth.users u on u.id = o.user_id
          left join (select x.user_id, pg_catalog.max(x.updated_at) as last_refresh
                       from auth.sessions x where x.user_id is not null group by x.user_id) s on s.user_id = o.user_id
         order by o.signed_up_at desc
         limit 2000) t), '[]'::jsonb);
end
$$;

-- 폰 알림 서버 전용. 초 단위로 자른 가입 시각이 p_since보다 뒤인 사람 수와 가장 새 가입 초만(이름 없음).
create or replace function public.app_signup_since(p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_since is null then
    raise exception using errcode = '22023', message = 'SIGNUP_SINCE_REQUIRED';
  end if;
  return (
    select pg_catalog.jsonb_build_object(
             'count', pg_catalog.count(*),
             'newest', pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.max(pg_catalog.date_trunc('second', s.signed_up_at))))::bigint)
      from private.app_signup_people() s
     where pg_catalog.date_trunc('second', s.signed_up_at) > p_since);
end
$$;

create or replace function public.app_feedback_list(p_state text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.app_feedback_operator() then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', f.id, 'email', u.email::text,
             'created_at', f.created_at, 'screen', f.screen, 'device', f.device, 'client', f.client, 'version', f.app_version,
             'body', f.body, 'photos', f.photo_count, 'done_at', f.done_at) order by f.created_at desc)
      from (select * from public.app_feedback x
             where case coalesce(p_state, 'open') when 'open' then x.done_at is null when 'done' then x.done_at is not null else true end
             order by x.created_at desc limit 300) f
      left join auth.users u on u.id = f.user_id), '[]'::jsonb);
end
$$;

revoke all on function public.app_signup_list() from public, anon, service_role;
revoke all on function public.app_signup_since(timestamptz) from public, anon, authenticated;
revoke all on function public.app_feedback_list(text) from public, anon, service_role;

-- 마지막 확인: 셋 다 DEFINER·빈 search_path·jsonb, 실행 역할은 적용 전과 같음(list·feedback_list는 authenticated만, since는 service_role만). 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_proc where oid in (to_regprocedure('public.app_signup_list()'),
        to_regprocedure('public.app_signup_since(timestamp with time zone)'), to_regprocedure('public.app_feedback_list(text)'))
        and prosecdef and proconfig = array['search_path=""'] and prorettype = 'jsonb'::regtype) <> 3
     or has_function_privilege('anon', 'public.app_signup_list()', 'execute')
     or has_function_privilege('service_role', 'public.app_signup_list()', 'execute')
     or not has_function_privilege('authenticated', 'public.app_signup_list()', 'execute')
     or has_function_privilege('anon', 'public.app_signup_since(timestamp with time zone)', 'execute')
     or has_function_privilege('authenticated', 'public.app_signup_since(timestamp with time zone)', 'execute')
     or not has_function_privilege('service_role', 'public.app_signup_since(timestamp with time zone)', 'execute')
     or has_function_privilege('anon', 'public.app_feedback_list(text)', 'execute')
     or has_function_privilege('service_role', 'public.app_feedback_list(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_feedback_list(text)', 'execute')
     or has_function_privilege('anon', 'private.app_signup_people()', 'execute')
     or has_function_privilege('authenticated', 'private.app_signup_people()', 'execute')
     or has_function_privilege('anon', 'private.app_feedback_operator()', 'execute')
     or has_function_privilege('authenticated', 'private.app_feedback_operator()', 'execute') then
    raise exception 'OPERATOR_INFO_THREE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261123170000', 'operator_info_three', array['S68-58 operator info three: operator-facing person info narrowed to email, signed-up time and last used time; public.app_signup_list() rows now email, signed_up_at, last_seen_at only (no union, department, name or job title); public.app_signup_since(timestamptz) returns count and newest only (no names); public.app_feedback_list(text) shows the sender email instead of the profile name; same signatures and return types (jsonb, SECURITY DEFINER, search_path empty); execute roles unchanged (list and feedback list authenticated only, since service_role only), revoke only; no table, column, policy, RLS, grant or row change; no anon or PUBLIC execute']);
commit;
