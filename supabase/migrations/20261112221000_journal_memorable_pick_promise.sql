begin;
-- S61-11 FORGET-요청방향 2단계(요청함 11/13 05:19 명진 결정): 명진이 남에게 부탁·요청한 일은 명진 할 일에서 빼고
-- 잊지 말기 '상대 약속' 줄로 보낸다. 소식 줄의 종류 표(app_journal_memorable_picks.kind)에 그 종류 'promise'가 없어,
-- 종류 CHECK 하나에 promise를 더한다(값 목록만 넓힘). 앞 단계: 20261109020000_journal_memorable_pick.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지). DB 먼저, ai-assist 배포는 그 뒤.
-- 안 하는 것: 표·칸·정책·표/칸 권한·트리거·함수·색인·기존 줄 변경, 다른 표, rtw_* 객체.
-- 짝: docs/20261112221000_journal_memorable_pick_promise.{precheck,snapshot,postcheck,rollback}.sql·.summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 앞 단계가 없거나, 이미 적용됐거나, 종류 CHECK가 앞 단계 모양(다섯 종류)이 아니면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261112221000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261109020000' and name = 'journal_memorable_pick') <> 1
     or to_regclass('public.app_journal_memorable_picks') is null
     -- check_clause 바깥 괄호는 PostgreSQL 16·17이 다르다(#980). 두 판의 글자만 받는다(쓰기 요청 = 표 소유자로 돌아 행이 보인다).
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_journal_memorable_picks_kind_check'
           and btrim(regexp_replace(check_clause, '\s+', ' ', 'g')) in (
             '((kind = ANY (ARRAY[''task''::text, ''event''::text, ''note''::text, ''org''::text, ''area''::text])))',
             '(kind = ANY (ARRAY[''task''::text, ''event''::text, ''note''::text, ''org''::text, ''area''::text]))')) <> 1 then
    raise exception 'JOURNAL_MEMORABLE_PICK_PROMISE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 종류 CHECK에 promise를 더한다(권한·정책 아님).
alter table public.app_journal_memorable_picks drop constraint app_journal_memorable_picks_kind_check,
  add constraint app_journal_memorable_picks_kind_check check (kind in ('task','event','note','org','area','promise'));

-- 사후 확인: 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_journal_memorable_picks_kind_check'
           and btrim(regexp_replace(check_clause, '\s+', ' ', 'g')) in (
             '((kind = ANY (ARRAY[''task''::text, ''event''::text, ''note''::text, ''org''::text, ''area''::text, ''promise''::text])))',
             '(kind = ANY (ARRAY[''task''::text, ''event''::text, ''note''::text, ''org''::text, ''area''::text, ''promise''::text]))')) <> 1
     or exists (select 1 from pg_constraint where conrelid = 'public.app_journal_memorable_picks'::regclass
         and conname = 'app_journal_memorable_picks_kind_check' and not convalidated) then
    raise exception 'JOURNAL_MEMORABLE_PICK_PROMISE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261112221000', 'journal_memorable_pick_promise', array['S61-11 FORGET-요청방향 2단계: app_journal_memorable_picks kind CHECK widened with promise (counterpart promise asked by me); no table, column, policy, grant or data change']);
commit;
