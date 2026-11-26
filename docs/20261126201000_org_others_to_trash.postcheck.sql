-- SELECT only. Run after apply (the backup table public.app_cleanup_s71_40_orgs must exist; the workflow's dry-run does not run this file).
-- No organization name, id or record text is shown: only yes/no, counts and hashes.
-- The count/hash items must equal the precheck values of the same name (assigned organizations, organization row count,
-- assignee rows, profile workplace rows, policies and triggers unchanged; only deleted_at of the backed-up organizations changes).
-- S71-44: 'other orgs to trash'·'other orgs with records'·'ref rows …' are counted over the moved (backed-up) organizations and must equal
-- the precheck values: every record row that pointed at them is still there and still points at them (no record row deleted or changed).
-- 'ref rows match backup' compares, per moved organization, the record rows now with the count saved at move time.
with h as (select count(*) filter (where name = 'org_others_to_trash') as named, count(*) as n from supabase_migrations.schema_migrations where version = '20261126201000'),
ws as (select f.workspace_id from public.app_operator_features f where f.feature = 'telegram'),
assigned as (
  select o.id from public.app_suborganizations o
   where o.workspace_id in (select workspace_id from ws) and o.deleted_at is null
     and (exists (select 1 from public.app_suborganization_assignees x where x.organization_id = o.id)
          or exists (select 1 from public.app_profile_workplaces x where x.organization_id = o.id))),
moved as (
  select b.ref_rows,
    (select count(*) from public.app_suborganization_updates x where x.organization_id = o.id) as suborganization_updates,
    (select count(*) from public.app_suborganization_timeline x where x.organization_id = o.id) as suborganization_timeline,
    (select count(*) from public.app_suborganization_weekly_reports x where x.organization_id = o.id) as suborganization_weekly_reports,
    (select count(*) from public.app_suborganization_status_items x where x.organization_id = o.id) as suborganization_status_items,
    (select count(*) from public.app_suborganization_affiliations x where x.organization_id = o.id) as suborganization_affiliations,
    (select count(*) from public.app_suborganization_dispute_stages x where x.organization_id = o.id) as suborganization_dispute_stages,
    (select count(*) from public.app_event_suborganizations x where x.organization_id = o.id) as event_suborganizations,
    (select count(*) from public.app_record_links x where x.organization_id = o.id) as record_links,
    (select count(*) from public.app_documents x where x.organization_id = o.id) as documents,
    (select count(*) from public.app_todo_candidates x where x.organization_id = o.id) as todo_candidates,
    (select count(*) from public.app_ledger_organizations x where x.suborganization_id = o.id) as ledger_organizations,
    (select count(*) from public.app_weekly_org_summaries x where x.organization_id = o.id) as weekly_org_summaries,
    (select count(*) from public.app_feed_items x where x.organization_id = o.id) as feed_items,
    (select count(*) from public.app_calendar_work_refs x where x.organization_id = o.id) as calendar_work_refs,
    (select count(*) from public.app_org_key_people x where x.organization_id = o.id) as org_key_people,
    (select count(*) from public.app_org_key_people_briefs x where x.organization_id = o.id) as org_key_people_briefs,
    (select count(*) from public.app_pre_meeting_sheets x where x.organization_id = o.id) as pre_meeting_sheets,
    (select count(*) from public.app_org_status_rows x where x.organization_id = o.id) as org_status_rows,
    (select count(*) from public.app_weekly_org_lines x where x.organization_id = o.id) as weekly_org_lines,
    (select count(*) from public.app_library_folders x where x.organization_id = o.id) as library_folders,
    (select count(*) from public.app_journal_memorable x where x.workspace_id = o.workspace_id and x.org_name = o.name) as journal_memorable_names
  from public.app_cleanup_s71_40_orgs b join public.app_suborganizations o on o.id = b.organization_id),
flag as (select m.*, (suborganization_updates + suborganization_timeline + suborganization_weekly_reports + suborganization_status_items + suborganization_affiliations + suborganization_dispute_stages + event_suborganizations + record_links + documents + todo_candidates + ledger_organizations + weekly_org_summaries + feed_items + calendar_work_refs + org_key_people + org_key_people_briefs + pre_meeting_sheets + org_status_rows + weekly_org_lines + library_folders + journal_memorable_names) as total from moved m)
select 'move agrees with history' as item, case
  when h.n = 1 and h.named = 1 then case
    when to_regclass('public.app_cleanup_s71_40_orgs') is null then '아니오'
    when (select count(*) from public.app_suborganizations o join public.app_cleanup_s71_40_orgs b on b.organization_id = o.id
          where o.deleted_at = b.moved_at) = (select count(*) from public.app_cleanup_s71_40_orgs) then '예' else '아니오' end
  when h.n = 0 then case when to_regclass('public.app_cleanup_s71_40_orgs') is null then '예' else '아니오' end
  else '아니오' end as value
  from h
union all select 'no assigned org moved', case when to_regclass('public.app_cleanup_s71_40_orgs') is null then '예'
  when exists (select 1 from public.app_cleanup_s71_40_orgs b where exists (select 1 from public.app_suborganization_assignees x where x.organization_id = b.organization_id)
    or exists (select 1 from public.app_profile_workplaces x where x.organization_id = b.organization_id)) then '아니오' else '예' end
union all select 'backup table closed', case when to_regclass('public.app_cleanup_s71_40_orgs') is null then '예'
  when exists (select 1 from pg_class where oid = to_regclass('public.app_cleanup_s71_40_orgs') and relrowsecurity)
   and not exists (select 1 from pg_policy where polrelid = to_regclass('public.app_cleanup_s71_40_orgs'))
   and not has_table_privilege('anon', 'public.app_cleanup_s71_40_orgs', 'select,insert,update,delete,truncate,references,trigger')
   and not has_table_privilege('authenticated', 'public.app_cleanup_s71_40_orgs', 'select,insert,update,delete,truncate,references,trigger')
   and not has_table_privilege('service_role', 'public.app_cleanup_s71_40_orgs', 'select,insert,update,delete,truncate,references,trigger') then '예' else '아니오' end
union all select 'RLS still enabled', case when exists (select 1 from pg_class where oid = to_regclass('public.app_suborganizations') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege', case when not has_table_privilege('anon', 'public.app_suborganizations', 'select,insert,update,delete')
  and not exists (select 1 from pg_class where oid = to_regclass('public.app_suborganizations') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'ref rows match backup', case when exists (select 1 from flag where total <> ref_rows)
  or (select count(*) from flag) <> (select count(*) from public.app_cleanup_s71_40_orgs) then '아니오' else '예' end
union all select 'other orgs to trash', (select count(*) from public.app_cleanup_s71_40_orgs)::text
union all select 'other orgs with records', (select count(*) from public.app_cleanup_s71_40_orgs where ref_rows > 0)::text
union all select 'ref rows total', coalesce((select sum(total) from flag), 0)::text
union all select 'ref rows in suborganization_updates', coalesce((select sum(suborganization_updates) from flag), 0)::text
union all select 'ref rows in suborganization_timeline', coalesce((select sum(suborganization_timeline) from flag), 0)::text
union all select 'ref rows in suborganization_weekly_reports', coalesce((select sum(suborganization_weekly_reports) from flag), 0)::text
union all select 'ref rows in suborganization_status_items', coalesce((select sum(suborganization_status_items) from flag), 0)::text
union all select 'ref rows in suborganization_affiliations', coalesce((select sum(suborganization_affiliations) from flag), 0)::text
union all select 'ref rows in suborganization_dispute_stages', coalesce((select sum(suborganization_dispute_stages) from flag), 0)::text
union all select 'ref rows in event_suborganizations', coalesce((select sum(event_suborganizations) from flag), 0)::text
union all select 'ref rows in record_links', coalesce((select sum(record_links) from flag), 0)::text
union all select 'ref rows in documents', coalesce((select sum(documents) from flag), 0)::text
union all select 'ref rows in todo_candidates', coalesce((select sum(todo_candidates) from flag), 0)::text
union all select 'ref rows in ledger_organizations', coalesce((select sum(ledger_organizations) from flag), 0)::text
union all select 'ref rows in weekly_org_summaries', coalesce((select sum(weekly_org_summaries) from flag), 0)::text
union all select 'ref rows in feed_items', coalesce((select sum(feed_items) from flag), 0)::text
union all select 'ref rows in calendar_work_refs', coalesce((select sum(calendar_work_refs) from flag), 0)::text
union all select 'ref rows in org_key_people', coalesce((select sum(org_key_people) from flag), 0)::text
union all select 'ref rows in org_key_people_briefs', coalesce((select sum(org_key_people_briefs) from flag), 0)::text
union all select 'ref rows in pre_meeting_sheets', coalesce((select sum(pre_meeting_sheets) from flag), 0)::text
union all select 'ref rows in org_status_rows', coalesce((select sum(org_status_rows) from flag), 0)::text
union all select 'ref rows in weekly_org_lines', coalesce((select sum(weekly_org_lines) from flag), 0)::text
union all select 'ref rows in library_folders', coalesce((select sum(library_folders) from flag), 0)::text
union all select 'ref rows in journal_memorable names', coalesce((select sum(journal_memorable_names) from flag), 0)::text
union all select 'assigned orgs', (select count(*) from assigned)::text
union all select 'org rows', (select count(*) from public.app_suborganizations)::text
union all select 'assignee rows', (select count(*) from public.app_suborganization_assignees)::text
union all select 'profile workplace rows', (select count(*) from public.app_profile_workplaces)::text
union all select 'assigned orgs hash', md5(coalesce((select string_agg(id::text, ',' order by id) from assigned), ''))
union all select 'policies hash', md5(coalesce(string_agg(polname::text || polcmd::text || polroles::text || polpermissive::text || coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' order by polname), ''))
  from pg_policy where polrelid = to_regclass('public.app_suborganizations')
union all select 'triggers hash', md5(coalesce(string_agg(tgname || ':' || tgenabled::text || ':' || pg_get_triggerdef(oid), ',' order by tgname), ''))
  from pg_trigger where tgrelid = to_regclass('public.app_suborganizations') and not tgisinternal;
