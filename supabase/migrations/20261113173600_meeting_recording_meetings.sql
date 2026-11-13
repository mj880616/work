begin;
-- S61-36 REC-상세녹음 ① DB. 회의(사업 보고) 상세 [녹음]으로 시작한 녹음이 어느 회의 것인지를 녹음(session) 하나에 한 행으로 서버에 남긴다.
-- 새로고침·창 닫기로 끊긴 녹음을 '끝나지 않은 녹음' 줄에서 [이어서 저장]·[이어 녹음]해도 Edge meeting-transcribe가 이 행을 보고
-- 같은 회의 '회의자료'에 붙인다(지금은 화면 메모리에만 있어 끊기면 회의 연결이 없어졌다). 기기에는 아무것도 남기지 않는다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 운영 적용 직전 정지.
--
-- 새 표 1개만: app_meeting_recording_meetings(session_id → meeting_id). 녹음 구간 표(app_meeting_recordings)·회의 표는 손대지 않는다
-- (구간마다 같은 회의를 되풀이해 적지 않고, 기존 표 권한을 넓히지 않으려고 따로 둔다).
-- 소유: 작업공간·만든 사람은 Edge가 로그인으로 정하고, 회의 id는 Edge가 부른 사람 로그인(owner RLS)으로 읽어 같은 작업공간 회의일 때만 넣는다.
-- 권한: RLS 켜짐, 정책 없음. anon·PUBLIC·authenticated 권한 없음(화면은 직접 읽지도 쓰지도 못함).
--   service_role(Edge meeting-transcribe만 씀): 읽기 + 넣기(칸 4개). 고치기·지우기 없음.
-- 회의를 영구 삭제하면 그 녹음의 회의 연결 행도 함께 지워진다(on delete cascade, 녹음·자료는 그대로). 작업공간 삭제도 같다.
-- 안 하는 것: 함수·트리거·기존 표·기존 자료 변경.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261113173600')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_meetings') is null
     or to_regclass('public.app_meeting_recordings') is null
     or to_regclass('public.app_meeting_recording_meetings') is not null then
    raise exception 'MEETING_RECORDING_MEETINGS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_meeting_recording_meetings (
  session_id uuid primary key,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  created_by uuid not null,
  meeting_id uuid not null references public.app_meetings(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index app_meeting_recording_meetings_meeting_idx on public.app_meeting_recording_meetings(meeting_id);
create index app_meeting_recording_meetings_ws_idx on public.app_meeting_recording_meetings(workspace_id);
alter table public.app_meeting_recording_meetings enable row level security;
revoke all on table public.app_meeting_recording_meetings from public, anon, authenticated, service_role;
grant select on table public.app_meeting_recording_meetings to service_role;
grant insert (session_id, workspace_id, created_by, meeting_id) on table public.app_meeting_recording_meetings to service_role;

-- 사후 확인: RLS 켜짐·정책 없음, anon·PUBLIC·authenticated 권한 없음, service_role은 읽기와 정한 칸 넣기만. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_meeting_recording_meetings'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or (select count(*) from pg_policy where polrelid = t) <> 0
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon|authenticated)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon|authenticated)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or has_table_privilege('authenticated', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('authenticated', t, 'select,insert,update,references')
     or not has_table_privilege('service_role', t, 'select')
     or has_table_privilege('service_role', t, 'insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('service_role', t, 'update')
     or not has_column_privilege('service_role', t, 'session_id', 'insert')
     or not has_column_privilege('service_role', t, 'meeting_id', 'insert')
     or has_column_privilege('service_role', t, 'created_at', 'insert') then
    raise exception 'MEETING_RECORDING_MEETINGS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261113173600', 'meeting_recording_meetings', array['S61-36 REC-상세녹음 ① DB: app_meeting_recording_meetings (session_id -> meeting_id, RLS on, no policies, no anon/authenticated, service_role select + 4-column insert, no update/delete, cascade on meeting/workspace delete)']);
commit;
