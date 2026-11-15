begin;
-- 20261115230000_news_user_save의 짝 되돌리기. 서버 함수 2개·save_n 칸을 지우고, 읽기 정책·출처 검사를 원래 모양으로, 이번 기록 1행을 지운다.
-- 사람이 직접 넣은 기사(origin='user')가 있으면 검사를 되돌릴 수 없어 그 기사 줄만 지운다(그 기사의 사람별 표시·본문 블록이 함께 사라짐 — 다른 기사는 그대로).
-- 되돌리기 전에 news-feed Edge(?action=save_url)·화면·폰 앱이 운영에 있으면 Edge를 먼저 이전 SHA로 되돌린다(아니면 'News 보관'이 실패로 보임).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261115230000' and name = 'news_user_save') <> 1 then
    raise exception 'NEWS_USER_SAVE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_news_user_save(uuid, text, text, jsonb);
drop policy news_articles_reader_select on public.app_news_articles;
create policy news_articles_reader_select on public.app_news_articles for select to authenticated
  using (origin <> 'tg_scrap' and private.app_news_reader_ok());
drop function private.app_news_marked_by_me(uuid);
delete from public.app_news_articles where origin = 'user';
alter table public.app_news_articles drop constraint app_news_articles_origin_check;
alter table public.app_news_articles add constraint app_news_articles_origin_check
  check (origin in ('site', 'tg_room', 'tg_scrap'));
alter table public.app_news_days drop constraint app_news_days_save_n_check;
alter table public.app_news_days drop column save_n;

delete from supabase_migrations.schema_migrations
  where version = '20261115230000' and name = 'news_user_save';
commit;
