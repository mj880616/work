begin;
-- 20261116013000_weekly_own_drafts의 짝 되돌리기. 새 표 1개(정책·트리거 포함)·트리거 함수 1개와 이번 기록 1행만 지운다.
-- 기존 표는 건드리지 않는다. 저장된 내 양식 주별 초안은 함께 사라진다(내 양식·기록은 그대로).
-- 지우기 전에 화면을 이 표를 쓰지 않는 이전 판으로 되돌린다(화면 PR이 나간 뒤라면).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261116013000' and name = 'weekly_own_drafts') <> 1 then
    raise exception 'WEEKLY_OWN_DRAFTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_weekly_own_drafts;
drop function private.app_weekly_own_drafts_stamp();

delete from supabase_migrations.schema_migrations
  where version = '20261116013000' and name = 'weekly_own_drafts';
commit;
