begin;
-- 20261020005000_share_pages_links의 짝 되돌리기. 새 표 2개(정책·색인 포함)와 이번 기록 1행만 지운다.
-- 공유 페이지나 링크가 한 줄이라도 있으면 멈춘다. 내용을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 화면·Edge 사용을 멈추고, 내용을 보관한 뒤 복구 계획을 따로 세운다.
-- 기존 표·정책·함수에는 손대지 않는다. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_share_pages, public.app_share_page_links in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261020005000' and name = 'share_pages_links') <> 1 then
    raise exception 'SHARE_PAGES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_share_page_links) or exists (select 1 from public.app_share_pages) then
    raise exception 'SHARE_PAGES_ROLLBACK_BLOCKED: share pages or links exist; preserve and plan recovery';
  end if;
end
$$;

drop table public.app_share_page_links;
drop table public.app_share_pages;

delete from supabase_migrations.schema_migrations
  where version = '20261020005000' and name = 'share_pages_links';
commit;
