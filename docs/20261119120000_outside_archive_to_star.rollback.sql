begin;
-- 20261119120000_outside_archive_to_star의 짝 되돌리기. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow의 rollback 모드는 자료 UPDATE를 막는다).
-- 1) 보관 시각(archived_at)이 있고 별표 시각(starred_at)이 보관 시각과 똑같은 줄 = 적용이 채운 줄의 starred_at만 비운다.
--    적용 뒤 사용자가 새로 별표를 쳤거나(시각이 다름) 별표를 끈 줄(화면이 archived_at도 비움)은 건드리지 않는다.
-- 2) 이번 기록 1행을 지운다. archived_at·다른 칸·표·권한·정책·함수는 건드리지 않는다.
-- 화면을 옛 판(사회운동 '보관' 따로)으로 되돌린 뒤에만 실행한다. 새 판 화면은 starred_at만 읽으므로 이 되돌리기 뒤 옛 보관 글이 [보관] 탭에서 빠진다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_outside_article_marks in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261119120000' and name = 'outside_archive_to_star') <> 1 then
    raise exception 'OUTSIDE_ARCHIVE_TO_STAR_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

update public.app_outside_article_marks
  set starred_at = null
  where archived_at is not null
    and starred_at = archived_at;

delete from supabase_migrations.schema_migrations
  where version = '20261119120000' and name = 'outside_archive_to_star';
commit;
