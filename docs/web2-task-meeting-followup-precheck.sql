-- Read-only precheck. Run after merging the DB PR and immediately before applying its migration.
-- Stop unless prior_record=1, this_record=0, meeting_column=false, meeting_helper=true,
-- invalid_targets=0, RLS=true, and the original policy/constraints match the migration.
select
  (select count(*) from supabase_migrations.schema_migrations
   where version = '20260927103344' and name = 'task_impl2_notes_record_links') as prior_record,
  (select count(*) from supabase_migrations.schema_migrations
   where version = '20260928123601' and name = 'task_meeting_followup_record_links') as this_record,
  to_regprocedure('private.app_meeting_in_workspace(uuid,uuid)') is not null as meeting_helper,
  exists (select 1 from pg_attribute
          where attrelid = 'public.app_record_links'::regclass
            and attname = 'meeting_id' and not attisdropped) as meeting_column,
  (select relrowsecurity from pg_class where oid = 'public.app_record_links'::regclass) as rls_enabled;

select count(*) as existing_links,
       count(*) filter (where num_nonnulls(project_id, organization_id) <> 1) as invalid_targets
from public.app_record_links;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.app_record_links'::regclass
  and conname in ('app_record_links_one_target', 'app_record_links_unique')
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
