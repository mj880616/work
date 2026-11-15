begin;
-- 20261104233000_workspace_drive_connections의 짝 되돌리기. 새 표(작업공간별 Drive 연결)와 기록 1행만 지운다.
-- public_policy_drive_config는 이 migration이 바꾸지 않았으므로 그대로다(명진 연결은 id=1에 그대로 남아 있음).
-- SQL Editor(폰 경로 C) 전용(승인형 workflow rollback 모드는 drop table을 받지 않을 수 있음).
-- 되돌리기 전에 ②-2 Edge(작업공간별 연결을 읽는 함수)를 이전 운영 SHA로 먼저 되돌린다. 아니면 그 함수들이 503/424로 멈춘다.
-- ②-2 뒤 다른 사람이 연결한 행이 있으면 그 연결도 같이 사라진다(그 사람은 다시 연결해야 함) — 행 수를 먼저 확인한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261104233000' and name = 'workspace_drive_connections') <> 1 then
    raise exception 'WORKSPACE_DRIVE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_drive_connections;

delete from supabase_migrations.schema_migrations
  where version = '20261104233000' and name = 'workspace_drive_connections';
commit;
