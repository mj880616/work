begin;
-- 20261112221000_journal_memorable_pick_promise의 짝 되돌리기. 종류 CHECK를 다섯 종류로 되돌리고 이번 기록 1행만 지운다.
-- 순서: 먼저 ai-assist를 promise를 쓰지 않는 이전 판(배포 때 기록한 되돌리기 ref)으로 되돌린다. 그다음 이 파일.
-- 종류가 promise인 줄이 하나라도 있으면 멈춘다(이 파일은 줄을 고치거나 지우지 않는다). 그때는:
--   1) 화면 잊지 말기 '상대 약속'에서 그 소식 줄을 할 일 등 다른 종류로 바꾸거나 처리한다(또는 명진 확인 뒤 따로 승인받아 종류를 바꾼다).
--   2) 그 다음에 이 파일을 실행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261112221000' and name = 'journal_memorable_pick_promise') <> 1 then
    raise exception 'JOURNAL_MEMORABLE_PICK_PROMISE_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_journal_memorable_picks where kind = 'promise')
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_journal_memorable_picks_kind_check'
           and btrim(regexp_replace(check_clause, '\s+', ' ', 'g')) in (
             '((kind = ANY (ARRAY[''task''::text, ''event''::text, ''note''::text, ''org''::text, ''area''::text, ''promise''::text])))',
             '(kind = ANY (ARRAY[''task''::text, ''event''::text, ''note''::text, ''org''::text, ''area''::text, ''promise''::text]))')) <> 1 then
    raise exception 'JOURNAL_MEMORABLE_PICK_PROMISE_ROLLBACK_BLOCKED: promise rows exist or kind check differs; change their kind first with separate approval';
  end if;
end
$$;

alter table public.app_journal_memorable_picks drop constraint app_journal_memorable_picks_kind_check,
  add constraint app_journal_memorable_picks_kind_check check (kind in ('task','event','note','org','area'));

delete from supabase_migrations.schema_migrations
  where version = '20261112221000' and name = 'journal_memorable_pick_promise';
commit;
