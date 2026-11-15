begin;
-- 20261110190000_org_update_one_line의 짝 되돌리기. 이번에 만든 것만 지운다: 트리거 1개·함수 1개·검사 1개·칸 1개(one_line)·이번 기록 1행.
-- 사라지는 것: AI가 만든 한 줄(화면은 원문에서 임시 한 줄로 돌아간다). 조직 기록 글·날짜·정책·권한은 그대로.
-- 순서: 화면을 one_line을 읽지 않는 이전 판으로 먼저 되돌린다(화면은 칸이 없으면 칸 없이 다시 읽어 그대로 동작한다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_suborganization_updates in access exclusive mode;
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261110190000' and name = 'org_update_one_line') <> 1 then
    raise exception 'ORG_UPDATE_ONE_LINE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;
drop trigger app_suborganization_updates_one_line_reset on public.app_suborganization_updates;
drop function private.app_suborganization_updates_one_line_reset();
alter table public.app_suborganization_updates drop constraint app_suborganization_updates_one_line_check;
alter table public.app_suborganization_updates drop column one_line;
delete from supabase_migrations.schema_migrations
  where version = '20261110190000' and name = 'org_update_one_line';
commit;
