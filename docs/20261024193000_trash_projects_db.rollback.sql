begin;
-- 20261024193000_trash_projects_db의 짝 되돌리기. 휴지통 트리거·숨김 정책·RPC 3개·트리거 함수·제약·색인·칸 2개와 이번 기록 1행만 지운다.
-- 프로젝트 행·연결·기존 정책·기존 트리거(app_spaces_unlink_retained_records_before_delete)는 건드리지 않는다.
-- 되돌린 순간 휴지통에 있던 프로젝트는 지워지지 않고 원래 자리에 다시 보인다(표시 칸이 없어지므로). 자료는 잃지 않는다.
-- 되돌린 뒤의 [삭제]는 적용 전처럼 바로 지운다(연결 해제 + cascade).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow의 rollback 모드는 트리거·정책 삭제를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_spaces in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261024193000' and name = 'trash_projects_db') <> 1 then
    raise exception 'TRASH_PROJECTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop trigger if exists app_spaces_a_trash_before_delete on public.app_spaces;
drop policy if exists app_spaces_trash_hidden on public.app_spaces;
drop function if exists public.app_trash_list(text);
drop function if exists public.app_trash_restore(text, uuid);
drop function if exists public.app_trash_purge(text, uuid);
drop function if exists private.app_trash_space_before_delete();
drop index if exists public.app_spaces_trash_root_idx;
alter table public.app_spaces drop constraint if exists app_spaces_trash_pair_check;
alter table public.app_spaces drop column if exists deleted_root_id, drop column if exists deleted_at;

delete from supabase_migrations.schema_migrations
  where version = '20261024193000' and name = 'trash_projects_db';
commit;
