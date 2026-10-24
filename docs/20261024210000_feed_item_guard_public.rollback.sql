begin;
-- 20261024210000_feed_item_guard_public의 짝 되돌리기(SQL Editor 경로 전용: 함수 본문 복원은 workflow rollback 허용 목록 밖).
-- 트리거 함수 본문만 앞 단계(20261024140000) 모양으로 되돌리고 기록 1행을 지운다. 표·자료·권한은 건드리지 않는다.
-- 주의: 되돌리면 service_role(collector-feed)의 넣기가 다시 `permission denied for schema private`로 막힌다(원래 문제 복귀).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261024210000' and name = 'feed_item_guard_public') <> 1 then
    raise exception 'FEED_GUARD_PUBLIC_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

-- 이전 본문(20261024140000) 그대로.
create or replace function private.app_feed_item_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if tg_op = 'UPDATE' and new.raw_text is distinct from old.raw_text and new.raw_text is not null then
    raise exception using errcode = '23514', message = 'FEED_RAW_TEXT_CLEAR_ONLY: the stored copy can only be cleared';
  end if;
  if not private.app_space_in_workspace(new.project_id, new.workspace_id)
     or not private.app_space_in_workspace(new.suggested_project_id, new.workspace_id)
     or (new.organization_id is not null and not exists (
       select 1 from public.app_suborganizations o
       where o.id = new.organization_id and o.workspace_id = new.workspace_id)) then
    raise exception using errcode = '23514', message = 'FEED_LINK_SCOPE: linked organization or project must be in the same workspace';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_feed_item_guard() from public, anon, authenticated, service_role;

delete from supabase_migrations.schema_migrations
  where version = '20261024210000' and name = 'feed_item_guard_public';
commit;
