begin;
-- 20261116002500_signup_status의 짝 되돌리기. public.app_signup_list()를 20261115234500_signup_notify 원문(이름·가입 시각·마지막 접속만)으로 되돌리고 이번 기록 1행을 지운다.
-- 새 쿼리 창(+)에 붙여 넣고 첫 줄 begin;·마지막 줄 commit;·대상 프로젝트를 확인한 뒤 실행한다. 표·자료·권한 범위는 바뀌지 않는다(authenticated만 실행 그대로).
-- 화면 PR(가입자 현황)이 이미 나갔다면 그 화면은 옛 모양(목록만)도 읽으므로 먼저 되돌리지 않아도 된다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261116002500' and name = 'signup_status') <> 1
     or to_regprocedure('public.app_signup_list()') is null then
    raise exception 'SIGNUP_STATUS_ROLLBACK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 20261115234500_signup_notify 원문 그대로.
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
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', s.name, 'signed_up_at', s.signed_up_at, 'last_seen_at', s.last_seen_at)
             order by s.signed_up_at desc)
      from (select * from private.app_signup_people() x order by x.signed_up_at desc limit 500) s), '[]'::jsonb);
end
$$;
revoke all on function public.app_signup_list() from public, anon, authenticated, service_role;
grant execute on function public.app_signup_list() to authenticated;

delete from supabase_migrations.schema_migrations where version = '20261116002500' and name = 'signup_status';
commit;
