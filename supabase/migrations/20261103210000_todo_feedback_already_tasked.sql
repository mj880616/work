begin;
-- S49-11 TODO-이미할일있음(요청함 11/03 16:04): 정리함 [챙길 것]에서 '이미 할 일 목록에 있고 아직 안 끝낸 일'을 고르는 결과 값 'already_tasked'를 결과 기록 표가 받게 한다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: public.app_todo_feedback의 검사식 app_todo_feedback_outcome_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦).
--   ('tasked', 'done', 'dismissed', 'not_mine') 네 값에 'already_tasked'를 더해 다섯 값으로. 다른 검사식(kind·source·summary·edited·candidate 열쇠)은 그대로다.
--   후보 표(app_todo_candidates)는 바꾸지 않는다: 이어 둔 후보는 기존 'tasked' 상태 + 기존 할 일 id(task_id)로 남고, 어떤 길로 빠졌는지는 이 결과 기록이 맡는다.
-- 권한: 표 grant·정책·RLS·함수·트리거·새 칸 변경 없음. 기존 줄은 건드리지 않는다.
-- 앞 단계: 20261101180000_todo_feedback(결과 기록 표 만듦)과 20261102030000_todo_feature_guard 기록이 있어야 한다(없으면 멈춘다).
-- 짝: docs/20261103210000_todo_feedback_already_tasked.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_todo_feedback in share row exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261103210000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261101180000' and name = 'todo_feedback') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261102030000' and name = 'todo_feature_guard') <> 1
     or to_regclass('public.app_todo_feedback') is null
     -- 지금 검사식이 앞 단계 그대로(already_tasked 없음, 네 값 모두 있음, 검증됨).
     or (select count(*) from pg_constraint where conrelid = 'public.app_todo_feedback'::regclass and conname = 'app_todo_feedback_outcome_check'
         and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ 'tasked' and pg_get_constraintdef(oid) ~ 'dismissed' and pg_get_constraintdef(oid) ~ 'not_mine'
         and pg_get_constraintdef(oid) !~ 'already_tasked') <> 1
     or (select count(*) from pg_class where oid = 'public.app_todo_feedback'::regclass and relrowsecurity) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_todo_feedback'::regclass) <> 1 then
    raise exception 'TODO_FEEDBACK_ALREADY_TASKED_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_todo_feedback drop constraint app_todo_feedback_outcome_check;
alter table public.app_todo_feedback add constraint app_todo_feedback_outcome_check check (
  outcome in ('tasked', 'already_tasked', 'done', 'dismissed', 'not_mine'));

-- 사후 확인: 검사식이 다섯 값을 알고 검증됨, RLS 켜짐·정책 1개 그대로, anon·PUBLIC·service_role 권한 없음, 고치기 권한 없음. 다르면 전체 취소.
do $$
declare f regclass := 'public.app_todo_feedback'::regclass;
begin
  if (select count(*) from pg_constraint where conrelid = f and conname = 'app_todo_feedback_outcome_check' and convalidated
        and pg_get_constraintdef(oid) ~ 'already_tasked' and pg_get_constraintdef(oid) ~ 'not_mine') <> 1
     or (select count(*) from pg_class where oid = f and relrowsecurity) <> 1
     or (select count(*) from pg_policy where polrelid = f) <> 1
     or exists (select 1 from pg_class where oid = f and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', f, 'select,insert,update,delete')
     or has_table_privilege('service_role', f, 'select,insert,update,delete')
     or has_any_column_privilege('authenticated', f, 'update') then
    raise exception 'TODO_FEEDBACK_ALREADY_TASKED_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261103210000', 'todo_feedback_already_tasked', array['S49-11 TODO-이미할일있음: app_todo_feedback_outcome_check also accepts already_tasked; no new column, grants, policies or functions']);
commit;
