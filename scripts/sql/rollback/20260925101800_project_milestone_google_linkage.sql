alter table if exists public.app_project_milestones
  drop column if exists google_event_id,
  drop column if exists google_calendar_id;
