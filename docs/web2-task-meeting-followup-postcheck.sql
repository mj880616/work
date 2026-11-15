-- Read-only postcheck. Expect both migration records=1, meeting column nullable,
-- meeting FK ON DELETE CASCADE, expanded target/unique constraints, meeting index,
-- RLS and owner-only read condition unchanged, and meeting write guard present.
-- Compare existing_links with the precheck count; meeting_links should be 0 before Edge/app work.
select
  (select count(*) from supabase_migrations.schema_migrations
   where version = '20260927103344' and name = 'task_impl2_notes_record_links') as prior_record,
  (select count(*) from supabase_migrations.schema_migrations
   where version = '20260928123601' and name = 'task_meeting_followup_record_links') as this_record,
  (select relrowsecurity from pg_class where oid = 'public.app_record_links'::regclass) as rls_enabled;

select count(*) as existing_links,
       count(*) filter (where meeting_id is not null) as meeting_links,
       count(*) filter (where num_nonnulls(project_id, organization_id, meeting_id) <> 1) as invalid_targets
from public.app_record_links;

select attname, atttypid::regtype as data_type, attnotnull
from pg_attribute
where attrelid = 'public.app_record_links'::regclass
  and attname = 'meeting_id' and not attisdropped;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.app_record_links'::regclass
  and conname in ('app_record_links_one_target', 'app_record_links_unique', 'app_record_links_meeting_id_fkey')
order by conname;

select polname, polcmd, polroles::regrole[] as roles,
       pg_get_expr(polqual, polrelid) as read_condition,
       pg_get_expr(polwithcheck, polrelid) as write_condition
from pg_policy
where polrelid = 'public.app_record_links'::regclass
  and polname = 'record_links_owner_all';

select indexname from pg_indexes
where schemaname = 'public' and tablename = 'app_record_links'
order by indexname;
