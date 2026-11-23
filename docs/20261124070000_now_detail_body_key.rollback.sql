begin;
-- 20261124070000_now_detail_body_key의 짝 되돌리기(승인형 workflow rollback 모드 또는 SQL Editor·폰 경로 C).
-- 먼저 Edge ai-assist를 이 변경 전 판으로 되돌린다(새 판은 body_key를 읽고 쓴다).
-- 지우는 것: 두 표의 body_key 칸과 그 모양 검사, 이번 기록 1행. 저장된 요약·시사점 행과 다른 칸은 그대로다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261124070000' and name = 'now_detail_body_key') <> 1 then
    raise exception 'NOW_DETAIL_BODY_KEY_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

alter table public.app_news_now_details drop constraint app_news_now_details_body_key_check;
alter table public.app_news_now_details drop column body_key;
alter table public.app_outside_now_details drop constraint app_outside_now_details_body_key_check;
alter table public.app_outside_now_details drop column body_key;

delete from supabase_migrations.schema_migrations
  where version = '20261124070000' and name = 'now_detail_body_key';
commit;
