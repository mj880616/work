begin;
-- 20261115200000_update_news의 짝 되돌리기(SQL Editor 새 쿼리 창 전용).
-- 함수 일곱·이번 기록 1행만 지운다. 표 셋은 남긴다(보낸 소식·읽음 기록 보존 — 지울지는 따로 결정).
-- 화면 PR(PR3)이 운영에 있으면 그것을 먼저 되돌린다(아니면 '업데이트 소식' 화면이 못 읽음 안내가 된다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261115200000' and name = 'update_news') <> 1 then
    raise exception 'UPDATE_NEWS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function if exists public.app_update_news_list();
drop function if exists public.app_update_news_seen();
drop function if exists public.app_update_news_admin();
drop function if exists public.app_update_news_save(uuid, text, text[], text[]);
drop function if exists public.app_update_news_withdraw(uuid);
drop function if exists public.app_update_news_set_start(date);
drop function if exists private.app_update_news_operator();

delete from supabase_migrations.schema_migrations where version = '20261115200000' and name = 'update_news';
commit;
