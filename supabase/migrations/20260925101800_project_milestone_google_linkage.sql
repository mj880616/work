alter table if exists public.app_project_milestones
  add column if not exists google_calendar_id text,
  add column if not exists google_event_id text;

comment on column public.app_project_milestones.google_calendar_id is
  'Google Calendar calendar id for an explicitly linked project milestone';

comment on column public.app_project_milestones.google_event_id is
  'Google Calendar event id for an explicitly linked project milestone';
