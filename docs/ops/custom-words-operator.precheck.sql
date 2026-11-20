-- APP-기록+이름바꾸기(S67-44) 운영자 이름 넣기 사전 확인. SELECT만, 개수·예/아니오만(사람·작업공간 id·이름·기록 내용을 보이지 않음).
-- 실행: CC가 SQL Editor 새 창(+) 또는 조회 전용 MCP. 모든 칸이 '예'여야 docs/ops/custom-words-operator.apply.sql로 간다.
-- 대상 고르기: 운영자 허용 표(app_operator_features)에 'calls'·'telegram'이 둘 다 켜진 작업공간이 정확히 하나 → 그 작업공간의 owner 한 명 → 그 사람의 프로필 행.
with target_ws as (
  select workspace_id from public.app_operator_features
  where feature in ('calls', 'telegram') group by workspace_id having count(distinct feature) = 2
), target_owner as (
  select m.user_id from public.app_workspace_members m join target_ws t on t.workspace_id = m.workspace_id where m.role = 'owner'
)
select 'migration 20261120210000 applied' as item,
  case when (select count(*) from supabase_migrations.schema_migrations where version = '20261120210000' and name = 'profile_custom_words') = 1 then '예' else '아니오' end as value
union all select 'custom_words column and check exist',
  case when exists (select 1 from pg_attribute where attrelid = 'public.app_profiles'::regclass and attname = 'custom_words' and not attisdropped)
    and exists (select 1 from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_custom_words_check' and convalidated) then '예' else '아니오' end
union all select 'exactly one operator workspace (calls + telegram)', case when (select count(*) from target_ws) = 1 then '예' else '아니오' end
union all select 'exactly one owner in it', case when (select count(*) from target_owner) = 1 then '예' else '아니오' end
union all select 'owner profile row exists', case when (select count(*) from public.app_profiles p join target_owner o on o.user_id = p.user_id) = 1 then '예' else '아니오' end
union all select 'owner names still empty', case when (select count(*) from public.app_profiles p join target_owner o on o.user_id = p.user_id where p.custom_words is null) = 1 then '예' else '아니오' end
union all select 'profiles with names (count only)', (select count(*)::text from public.app_profiles where custom_words is not null);
