-- S67-51 AI가 부르는 내 역할(_shared/owner-role.mjs) 배포 전·후 확인. SELECT만, 예/아니오·개수만(사람·작업공간 id·이름·직책·소속 글자를 보이지 않음).
-- 뜻: ai-assist·회의 정리 Edge 재배포 뒤 AI는 기록 주인을 '<프로필 소속> <프로필 직책>'으로 부른다(예전: 늘 '노동조합 <직책>').
--     운영자 프로필에 소속 칸이 비어 있으면 직책만으로 불린다 — 그때는 명진이 내 프로필 '노조명' 칸을 채우면 예전처럼 단체 이름이 붙는다(코드에 이름을 박지 않음).
-- 실행: CC가 SQL Editor 새 창(+) 또는 조회 전용 MCP. 쓰기 없음, 되돌릴 것 없음.
with target_ws as (
  select workspace_id from public.app_operator_features
  where feature in ('calls', 'telegram') group by workspace_id having count(distinct feature) = 2
), target_owner as (
  select m.user_id from public.app_workspace_members m join target_ws t on t.workspace_id = m.workspace_id where m.role = 'owner'
)
select 'union_name column exists' as item,
  case when exists (select 1 from pg_attribute where attrelid = 'public.app_profiles'::regclass and attname = 'union_name' and not attisdropped) then '예' else '아니오' end as value
union all select 'exactly one operator workspace (calls + telegram)', case when (select count(*) from target_ws) = 1 then '예' else '아니오' end
union all select 'exactly one owner in it', case when (select count(*) from target_owner) = 1 then '예' else '아니오' end
union all select 'operator job title filled', case when (select count(*) from public.app_profiles p join target_owner o on o.user_id = p.user_id where nullif(btrim(p.job_title), '') is not null) = 1 then '예' else '아니오' end
union all select 'operator union name filled', case when (select count(*) from public.app_profiles p join target_owner o on o.user_id = p.user_id where nullif(btrim(p.union_name), '') is not null) = 1 then '예' else '아니오' end;
