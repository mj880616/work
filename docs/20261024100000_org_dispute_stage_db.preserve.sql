-- SELECT only. rollback 전에 SQL Editor 새 창에서 실행하고 결과를 내려받아 보관한다.
-- rollback은 단계 목록 표와 단계 이력 표를 통째로 지운다. 이 결과로 나중에 단계 목록(이름·순서·표시)과 조직별 이력(어느 조직이 언제 어느 단계였는지)을 다시 채울 수 있다.
-- 조직 표와 다른 표는 지워지지 않는다. 단계·이력 줄이 있으면 rollback이 멈추므로, 보관한 뒤 명진 확인을 받아 두 표의 줄을 따로 승인받아 지우고 rollback을 실행한다.
select 'stage' as kind, s.id, s.workspace_id, null::uuid as organization_id, s.name, s.sort_order, s.is_struggle, s.is_ending, s.is_default,
       null::uuid as stage_id, null::date as stage_date, s.created_at
from public.app_dispute_stages s
union all
select 'history', h.id, null, h.organization_id, h.stage_name, null, null, null, null, h.stage_id, h.stage_date, h.created_at
from public.app_suborganization_dispute_stages h
order by 1, 12, 2;
