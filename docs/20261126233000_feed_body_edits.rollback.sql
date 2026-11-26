begin;
-- 20261126233000_feed_body_edits의 짝 되돌리기(SQL Editor 전용 — 표 지우기는 승인형 workflow rollback 모드가 받지 않는다).
-- 새 표(app_feed_body_edits — 정책·색인·권한이 함께 사라짐)를 지우고 이번 기록 1행만 지운다.
-- 고친 원문이 하나라도 있으면 멈춘다 — 지우면 사용자가 고친 원문이 사라지므로, 먼저 어떻게 할지 정한 뒤 다시 계획한다.
-- 다른 표·칸·권한·정책·자료에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261126233000' and name = 'feed_body_edits') <> 1 then
    raise exception 'FEED_BODY_EDITS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_feed_body_edits) then
    raise exception 'FEED_BODY_EDITS_ROLLBACK_BLOCKED: edited copies exist; decide them first';
  end if;
end
$$;

drop table public.app_feed_body_edits;

delete from supabase_migrations.schema_migrations
  where version = '20261126233000' and name = 'feed_body_edits';
commit;
