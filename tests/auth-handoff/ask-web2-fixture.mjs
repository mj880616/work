// Synthetic stand-ins for ASK-Web2 DB tests (no production connection, no real data).
// Same columns as search-attachment-text.test.mjs plus the call/telegram feed tables the search function reads,
// and the personal call box / personal telegram tables that it must never read.
import {OWNER} from './basket4-fixture.mjs';
const owned=['app_spaces','app_meetings','app_documents','app_project_progress_updates','app_project_milestones','app_suborganization_updates',
  'app_suborganization_timeline','app_feed_items','app_call_edits','app_feed_summary_edits','app_feed_room_days','app_call_personal','app_tg_personal_days'];
export const askSchema=`
  alter table public.app_spaces add column owner_id uuid default '${OWNER}', add column name text, add column parent_id uuid,
    add column status text default 'active', add column metadata jsonb default '{"project_system":"v2"}', add column updated_at timestamptz default now();
  alter table public.app_suborganizations add column aliases text[] default '{}', add column description text, add column updated_at timestamptz default now();
  alter table public.app_meetings add column series_name text, add column meeting_at timestamptz, add column transcript_text text, add column decisions text,
    add column created_at timestamptz not null default now(), add column project_id uuid;
  create table public.app_documents(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), title text, file_name text, source text,
    category text, tags text[], description text, document_date date, created_at timestamptz not null default now(), project_id uuid, organization_id uuid,
    visibility text default 'private', extracted_text text, extraction_status text, extraction_error text, extracted_at timestamptz);
  create table public.app_project_progress_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
    workstream_id uuid, effective_on date, status_label text, summary text, next_step text);
  create table public.app_project_milestones(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
    title text, status text, start_at timestamptz);
  create table public.app_suborganization_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, organization_id uuid not null,
    raw_text text, detail_text text, occurred_at timestamptz);
  create table public.app_suborganization_timeline(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, organization_id uuid not null,
    event_year integer, event_date date, title text, summary text);
  create table public.app_feed_items(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    source text not null check (source in ('call','telegram')), day date not null, occurred_at timestamptz not null, room_key text, room_label text,
    title text, summary text, points jsonb not null default '[]', counterpart text, raw_text text, organization_id uuid, project_id uuid,
    hidden_at timestamptz, archived_at timestamptz);
  create table public.app_call_edits(call_id uuid primary key, workspace_id uuid not null, vals jsonb not null default '{}');
  create table public.app_feed_summary_edits(workspace_id uuid not null, target text not null, vals jsonb not null default '{}', primary key (workspace_id, target));
  create table public.app_feed_room_days(workspace_id uuid not null, room_key text not null, day date not null, parts jsonb not null default '[]',
    hidden_at timestamptz, primary key (workspace_id, room_key, day));
  create table public.app_call_personal(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, kind text, day date, occurred_at timestamptz,
    title text, summary text, points jsonb default '[]', counterpart text, raw_text text, hidden_at timestamptz);
  create table public.app_tg_personal_days(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, room_label text, day date, one_line text);
  ${owned.map(t=>`
  grant select on public.${t} to authenticated;
  alter table public.${t} enable row level security;
  create policy synthetic_owner on public.${t} for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`).join('')}
  grant select on public.app_suborganizations to authenticated;
`;
// Migrations the search function chain needs (same list as search-attachment-text.test.mjs, then that migration itself).
export const askChain=['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql','20261010120000_basket1_notes_links.sql',
  '20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql','20261013034836_basket_photo_ocr_db.sql','20261017052234_journal_memo_notes_kind.sql',
  '20261020051027_journal_work_lines.sql','20261022150000_search_records.sql','20261023013000_search_attachment_text.sql'];
