begin;
-- EDGE-서버함수정리 C3(명진 11/02 결정: 안 A). 설계: docs/design/todo-feature-guard.md 3절 '안 A'.
-- 챙길 것 표 중 텔레그램에 속한 2곳에만 운영자 허용 표 가드를 건다(권한을 좁히기만 함).
--   1) public.app_todo_ask_rooms(텔레그램 방 열쇠): restrictive 읽기 정책 op_feature_read(authenticated)
--      + BEFORE INSERT OR UPDATE 트리거 trg_op_feature_guard(기존 private.app_operator_feature_guard('telegram') 재사용).
--   2) public.app_todo_candidates: source_kind = 'telegram' 줄에만 같은 판정.
--      restrictive 읽기 정책 op_feature_read + 트리거 trg_op_feature_guard (when new.source_kind = 'telegram').
--      DEFINER 함수 app_todo_candidate_from_telegram(service_role)은 RLS를 거치지 않으므로 트리거가 길목이다.
--      가드 함수는 auth.uid()를 보지 않고 허용 행 존재만 보므로 service_role 수집기에서도 그대로 돈다.
-- 걸지 않는 표(D3, 모든 사용자 것): app_todo_radar_state, app_todo_not_mine, app_todo_feedback, app_todo_rules.
-- 안 하는 것: 기존 정책·권한·칸·함수 본문 변경, 기존 줄 변경·삭제, anon·PUBLIC 권한, RLS 약화, rtw_* 객체.
-- 사전 조건: 운영자(텔레그램 허용) 작업공간 밖에 텔레그램 후보 줄·텔레그램 방 줄이 0이어야 한다(아니면 그 줄 수정까지 막히므로 멈춤).
-- 짝: docs/20261102030000_todo_feature_guard.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261102030000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029120000' and name = 'todo_candidates_telegram') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029210000' and name = 'todo_mine_only') <> 1
     or to_regclass('public.app_todo_candidates') is null
     or to_regclass('public.app_todo_ask_rooms') is null
     or to_regclass('public.app_operator_features') is null
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null
     or to_regprocedure('private.app_operator_feature_guard()') is null
     or exists (select 1 from pg_policy where polname = 'op_feature_read'
                  and polrelid in (to_regclass('public.app_todo_candidates'), to_regclass('public.app_todo_ask_rooms')))
     or exists (select 1 from pg_trigger where tgname = 'trg_op_feature_guard'
                  and tgrelid in (to_regclass('public.app_todo_candidates'), to_regclass('public.app_todo_ask_rooms'))) then
    raise exception 'TODO_FEATURE_GUARD_PREREQUISITE_CHANGED; stop';
  end if;
  if exists (select 1 from public.app_todo_candidates c
               where c.source_kind = 'telegram'
                 and not exists (select 1 from public.app_operator_features f
                                  where f.workspace_id = c.workspace_id and f.feature = 'telegram'))
     or exists (select 1 from public.app_todo_ask_rooms r
                  where not exists (select 1 from public.app_operator_features f
                                     where f.workspace_id = r.workspace_id and f.feature = 'telegram')) then
    raise exception 'TODO_FEATURE_GUARD_ROWS_OUTSIDE_OPERATOR; stop';
  end if;
end
$$;

create policy op_feature_read on public.app_todo_ask_rooms as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'telegram'));
create policy op_feature_read on public.app_todo_candidates as restrictive for select to authenticated
  using (source_kind <> 'telegram' or private.app_workspace_has_feature(workspace_id, 'telegram'));

create trigger trg_op_feature_guard before insert or update on public.app_todo_ask_rooms
  for each row execute function private.app_operator_feature_guard('telegram');
create trigger trg_op_feature_guard before insert or update on public.app_todo_candidates
  for each row when (new.source_kind = 'telegram') execute function private.app_operator_feature_guard('telegram');

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261102030000', 'todo_feature_guard', array['EDGE-서버함수정리 C3 plan A: restrictive select policy op_feature_read (authenticated) and BEFORE INSERT OR UPDATE trigger trg_op_feature_guard reusing private.app_operator_feature_guard(telegram) on app_todo_ask_rooms (all rows) and app_todo_candidates (source_kind = telegram rows only); no guard on app_todo_radar_state, app_todo_not_mine, app_todo_feedback, app_todo_rules; no change to existing policies, grants, columns, function bodies or rows']);
commit;
