-- SELECT only. rollback이 'one-line updates saved'로 멈췄을 때 SQL Editor 새 창에서 실행하고 결과를 내려받아 보관한다.
-- 한 줄 업데이트의 id·사업영역 id·날짜만 읽는다(문장은 읽지 않음). 이 결과로 나중에 칸을 다시 채울 수 있다.
select id, business_area_id, meeting_at
from public.app_meetings
where activity_kind = 'oneline'
order by id;
