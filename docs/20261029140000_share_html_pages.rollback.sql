begin;
-- 20261029140000_share_html_pages의 짝 되돌리기. 새 표 2개(app_share_page_html·app_share_page_slugs)를 지우고 이번 기록 1행만 지운다.
-- HTML 판이나 짧은 주소가 하나라도 있으면 멈춘다(올린 파일·보낸 짧은 링크를 몰래 지우지 않는다). 그런 경우 먼저 화면을 되돌리고,
-- 그 페이지들을 어떻게 할지 명진이 정한 뒤 다시 계획한다. 기존 공유 페이지·링크 표의 칸·권한·정책·자료에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261029140000' and name = 'share_html_pages') <> 1 then
    raise exception 'SHARE_HTML_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_share_page_html) or exists (select 1 from public.app_share_page_slugs) then
    raise exception 'SHARE_HTML_ROLLBACK_BLOCKED: html versions or short links exist; decide them first';
  end if;
end
$$;

drop table public.app_share_page_slugs;
drop table public.app_share_page_html;

delete from supabase_migrations.schema_migrations
  where version = '20261029140000' and name = 'share_html_pages';
commit;
