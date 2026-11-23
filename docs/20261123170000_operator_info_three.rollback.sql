begin;
-- 20261123170000_operator_info_three의 짝 되돌리기. 세 함수를 바로 앞 원문으로 되돌리고 이번 기록 1행을 지운다.
--   public.app_signup_list() → 20261116002500_signup_status 원문(조직·부서·이름·직책·이메일·가입일·마지막 사용)
--   public.app_signup_since(timestamptz) → 20261115234500_signup_notify 원문(수·이름 다섯·가장 새 가입 초)
--   public.app_feedback_list(text) → 20261115210000_feedback 원문(보낸 사람 이름)
-- 새 쿼리 창(+)에 붙여 넣고 첫 줄 begin;·마지막 줄 commit;·대상 프로젝트를 확인한 뒤 실행한다. 표·자료·실행 역할은 바뀌지 않는다
-- (create or replace는 실행권을 지킨다: list·feedback_list는 authenticated만, since는 service_role만 그대로).
-- 화면·phone-push가 이미 새 판이어도 깨지지 않는다(새 판은 이메일·수만 읽고 남는 칸은 그리지 않음).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261123170000' and name = 'operator_info_three') <> 1
     or to_regprocedure('public.app_signup_list()') is null
     or to_regprocedure('public.app_signup_since(timestamp with time zone)') is null
     or to_regprocedure('public.app_feedback_list(text)') is null then
    raise exception 'OPERATOR_INFO_THREE_ROLLBACK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 20261116002500_signup_status 원문 그대로.
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

-- 20261115234500_signup_notify 원문 그대로.
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
             'names', coalesce((select pg_catalog.jsonb_agg(t.name order by t.at desc, t.name)
                                  from (select x.name, pg_catalog.date_trunc('second', x.signed_up_at) as at from private.app_signup_people() x
                                         where pg_catalog.date_trunc('second', x.signed_up_at) > p_since
                                         order by x.signed_up_at desc, x.name limit 5) t), '[]'::jsonb),
             'newest', pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.max(pg_catalog.date_trunc('second', s.signed_up_at))))::bigint)
      from private.app_signup_people() s
     where pg_catalog.date_trunc('second', s.signed_up_at) > p_since);
end
$$;

-- 20261115210000_feedback 원문 그대로.
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
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', f.id, 'name', coalesce(nullif(pg_catalog.btrim(p.display_name), ''), '이름 없음'),
             'created_at', f.created_at, 'screen', f.screen, 'device', f.device, 'client', f.client, 'version', f.app_version,
             'body', f.body, 'photos', f.photo_count, 'done_at', f.done_at) order by f.created_at desc)
      from (select * from public.app_feedback x
             where case coalesce(p_state, 'open') when 'open' then x.done_at is null when 'done' then x.done_at is not null else true end
             order by x.created_at desc limit 300) f
      left join public.app_profiles p on p.user_id = f.user_id), '[]'::jsonb);
end
$$;

revoke all on function public.app_signup_list() from public, anon, service_role;
revoke all on function public.app_signup_since(timestamptz) from public, anon, authenticated;
revoke all on function public.app_feedback_list(text) from public, anon, service_role;

delete from supabase_migrations.schema_migrations where version = '20261123170000' and name = 'operator_info_three';
commit;
