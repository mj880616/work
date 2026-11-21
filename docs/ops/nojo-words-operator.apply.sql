begin;
-- S67-62 바탕 낱말 묶음: 운영자(명진) 작업공간 하나에 'nojo_words'(노동조합+ 낱말 전체를 바탕으로) 허용 행 1개를 넣는다.
-- 2026-11-21 07:55 명진 결정: 운영 빌드가 WORK ON 낱말이 돼도 명진 화면은 바뀌기 전과 한 글자도 다르지 않게. 코드에 계정·이름을 넣지 않고 이 SQL로만 넣는다.
-- SQL Editor(폰 경로 C) 전용, 실행은 CC. 앞 단계: 20261121090000_nojo_words_feature 적용 + nojo-words-operator.precheck.sql 모든 칸 '예'.
-- 대상: 운영자 허용 표에 'calls'·'telegram'이 둘 다 켜진 작업공간 정확히 하나(owner 한 명). 다른 작업공간은 건드리지 않는다.
-- 이미 행이 있으면 멈춘다(어느 작업공간이든 nojo_words는 이번에 처음). 짝: nojo-words-operator.rollback.sql
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  ws_count int; owner_count int; target uuid; changed int;
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261121090000' and name = 'nojo_words_feature') <> 1 then
    raise exception 'NOJO_WORDS_OPERATOR_MIGRATION_MISSING; stop';
  end if;
  if exists (select 1 from public.app_operator_features where feature = 'nojo_words') then
    raise exception 'NOJO_WORDS_OPERATOR_ALREADY_SET; stop';
  end if;
  select count(*), min(workspace_id::text)::uuid into ws_count, target from (
    select workspace_id from public.app_operator_features where feature in ('calls', 'telegram')
    group by workspace_id having count(distinct feature) = 2) t;
  if ws_count <> 1 or target is null then raise exception 'NOJO_WORDS_OPERATOR_WORKSPACE_NOT_ONE; stop'; end if;
  select count(*) into owner_count from public.app_workspace_members m where m.role = 'owner' and m.workspace_id = target;
  if owner_count <> 1 then raise exception 'NOJO_WORDS_OPERATOR_OWNER_NOT_ONE; stop'; end if;
  insert into public.app_operator_features (workspace_id, feature) values (target, 'nojo_words');
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'NOJO_WORDS_OPERATOR_NOT_INSERTED; stop'; end if;
end
$$;
commit;
