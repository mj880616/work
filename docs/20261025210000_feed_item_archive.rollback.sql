begin;
-- 20261025210000_feed_item_archive의 짝 되돌리기(SQL Editor 경로 전용: 자료 보호 확인(DO 블록)이 있어 승인형 workflow rollback 모드는 받지 않는다).
-- 보관한 소식(archived_at 값)이 하나라도 있으면 멈춘다(보관 표시를 잃지 않으려고). 그때 순서:
--   1) Web2 텔레그램 소식의 '보관함'에서 보관한 소식을 모두 '되살리기'로 보통 상태로 돌린다. 지우는 일은 이 파일이 하지 않는다.
--   2) 그 뒤 이 되돌리기를 실행한다.
-- 순서: 함수 삭제 → 색인 삭제 → 새 칸 삭제 → 기록 1행 삭제. 소식 표의 기존 줄·권한·정책·트리거와 hidden_at(삭제 표시)은 건드리지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261025210000' and name = 'feed_item_archive') <> 1 then
    raise exception 'FEED_ITEM_ARCHIVE_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_feed_items where archived_at is not null) then
    raise exception 'FEED_ITEM_ARCHIVE_ROLLBACK_BLOCKED: archived items exist; restore them to normal first';
  end if;
end
$$;

drop function public.app_feed_set_state(uuid, text);
drop index public.app_feed_items_archived_idx;
alter table public.app_feed_items drop column archived_at;

delete from supabase_migrations.schema_migrations
  where version = '20261025210000' and name = 'feed_item_archive';
commit;
