-- S67-62 바탕 낱말 묶음(운영자 = 노동조합+ 낱말) 넣기 사전 확인. SELECT만, 개수·예/아니오만(사람·작업공간 id·이름·기록 내용을 보이지 않음).
-- 실행: CC가 SQL Editor 새 창(+) 또는 조회 전용 MCP. 모든 칸이 '예'여야 docs/ops/nojo-words-operator.apply.sql로 간다.
-- 대상 고르기: 운영자 허용 표(app_operator_features)에 'calls'·'telegram'이 둘 다 켜진 작업공간이 정확히 하나(custom-words-operator.*.sql과 같은 근거).
with target_ws as (
  select workspace_id from public.app_operator_features
  where feature in ('calls', 'telegram') group by workspace_id having count(distinct feature) = 2
)
select 'migration 20261121090000 applied' as item,
  case when (select count(*) from supabase_migrations.schema_migrations where version = '20261121090000' and name = 'nojo_words_feature') = 1 then '예' else '아니오' end as value
union all select 'feature check allows nojo_words',
  case when (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
    and conname = 'app_operator_features_feature_check' and convalidated and pg_get_constraintdef(oid) ~ '''nojo_words''') = 1 then '예' else '아니오' end
union all select 'exactly one operator workspace (calls + telegram)', case when (select count(*) from target_ws) = 1 then '예' else '아니오' end
union all select 'exactly one owner in it', case when (select count(*) from public.app_workspace_members m join target_ws t on t.workspace_id = m.workspace_id where m.role = 'owner') = 1 then '예' else '아니오' end
union all select 'no nojo_words row yet', case when not exists (select 1 from public.app_operator_features where feature = 'nojo_words') then '예' else '아니오' end;
