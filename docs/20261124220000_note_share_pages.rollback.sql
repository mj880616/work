begin;
-- 20261124220000_note_share_pages의 짝 되돌리기. 새 표(app_note_share_pages)를 지우고 이번 기록 1행만 지운다.
-- 게시한 노트 짝이 하나라도 있으면 멈춘다(보낸 링크가 몰래 빈 페이지가 되지 않게). 그런 경우 먼저 화면을 되돌리고,
-- 그 게시를 어떻게 할지 명진이 정한 뒤 다시 계획한다. 공유 페이지·링크·노트 표의 칸·권한·정책·자료에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261124220000' and name = 'note_share_pages') <> 1 then
    raise exception 'NOTE_SHARE_PAGES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_note_share_pages) then
    raise exception 'NOTE_SHARE_PAGES_ROLLBACK_BLOCKED: published notes exist; decide them first';
  end if;
end
$$;

drop table public.app_note_share_pages;

delete from supabase_migrations.schema_migrations
  where version = '20261124220000' and name = 'note_share_pages';
commit;
