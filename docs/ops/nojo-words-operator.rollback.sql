begin;
-- nojo-words-operator.apply.sql의 짝 되돌리기. 운영자 작업공간의 'nojo_words' 허용 행 1개만 지운다(화면은 다음 열기부터 WORK ON 낱말 바탕).
-- 행이 운영자 작업공간 하나에만 정확히 1개 있을 때만 지운다. 다른 작업공간에도 있으면 멈춘다(사람이 정한다).
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  ws_count int; target uuid; changed int;
begin
  select count(*), min(workspace_id::text)::uuid into ws_count, target from (
    select workspace_id from public.app_operator_features where feature in ('calls', 'telegram')
    group by workspace_id having count(distinct feature) = 2) t;
  if ws_count <> 1 or target is null then raise exception 'NOJO_WORDS_OPERATOR_WORKSPACE_NOT_ONE; stop'; end if;
  if (select count(*) from public.app_operator_features where feature = 'nojo_words') <> 1
     or not exists (select 1 from public.app_operator_features where feature = 'nojo_words' and workspace_id = target) then
    raise exception 'NOJO_WORDS_OPERATOR_ROWS_CHANGED_SINCE_APPLY; stop';
  end if;
  delete from public.app_operator_features where feature = 'nojo_words' and workspace_id = target;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'NOJO_WORDS_OPERATOR_NOT_REMOVED; stop'; end if;
end
$$;
commit;
