begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop policy if exists task12a_owner_all on public.app_ai_conversations;
drop policy if exists task12a_owner_all on public.app_ai_daily_usage;
drop policy if exists task12a_owner_all on public.app_ai_messages;
drop policy if exists task12a_owner_all on public.app_ai_workspace_settings;
drop policy if exists task12a_owner_all on public.app_direct_messages;
drop policy if exists task12a_owner_all on public.app_document_ai_index;
drop policy if exists task12a_owner_all on public.app_document_chunks;
drop policy if exists task12a_owner_all on public.app_documents;
drop policy if exists task12a_owner_all on public.app_event_attendees;
drop policy if exists task12a_owner_all on public.app_event_comments;
drop policy if exists task12a_owner_all on public.app_event_photos;
drop policy if exists task12a_owner_all on public.app_event_suborganizations;
drop policy if exists task12a_owner_all on public.app_events;
drop policy if exists task12a_owner_all on public.app_invites;
drop policy if exists task12a_owner_all on public.app_meetings;
drop policy if exists task12a_owner_all on public.app_org_affiliation_tags;
drop policy if exists task12a_owner_all on public.app_pages;
drop policy if exists task12a_owner_all on public.app_profile_report_projects;
drop policy if exists task12a_owner_all on public.app_profile_weekly_reports;
drop policy if exists task12a_owner_all on public.app_profile_workplace_statuses;
drop policy if exists task12a_owner_all on public.app_profile_workplaces;
drop policy if exists task12a_owner_all on public.app_profiles;
drop policy if exists task12a_profile_self_select on public.app_profiles;
drop policy if exists task12a_owner_all on public.app_suborganization_affiliations;
drop policy if exists task12a_owner_all on public.app_suborganization_assignees;
drop policy if exists task12a_owner_all on public.app_suborganization_status_items;
drop policy if exists task12a_owner_all on public.app_suborganization_timeline;
drop policy if exists task12a_owner_all on public.app_suborganization_updates;
drop policy if exists task12a_owner_all on public.app_suborganization_weekly_reports;
drop policy if exists task12a_owner_all on public.app_suborganizations;
drop policy if exists task12a_owner_all on public.app_tasks;
drop policy if exists task12a_owner_all on public.app_workspace_members;
drop policy if exists task12a_member_self_select on public.app_workspace_members;
drop policy if exists task12a_owner_all on public.app_workspaces;

-- Restore app_ai_conversations
alter table public."app_ai_conversations" enable row level security;
alter table public."app_ai_conversations" no force row level security;
drop policy if exists "app_ai_conversations_self_delete" on public."app_ai_conversations";
drop policy if exists "app_ai_conversations_self_insert" on public."app_ai_conversations";
drop policy if exists "app_ai_conversations_self_select" on public."app_ai_conversations";
drop policy if exists "app_ai_conversations_self_update" on public."app_ai_conversations";
create policy "app_ai_conversations_self_delete" on public."app_ai_conversations" for delete to PUBLIC using ((owner_id = auth.uid()));
create policy "app_ai_conversations_self_insert" on public."app_ai_conversations" for insert to PUBLIC with check (((owner_id = auth.uid()) AND private.app_is_workspace_member(workspace_id)));
create policy "app_ai_conversations_self_select" on public."app_ai_conversations" for select to PUBLIC using ((owner_id = auth.uid()));
create policy "app_ai_conversations_self_update" on public."app_ai_conversations" for update to PUBLIC using ((owner_id = auth.uid())) with check ((owner_id = auth.uid()));
revoke all privileges on table public."app_ai_conversations" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_ai_conversations" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_ai_conversations" to "service_role";

-- Restore app_ai_daily_usage
alter table public."app_ai_daily_usage" enable row level security;
alter table public."app_ai_daily_usage" no force row level security;
drop policy if exists "app_ai_usage_self_select" on public."app_ai_daily_usage";
create policy "app_ai_usage_self_select" on public."app_ai_daily_usage" for select to PUBLIC using ((user_id = auth.uid()));
revoke all privileges on table public."app_ai_daily_usage" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_ai_daily_usage" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_ai_daily_usage" to "service_role";

-- Restore app_ai_messages
alter table public."app_ai_messages" enable row level security;
alter table public."app_ai_messages" no force row level security;
drop policy if exists "app_ai_messages_self_delete" on public."app_ai_messages";
drop policy if exists "app_ai_messages_self_insert" on public."app_ai_messages";
drop policy if exists "app_ai_messages_self_select" on public."app_ai_messages";
create policy "app_ai_messages_self_delete" on public."app_ai_messages" for delete to PUBLIC using ((owner_id = auth.uid()));
create policy "app_ai_messages_self_insert" on public."app_ai_messages" for insert to PUBLIC with check (((owner_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM app_ai_conversations c
  WHERE ((c.id = app_ai_messages.conversation_id) AND (c.owner_id = auth.uid()))))));
create policy "app_ai_messages_self_select" on public."app_ai_messages" for select to PUBLIC using ((owner_id = auth.uid()));
revoke all privileges on table public."app_ai_messages" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_ai_messages" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_ai_messages" to "service_role";

-- Restore app_ai_workspace_settings
alter table public."app_ai_workspace_settings" enable row level security;
alter table public."app_ai_workspace_settings" no force row level security;
drop policy if exists "app_ai_settings_admin_update" on public."app_ai_workspace_settings";
drop policy if exists "app_ai_settings_member_read" on public."app_ai_workspace_settings";
create policy "app_ai_settings_admin_update" on public."app_ai_workspace_settings" for update to PUBLIC using (private.app_is_workspace_admin(workspace_id)) with check (private.app_is_workspace_admin(workspace_id));
create policy "app_ai_settings_member_read" on public."app_ai_workspace_settings" for select to PUBLIC using (private.app_is_workspace_member(workspace_id));
revoke all privileges on table public."app_ai_workspace_settings" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_ai_workspace_settings" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_ai_workspace_settings" to "service_role";

-- Restore app_direct_messages
alter table public."app_direct_messages" enable row level security;
alter table public."app_direct_messages" no force row level security;
drop policy if exists "app_direct_messages_insert" on public."app_direct_messages";
drop policy if exists "app_direct_messages_read" on public."app_direct_messages";
drop policy if exists "app_direct_messages_read_update" on public."app_direct_messages";
create policy "app_direct_messages_insert" on public."app_direct_messages" for insert to "authenticated" with check (((sender_id = ( SELECT auth.uid() AS uid)) AND private.app_is_workspace_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM app_workspace_members wm
  WHERE ((wm.workspace_id = app_direct_messages.workspace_id) AND (wm.user_id = app_direct_messages.recipient_id))))));
create policy "app_direct_messages_read" on public."app_direct_messages" for select to "authenticated" using ((private.app_is_workspace_member(workspace_id) AND ((sender_id = ( SELECT auth.uid() AS uid)) OR (recipient_id = ( SELECT auth.uid() AS uid)))));
create policy "app_direct_messages_read_update" on public."app_direct_messages" for update to "authenticated" using ((recipient_id = ( SELECT auth.uid() AS uid))) with check ((recipient_id = ( SELECT auth.uid() AS uid)));
revoke all privileges on table public."app_direct_messages" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public."app_direct_messages" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_direct_messages" to "service_role";

-- Restore app_document_ai_index
alter table public."app_document_ai_index" enable row level security;
alter table public."app_document_ai_index" no force row level security;
drop policy if exists "app_document_ai_index_read" on public."app_document_ai_index";
create policy "app_document_ai_index_read" on public."app_document_ai_index" for select to "authenticated" using (private.app_can_view_document(document_id));
revoke all privileges on table public."app_document_ai_index" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_document_ai_index" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_document_ai_index" to "service_role";

-- Restore app_document_chunks
alter table public."app_document_chunks" enable row level security;
alter table public."app_document_chunks" no force row level security;
drop policy if exists "app_document_chunks_read" on public."app_document_chunks";
create policy "app_document_chunks_read" on public."app_document_chunks" for select to "authenticated" using (private.app_can_view_document(document_id));
revoke all privileges on table public."app_document_chunks" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_document_chunks" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_document_chunks" to "service_role";

-- Restore app_documents
alter table public."app_documents" enable row level security;
alter table public."app_documents" no force row level security;
drop policy if exists "app_documents_scoped_delete" on public."app_documents";
drop policy if exists "app_documents_scoped_insert" on public."app_documents";
drop policy if exists "app_documents_scoped_read" on public."app_documents";
drop policy if exists "app_documents_scoped_update" on public."app_documents";
create policy "app_documents_scoped_delete" on public."app_documents" for delete to "authenticated" using ((((project_id IS NULL) AND ((uploaded_by = auth.uid()) OR private.app_is_workspace_admin(workspace_id))) OR ((project_id IS NOT NULL) AND ((uploaded_by = auth.uid()) OR private.app_can_manage_space(project_id)))));
create policy "app_documents_scoped_insert" on public."app_documents" for insert to "authenticated" with check (((uploaded_by = auth.uid()) AND (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 20) AND ((project_id IS NULL) OR private.app_can_edit_space(project_id))));
create policy "app_documents_scoped_read" on public."app_documents" for select to "authenticated" using (private.app_can_view_document(id));
create policy "app_documents_scoped_update" on public."app_documents" for update to "authenticated" using ((((project_id IS NULL) AND ((uploaded_by = auth.uid()) OR (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 30))) OR ((project_id IS NOT NULL) AND ((uploaded_by = auth.uid()) OR private.app_can_edit_space(project_id))))) with check ((((project_id IS NULL) AND ((uploaded_by = auth.uid()) OR (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 30))) OR ((project_id IS NOT NULL) AND ((uploaded_by = auth.uid()) OR private.app_can_edit_space(project_id)))));
revoke all privileges on table public."app_documents" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, SELECT, UPDATE on table public."app_documents" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_documents" to "service_role";

-- Restore app_event_attendees
alter table public."app_event_attendees" enable row level security;
alter table public."app_event_attendees" no force row level security;
drop policy if exists "app_event_attendees_delete" on public."app_event_attendees";
drop policy if exists "app_event_attendees_insert" on public."app_event_attendees";
drop policy if exists "app_event_attendees_scoped_read" on public."app_event_attendees";
drop policy if exists "app_event_attendees_update" on public."app_event_attendees";
create policy "app_event_attendees_delete" on public."app_event_attendees" for delete to PUBLIC using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM app_events e
  WHERE ((e.id = app_event_attendees.event_id) AND ((e.created_by = auth.uid()) OR (private.app_role_rank(private.app_workspace_role(e.workspace_id)) >= 30)))))));
create policy "app_event_attendees_insert" on public."app_event_attendees" for insert to PUBLIC with check ((EXISTS ( SELECT 1
   FROM app_events e
  WHERE ((e.id = app_event_attendees.event_id) AND ((e.created_by = auth.uid()) OR (private.app_role_rank(private.app_workspace_role(e.workspace_id)) >= 30))))));
create policy "app_event_attendees_scoped_read" on public."app_event_attendees" for select to "authenticated" using (private.app_can_view_event(event_id));
create policy "app_event_attendees_update" on public."app_event_attendees" for update to PUBLIC using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM app_events e
  WHERE ((e.id = app_event_attendees.event_id) AND ((e.created_by = auth.uid()) OR (private.app_role_rank(private.app_workspace_role(e.workspace_id)) >= 30))))))) with check (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM app_events e
  WHERE ((e.id = app_event_attendees.event_id) AND ((e.created_by = auth.uid()) OR (private.app_role_rank(private.app_workspace_role(e.workspace_id)) >= 30)))))));
revoke all privileges on table public."app_event_attendees" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_event_attendees" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_event_attendees" to "service_role";

-- Restore app_event_comments
alter table public."app_event_comments" enable row level security;
alter table public."app_event_comments" no force row level security;
drop policy if exists "app_event_comments_delete" on public."app_event_comments";
drop policy if exists "app_event_comments_scoped_insert" on public."app_event_comments";
drop policy if exists "app_event_comments_scoped_read" on public."app_event_comments";
drop policy if exists "app_event_comments_update" on public."app_event_comments";
create policy "app_event_comments_delete" on public."app_event_comments" for delete to PUBLIC using (((author_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM app_events e
  WHERE ((e.id = app_event_comments.event_id) AND private.app_is_workspace_admin(e.workspace_id))))));
create policy "app_event_comments_scoped_insert" on public."app_event_comments" for insert to "authenticated" with check (((author_id = auth.uid()) AND private.app_can_view_event(event_id)));
create policy "app_event_comments_scoped_read" on public."app_event_comments" for select to "authenticated" using (private.app_can_view_event(event_id));
create policy "app_event_comments_update" on public."app_event_comments" for update to PUBLIC using ((author_id = auth.uid())) with check ((author_id = auth.uid()));
revoke all privileges on table public."app_event_comments" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_event_comments" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_event_comments" to "service_role";

-- Restore app_event_photos
alter table public."app_event_photos" enable row level security;
alter table public."app_event_photos" no force row level security;
drop policy if exists "app_event_photos_scoped_delete" on public."app_event_photos";
drop policy if exists "app_event_photos_scoped_insert" on public."app_event_photos";
drop policy if exists "app_event_photos_scoped_read" on public."app_event_photos";
drop policy if exists "app_event_photos_scoped_update" on public."app_event_photos";
create policy "app_event_photos_scoped_delete" on public."app_event_photos" for delete to "authenticated" using (((uploaded_by = auth.uid()) AND private.app_can_view_event(event_id)));
create policy "app_event_photos_scoped_insert" on public."app_event_photos" for insert to "authenticated" with check (((uploaded_by = auth.uid()) AND private.app_can_view_event(event_id)));
create policy "app_event_photos_scoped_read" on public."app_event_photos" for select to "authenticated" using (private.app_can_view_event(event_id));
create policy "app_event_photos_scoped_update" on public."app_event_photos" for update to "authenticated" using (((uploaded_by = auth.uid()) AND private.app_can_view_event(event_id))) with check (((uploaded_by = auth.uid()) AND private.app_can_view_event(event_id)));
revoke all privileges on table public."app_event_photos" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_event_photos" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_event_photos" to "service_role";

-- Restore app_event_suborganizations
alter table public."app_event_suborganizations" enable row level security;
alter table public."app_event_suborganizations" no force row level security;
drop policy if exists "app_event_suborganizations_delete" on public."app_event_suborganizations";
drop policy if exists "app_event_suborganizations_insert" on public."app_event_suborganizations";
drop policy if exists "app_event_suborganizations_read" on public."app_event_suborganizations";
create policy "app_event_suborganizations_delete" on public."app_event_suborganizations" for delete to "authenticated" using ((EXISTS ( SELECT 1
   FROM app_events e
  WHERE ((e.id = app_event_suborganizations.event_id) AND ((e.created_by = ( SELECT auth.uid() AS uid)) OR private.app_is_workspace_admin(e.workspace_id) OR ((e.project_id IS NOT NULL) AND private.app_can_edit_space(e.project_id)))))));
create policy "app_event_suborganizations_insert" on public."app_event_suborganizations" for insert to "authenticated" with check (((created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (app_events e
     JOIN app_suborganizations o ON ((o.workspace_id = e.workspace_id)))
  WHERE ((e.id = app_event_suborganizations.event_id) AND (o.id = app_event_suborganizations.organization_id) AND ((e.created_by = ( SELECT auth.uid() AS uid)) OR private.app_is_workspace_admin(e.workspace_id) OR ((e.project_id IS NOT NULL) AND private.app_can_edit_space(e.project_id))))))));
create policy "app_event_suborganizations_read" on public."app_event_suborganizations" for select to "authenticated" using ((EXISTS ( SELECT 1
   FROM app_events e
  WHERE ((e.id = app_event_suborganizations.event_id) AND private.app_is_workspace_member(e.workspace_id) AND ((e.calendar_scope = 'team'::text) OR (e.created_by = ( SELECT auth.uid() AS uid))) AND ((e.project_id IS NULL) OR private.app_can_view_space(e.project_id))))));
revoke all privileges on table public."app_event_suborganizations" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_event_suborganizations" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_event_suborganizations" to "service_role";

-- Restore app_events
alter table public."app_events" enable row level security;
alter table public."app_events" no force row level security;
drop policy if exists "app_events_scoped_delete" on public."app_events";
drop policy if exists "app_events_scoped_insert" on public."app_events";
drop policy if exists "app_events_scoped_read" on public."app_events";
drop policy if exists "app_events_scoped_update" on public."app_events";
create policy "app_events_scoped_delete" on public."app_events" for delete to "authenticated" using ((((calendar_scope = 'personal'::text) AND (created_by = auth.uid())) OR ((calendar_scope = 'team'::text) AND (((project_id IS NULL) AND ((created_by = auth.uid()) OR private.app_is_workspace_admin(workspace_id))) OR ((project_id IS NOT NULL) AND ((created_by = auth.uid()) OR private.app_can_manage_space(project_id)))))));
create policy "app_events_scoped_insert" on public."app_events" for insert to "authenticated" with check (((created_by = auth.uid()) AND private.app_is_workspace_member(workspace_id) AND ((calendar_scope = 'personal'::text) OR (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 20)) AND ((project_id IS NULL) OR private.app_can_edit_space(project_id))));
create policy "app_events_scoped_read" on public."app_events" for select to "authenticated" using ((private.app_is_workspace_member(workspace_id) AND ((calendar_scope = 'team'::text) OR ((calendar_scope = 'personal'::text) AND (created_by = auth.uid()))) AND ((project_id IS NULL) OR private.app_can_view_space(project_id))));
create policy "app_events_scoped_update" on public."app_events" for update to "authenticated" using ((((calendar_scope = 'personal'::text) AND (created_by = auth.uid())) OR ((calendar_scope = 'team'::text) AND (((project_id IS NULL) AND ((created_by = auth.uid()) OR (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 30))) OR ((project_id IS NOT NULL) AND ((created_by = auth.uid()) OR private.app_can_edit_space(project_id))))))) with check ((((calendar_scope = 'personal'::text) AND (created_by = auth.uid())) OR ((calendar_scope = 'team'::text) AND (((project_id IS NULL) AND ((created_by = auth.uid()) OR (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 30))) OR ((project_id IS NOT NULL) AND ((created_by = auth.uid()) OR private.app_can_edit_space(project_id)))))));
revoke all privileges on table public."app_events" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, SELECT, UPDATE on table public."app_events" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_events" to "service_role";

-- Restore app_invites
alter table public."app_invites" enable row level security;
alter table public."app_invites" no force row level security;
drop policy if exists "app_invites_admin_read" on public."app_invites";
create policy "app_invites_admin_read" on public."app_invites" for select to "authenticated" using (private.app_is_workspace_admin(workspace_id));
revoke all privileges on table public."app_invites" from PUBLIC, anon, authenticated, service_role;
grant SELECT on table public."app_invites" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_invites" to "service_role";

-- Restore app_meetings
alter table public."app_meetings" enable row level security;
alter table public."app_meetings" no force row level security;
drop policy if exists "app_meetings_scoped_delete" on public."app_meetings";
drop policy if exists "app_meetings_scoped_insert" on public."app_meetings";
drop policy if exists "app_meetings_scoped_read" on public."app_meetings";
drop policy if exists "app_meetings_scoped_update" on public."app_meetings";
create policy "app_meetings_scoped_delete" on public."app_meetings" for delete to "authenticated" using ((((project_id IS NULL) AND ((created_by = auth.uid()) OR private.app_is_workspace_admin(workspace_id))) OR ((project_id IS NOT NULL) AND ((created_by = auth.uid()) OR private.app_can_manage_space(project_id)))));
create policy "app_meetings_scoped_insert" on public."app_meetings" for insert to "authenticated" with check (((created_by = auth.uid()) AND (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 20) AND ((project_id IS NULL) OR private.app_can_edit_space(project_id))));
create policy "app_meetings_scoped_read" on public."app_meetings" for select to "authenticated" using ((private.app_is_workspace_member(workspace_id) AND ((project_id IS NULL) OR private.app_can_view_space(project_id))));
create policy "app_meetings_scoped_update" on public."app_meetings" for update to "authenticated" using ((((project_id IS NULL) AND ((created_by = auth.uid()) OR (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 30))) OR ((project_id IS NOT NULL) AND ((created_by = auth.uid()) OR private.app_can_edit_space(project_id))))) with check ((((project_id IS NULL) AND ((created_by = auth.uid()) OR (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 30))) OR ((project_id IS NOT NULL) AND ((created_by = auth.uid()) OR private.app_can_edit_space(project_id)))));
revoke all privileges on table public."app_meetings" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_meetings" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_meetings" to "service_role";

-- Restore app_org_affiliation_tags
alter table public."app_org_affiliation_tags" enable row level security;
alter table public."app_org_affiliation_tags" no force row level security;
drop policy if exists "app_org_affiliation_tags_delete" on public."app_org_affiliation_tags";
drop policy if exists "app_org_affiliation_tags_insert" on public."app_org_affiliation_tags";
drop policy if exists "app_org_affiliation_tags_read" on public."app_org_affiliation_tags";
drop policy if exists "app_org_affiliation_tags_update" on public."app_org_affiliation_tags";
create policy "app_org_affiliation_tags_delete" on public."app_org_affiliation_tags" for delete to "authenticated" using (((created_by = auth.uid()) OR private.app_is_workspace_admin(workspace_id)));
create policy "app_org_affiliation_tags_insert" on public."app_org_affiliation_tags" for insert to "authenticated" with check (((created_by = auth.uid()) AND (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 20)));
create policy "app_org_affiliation_tags_read" on public."app_org_affiliation_tags" for select to "authenticated" using (private.app_is_workspace_member(workspace_id));
create policy "app_org_affiliation_tags_update" on public."app_org_affiliation_tags" for update to "authenticated" using (((created_by = auth.uid()) OR private.app_is_workspace_admin(workspace_id))) with check (((created_by = auth.uid()) OR private.app_is_workspace_admin(workspace_id)));
revoke all privileges on table public."app_org_affiliation_tags" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_org_affiliation_tags" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_org_affiliation_tags" to "service_role";

-- Restore app_pages
alter table public."app_pages" enable row level security;
alter table public."app_pages" no force row level security;
drop policy if exists "app_pages_create_guard" on public."app_pages";
drop policy if exists "app_pages_delete" on public."app_pages";
drop policy if exists "app_pages_member_read" on public."app_pages";
drop policy if exists "app_pages_update" on public."app_pages";
create policy "app_pages_create_guard" on public."app_pages" for insert to "authenticated" with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 20) AND ((space_id IS NULL) OR (EXISTS ( SELECT 1
   FROM app_spaces s
  WHERE ((s.id = app_pages.space_id) AND (s.workspace_id = app_pages.workspace_id) AND private.app_can_edit_space(s.id))))) AND ((workstream_id IS NULL) OR (EXISTS ( SELECT 1
   FROM (app_project_workstreams w
     JOIN app_spaces s ON ((s.id = w.project_id)))
  WHERE ((w.id = app_pages.workstream_id) AND (w.project_id = app_pages.space_id) AND (s.workspace_id = app_pages.workspace_id) AND private.app_can_edit_space(s.id)))))));
create policy "app_pages_delete" on public."app_pages" for delete to "authenticated" using (private.app_can_manage_page(id));
create policy "app_pages_member_read" on public."app_pages" for select to "authenticated" using (private.app_can_view_page(id));
create policy "app_pages_update" on public."app_pages" for update to "authenticated" using (private.app_can_edit_page(id)) with check ((private.app_can_edit_page(id) AND ((space_id IS NULL) OR (EXISTS ( SELECT 1
   FROM app_spaces s
  WHERE ((s.id = app_pages.space_id) AND (s.workspace_id = app_pages.workspace_id) AND private.app_can_edit_space(s.id))))) AND ((workstream_id IS NULL) OR (EXISTS ( SELECT 1
   FROM (app_project_workstreams w
     JOIN app_spaces s ON ((s.id = w.project_id)))
  WHERE ((w.id = app_pages.workstream_id) AND (w.project_id = app_pages.space_id) AND (s.workspace_id = app_pages.workspace_id) AND private.app_can_edit_space(s.id)))))));
revoke all privileges on table public."app_pages" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, SELECT, UPDATE on table public."app_pages" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_pages" to "service_role";

-- Restore app_profile_report_projects
alter table public."app_profile_report_projects" enable row level security;
alter table public."app_profile_report_projects" no force row level security;
drop policy if exists "app_profile_report_projects_self_delete" on public."app_profile_report_projects";
drop policy if exists "app_profile_report_projects_self_insert" on public."app_profile_report_projects";
drop policy if exists "app_profile_report_projects_self_update" on public."app_profile_report_projects";
drop policy if exists "app_profile_report_projects_team_read" on public."app_profile_report_projects";
create policy "app_profile_report_projects_self_delete" on public."app_profile_report_projects" for delete to PUBLIC using ((user_id = auth.uid()));
create policy "app_profile_report_projects_self_insert" on public."app_profile_report_projects" for insert to PUBLIC with check ((user_id = auth.uid()));
create policy "app_profile_report_projects_self_update" on public."app_profile_report_projects" for update to PUBLIC using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy "app_profile_report_projects_team_read" on public."app_profile_report_projects" for select to PUBLIC using (private.app_can_read_profile(user_id));
revoke all privileges on table public."app_profile_report_projects" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_profile_report_projects" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_profile_report_projects" to "service_role";

-- Restore app_profile_weekly_reports
alter table public."app_profile_weekly_reports" enable row level security;
alter table public."app_profile_weekly_reports" no force row level security;
drop policy if exists "app_profile_weekly_reports_self_delete" on public."app_profile_weekly_reports";
drop policy if exists "app_profile_weekly_reports_self_insert" on public."app_profile_weekly_reports";
drop policy if exists "app_profile_weekly_reports_self_update" on public."app_profile_weekly_reports";
drop policy if exists "app_profile_weekly_reports_team_read" on public."app_profile_weekly_reports";
create policy "app_profile_weekly_reports_self_delete" on public."app_profile_weekly_reports" for delete to PUBLIC using ((user_id = auth.uid()));
create policy "app_profile_weekly_reports_self_insert" on public."app_profile_weekly_reports" for insert to PUBLIC with check ((user_id = auth.uid()));
create policy "app_profile_weekly_reports_self_update" on public."app_profile_weekly_reports" for update to PUBLIC using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy "app_profile_weekly_reports_team_read" on public."app_profile_weekly_reports" for select to PUBLIC using (private.app_can_read_profile(user_id));
revoke all privileges on table public."app_profile_weekly_reports" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_profile_weekly_reports" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_profile_weekly_reports" to "service_role";

-- Restore app_profile_workplace_statuses
alter table public."app_profile_workplace_statuses" enable row level security;
alter table public."app_profile_workplace_statuses" no force row level security;
drop policy if exists "app_profile_workplace_statuses_self_delete" on public."app_profile_workplace_statuses";
drop policy if exists "app_profile_workplace_statuses_self_insert" on public."app_profile_workplace_statuses";
drop policy if exists "app_profile_workplace_statuses_self_update" on public."app_profile_workplace_statuses";
drop policy if exists "app_profile_workplace_statuses_team_read" on public."app_profile_workplace_statuses";
create policy "app_profile_workplace_statuses_self_delete" on public."app_profile_workplace_statuses" for delete to PUBLIC using ((user_id = auth.uid()));
create policy "app_profile_workplace_statuses_self_insert" on public."app_profile_workplace_statuses" for insert to PUBLIC with check ((user_id = auth.uid()));
create policy "app_profile_workplace_statuses_self_update" on public."app_profile_workplace_statuses" for update to PUBLIC using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy "app_profile_workplace_statuses_team_read" on public."app_profile_workplace_statuses" for select to PUBLIC using (private.app_can_read_profile(user_id));
revoke all privileges on table public."app_profile_workplace_statuses" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_profile_workplace_statuses" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_profile_workplace_statuses" to "service_role";

-- Restore app_profile_workplaces
alter table public."app_profile_workplaces" enable row level security;
alter table public."app_profile_workplaces" no force row level security;
drop policy if exists "app_profile_workplaces_self_delete" on public."app_profile_workplaces";
drop policy if exists "app_profile_workplaces_self_insert" on public."app_profile_workplaces";
drop policy if exists "app_profile_workplaces_self_update" on public."app_profile_workplaces";
drop policy if exists "app_profile_workplaces_team_read" on public."app_profile_workplaces";
create policy "app_profile_workplaces_self_delete" on public."app_profile_workplaces" for delete to PUBLIC using ((user_id = auth.uid()));
create policy "app_profile_workplaces_self_insert" on public."app_profile_workplaces" for insert to PUBLIC with check ((user_id = auth.uid()));
create policy "app_profile_workplaces_self_update" on public."app_profile_workplaces" for update to PUBLIC using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy "app_profile_workplaces_team_read" on public."app_profile_workplaces" for select to PUBLIC using (private.app_can_read_profile(user_id));
revoke all privileges on table public."app_profile_workplaces" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_profile_workplaces" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_profile_workplaces" to "service_role";

-- Restore app_profiles
alter table public."app_profiles" enable row level security;
alter table public."app_profiles" no force row level security;
drop policy if exists "app_profiles_self_or_colleague_read" on public."app_profiles";
drop policy if exists "app_profiles_self_update" on public."app_profiles";
create policy "app_profiles_self_or_colleague_read" on public."app_profiles" for select to "authenticated" using (private.app_can_read_profile(user_id));
create policy "app_profiles_self_update" on public."app_profiles" for update to "authenticated" using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
revoke all privileges on table public."app_profiles" from PUBLIC, anon, authenticated, service_role;
grant SELECT, UPDATE on table public."app_profiles" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_profiles" to "service_role";

-- Restore app_spaces
alter table public."app_spaces" enable row level security;
alter table public."app_spaces" no force row level security;
drop policy if exists "app_spaces_create" on public."app_spaces";
drop policy if exists "app_spaces_delete" on public."app_spaces";
drop policy if exists "app_spaces_scoped_read" on public."app_spaces";
drop policy if exists "app_spaces_update" on public."app_spaces";
create policy "app_spaces_create" on public."app_spaces" for insert to "authenticated" with check (((created_by = auth.uid()) AND (owner_id = auth.uid()) AND (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 20)));
create policy "app_spaces_delete" on public."app_spaces" for delete to "authenticated" using ((owner_id = auth.uid()));
create policy "app_spaces_scoped_read" on public."app_spaces" for select to "authenticated" using ((owner_id = ( SELECT auth.uid() AS uid)));
create policy "app_spaces_update" on public."app_spaces" for update to "authenticated" using (private.app_can_manage_space(id)) with check (private.app_can_manage_space(id));
revoke all privileges on table public."app_spaces" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, SELECT, UPDATE on table public."app_spaces" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_spaces" to "service_role";

-- Restore app_suborganization_affiliations
alter table public."app_suborganization_affiliations" enable row level security;
alter table public."app_suborganization_affiliations" no force row level security;
drop policy if exists "app_suborganization_affiliations_delete" on public."app_suborganization_affiliations";
drop policy if exists "app_suborganization_affiliations_insert" on public."app_suborganization_affiliations";
drop policy if exists "app_suborganization_affiliations_read" on public."app_suborganization_affiliations";
create policy "app_suborganization_affiliations_delete" on public."app_suborganization_affiliations" for delete to "authenticated" using (private.app_can_edit_suborganization(organization_id));
create policy "app_suborganization_affiliations_insert" on public."app_suborganization_affiliations" for insert to "authenticated" with check (((created_by = auth.uid()) AND private.app_can_edit_suborganization(organization_id) AND (EXISTS ( SELECT 1
   FROM (app_suborganizations o
     JOIN app_org_affiliation_tags t ON ((t.id = app_suborganization_affiliations.tag_id)))
  WHERE ((o.id = app_suborganization_affiliations.organization_id) AND (o.workspace_id = t.workspace_id) AND (t.active = true))))));
create policy "app_suborganization_affiliations_read" on public."app_suborganization_affiliations" for select to "authenticated" using ((EXISTS ( SELECT 1
   FROM app_suborganizations o
  WHERE ((o.id = app_suborganization_affiliations.organization_id) AND private.app_is_workspace_member(o.workspace_id)))));
revoke all privileges on table public."app_suborganization_affiliations" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganization_affiliations" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganization_affiliations" to "service_role";

-- Restore app_suborganization_assignees
alter table public."app_suborganization_assignees" enable row level security;
alter table public."app_suborganization_assignees" no force row level security;
drop policy if exists "app_suborg_assignees_delete" on public."app_suborganization_assignees";
drop policy if exists "app_suborg_assignees_insert" on public."app_suborganization_assignees";
drop policy if exists "app_suborg_assignees_read" on public."app_suborganization_assignees";
drop policy if exists "app_suborg_assignees_self_assign_v2" on public."app_suborganization_assignees";
drop policy if exists "app_suborg_assignees_self_claim_named" on public."app_suborganization_assignees";
drop policy if exists "app_suborg_assignees_self_delete_v2" on public."app_suborganization_assignees";
create policy "app_suborg_assignees_delete" on public."app_suborganization_assignees" for delete to "authenticated" using ((EXISTS ( SELECT 1
   FROM app_suborganizations o
  WHERE ((o.id = app_suborganization_assignees.organization_id) AND private.app_is_workspace_admin(o.workspace_id)))));
create policy "app_suborg_assignees_insert" on public."app_suborganization_assignees" for insert to "authenticated" with check (((assigned_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM app_suborganizations o
  WHERE ((o.id = app_suborganization_assignees.organization_id) AND private.app_is_workspace_admin(o.workspace_id)))) AND (EXISTS ( SELECT 1
   FROM (app_workspace_members wm
     JOIN app_suborganizations o ON ((o.workspace_id = wm.workspace_id)))
  WHERE ((o.id = app_suborganization_assignees.organization_id) AND (wm.user_id = app_suborganization_assignees.user_id))))));
create policy "app_suborg_assignees_read" on public."app_suborganization_assignees" for select to "authenticated" using ((EXISTS ( SELECT 1
   FROM app_suborganizations o
  WHERE ((o.id = app_suborganization_assignees.organization_id) AND private.app_is_workspace_member(o.workspace_id)))));
create policy "app_suborg_assignees_self_assign_v2" on public."app_suborganization_assignees" for insert to "authenticated" with check (((user_id = ( SELECT auth.uid() AS uid)) AND (assigned_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (app_suborganizations o
     JOIN app_workspace_members wm ON (((wm.workspace_id = o.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)))))
  WHERE ((o.id = app_suborganization_assignees.organization_id) AND (o.active = true))))));
create policy "app_suborg_assignees_self_claim_named" on public."app_suborganization_assignees" for insert to "authenticated" with check (((user_id = ( SELECT auth.uid() AS uid)) AND (assigned_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM ((app_suborganizations o
     JOIN app_profiles p ON ((p.user_id = ( SELECT auth.uid() AS uid))))
     JOIN app_workspace_members wm ON (((wm.workspace_id = o.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)))))
  WHERE ((o.id = app_suborganization_assignees.organization_id) AND (o.active = true) AND (NULLIF(btrim(o.default_assignee_name), ''::text) IS NOT NULL) AND (btrim(o.default_assignee_name) = btrim(COALESCE(p.display_name, ''::text))))))));
create policy "app_suborg_assignees_self_delete_v2" on public."app_suborganization_assignees" for delete to "authenticated" using (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (app_suborganizations o
     JOIN app_workspace_members wm ON (((wm.workspace_id = o.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)))))
  WHERE (o.id = app_suborganization_assignees.organization_id)))));
revoke all privileges on table public."app_suborganization_assignees" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganization_assignees" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganization_assignees" to "service_role";

-- Restore app_suborganization_status_items
alter table public."app_suborganization_status_items" enable row level security;
alter table public."app_suborganization_status_items" no force row level security;
drop policy if exists "app_suborganization_status_items_delete" on public."app_suborganization_status_items";
drop policy if exists "app_suborganization_status_items_insert" on public."app_suborganization_status_items";
drop policy if exists "app_suborganization_status_items_read" on public."app_suborganization_status_items";
drop policy if exists "app_suborganization_status_items_update" on public."app_suborganization_status_items";
create policy "app_suborganization_status_items_delete" on public."app_suborganization_status_items" for delete to "authenticated" using (private.app_can_edit_suborganization(organization_id));
create policy "app_suborganization_status_items_insert" on public."app_suborganization_status_items" for insert to "authenticated" with check (((created_by = ( SELECT auth.uid() AS uid)) AND private.app_can_edit_suborganization(organization_id)));
create policy "app_suborganization_status_items_read" on public."app_suborganization_status_items" for select to "authenticated" using ((EXISTS ( SELECT 1
   FROM app_suborganizations o
  WHERE ((o.id = app_suborganization_status_items.organization_id) AND private.app_is_workspace_member(o.workspace_id)))));
create policy "app_suborganization_status_items_update" on public."app_suborganization_status_items" for update to "authenticated" using (private.app_can_edit_suborganization(organization_id)) with check (private.app_can_edit_suborganization(organization_id));
revoke all privileges on table public."app_suborganization_status_items" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganization_status_items" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganization_status_items" to "service_role";

-- Restore app_suborganization_timeline
alter table public."app_suborganization_timeline" enable row level security;
alter table public."app_suborganization_timeline" no force row level security;
drop policy if exists "app_suborganization_timeline_delete" on public."app_suborganization_timeline";
drop policy if exists "app_suborganization_timeline_insert" on public."app_suborganization_timeline";
drop policy if exists "app_suborganization_timeline_read" on public."app_suborganization_timeline";
drop policy if exists "app_suborganization_timeline_update" on public."app_suborganization_timeline";
create policy "app_suborganization_timeline_delete" on public."app_suborganization_timeline" for delete to "authenticated" using (private.app_can_edit_suborganization(organization_id));
create policy "app_suborganization_timeline_insert" on public."app_suborganization_timeline" for insert to "authenticated" with check (((created_by = ( SELECT auth.uid() AS uid)) AND private.app_can_edit_suborganization(organization_id)));
create policy "app_suborganization_timeline_read" on public."app_suborganization_timeline" for select to "authenticated" using ((EXISTS ( SELECT 1
   FROM app_suborganizations o
  WHERE ((o.id = app_suborganization_timeline.organization_id) AND private.app_is_workspace_member(o.workspace_id)))));
create policy "app_suborganization_timeline_update" on public."app_suborganization_timeline" for update to "authenticated" using (private.app_can_edit_suborganization(organization_id)) with check (private.app_can_edit_suborganization(organization_id));
revoke all privileges on table public."app_suborganization_timeline" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganization_timeline" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganization_timeline" to "service_role";

-- Restore app_suborganization_updates
alter table public."app_suborganization_updates" enable row level security;
alter table public."app_suborganization_updates" no force row level security;
drop policy if exists "app_suborganization_updates_delete" on public."app_suborganization_updates";
drop policy if exists "app_suborganization_updates_insert" on public."app_suborganization_updates";
drop policy if exists "app_suborganization_updates_read" on public."app_suborganization_updates";
drop policy if exists "app_suborganization_updates_update" on public."app_suborganization_updates";
create policy "app_suborganization_updates_delete" on public."app_suborganization_updates" for delete to PUBLIC using (private.app_can_edit_suborganization(organization_id));
create policy "app_suborganization_updates_insert" on public."app_suborganization_updates" for insert to PUBLIC with check (((created_by = auth.uid()) AND private.app_can_edit_suborganization(organization_id)));
create policy "app_suborganization_updates_read" on public."app_suborganization_updates" for select to PUBLIC using ((EXISTS ( SELECT 1
   FROM app_suborganizations o
  WHERE ((o.id = app_suborganization_updates.organization_id) AND private.app_is_workspace_member(o.workspace_id)))));
create policy "app_suborganization_updates_update" on public."app_suborganization_updates" for update to PUBLIC using (private.app_can_edit_suborganization(organization_id)) with check (private.app_can_edit_suborganization(organization_id));
revoke all privileges on table public."app_suborganization_updates" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganization_updates" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganization_updates" to "service_role";

-- Restore app_suborganization_weekly_reports
alter table public."app_suborganization_weekly_reports" enable row level security;
alter table public."app_suborganization_weekly_reports" no force row level security;
drop policy if exists "app_suborganization_weekly_reports_delete" on public."app_suborganization_weekly_reports";
drop policy if exists "app_suborganization_weekly_reports_insert" on public."app_suborganization_weekly_reports";
drop policy if exists "app_suborganization_weekly_reports_read" on public."app_suborganization_weekly_reports";
drop policy if exists "app_suborganization_weekly_reports_update" on public."app_suborganization_weekly_reports";
create policy "app_suborganization_weekly_reports_delete" on public."app_suborganization_weekly_reports" for delete to PUBLIC using (private.app_can_edit_suborganization(organization_id));
create policy "app_suborganization_weekly_reports_insert" on public."app_suborganization_weekly_reports" for insert to PUBLIC with check (((created_by = auth.uid()) AND private.app_can_edit_suborganization(organization_id)));
create policy "app_suborganization_weekly_reports_read" on public."app_suborganization_weekly_reports" for select to PUBLIC using ((EXISTS ( SELECT 1
   FROM app_suborganizations o
  WHERE ((o.id = app_suborganization_weekly_reports.organization_id) AND private.app_is_workspace_member(o.workspace_id)))));
create policy "app_suborganization_weekly_reports_update" on public."app_suborganization_weekly_reports" for update to PUBLIC using (private.app_can_edit_suborganization(organization_id)) with check (private.app_can_edit_suborganization(organization_id));
revoke all privileges on table public."app_suborganization_weekly_reports" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganization_weekly_reports" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganization_weekly_reports" to "service_role";

-- Restore app_suborganizations
alter table public."app_suborganizations" enable row level security;
alter table public."app_suborganizations" no force row level security;
drop policy if exists "app_suborganizations_assignee_update" on public."app_suborganizations";
drop policy if exists "app_suborganizations_delete" on public."app_suborganizations";
drop policy if exists "app_suborganizations_insert" on public."app_suborganizations";
drop policy if exists "app_suborganizations_read" on public."app_suborganizations";
drop policy if exists "app_suborganizations_update" on public."app_suborganizations";
create policy "app_suborganizations_assignee_update" on public."app_suborganizations" for update to "authenticated" using (private.app_can_edit_suborganization(id)) with check (private.app_can_edit_suborganization(id));
create policy "app_suborganizations_delete" on public."app_suborganizations" for delete to "authenticated" using (((created_by = ( SELECT auth.uid() AS uid)) OR private.app_is_workspace_admin(workspace_id)));
create policy "app_suborganizations_insert" on public."app_suborganizations" for insert to "authenticated" with check (((created_by = ( SELECT auth.uid() AS uid)) AND (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 20)));
create policy "app_suborganizations_read" on public."app_suborganizations" for select to "authenticated" using (private.app_is_workspace_member(workspace_id));
create policy "app_suborganizations_update" on public."app_suborganizations" for update to "authenticated" using (((created_by = ( SELECT auth.uid() AS uid)) OR private.app_is_workspace_admin(workspace_id))) with check (((created_by = ( SELECT auth.uid() AS uid)) OR private.app_is_workspace_admin(workspace_id)));
revoke all privileges on table public."app_suborganizations" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganizations" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_suborganizations" to "service_role";

-- Restore app_tasks
alter table public."app_tasks" enable row level security;
alter table public."app_tasks" no force row level security;
drop policy if exists "app_tasks_scoped_delete" on public."app_tasks";
drop policy if exists "app_tasks_scoped_insert" on public."app_tasks";
drop policy if exists "app_tasks_scoped_read" on public."app_tasks";
drop policy if exists "app_tasks_scoped_update" on public."app_tasks";
create policy "app_tasks_scoped_delete" on public."app_tasks" for delete to "authenticated" using ((((project_id IS NULL) AND (assignee_id = auth.uid())) OR ((project_id IS NOT NULL) AND ((created_by = auth.uid()) OR (assignee_id = auth.uid()) OR private.app_can_manage_space(project_id)))));
create policy "app_tasks_scoped_insert" on public."app_tasks" for insert to "authenticated" with check (((created_by = auth.uid()) AND (private.app_role_rank(private.app_workspace_role(workspace_id)) >= 20) AND ((project_id IS NULL) OR private.app_can_edit_space(project_id)) AND private.app_space_in_workspace(project_id, workspace_id) AND private.app_workstream_in_context(workstream_id, project_id, workspace_id) AND private.app_user_in_workspace(assignee_id, workspace_id) AND ((COALESCE(source_type, 'manual'::text) = 'manual'::text) OR ((source_type = 'meeting'::text) AND (source_id IS NOT NULL) AND private.app_meeting_in_workspace(source_id, workspace_id) AND (EXISTS ( SELECT 1
   FROM app_meetings m
  WHERE ((m.id = app_tasks.source_id) AND ((m.created_by = auth.uid()) OR (private.app_role_rank(private.app_workspace_role(m.workspace_id)) >= 30)))))) OR ((source_type = 'project'::text) AND (project_id IS NOT NULL) AND private.app_can_edit_space(project_id)))));
create policy "app_tasks_scoped_read" on public."app_tasks" for select to "authenticated" using ((private.app_is_workspace_member(workspace_id) AND (((project_id IS NULL) AND (assignee_id = auth.uid())) OR ((project_id IS NOT NULL) AND private.app_can_view_space(project_id)))));
create policy "app_tasks_scoped_update" on public."app_tasks" for update to "authenticated" using ((((project_id IS NULL) AND (assignee_id = auth.uid())) OR ((project_id IS NOT NULL) AND private.app_can_view_space(project_id) AND ((created_by = auth.uid()) OR (assignee_id = auth.uid()) OR private.app_can_edit_space(project_id))))) with check ((private.app_space_in_workspace(project_id, workspace_id) AND private.app_workstream_in_context(workstream_id, project_id, workspace_id) AND private.app_user_in_workspace(assignee_id, workspace_id) AND (((project_id IS NULL) AND (assignee_id = auth.uid())) OR ((project_id IS NOT NULL) AND private.app_can_view_space(project_id) AND ((created_by = auth.uid()) OR (assignee_id = auth.uid()) OR private.app_can_edit_space(project_id))))));
revoke all privileges on table public."app_tasks" from PUBLIC, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, SELECT, UPDATE on table public."app_tasks" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_tasks" to "service_role";

-- Restore app_workspace_members
alter table public."app_workspace_members" enable row level security;
alter table public."app_workspace_members" no force row level security;
drop policy if exists "app_members_owner_delete_guard" on public."app_workspace_members";
drop policy if exists "app_members_read" on public."app_workspace_members";
create policy "app_members_owner_delete_guard" on public."app_workspace_members" for delete to "authenticated" using (((user_id <> ( SELECT auth.uid() AS uid)) AND (role <> 'owner'::text) AND (private.app_workspace_role(workspace_id) = 'owner'::text)));
create policy "app_members_read" on public."app_workspace_members" for select to "authenticated" using (private.app_is_workspace_member(workspace_id));
revoke all privileges on table public."app_workspace_members" from PUBLIC, anon, authenticated, service_role;
grant DELETE, SELECT on table public."app_workspace_members" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_workspace_members" to "service_role";

-- Restore app_workspaces
alter table public."app_workspaces" enable row level security;
alter table public."app_workspaces" no force row level security;
drop policy if exists "app_workspaces_member_read" on public."app_workspaces";
create policy "app_workspaces_member_read" on public."app_workspaces" for select to "authenticated" using (private.app_is_workspace_member(id));
revoke all privileges on table public."app_workspaces" from PUBLIC, anon, authenticated, service_role;
grant SELECT on table public."app_workspaces" to "authenticated";
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public."app_workspaces" to "service_role";

create or replace function private.app_is_workspace_admin(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(private.app_role_rank((select m.role from public.app_workspace_members m where m.workspace_id=p_workspace and m.user_id=auth.uid())) >= 40, false)
$$;
revoke all on function private.app_is_workspace_admin(uuid) from PUBLIC, anon, authenticated, service_role;
grant execute on function private.app_is_workspace_admin(uuid) to anon, authenticated;

create or replace function public.app_can_edit_page_rpc(p_page uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.app_can_edit_page(p_page)
$$;

create or replace function public.app_create_invite(
  p_role text default 'viewer'::text,
  p_group uuid default null::uuid,
  p_expires_at timestamptz default (now() + interval '7 days')
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_workspace uuid; v_token text;
begin
  select m.workspace_id into v_workspace
  from public.app_workspace_members m
  where m.user_id=auth.uid() and m.role in ('owner','admin')
  order by case m.role when 'owner' then 1 else 2 end limit 1;
  if v_workspace is null then raise exception 'admin permission required'; end if;
  if p_role not in ('editor','author','viewer') then raise exception 'invalid role'; end if;
  if p_group is not null and not exists(select 1 from public.app_groups g where g.id=p_group and g.workspace_id=v_workspace) then raise exception 'invalid group'; end if;
  v_token := encode(extensions.gen_random_bytes(24),'hex');
  insert into public.app_invites(workspace_id,group_id,token_hash,role,expires_at,created_by)
  values(v_workspace,p_group,encode(extensions.digest(v_token::bytea,'sha256'),'hex'),p_role,p_expires_at,auth.uid());
  return v_token;
end
$$;

create or replace function public.app_delete_pages(p_page_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  requested_count integer;
  existing_count integer;
  deleted_count integer;
begin
  if p_page_ids is null or cardinality(p_page_ids)=0 then
    return 0;
  end if;
  select count(distinct x) into requested_count from unnest(p_page_ids) x;
  select count(*) into existing_count from public.app_pages p where p.id=any(p_page_ids);
  if existing_count <> requested_count then raise exception '삭제할 페이지를 찾을 수 없습니다.'; end if;
  if exists (
    select 1 from public.app_pages p
    where p.id=any(p_page_ids) and not private.app_can_manage_page(p.id)
  ) then raise exception '삭제 권한이 없는 페이지가 포함되어 있습니다.'; end if;
  delete from public.app_pages p where p.id=any(p_page_ids);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;

create or replace function public.app_open_share(p_token text)
returns table(id uuid, slug text, title text, summary text, body text, content_format text, updated_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select p.id,p.slug,p.title,p.summary,p.body,p.content_format,p.updated_at
  from public.app_share_links s join public.app_pages p on p.id=s.page_id
  where s.token_hash=encode(extensions.digest(p_token::bytea,'sha256'),'hex')
    and s.revoked_at is null and (s.expires_at is null or s.expires_at>now())
  limit 1
$$;

create or replace function public.app_save_page_v2(
  p_id uuid, p_workspace uuid, p_space uuid, p_title text, p_slug text,
  p_summary text, p_body text, p_status text, p_visibility text
)
returns app_pages
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_page public.app_pages;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  select role into v_role from public.app_workspace_members where workspace_id=p_workspace and user_id=v_uid;
  if private.app_role_rank(v_role) < 20 then raise exception '페이지 작성 권한이 없습니다.'; end if;
  if p_title is null or btrim(p_title)='' then raise exception '제목을 입력해 주세요.'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]*$' then raise exception '공유 URL 이름은 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.'; end if;
  if p_status not in ('draft','review','published','archived') then raise exception '게시 상태가 올바르지 않습니다.'; end if;
  if p_visibility not in ('public','unlisted','workspace','groups','private') then raise exception '공개 범위가 올바르지 않습니다.'; end if;
  if p_space is not null then
    if not exists(select 1 from public.app_spaces s where s.id=p_space and s.workspace_id=p_workspace) then raise exception '프로젝트가 올바르지 않습니다.'; end if;
    if not private.app_can_edit_space(p_space) then raise exception '해당 프로젝트에 페이지를 작성할 권한이 없습니다.'; end if;
  end if;
  if p_id is null then
    insert into public.app_pages(workspace_id,space_id,slug,title,summary,body,content_format,visibility,status,owner_id,published_at)
    values(p_workspace,p_space,p_slug,btrim(p_title),nullif(btrim(coalesce(p_summary,'')),''),coalesce(p_body,''),'markdown',p_visibility,p_status,v_uid,case when p_status='published' then now() else null end)
    returning * into v_page;
  else
    if not private.app_can_edit_page(p_id) then raise exception '페이지 수정 권한이 없습니다.'; end if;
    update public.app_pages
       set space_id=p_space, slug=p_slug, title=btrim(p_title), summary=nullif(btrim(coalesce(p_summary,'')),''), body=coalesce(p_body,''), content_format='markdown', visibility=p_visibility, status=p_status,
           published_at=case when p_status='published' then coalesce(published_at,now()) else published_at end
     where id=p_id and workspace_id=p_workspace
     returning * into v_page;
    if v_page.id is null then raise exception '페이지를 찾을 수 없습니다.'; end if;
  end if;
  return v_page;
exception when unique_violation then
  raise exception '같은 공유 URL 이름이 이미 사용 중입니다. 다른 이름을 입력해 주세요.';
end
$$;

create or replace function public.app_set_workspace_member_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_actor_role text;
  v_target_role text;
begin
  select workspace_id, role into v_workspace, v_actor_role
  from public.app_workspace_members
  where user_id = v_actor
  order by created_at asc limit 1;
  if v_workspace is null or v_actor_role not in ('owner','admin') then raise exception '구성원 관리 권한이 없습니다.'; end if;
  select role into v_target_role from public.app_workspace_members
  where workspace_id = v_workspace and user_id = p_user;
  if v_target_role is null then raise exception '해당 구성원을 찾을 수 없습니다.'; end if;
  if p_user = v_actor then raise exception '본인 권한은 변경할 수 없습니다.'; end if;
  if v_target_role = 'owner' then raise exception '소유자 권한은 변경할 수 없습니다.'; end if;
  if p_role not in ('admin','editor','author','viewer') then raise exception '변경할 수 없는 권한입니다.'; end if;
  if v_actor_role = 'admin' and (v_target_role = 'admin' or p_role = 'admin') then raise exception '관리자 지정·해제는 소유자만 할 수 있습니다.'; end if;
  update public.app_workspace_members set role = p_role
  where workspace_id = v_workspace and user_id = p_user;
  return jsonb_build_object('ok',true,'role',p_role);
end
$$;

create or replace function public.app_update_event_body(p_event uuid, p_body text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_workspace uuid;
  v_project uuid;
  v_scope text;
  v_created_by uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  select e.workspace_id, e.project_id, e.calendar_scope, e.created_by
    into v_workspace, v_project, v_scope, v_created_by
  from public.app_events e where e.id = p_event;
  if v_workspace is null then raise exception 'not allowed'; end if;
  if not (
    (v_scope = 'personal' and v_created_by = v_uid)
    or (v_scope = 'team' and (
      (v_project is null and (v_created_by = v_uid or private.app_role_rank(private.app_workspace_role(v_workspace)) >= 30))
      or (v_project is not null and (v_created_by = v_uid or private.app_can_edit_space(v_project)))
    ))
  ) then raise exception 'not allowed'; end if;
  update public.app_events set body = coalesce(p_body,''), updated_at = now() where id = p_event;
  return true;
end
$$;

grant execute on function public.app_accept_invite(text) to authenticated;
grant execute on function public.app_claim_owner(text,text) to authenticated;
grant execute on function public.app_request_workspace_access(text) to authenticated;
grant execute on function public.app_respond_project_invitation(uuid,boolean) to authenticated;
grant execute on function public.app_public_workspace_snapshot() to authenticated;

drop function if exists private.app_is_owner_conversation(uuid);
drop function if exists private.app_is_owner_workplace(uuid);
drop function if exists private.app_is_owner_profile(uuid);
drop function if exists private.app_is_owner_organization(uuid);
drop function if exists private.app_is_owner_event(uuid);
drop function if exists private.app_is_owner_document(uuid);
drop function if exists private.app_is_workspace_owner(uuid);

commit;
