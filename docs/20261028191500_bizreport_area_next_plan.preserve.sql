-- SELECT only. Run in the SQL Editor BEFORE the rollback when the screen has already saved a 사업영역 꼬리표 or 다음 할 일.
-- Keep the result (id, 꼬리표, 다음 할 일) outside the public repository; it holds the user's own text.
select id,business_area_id,next_plan from public.app_meetings
 where business_area_id is not null or next_plan is not null
 order by id;
