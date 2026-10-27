-- SELECT only. rollback 전에 SQL Editor 새 창에서 실행하고 결과를 내려받아 보관한다.
-- rollback은 회의 출처 연결 줄을 모두 지운다. 이 결과로 나중에 연결·보낸 기록(요약)을 다시 채울 수 있다.
-- 적용 때 기존 project_id로 채운 줄(요약 없음, 회의의 project_id와 같은 곳)은 project_id가 남으므로 다시 만들 수 있다.
select l.id, l.workspace_id, l.source_meeting_id, l.organization_id, l.project_id, l.status, l.report_kind, l.summary, l.created_at
from public.app_record_links l
where l.source_meeting_id is not null
order by l.source_meeting_id, l.id;
