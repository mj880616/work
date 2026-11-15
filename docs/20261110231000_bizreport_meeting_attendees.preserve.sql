-- SELECT only. rollback이 'reports with attendees'로 멈췄을 때 SQL Editor 새 창에서 실행하고 결과를 저장소 밖에 보관한다.
-- 참석인원을 적은 보고의 id와 그 한 줄만 읽는다(제목·회의 결과는 읽지 않음). 이 결과로 나중에 칸을 다시 채울 수 있다.
select id, attendees
from public.app_meetings
where attendees is not null
order by id;
