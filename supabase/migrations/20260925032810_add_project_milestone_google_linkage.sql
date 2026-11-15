alter table public.app_project_milestones
  add column google_calendar_id text,
  add column google_event_id text;

alter table public.app_project_milestones
  add constraint app_project_milestones_google_linkage_pair_chk
  check (
    (google_calendar_id is null and google_event_id is null)
    or (
      nullif(btrim(google_calendar_id), '') is not null
      and nullif(btrim(google_event_id), '') is not null
    )
  );

comment on column public.app_project_milestones.google_calendar_id is
  'Google Calendar calendar id for project milestones created with Google linkage.';

comment on column public.app_project_milestones.google_event_id is
  'Google Calendar event id paired with google_calendar_id for project milestones created with Google linkage.';
