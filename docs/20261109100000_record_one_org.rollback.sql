begin;
-- 20261109100000_record_one_org의 짝 되돌리기. 이번에 만든 것만 지운다:
--   조직 기록의 트리거 1개·색인 2개·검사 2개·칸 3개(end_day·source_kind·source_id), 새 표 2개(보고용 표시·확정 사진, 색인·정책·트리거 포함),
--   트리거 함수 3개, 이번 기록 1행. 조직 기록의 기존 칸·행·정책·표 권한은 건드리지 않는다.
-- 사라지는 것: 적어 둔 끝나는 날·출처 표시, 보고용 표시(빼기·보고용 글), 확정 사진. 조직 기록 글·개인 확정본 한글 파일은 그대로.
-- 순서: 화면을 이 칸·표를 쓰지 않는 이전 판으로 먼저 되돌린다. 옛 자료 옮기기(O-3)를 적용했다면 그 rollback을 먼저 실행한다(옮긴 줄이 남아 있으면 멈춤).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표·칸 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_suborganization_updates in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261109100000' and name = 'record_one_org') <> 1 then
    raise exception 'RECORD_ONE_ORG_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_suborganization_updates where source_kind in ('status_row', 'weekly_line')) then
    raise exception 'RECORD_ONE_ORG_ROLLBACK_BLOCKED: moved rows remain; roll back the move first';
  end if;
end
$$;

drop trigger app_suborganization_updates_source_guard on public.app_suborganization_updates;
drop function private.app_suborganization_updates_source_guard();
drop index public.app_suborganization_updates_source_once;
drop index public.app_suborganization_updates_org_occurred_idx;
alter table public.app_suborganization_updates drop constraint app_suborganization_updates_source_check;
alter table public.app_suborganization_updates drop constraint app_suborganization_updates_end_day_check;
alter table public.app_suborganization_updates drop column source_id;
alter table public.app_suborganization_updates drop column source_kind;
alter table public.app_suborganization_updates drop column end_day;

drop table public.app_report_line_marks;
drop function private.app_report_line_marks_guard();
drop table public.app_report_snapshots;
drop function private.app_report_snapshots_guard();

delete from supabase_migrations.schema_migrations
  where version = '20261109100000' and name = 'record_one_org';
commit;
