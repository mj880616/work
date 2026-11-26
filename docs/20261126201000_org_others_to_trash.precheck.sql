-- SELECT only. Counts, yes/no and hashes; no organization name, id or record text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 'other orgs' = 운영자 작업공간의 활성·휴지통 밖·담당 아님 조직(화면 '그 외', 78곳 기준). 'other orgs with records'는 참조 기록이 있어 이번에 옮기지 않는 조직 수,
-- 'other orgs to trash'는 이번에 휴지통으로 옮길 조직 수. 'other orgs in <표>'는 표마다 그 표에 기록이 있는 '그 외' 조직 수(한 조직이 여러 표에 셀 수 있음).
-- 'fk list as expected'가 아니오면 migration이 시험 적용(dry-run)에서 멈춘다. 그때 snapshot의 'fk' 줄로 목록을 고친다(여기서 멈추지 않는 것은 snapshot을 남기기 위해서다).
-- 나머지 행 수·해시는 사후 확인과 같은 값이어야 한다(담당 조직·조직 줄 수·담당 표 줄 수 그대로).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: backup table absent = 예
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: operator workspace one owner = 예
-- expect: fk list as expected = 기록
-- expect: fk count = 기록
-- expect: other orgs = 0~78
-- expect: other orgs with records = 기록
-- expect: other orgs to trash = 기록
-- expect: other orgs in * = 기록
-- expect: other orgs inactive untouched = 기록
-- expect: assigned orgs = 기록
-- expect: orgs in trash = 기록
-- expect: org rows = 기록
-- expect: assignee rows = 기록
-- expect: profile workplace rows = 기록
-- expect: assigned orgs hash = 기록
-- expect: policies hash = 기록
-- expect: triggers hash = 기록
with ws as (select f.workspace_id from public.app_operator_features f where f.feature = 'telegram'),
other as (
  select o.id, o.workspace_id, o.name from public.app_suborganizations o
   where o.workspace_id in (select workspace_id from ws) and o.deleted_at is null and coalesce(o.active, true)
     and not exists (select 1 from public.app_suborganization_assignees x where x.organization_id = o.id)
     and not exists (select 1 from public.app_profile_workplaces x where x.organization_id = o.id)),
refs as (
  select o.id,
    exists (select 1 from public.app_suborganization_updates x where x.organization_id = o.id) as updates,
    exists (select 1 from public.app_suborganization_timeline x where x.organization_id = o.id) as timeline,
    exists (select 1 from public.app_suborganization_weekly_reports x where x.organization_id = o.id) as weekly_reports,
    exists (select 1 from public.app_suborganization_status_items x where x.organization_id = o.id) as status_items,
    exists (select 1 from public.app_suborganization_affiliations x where x.organization_id = o.id) as affiliations,
    exists (select 1 from public.app_suborganization_dispute_stages x where x.organization_id = o.id) as dispute_stages,
    exists (select 1 from public.app_event_suborganizations x where x.organization_id = o.id) as events,
    exists (select 1 from public.app_record_links x where x.organization_id = o.id) as record_links,
    exists (select 1 from public.app_documents x where x.organization_id = o.id) as documents,
    exists (select 1 from public.app_todo_candidates x where x.organization_id = o.id) as todo_candidates,
    exists (select 1 from public.app_ledger_organizations x where x.suborganization_id = o.id) as ledger,
    exists (select 1 from public.app_weekly_org_summaries x where x.organization_id = o.id) as weekly_summaries,
    exists (select 1 from public.app_feed_items x where x.organization_id = o.id) as feed_items,
    exists (select 1 from public.app_calendar_work_refs x where x.organization_id = o.id) as calendar_refs,
    exists (select 1 from public.app_org_key_people x where x.organization_id = o.id) as key_people,
    exists (select 1 from public.app_org_key_people_briefs x where x.organization_id = o.id) as key_people_briefs,
    exists (select 1 from public.app_pre_meeting_sheets x where x.organization_id = o.id) as pre_meeting_sheets,
    exists (select 1 from public.app_org_status_rows x where x.organization_id = o.id) as status_rows,
    exists (select 1 from public.app_weekly_org_lines x where x.organization_id = o.id) as weekly_lines,
    exists (select 1 from public.app_library_folders x where x.organization_id = o.id) as library_folders,
    exists (select 1 from public.app_journal_memorable x where x.workspace_id = o.workspace_id and x.org_name = o.name) as memorable_names
  from other o),
flag as (
  select r.*, (updates or timeline or weekly_reports or status_items or affiliations or dispute_stages or events or record_links
    or documents or todo_candidates or ledger or weekly_summaries or feed_items or calendar_refs or key_people or key_people_briefs
    or pre_meeting_sheets or status_rows or weekly_lines or library_folders or memorable_names) as any_ref from refs r),
assigned as (
  select o.id from public.app_suborganizations o
   where o.workspace_id in (select workspace_id from ws) and o.deleted_at is null
     and (exists (select 1 from public.app_suborganization_assignees x where x.organization_id = o.id)
          or exists (select 1 from public.app_profile_workplaces x where x.organization_id = o.id))),
fk as (
  select c.relnamespace, c.relname || '.' || a.attname as col from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
   where k.contype = 'f' and k.confrelid = to_regclass('public.app_suborganizations'))
select 'prerequisite recorded' as item, case when (select count(*) from supabase_migrations.schema_migrations where version = '20261025100000' and name = 'trash_org_report_db') = 1 then '예' else '아니오' end as value
union all select 'new migration absent', case when not exists (select 1 from supabase_migrations.schema_migrations where version = '20261126201000') then '예' else '아니오' end
union all select 'backup table absent', case when to_regclass('public.app_cleanup_s71_40_orgs') is null then '예' else '아니오' end
union all select 'RLS enabled', case when exists (select 1 from pg_class where oid = to_regclass('public.app_suborganizations') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege', case when has_table_privilege('anon', 'public.app_suborganizations', 'select,insert,update,delete')
  or exists (select 1 from pg_class where oid = to_regclass('public.app_suborganizations') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'operator workspace one owner', case when (select count(distinct workspace_id) from ws) = 1
  and (select count(*) from public.app_workspace_members m where m.role = 'owner' and m.workspace_id in (select workspace_id from ws)) = 1 then '예' else '아니오' end
union all select 'fk list as expected', case when (select count(*) from fk) = 22 and not exists (select 1 from fk where relnamespace <> 'public'::regnamespace or col <> all (array[
    'app_suborganization_assignees.organization_id', 'app_profile_workplaces.organization_id',
    'app_suborganization_updates.organization_id', 'app_suborganization_timeline.organization_id',
    'app_suborganization_weekly_reports.organization_id', 'app_suborganization_status_items.organization_id',
    'app_suborganization_affiliations.organization_id', 'app_suborganization_dispute_stages.organization_id',
    'app_event_suborganizations.organization_id', 'app_record_links.organization_id',
    'app_documents.organization_id', 'app_todo_candidates.organization_id',
    'app_ledger_organizations.suborganization_id', 'app_weekly_org_summaries.organization_id',
    'app_feed_items.organization_id', 'app_calendar_work_refs.organization_id',
    'app_org_key_people.organization_id', 'app_org_key_people_briefs.organization_id',
    'app_pre_meeting_sheets.organization_id', 'app_org_status_rows.organization_id',
    'app_weekly_org_lines.organization_id', 'app_library_folders.organization_id'])) then '예' else '아니오' end
union all select 'fk count', (select count(*) from fk)::text
union all select 'other orgs', (select count(*) from other)::text
union all select 'other orgs with records', (select count(*) from flag where any_ref)::text
union all select 'other orgs to trash', (select count(*) from flag where not any_ref)::text
union all select 'other orgs in suborganization_updates', (select count(*) from flag where updates)::text
union all select 'other orgs in suborganization_timeline', (select count(*) from flag where timeline)::text
union all select 'other orgs in suborganization_weekly_reports', (select count(*) from flag where weekly_reports)::text
union all select 'other orgs in suborganization_status_items', (select count(*) from flag where status_items)::text
union all select 'other orgs in suborganization_affiliations', (select count(*) from flag where affiliations)::text
union all select 'other orgs in suborganization_dispute_stages', (select count(*) from flag where dispute_stages)::text
union all select 'other orgs in event_suborganizations', (select count(*) from flag where events)::text
union all select 'other orgs in record_links', (select count(*) from flag where record_links)::text
union all select 'other orgs in documents', (select count(*) from flag where documents)::text
union all select 'other orgs in todo_candidates', (select count(*) from flag where todo_candidates)::text
union all select 'other orgs in ledger_organizations', (select count(*) from flag where ledger)::text
union all select 'other orgs in weekly_org_summaries', (select count(*) from flag where weekly_summaries)::text
union all select 'other orgs in feed_items', (select count(*) from flag where feed_items)::text
union all select 'other orgs in calendar_work_refs', (select count(*) from flag where calendar_refs)::text
union all select 'other orgs in org_key_people', (select count(*) from flag where key_people)::text
union all select 'other orgs in org_key_people_briefs', (select count(*) from flag where key_people_briefs)::text
union all select 'other orgs in pre_meeting_sheets', (select count(*) from flag where pre_meeting_sheets)::text
union all select 'other orgs in org_status_rows', (select count(*) from flag where status_rows)::text
union all select 'other orgs in weekly_org_lines', (select count(*) from flag where weekly_lines)::text
union all select 'other orgs in library_folders', (select count(*) from flag where library_folders)::text
union all select 'other orgs in journal_memorable names', (select count(*) from flag where memorable_names)::text
union all select 'other orgs inactive untouched', (select count(*) from public.app_suborganizations o
   where o.workspace_id in (select workspace_id from ws) and o.deleted_at is null and not coalesce(o.active, true)
     and not exists (select 1 from public.app_suborganization_assignees x where x.organization_id = o.id)
     and not exists (select 1 from public.app_profile_workplaces x where x.organization_id = o.id))::text
union all select 'assigned orgs', (select count(*) from assigned)::text
union all select 'orgs in trash', (select count(*) from public.app_suborganizations o where o.workspace_id in (select workspace_id from ws) and o.deleted_at is not null)::text
union all select 'org rows', (select count(*) from public.app_suborganizations)::text
union all select 'assignee rows', (select count(*) from public.app_suborganization_assignees)::text
union all select 'profile workplace rows', (select count(*) from public.app_profile_workplaces)::text
union all select 'assigned orgs hash', md5(coalesce((select string_agg(id::text, ',' order by id) from assigned), ''))
union all select 'policies hash', md5(coalesce(string_agg(polname::text || polcmd::text || polroles::text || polpermissive::text || coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' order by polname), ''))
  from pg_policy where polrelid = to_regclass('public.app_suborganizations')
union all select 'triggers hash', md5(coalesce(string_agg(tgname || ':' || tgenabled::text || ':' || pg_get_triggerdef(oid), ',' order by tgname), ''))
  from pg_trigger where tgrelid = to_regclass('public.app_suborganizations') and not tgisinternal;
