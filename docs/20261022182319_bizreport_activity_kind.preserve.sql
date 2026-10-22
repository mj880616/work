-- SELECT only. rollback이 'non-meeting kinds saved'로 멈췄을 때 SQL Editor 새 창에서 실행하고 결과를 내려받아 보관한다.
-- 회의 기록의 id와 칸 값만 읽는다(제목·본문·일시 없음). 이 결과로 나중에 칸을 다시 채울 수 있다.
select id, activity_kind
from public.app_meetings
where activity_kind <> 'meeting'
order by id;
