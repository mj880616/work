-- S67-57 운영자 새 두 칸 넣기 사전 확인. SELECT만, 개수·예/아니오만(사람·작업공간 id·이름·기록 내용을 보이지 않음).
-- 실행: CC가 SQL Editor 새 창(+) 또는 조회 전용 MCP. 모든 칸이 '예'여야 docs/ops/custom-words-operator-slots.apply.sql로 간다.
-- 대상 고르기: custom-words-operator.precheck.sql과 같다(calls·telegram이 둘 다 켜진 작업공간 하나 → owner 한 명 → 프로필 행).
with target_ws as (
  select workspace_id from public.app_operator_features
  where feature in ('calls', 'telegram') group by workspace_id having count(distinct feature) = 2
), target_owner as (
  select m.user_id from public.app_workspace_members m join target_ws t on t.workspace_id = m.workspace_id where m.role = 'owner'
)
select 'migration 20261121073000 applied' as item,
  case when (select count(*) from supabase_migrations.schema_migrations where version = '20261121073000' and name = 'profile_custom_words_slots') = 1 then '예' else '아니오' end as value
union all select 'exactly one operator workspace (calls + telegram)', case when (select count(*) from target_ws) = 1 then '예' else '아니오' end
union all select 'exactly one owner in it', case when (select count(*) from target_owner) = 1 then '예' else '아니오' end
union all select 'owner names already set (15 slots)', case when (select count(*) from public.app_profiles p join target_owner o on o.user_id = p.user_id where p.custom_words is not null) = 1 then '예' else '아니오' end
union all select 'owner new slots still empty', case when (select count(*) from public.app_profiles p join target_owner o on o.user_id = p.user_id
  where p.custom_words is not null and not (p.custom_words ? 'affiliation') and not (p.custom_words ? 'weekly')) = 1 then '예' else '아니오' end
union all select 'profiles with new slots (count only)', (select count(*)::text from public.app_profiles where custom_words ? 'affiliation' or custom_words ? 'weekly');
