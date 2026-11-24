begin;
-- S69 STORE-계정삭제(구글 플레이 정책: 앱 안에서 계정 삭제 시작 + 앱 밖 웹 주소). 설계는 PR 본문과 docs/design/account-delete.md.
-- 바꾸는 것: 새 표 1개(app_account_delete_runs, 실행 중에만 한 줄이 생겼다 바로 지워짐), 새 함수 3개
--   (공개 RPC app_account_delete_check·app_account_delete, private 트리거 함수 app_account_delete_run), 트리거 1개.
--   기존 표·정책·권한·자료 정의는 한 줄도 바꾸지 않는다(이 파일을 적용해도 아무 기록도 지워지지 않는다 — 지우는 것은 본인이 버튼을 누를 때뿐).
-- 누가: 로그인한 본인만, 자기 작업공간 하나만. 작업공간은 서버가 auth.uid()의 owner 행에서 찾는다(화면이 보낸 id는 받지 않는다 — 인자 없음).
--   위임 열쇠(바깥 앱 OAuth, jwt client_id)는 거절. 같은 작업공간에 다른 owner가 있으면 거절(남의 기록 보호).
--   운영자 작업공간(통화·텔레그램 허용 행)은 이 버튼으로 지우지 않는다(실수로 운영 기능 전체가 사라지는 것을 막음).
--   내가 관리자인 묶음에 다른 멤버가 있으면 거절(지금 [묶음 나가기]와 같은 규칙: 관리자를 먼저 넘긴다).
-- 무엇을: 내 작업공간의 기록 전부(작업공간 행을 지우면 on delete cascade로 딸린 표가 함께 지워진다) + 작업공간 칸이 없는 내 표
--   (프로필·구글 캘린더 연결·구글 연결 시도·잠금 PIN·읽은 소식·보낸 의견 등 user_id 표) + 내 묶음 자리(혼자인 묶음은 묶음째, 남이 있는
--   묶음은 내 멤버 줄만 빼고 '나감' 한 줄 — 남의 멤버 줄·기록은 그대로). 구글 드라이브 연결 토큰은 작업공간 표라 함께 지워진다.
--   남기는 것: Auth 로그인 계정(같은 Auth를 쓰는 다른 서비스 자료 보호 — 1차는 'WORK ON+ 데이터 삭제 + 로그아웃'), 구글 쪽 원본.
-- 휴지통 가로채기 트리거들은 '다른 삭제에 딸린 삭제(트리거 깊이 2 이상)'는 그대로 지우게 되어 있다. 그래서 모든 지우기를
--   app_account_delete_runs의 BEFORE INSERT 트리거 안에서 한다(휴지통으로 가지 않고 실제로 지워짐, 폴더 '위로 올리기'도 건너뜀).
-- 사진 파일(공유 페이지 사진·일정 사진 버킷)은 DB가 지울 수 없어 지운 파일 경로 목록만 돌려준다 → Edge 함수 account-delete가
--   서버 키로 그 경로만 지운다. 경로는 내 작업공간의 페이지·일정 id로 시작하는 것만 모은다(남의 파일 경로가 섞이지 않게).
-- 어디까지 지워지는지 미리 보기: app_account_delete_check()가 같은 지우기를 끝까지 해 본 뒤 되돌려 결과(ok/거절 이유)만 돌려준다.
-- 운영자도 지운 내용을 보지 않는다: 복구용 사본을 만들지 않는다(실행 줄은 지우고 끝나며 누구·무엇을 남기지 않는다).
--   매일 DB 백업(기존 정책: 최근 30개 + 달마다 1개 12달)에는 보관 기간 동안 남는다 — 화면·안내 페이지에 적는다.
-- 짝: docs/20261124130000_account_delete.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261124130000')
     or to_regclass('public.app_account_delete_runs') is not null
     or to_regprocedure('public.app_account_delete_check()') is not null
     or to_regprocedure('public.app_account_delete(text)') is not null
     or to_regprocedure('private.app_account_delete_run()') is not null
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261118110000' and name = 'collab_groups') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_workspace_members') is null
     or to_regclass('public.app_operator_features') is null
     or to_regclass('public.app_share_pages') is null
     or to_regclass('public.app_share_page_media') is null
     or to_regclass('public.app_collab_members') is null
     or (select count(*) from pg_attribute a where not a.attisdropped and a.atttypid = 'uuid'::regtype and (
            (a.attrelid = 'public.app_workspace_members'::regclass and a.attname in ('workspace_id', 'user_id'))
         or (a.attrelid = 'public.app_share_page_media'::regclass and a.attname in ('workspace_id', 'page_id'))
         or (a.attrelid = 'public.app_share_pages'::regclass and a.attname = 'workspace_id'))) <> 5
     or to_regprocedure('auth.jwt()') is null then
    raise exception 'ACCOUNT_DELETE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 실행 줄: 지우기 한 번 = 한 줄. 넣는 순간 트리거가 지우기를 하고, 공개 함수가 바로 그 줄을 지운다(남는 줄 없음).
-- 누구·어느 작업공간 칸이 없다(트리거가 auth.uid()로만 정함). files는 지운 사진 파일 경로(버킷·경로)뿐.
create table public.app_account_delete_runs (
  id uuid primary key default gen_random_uuid(),
  probe boolean not null,
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint app_account_delete_runs_files_check check (jsonb_typeof(files) = 'array')
);
alter table public.app_account_delete_runs enable row level security;
revoke all on table public.app_account_delete_runs from public, anon, authenticated, service_role;

-- 지우기 본체(BEFORE INSERT 트리거). 실행권은 아무에게도 없다(트리거로만 돈다).
create function private.app_account_delete_run()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ws uuid;
  v_files jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'ACCOUNT_AUTH_REQUIRED';
  end if;
  -- 바깥 앱에 내준 위임 열쇠로는 지우지 않는다(본인 로그인 열쇠만).
  if coalesce((select auth.jwt()) ->> 'client_id', '') <> '' then
    raise exception using errcode = '42501', message = 'ACCOUNT_DELEGATED_REFUSED';
  end if;
  if (select count(*) from public.app_workspace_members m where m.user_id = v_uid and m.role = 'owner') <> 1 then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_WORKSPACE_REQUIRED';
  end if;
  select m.workspace_id into v_ws from public.app_workspace_members m where m.user_id = v_uid and m.role = 'owner';
  if v_ws is null then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_WORKSPACE_REQUIRED';
  end if;
  perform 1 from public.app_workspaces w where w.id = v_ws for update;
  if exists (select 1 from public.app_workspace_members m where m.workspace_id = v_ws and m.role = 'owner' and m.user_id <> v_uid) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_WORKSPACE_SHARED';
  end if;
  if exists (select 1 from public.app_operator_features f where f.workspace_id = v_ws and f.feature in ('calls', 'telegram')) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_OPERATOR_KEEP';
  end if;
  if exists (select 1 from public.app_collab_members m
              where m.user_id = v_uid and m.member_role = 'admin'
                and exists (select 1 from public.app_collab_members o where o.group_id = m.group_id and o.user_id <> v_uid)) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_GROUP_ADMIN_MOVE';
  end if;

  -- 사진 파일 경로(지우기 전에 모은다). 내 작업공간 페이지·일정 id로 시작하는 경로만.
  v_files := coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('b', 'share-page-media', 'p', m.storage_path) order by m.storage_path)
      from public.app_share_page_media m
      join public.app_share_pages p on p.id = m.page_id
     where m.workspace_id = v_ws and p.workspace_id = v_ws
       and pg_catalog.starts_with(m.storage_path, p.id::text || '/')), '[]'::jsonb);
  if to_regclass('public.app_event_photos') is not null and to_regclass('public.app_events') is not null then
    v_files := v_files || coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('b', 'team-event-media', 'p', x.path) order by x.path)
        from (select ph.storage_path as path from public.app_event_photos ph join public.app_events e on e.id = ph.event_id
               where e.workspace_id = v_ws and ph.storage_path is not null and pg_catalog.starts_with(ph.storage_path, e.id::text || '/')
              union
              select ph.thumb_path from public.app_event_photos ph join public.app_events e on e.id = ph.event_id
               where e.workspace_id = v_ws and ph.thumb_path is not null and pg_catalog.starts_with(ph.thumb_path, e.id::text || '/')) x), '[]'::jsonb);
  end if;

  -- 묶음: 나 혼자인 묶음은 묶음째(초대·요청·기록 cascade), 남이 있는 묶음은 내 멤버 줄만 빼고 '나감' 한 줄(지금 [묶음 나가기]와 같음).
  delete from public.app_collab_groups g
   where g.id in (select m.group_id from public.app_collab_members m where m.user_id = v_uid)
     and not exists (select 1 from public.app_collab_members o where o.group_id = g.id and o.user_id <> v_uid);
  insert into public.app_collab_member_log (group_id, user_id, event)
    select m.group_id, v_uid, 'leave' from public.app_collab_members m where m.user_id = v_uid;
  delete from public.app_collab_members m where m.user_id = v_uid;
  delete from public.app_collab_join_requests r where r.requester_user_id = v_uid;
  delete from public.app_collab_invites i where i.created_by = v_uid;
  delete from public.app_collab_join_attempts a where a.user_id = v_uid;

  -- 작업공간 칸이 없는(또는 작업공간에 묶이지 않은) 내 표: user_id = 나. 표가 없는 운영이면 건너뛴다.
  if to_regclass('public.app_feedback') is not null then
    delete from public.app_feedback t where t.user_id = v_uid or t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_feature_locks') is not null then
    delete from public.app_feature_locks t where t.user_id = v_uid;
  end if;
  if to_regclass('public.app_note_folder_locks') is not null then
    delete from public.app_note_folder_locks t where t.user_id = v_uid;
  end if;
  if to_regclass('public.app_update_news_reads') is not null then
    delete from public.app_update_news_reads t where t.user_id = v_uid;
  end if;
  if to_regclass('public.app_google_calendar_connections') is not null then
    delete from public.app_google_calendar_connections t where t.user_id = v_uid;
  end if;
  if to_regclass('public.app_google_oauth_states') is not null then
    delete from public.app_google_oauth_states t where t.user_id = v_uid;
  end if;
  if to_regclass('public.app_drive_download_tokens') is not null then
    delete from public.app_drive_download_tokens t where t.user_id = v_uid;
  end if;
  if to_regclass('public.app_private_feature_access') is not null then
    delete from public.app_private_feature_access t where t.user_id = v_uid;
  end if;

  -- 작업공간 칸은 있지만 작업공간 행에 cascade로 묶이지 않은 표, 그리고 순서가 필요한 표(묶음 연결 restrict)를 먼저 지운다.
  if to_regclass('public.app_record_links') is not null then
    delete from public.app_record_links t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_document_date_fixes') is not null then
    delete from public.app_document_date_fixes t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_feed_entity_fixes') is not null then
    delete from public.app_feed_entity_fixes t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_outside_sentences') is not null then
    delete from public.app_outside_sentences t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_outside_summary_fixes') is not null then
    delete from public.app_outside_summary_fixes t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_outside_title_fixes') is not null then
    delete from public.app_outside_title_fixes t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_tg_day_senders') is not null then
    delete from public.app_tg_day_senders t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_onedrive_photos') is not null then
    delete from public.app_onedrive_photos t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_onedrive_folders') is not null then
    delete from public.app_onedrive_folders t where t.workspace_id = v_ws;
  end if;
  -- 저장소 migration 전부터 있던 작업공간 표(잎 → 뿌리 순서). 딸린 표는 그 표에서 cascade.
  if to_regclass('public.app_tasks') is not null then
    delete from public.app_tasks t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_events') is not null then
    delete from public.app_events t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_ai_conversations') is not null then
    delete from public.app_ai_conversations t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_ai_daily_usage') is not null then
    delete from public.app_ai_daily_usage t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_ai_workspace_settings') is not null then
    delete from public.app_ai_workspace_settings t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_direct_messages') is not null then
    delete from public.app_direct_messages t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_org_affiliation_tags') is not null then
    delete from public.app_org_affiliation_tags t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_invites') is not null then
    delete from public.app_invites t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_access_requests') is not null then
    delete from public.app_access_requests t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_groups') is not null then
    delete from public.app_groups t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_drive_settings') is not null then
    delete from public.app_drive_settings t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_pages') is not null then
    delete from public.app_pages t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_documents') is not null then
    delete from public.app_documents t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_meetings') is not null then
    delete from public.app_meetings t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_suborganizations') is not null then
    delete from public.app_suborganizations t where t.workspace_id = v_ws;
  end if;
  if to_regclass('public.app_spaces') is not null then
    delete from public.app_spaces t where t.workspace_id = v_ws;
  end if;
  -- 프로필(사람 표, 딸린 표는 프로필에서 cascade). 작업공간 연결 줄 → 작업공간 행(나머지 표는 on delete cascade).
  if to_regclass('public.app_profiles') is not null then
    delete from public.app_profiles t where t.user_id = v_uid;
  end if;
  delete from public.app_workspace_members m where m.workspace_id = v_ws;
  delete from public.app_workspaces w where w.id = v_ws;

  new.files := v_files;
  return new;
end
$$;
revoke all on function private.app_account_delete_run() from public, anon, authenticated, service_role;

create trigger app_account_delete_runs_run
before insert on public.app_account_delete_runs
for each row execute function private.app_account_delete_run();

-- 미리 보기: 같은 지우기를 끝까지 해 본 뒤 되돌린다. 돌려주는 것: {ok:true} 또는 {ok:false, code}(거절 이유 이름만).
create function public.app_account_delete_check()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text := '';
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'ACCOUNT_AUTH_REQUIRED';
  end if;
  begin
    insert into public.app_account_delete_runs (probe) values (true);
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_CHECK_DONE';
  exception when others then
    v_code := sqlerrm;
  end;
  if v_code = 'ACCOUNT_DELETE_CHECK_DONE' then
    return pg_catalog.jsonb_build_object('ok', true);
  end if;
  if v_code in ('ACCOUNT_DELEGATED_REFUSED', 'ACCOUNT_WORKSPACE_REQUIRED', 'ACCOUNT_WORKSPACE_SHARED', 'ACCOUNT_OPERATOR_KEEP', 'ACCOUNT_GROUP_ADMIN_MOVE') then
    return pg_catalog.jsonb_build_object('ok', false, 'code', v_code);
  end if;
  return pg_catalog.jsonb_build_object('ok', false, 'code', 'ACCOUNT_DELETE_UNAVAILABLE');
end
$$;
revoke all on function public.app_account_delete_check() from public, anon, authenticated, service_role;
grant execute on function public.app_account_delete_check() to authenticated;

-- 지우기: 확인 글자 '삭제'가 맞을 때만. 돌려주는 것: {ok:true, files:[{b,p}]}(Edge가 그 파일만 지운다).
create function public.app_account_delete(p_confirm text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_files jsonb;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'ACCOUNT_AUTH_REQUIRED';
  end if;
  if p_confirm is distinct from '삭제' then
    raise exception using errcode = '22023', message = 'ACCOUNT_CONFIRM_MISMATCH';
  end if;
  insert into public.app_account_delete_runs (probe) values (false) returning id, files into v_id, v_files;
  delete from public.app_account_delete_runs r where r.id = v_id;
  return pg_catalog.jsonb_build_object('ok', true, 'files', v_files);
end
$$;
revoke all on function public.app_account_delete(text) from public, anon, authenticated, service_role;
grant execute on function public.app_account_delete(text) to authenticated;

-- 사후 확인: 새 표 RLS 켬·정책 0·API 역할 권한 0·줄 0, 트리거 1개, 함수 DEFINER·빈 search_path·실행권 경계. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_account_delete_runs'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_account_delete_runs'::regclass)
     or has_table_privilege('anon', 'public.app_account_delete_runs', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_account_delete_runs', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_account_delete_runs', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from public.app_account_delete_runs) <> 0
     or (select count(*) from pg_trigger where tgrelid = 'public.app_account_delete_runs'::regclass and not tgisinternal) <> 1
     or (select count(*) from pg_proc where oid in (to_regprocedure('public.app_account_delete_check()'), to_regprocedure('public.app_account_delete(text)'),
           to_regprocedure('private.app_account_delete_run()')) and prosecdef and proconfig = array['search_path=""']) <> 3
     or has_function_privilege('anon', 'public.app_account_delete_check()', 'execute')
     or has_function_privilege('anon', 'public.app_account_delete(text)', 'execute')
     or has_function_privilege('service_role', 'public.app_account_delete(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_account_delete(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_account_delete_check()', 'execute')
     or has_function_privilege('authenticated', 'private.app_account_delete_run()', 'execute')
     or has_function_privilege('anon', 'private.app_account_delete_run()', 'execute')
     or has_function_privilege('service_role', 'private.app_account_delete_run()', 'execute') then
    raise exception 'ACCOUNT_DELETE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261124130000', 'account_delete', array['S69 STORE-계정삭제: app_account_delete_check/app_account_delete (self only, own workspace, trigger-depth delete, file paths for Edge), app_account_delete_runs (closed, empty)']);
commit;
