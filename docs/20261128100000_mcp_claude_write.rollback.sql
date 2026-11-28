begin;
-- 20261128100000_mcp_claude_write의 짝 되돌리기. 쓰기 함수 3개·도우미 8개·쓰기 기록 표 2개·설정 쓰기 칸·mcp_write 허용 행과 키·이번 기록 1행을 지운다.
-- Claude가 이미 쓴 노트·기록은 그대로 남는다(사용자 자료). 쓰기 기록·되돌리기 자료는 표와 함께 사라진다 — 필요하면 먼저 화면에서 되돌린다.
-- 순서: ① Web2 쓰기 스위치 끄기 ② docs/ops/mcp-claude-write-guard.rollback.sql(요청 전 함수 허용 목록 17개로) ③ 이 파일.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 함수·표·칸 삭제와 자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261128100000' and name = 'mcp_claude_write') <> 1 then
    raise exception 'MCP_CLAUDE_WRITE_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if to_regprocedure('public.app_mcp_pre_request()') is not null
     and pg_get_functiondef(to_regprocedure('public.app_mcp_pre_request()')) like '%write\_tools%' then
    raise exception 'MCP_CLAUDE_WRITE_ROLLBACK_BLOCKED: undo docs/ops/mcp-claude-write-guard first';
  end if;
end
$$;

drop function public.app_mcp_write_undo(uuid);
drop function public.app_mcp_write(text, jsonb);
drop function public.app_mcp_write_tools();
drop function private.app_mcp_w_note_blocked(jsonb, boolean, jsonb);
drop function private.app_mcp_w_day(jsonb);
drop function private.app_mcp_w_version(jsonb);
drop function private.app_mcp_w_text(jsonb, text, integer, boolean);
drop function private.app_mcp_w_diary_locked();
drop function private.app_mcp_write_note(uuid, text, text, uuid, date, text, jsonb, integer, integer, timestamptz);
drop function private.app_mcp_write_gate(text);
drop function private.app_mcp_write_check(boolean);

drop table public.app_mcp_write_before;
drop table public.app_mcp_write_log;

revoke update (write_enabled) on table public.app_mcp_settings from authenticated;
alter table public.app_mcp_settings drop column write_enabled;

delete from public.app_operator_features where feature = 'mcp_write';
alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words', 'blog', 'photo_content'));

delete from supabase_migrations.schema_migrations
  where version = '20261128100000' and name = 'mcp_claude_write';
commit;
