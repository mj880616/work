-- SELECT only. rollback이 'reports marked none'으로 멈췄을 때 SQL Editor 새 창에서 실행하고 결과를 저장소 밖에 보관한다.
-- '사업영역 없음'으로 고른 보고의 id만 읽는다(제목·내용은 읽지 않음). 이 결과로 나중에 칸을 다시 채울 수 있다.
select id
from public.app_meetings
where business_area_none
order by id;
