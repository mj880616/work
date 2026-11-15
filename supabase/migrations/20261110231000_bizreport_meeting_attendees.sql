begin;
-- S56-31 MTG-참석인원칸 (요청함 2026-11-10 09:40 '회의 결과 입력 칸에 참석인원 입력칸 하나', 09:57 명진 'A' = 글 한 줄 칸, 숫자·이름 같이).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
-- 선행: 20261023023500_bizreport_meeting_links(장소 칸 app_meetings.location — 이 칸의 본보기) 적용 뒤.
--
-- 무엇: 사업 보고 표(app_meetings)에 칸 하나와 검사 하나를 더한다(Expand만, 기존 칸·기록은 그대로).
--   attendees text null — [회의] 칸의 참석인원 한 줄(예 '12명 (위원장 외 11명)'). 비워도 됨, 장소 칸과 같이 200자 이하.
--   기존 행은 모두 null(지금 화면 그대로). 기본값 없음이라 표를 다시 쓰지 않는다.
-- 권한: 표 grant 변경 없음(기존 표 단위 권한 그대로 — 새 칸도 소유자만 읽고 씀). 정책·함수·트리거·색인 추가 없음. anon·PUBLIC 권한 없음.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다(pg_catalog만 읽는다).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261110231000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261023023500' and name = 'bizreport_meeting_links') <> 1
     or to_regclass('public.app_meetings') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_meetings'::regclass and not attisdropped
         and attname = 'location' and atttypid = 'text'::regtype)
     -- 새 칸·검사가 아직 없다.
     or exists (select 1 from pg_attribute where attrelid = 'public.app_meetings'::regclass and not attisdropped
         and attname = 'attendees')
     or exists (select 1 from pg_constraint where conrelid = 'public.app_meetings'::regclass
         and conname = 'app_meetings_attendees_length_check')
     -- app_meetings: RLS 켜짐, anon·PUBLIC 표 권한 없음.
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     -- 넓히는(permissive) 정책은 task12a 한 개 그대로(소유자만).
     or (select count(*) from pg_policy where polrelid = 'public.app_meetings'::regclass and polpermissive) <> 1
     or not exists (select 1 from pg_policy where polrelid = 'public.app_meetings'::regclass
         and polname = 'task12a_owner_all' and polpermissive and polcmd = '*'
         and polroles = array['authenticated'::regrole]::oid[]
         and regexp_replace(pg_get_expr(polqual, polrelid), '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id'
         and regexp_replace(pg_get_expr(polwithcheck, polrelid), '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id') then
    raise exception 'BIZREPORT_MEETING_ATTENDEES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_meetings
  add column attendees text,
  add constraint app_meetings_attendees_length_check check (attendees is null or char_length(attendees) <= 200);

-- 사후 확인: 권한 경계 그대로, 새 칸은 text·null 허용·기본값 없음·모두 null, 검사 하나, 넓히는 정책은 여전히 하나. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_meetings'::regclass and polpermissive) <> 1
     or (select count(*) from pg_attribute a
         where a.attrelid = 'public.app_meetings'::regclass and not a.attisdropped and a.attname = 'attendees'
           and a.atttypid = 'text'::regtype and not a.attnotnull and not a.atthasdef and a.attacl is null) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_meetings'::regclass
         and conname = 'app_meetings_attendees_length_check' and contype = 'c' and convalidated
         and regexp_replace(pg_get_constraintdef(oid), '[\s()]', '', 'g') = 'CHECKattendeesISNULLORchar_lengthattendees<=200') <> 1
     or exists (select 1 from public.app_meetings where attendees is not null) then
    raise exception 'BIZREPORT_MEETING_ATTENDEES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261110231000', 'bizreport_meeting_attendees', array['S56-31 MTG-참석인원칸: app_meetings.attendees text null + check (null or <= 200 chars), no grants/policies/functions/triggers/indexes']);
commit;
