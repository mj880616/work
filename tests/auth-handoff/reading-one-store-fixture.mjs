// S68-27 READ-보관기록일원화 DB 시험의 바탕 schema(합성, 운영 자료 없음). news-outside-retention-db.test.mjs와 같은 차례로
// News 공용 기사·사회운동 글·보관 기간 정리(20261120130000)까지 올리고, 읽을 거리 표(20261122100000)의 표·밑줄 검사 부분만 더한다
// (그 migration의 검색 함수 부분은 이 시험과 무관해서 뺀다 — 기록 1행은 넣어 사전 조건을 맞춘다).
// setupSteps(read)는 차례대로 실행할 SQL 글 목록을 돌려준다. pg 없이도(SQL만) 쓸 수 있다.
import {fixture,OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';

export const prerequisites = `
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  alter table auth.users add column email text;
  insert into auth.users(id,email) values ('${OWNER}','op@example.test'),('${STRANGER}','b@example.test');
  create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    raw_text text not null, kind text not null default 'note', metadata jsonb not null default '{}'::jsonb, deleted_at timestamptz);
  alter table public.app_notes enable row level security;
  revoke all on table public.app_notes from public, anon, authenticated, service_role;
  create table public.app_workspace_signup_allow(email text primary key, kind text not null, created_at timestamptz not null default now(),
    constraint app_workspace_signup_allow_kind check (kind in ('operator','blocked')));
  alter table public.app_workspace_signup_allow enable row level security;
  revoke all on table public.app_workspace_signup_allow from public, anon, authenticated, service_role;
  insert into supabase_migrations.schema_migrations(version,name) values ('20261113140000','workspace_signup_allow');`;

const BEFORE = ['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
  '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
  '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];
const MIDDLE = ['20261028160000_ai_usage_costs','20261031120000_gdrive_photo_index','20261102160000_cloud_files_index','20261103100000_dev_inbox_feature',
  '20261030060000_tg_room_pin','20261105100000_family_notes','20261101233000_news_clipping','20261108140000_news_titles_tried',
  '20261031230000_outside_statements','20261102150000_outside_search_undated','20261108020000_outside_post_body_ko','20261102140000_now_detail','20261106050000_feed_bodies',
  '20261108070000_news_highlights'];
const NEWS = ['20261115100000_news_for_all','20261115140000_news_for_all_refs','20261115150000_outside_for_all','20261115230000_news_user_save','20261119000000_news_hand_fill'];

export async function setupSteps(read) {
  const mig = f => read('supabase/migrations/' + f + '.sql');
  const steps = [fixture, prerequisites,
    'revoke usage on schema private from service_role',
    'grant select on public.app_spaces to authenticated',
    'alter table public.app_spaces enable row level security',
    'create policy fake_owner_read on public.app_spaces for select to authenticated using (private.app_is_workspace_owner(workspace_id))',
    `create table public.app_documents(id uuid primary key, workspace_id uuid not null, file_id text, extraction_status text, extracted_text text);
     alter table public.app_documents enable row level security;
     create policy fake_docs_owner on public.app_documents for select to authenticated using (private.app_is_workspace_owner(workspace_id));
     grant select on public.app_documents to authenticated;`,
    `update public.app_workspaces set slug='kptu-work' where id='${WS_A}'`,
    `update public.app_workspaces set slug='other-work' where id='${WS_B}'`];
  for (const f of BEFORE.slice(0, -1)) steps.push(await mig(f));
  steps.push(`insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values('${WS_A}','call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:uc1')`);
  steps.push(await mig(BEFORE.at(-1)));
  for (const f of MIDDLE) steps.push(await mig(f));
  const reads = await mig('20261106080000_feed_reads_news_prefs');
  steps.push(reads.slice(reads.indexOf('create table public.app_feed_reads ('), reads.indexOf('alter table public.app_profiles drop constraint')));
  steps.push("insert into supabase_migrations.schema_migrations(version,name) values ('20261106080000','feed_reads_news_prefs')");
  for (const f of NEWS) steps.push(await mig(f));
  steps.push(await mig('20261120130000_news_outside_retention'));
  // 'outside' 기능 키를 허용 표가 받게(운영 migration 20261111… arsenal_outside_features와 같은 값 목록의 합성판).
  steps.push(`alter table public.app_operator_features drop constraint app_operator_features_feature_check;
    alter table public.app_operator_features add constraint app_operator_features_feature_check check (feature in ('calls','telegram','gdrive_photos','files','dev_inbox','family','outside'))`);
  const reading = await mig('20261122100000_reading_items');
  steps.push(reading.slice(reading.indexOf('create table public.app_reading_items ('), reading.indexOf('-- 3) 전체 검색.')));
  steps.push("insert into supabase_migrations.schema_migrations(version,name) values ('20261122100000','reading_items')");
  return steps;
}
