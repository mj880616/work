alter table public.app_project_milestones
  drop constraint if exists app_project_milestones_google_linkage_pair_chk;

alter table public.app_project_milestones
  drop column if exists google_event_id,
  drop column if exists google_calendar_id;
