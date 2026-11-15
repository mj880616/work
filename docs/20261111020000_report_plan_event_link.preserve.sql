-- SELECT only. 되돌리기 전에 SQL Editor 새 창에서 실행해, 결과를 저장소 밖에 보관한다(공개 저장소·PR·보고에 붙이지 않는다).
-- 읽는 것: 일정에 이어진 사업 보고의 id와 연결 칸, '보고할 일정' 결정 줄 전체. 보고 내용·다른 칸은 읽지 않는다.
select 'report link' as kind,m.id,m.workspace_id,m.google_calendar_id,m.google_event_id,
       null::text as state,null::text as decided_by,null::timestamptz as decided_at,null::text as title,null::date as event_day,null::timestamptz as starts_at
  from public.app_meetings m
  where m.google_event_id is not null or m.google_calendar_id is not null
union all
select 'report plan',p.id,p.workspace_id,p.google_calendar_id,p.google_event_id,
       p.state,p.decided_by,p.decided_at,p.title,p.event_day,p.starts_at
  from public.app_calendar_report_plans p
order by 1,2;
