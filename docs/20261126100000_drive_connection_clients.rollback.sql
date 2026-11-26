begin;
-- 20261126100000_drive_connection_clients의 짝 되돌리기(SQL Editor 새 쿼리 창 전용).
-- 이번 기록 1행만 지운다. 표는 남긴다(drop table은 승인형 workflow가 받지 않는다. 지울지는 따로 결정).
-- 되돌리기 전에 Edge 함수(public-policy-drive·gdrive-photos·cloud-files·drive-summary·_shared 쓰는 함수)를 이전 커밋으로 먼저 되돌린다.
--   이전 코드는 이 표를 읽지 않으므로 표가 남아 있어도 동작은 지금(심사용 창구 하나)과 같다.
--   명진 전용 창구로 받은 연결이 있으면 이전 코드는 심사용 창구로 새 토큰을 받으려다 실패해 '[Drive 다시 연결]'이 뜬다 → 한 번 다시 연결하면 된다.
--   개수 확인: select count(*) from public.app_drive_connection_clients where oauth_client = 'full';
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261126100000' and name = 'drive_connection_clients') <> 1 then
    raise exception 'DRIVE_CONNECTION_CLIENTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

delete from supabase_migrations.schema_migrations where version = '20261126100000' and name = 'drive_connection_clients';
commit;
