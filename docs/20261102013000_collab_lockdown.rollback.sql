begin;
-- 20261102013000_collab_lockdown의 짝 되돌리기(SQL Editor 경로 전용: 정책 삭제가 들어 있어 승인형 workflow rollback 모드는 받지 않는다).
-- 순서: 기록 확인 → 쓰기 차단 정책 6개 삭제 → 기록 1행 삭제. 두 표의 자료·기존 정책·표 권한·트리거는 건드리지 않는다.
-- 협업 함수 9개의 실행권은 되살리지 않는다: 앱·Edge 호출이 0건이라 실행권이 없어서 생길 고장이 없고, 되살리면 막은 입구가 다시 열린다.
--   꼭 이전 상태가 필요하면 적용 전 snapshot artifact의 function 줄(ACL)을 보고 커맨드센터가 함수별 grant를 따로 승인받아 실행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261102013000' and name = 'collab_lockdown') <> 1 then
    raise exception 'COLLAB_LOCKDOWN_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop policy collab_lock_no_insert on public.app_invites;
drop policy collab_lock_no_update on public.app_invites;
drop policy collab_lock_no_delete on public.app_invites;
drop policy collab_lock_no_insert on public.app_workspace_members;
drop policy collab_lock_no_update on public.app_workspace_members;
drop policy collab_lock_no_delete on public.app_workspace_members;

delete from supabase_migrations.schema_migrations where version = '20261102013000' and name = 'collab_lockdown';
commit;
