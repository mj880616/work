begin;
-- JOURNAL-챙길것화면 후속(명진 결정 2026-10-27 "ㅇ", 원장 결정 대기 ① V33): 챙길 것 후보에 "할 일로 넣을 때 정한 기한" 칸을 둔다.
-- 지금은 '할 일로 넣음 · 10.23'의 기한을 저장 칸 없이 할 일 목록 사본에서 읽어, 사본에 없으면 날짜를 못 보여 준다. 이 칸이 있으면 늘 정확히 남는다.
-- 설계:
--  1) public.app_todo_candidates에 task_due date 칸 1개만 더한다. AI가 제안한 기한(due)과 다른 칸이다(due는 그대로).
--  2) 검사 제약 app_todo_candidates_task_due_check: task_due는 status='tasked'일 때만 값이 있을 수 있다(대기·무시 후보에는 비어 있음).
--     기존 행은 모두 null이라 통과한다. null은 "기한 없음" 또는 "이 칸이 생기기 전에 넣은 후보"이며, 화면은 이전처럼 할 일 사본에서 읽는다.
--  3) 권한: 기존 처리 칸(status·task_id·decided_at)과 같은 방식으로 authenticated에 task_due 칸 update만 더한다. insert 권한은 주지 않는다
--     (후보를 만드는 쪽이 이 칸을 정할 수 없다). 같은 owner 정책(todo_candidates_owner_all)이 그대로 막아 주므로 읽기·쓰기 범위는 넓어지지 않는다.
--     anon·PUBLIC·service_role 권한 없음. 새 표·함수·정책·트리거 없음. 기존 정책·자료는 바꾸지 않는다.
-- 표 권한(grant)이 있어 승인형 DB workflow 검사가 거절하므로 SQL Editor(폰 경로 C) 전용이다(앞 단계 20261021075034와 같다).
-- 짝 파일: docs/20261027060000_todo_candidates_task_due.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- 확인과 바꾸기 사이에 다른 저장이 끼어들지 않게 쓰기만 잠근다(읽기는 그대로).
lock table public.app_todo_candidates in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261027060000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261021075034' and name = 'todo_radar_candidates') <> 1
     or to_regclass('public.app_todo_candidates') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_todo_candidates') and attname = 'task_due' and not attisdropped)
     or exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_todo_candidates') and conname = 'app_todo_candidates_task_due_check')
     -- 쓰는 칸이 있고 모양이 맞아야 한다.
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_todo_candidates') and not attisdropped
         and ((attname = 'status' and atttypid = 'text'::regtype) or (attname = 'task_id' and atttypid = 'text'::regtype)
              or (attname = 'due' and atttypid = 'date'::regtype))) <> 3
     -- 앞 단계의 권한 모양이 그대로여야 한다: 처리 칸 update만, 정책 1개.
     or not has_column_privilege('authenticated', to_regclass('public.app_todo_candidates'), 'status', 'update')
     or has_column_privilege('authenticated', to_regclass('public.app_todo_candidates'), 'summary', 'update')
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_todo_candidates')
         and polname = 'todo_candidates_owner_all' and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_todo_candidates')) <> 1 then
    raise exception 'TODO_TASK_DUE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_todo_candidates add column task_due date;
alter table public.app_todo_candidates add constraint app_todo_candidates_task_due_check check (task_due is null or status = 'tasked');
comment on column public.app_todo_candidates.task_due is '할 일로 넣을 때 정한 기한(status=tasked일 때만). null = 기한 없음 또는 이 칸이 생기기 전 후보.';

grant update (task_due) on table public.app_todo_candidates to authenticated;

-- 사후 확인: 칸·제약이 있고, 쓰기는 update만(insert 불가), anon·PUBLIC·service_role 권한 없음, 정책은 그대로 1개. 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_attribute where attrelid = 'public.app_todo_candidates'::regclass and attname = 'task_due'
      and atttypid = 'date'::regtype and not attisdropped and not attnotnull) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_todo_candidates'::regclass and conname = 'app_todo_candidates_task_due_check') <> 1
     or not has_column_privilege('authenticated', 'public.app_todo_candidates'::regclass, 'task_due', 'update')
     or has_column_privilege('authenticated', 'public.app_todo_candidates'::regclass, 'task_due', 'insert')
     or has_any_column_privilege('anon', 'public.app_todo_candidates'::regclass, 'select,insert,update,references')
     or has_any_column_privilege('service_role', 'public.app_todo_candidates'::regclass, 'select,insert,update,references')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_todo_candidates'::regclass and attname = 'task_due'
                and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_class where oid = 'public.app_todo_candidates'::regclass and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_todo_candidates'::regclass) <> 1 then
    raise exception 'TODO_TASK_DUE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261027060000', 'todo_candidates_task_due', array['JOURNAL-챙길것화면: app_todo_candidates.task_due date + 검사 제약(tasked일 때만) + authenticated task_due update 권한']);
commit;
