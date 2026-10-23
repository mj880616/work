begin;
-- 20261023160000_share_pages_archived_status의 짝 되돌리기. 상태 검사를 draft·published 둘로 되돌리고 이번 기록 1행만 지운다.
-- 보관(archived) 페이지가 하나라도 있으면 멈춘다. 페이지를 지우거나 상태를 몰래 바꿔 통과시키지 않는다.
-- 그런 경우 먼저 화면을 되돌리고(목록에서 뺀 페이지가 다시 보이게 될 수 있음) 그 페이지들을 어떻게 할지 명진이 정한 뒤 다시 계획한다.
-- 표 권한·정책·함수·링크·사진 기록에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_share_pages in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261023160000' and name = 'share_pages_archived_status') <> 1 then
    raise exception 'SHARE_ARCHIVED_STATUS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_share_pages where status = 'archived') then
    raise exception 'SHARE_ARCHIVED_STATUS_ROLLBACK_BLOCKED: archived pages exist; decide them first';
  end if;
end
$$;

alter table public.app_share_pages drop constraint app_share_pages_status_check;
alter table public.app_share_pages
  add constraint app_share_pages_status_check check (status in ('draft', 'published'));

delete from supabase_migrations.schema_migrations
  where version = '20261023160000' and name = 'share_pages_archived_status';
commit;
