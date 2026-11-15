begin;
-- 20261022212757_library_auto_tidy의 짝 되돌리기. 새 함수 2개·새 표 2개(정책·색인 포함)와 이번 기록 1행만 지운다.
-- 먼저 화면·ai-assist를 이전으로 되돌린다(새 화면·서버가 이 표·함수를 쓰므로). 그 뒤 SQL Editor(폰 경로 C)에서 쓴다.
-- 아직 되돌리지 않은 백업(원래 값)이 한 줄이라도 있으면 멈춘다. 원래 값을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 묶음마다 public.app_library_auto_tidy_revert(묶음 id)로 자료 값을 되돌리고(사용자가 그 사이 고친 칸은 건너뜀),
-- 건너뛴 칸이 남으면 캡처해 보관한 뒤 다시 계획한다. 자료 표(app_documents)의 값·정책·권한에는 손대지 않는다.
-- 승인형 DB workflow는 표 삭제를 막으므로 SQL Editor(폰 경로 C) 전용이다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_library_tidy_backups in access exclusive mode;
lock table public.app_library_tidy_attempts in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261022212757' and name = 'library_auto_tidy') <> 1 then
    raise exception 'LIBRARY_AUTO_TIDY_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_library_tidy_backups where reverted_at is null) then
    raise exception 'LIBRARY_AUTO_TIDY_ROLLBACK_BLOCKED: unreverted backups exist; revert or preserve first';
  end if;
end
$$;

drop function public.app_library_auto_tidy_revert(uuid);
drop function public.app_library_auto_tidy_apply(uuid, jsonb);
drop table public.app_library_tidy_attempts;
drop table public.app_library_tidy_backups;

delete from supabase_migrations.schema_migrations
  where version = '20261022212757' and name = 'library_auto_tidy';
commit;
