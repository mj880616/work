-- MCP-Claude읽기 M-3 L1·L2 되돌리기. SQL Editor(폰 경로 C) 전용. 두 단계를 따로(각각 새 쿼리 창에서) 실행한다.
-- 순서(설계 4.5): Web2 스위치 끄기 → OAuth 클라이언트 삭제·OAuth 서버 끄기 → 1단계 → (화면 확인) → 2단계.
-- 비상(REST가 멈췄을 때): 1단계만 바로 실행하면 요청 전 함수가 빠진다(PostgREST가 설정을 다시 읽음).

-- 1단계: 요청 전 설정 해제 -------------------------------------------------------------------------
begin;
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
commit;

-- 2단계: 1단계 뒤 몇 초 지나 Web2 화면이 열리는 것을 본 다음 실행(설정이 남아 있으면 멈춤) ----------------
begin;
do $$
begin
  if exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole cross join lateral unnest(s.setconfig) x(v)
             where r.rolname = 'authenticator' and x.v like 'pgrst.db\_pre\_request=%') then
    raise exception 'MCP_CLAUDE_READ_GUARD_ROLLBACK_BLOCKED: pre-request still set, run step 1 first';
  end if;
end
$$;
drop policy if exists app_mcp_no_delegated_buckets on storage.buckets;
drop policy if exists app_mcp_no_delegated_storage on storage.objects;
drop function if exists public.app_mcp_pre_request();
commit;
