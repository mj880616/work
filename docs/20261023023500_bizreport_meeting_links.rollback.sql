begin;
-- 20261023023500_bizreport_meeting_links의 짝 되돌리기(SQL Editor 경로 전용: drop policy·drop function은 workflow rollback 허용 목록 밖).
-- 실행 전에 docs/20261023023500_bizreport_meeting_links.preserve.sql을 SQL Editor에서 실행해 결과를 보관한다(회의 출처 줄·요약).
-- 순서: 함수 삭제 → 좁히기 정책 삭제 → 회의 출처 줄 삭제 → 출처·중복 규칙을 옛 모양(같은 이름)으로 → 모양 검사·색인·칸 삭제
--   → 장소 길이 검사 삭제 → 기록 1행 삭제.
-- 장소 칸(location)은 지우지 않는다: 운영에 원래 있었을 수 있고(Edge가 읽음), 비어 있는 글자 칸이라 남아도 기존 동작에 영향이 없다.
-- 기존 표·소유자 정책·권한·다른 칸에는 손대지 않는다. app_meetings.project_id는 그대로 남는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings, public.app_record_links in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261023023500' and name = 'bizreport_meeting_links') <> 1 then
    raise exception 'BIZREPORT_MEETING_LINKS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_meeting_set_links(uuid, timestamptz, jsonb);
drop policy record_links_source_meeting_ws on public.app_record_links;
delete from public.app_record_links where source_meeting_id is not null;

alter table public.app_record_links
  add constraint app_record_links_one_source_prev check (num_nonnulls(google_task_id, note_id) = 1),
  add constraint app_record_links_unique_prev unique nulls not distinct
    (google_task_id, note_id, project_id, organization_id, meeting_id, document_id);
alter table public.app_record_links
  drop constraint app_record_links_one_source,
  drop constraint app_record_links_unique,
  drop constraint app_record_links_source_meeting_shape;
alter table public.app_record_links rename constraint app_record_links_one_source_prev to app_record_links_one_source;
alter table public.app_record_links rename constraint app_record_links_unique_prev to app_record_links_unique;
drop index public.app_record_links_source_meeting_idx;
alter table public.app_record_links drop column source_meeting_id;
alter table public.app_meetings drop constraint app_meetings_location_length_check;

delete from supabase_migrations.schema_migrations
  where version = '20261023023500' and name = 'bizreport_meeting_links';
commit;
