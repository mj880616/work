begin;
-- ED③-1 DB (docs/design/unified-editor.md 11.3·11.4 순서 0): 새 편집기가 "서식까지" 저장할 칸을 세 표에 하나씩 더한다.
-- 노트·일기·업데이트(app_notes), 담당조직 기록(app_suborganization_updates), 프로젝트 기록(app_project_progress_updates).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: 세 표에 `doc jsonb`(비어 있음 = 서식 없는 옛 글) 칸 하나와 모양 검사 하나씩.
--   비어 있지 않으면 {"v":"ed1","doc":{"content":[…]}} 모양의 객체이고, 글자로 1 MiB(1,048,576바이트)까지.
--   설계 문서의 검사식은 모양이 틀려 속 칸이 비면 결과가 NULL이 되어 통과해 버린다({"v":"ed1"} 같은 값).
--   그래서 coalesce(…, false)로 감싸 그런 값도 거절한다(그 밖의 조건은 설계 그대로).
-- 글자 칸(raw_text, 프로젝트 기록은 summary)과 그 길이 검사는 그대로다. 글자가 계속 원본 사본이므로 검색·AI·업무일지·주간보고는 바뀌지 않는다.
-- 기존 행은 모두 doc 비어 있음으로 남는다(표를 다시 쓰지 않음, 기존 데이터 변경 없음).
-- 권한: 표 grant·정책·RLS·함수·트리거 변경 없음. 새 칸은 기존 표 단위 권한과 기존 소유자 정책 아래에 있다
--   (사전 확인: 세 표 모두 RLS 켜짐, anon·PUBLIC 권한·정책 없음, authenticated의 표 단위 읽기·넣기·고치기 권한이 이미 있음 = 칸 단위 권한 아님).
-- 기존 글 따로 보관(백업)은 이 파일에 넣지 않는다: 노트 화면 PR 직전 별도 migration으로 둔다(PR 본문 근거).
-- 짝 rollback은 어느 표든 doc이 있는 행이 있으면 멈춘다(서식이 사라지므로).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_notes in access exclusive mode;
lock table public.app_project_progress_updates in access exclusive mode;
lock table public.app_suborganization_updates in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록 없음, 앞선 기록 있음, 세 표가 있고 글자 칸이 text,
-- doc 칸·검사 이름이 아직 없음, RLS 켜짐, anon·PUBLIC 표 권한·정책 없음, authenticated 표 단위 권한(읽기·넣기·고치기) 있음,
-- 노트 표는 지금 모양(소유자 정책 notes_owner_all 하나, 검증된 본문 검사).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023233000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261023180000' and name = 'profile_view_prefs') <> 1
     or to_regclass('public.app_notes') is null
     or to_regclass('public.app_suborganization_updates') is null
     or to_regclass('public.app_project_progress_updates') is null
     or (select count(*) from pg_attribute where attnum > 0 and not attisdropped and atttypid = 'text'::regtype
           and ((attrelid = 'public.app_notes'::regclass and attname = 'raw_text')
             or (attrelid = 'public.app_suborganization_updates'::regclass and attname = 'raw_text')
             or (attrelid = 'public.app_project_progress_updates'::regclass and attname = 'summary'))) <> 3
     or exists (select 1 from pg_attribute where attname = 'doc' and not attisdropped
           and attrelid in ('public.app_notes'::regclass, 'public.app_suborganization_updates'::regclass, 'public.app_project_progress_updates'::regclass))
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace
           and conname in ('app_notes_doc_check', 'app_suborganization_updates_doc_check', 'app_project_progress_updates_doc_check'))
     or exists (select 1 from pg_class where relrowsecurity = false
           and oid in ('public.app_notes'::regclass, 'public.app_suborganization_updates'::regclass, 'public.app_project_progress_updates'::regclass))
     or exists (select 1 from pg_class where relacl::text ~ '(^|[{,])(anon)?='
           and oid in ('public.app_notes'::regclass, 'public.app_suborganization_updates'::regclass, 'public.app_project_progress_updates'::regclass))
     or exists (select 1 from pg_policy
           where polrelid in ('public.app_notes'::regclass, 'public.app_suborganization_updates'::regclass, 'public.app_project_progress_updates'::regclass)
             and (polroles @> array[0::oid] or polroles @> array['anon'::regrole::oid]))
     or exists (select 1 from pg_class
           where oid in ('public.app_notes'::regclass, 'public.app_suborganization_updates'::regclass, 'public.app_project_progress_updates'::regclass)
             and not (relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*r' and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*a'
                      and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w'))
     or (select count(*) from pg_policy where polrelid = 'public.app_notes'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_notes'::regclass
         and polname = 'notes_owner_all' and polcmd = '*'
         and polroles = array['authenticated'::regrole::oid]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_suborganization_updates'::regclass) < 1
     or (select count(*) from pg_policy where polrelid = 'public.app_project_progress_updates'::regclass) < 1 then
    raise exception 'ED_FORMAT_COLUMNS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_notes
  add column doc jsonb,
  add constraint app_notes_doc_check check (
    doc is null or coalesce(
      jsonb_typeof(doc) = 'object'
      and doc ->> 'v' = 'ed1'
      and jsonb_typeof(doc -> 'doc' -> 'content') = 'array'
      and octet_length(doc::text) <= 1048576, false));
alter table public.app_suborganization_updates
  add column doc jsonb,
  add constraint app_suborganization_updates_doc_check check (
    doc is null or coalesce(
      jsonb_typeof(doc) = 'object'
      and doc ->> 'v' = 'ed1'
      and jsonb_typeof(doc -> 'doc' -> 'content') = 'array'
      and octet_length(doc::text) <= 1048576, false));
alter table public.app_project_progress_updates
  add column doc jsonb,
  add constraint app_project_progress_updates_doc_check check (
    doc is null or coalesce(
      jsonb_typeof(doc) = 'object'
      and doc ->> 'v' = 'ed1'
      and jsonb_typeof(doc -> 'doc' -> 'content') = 'array'
      and octet_length(doc::text) <= 1048576, false));

-- 사후 확인: 세 칸·세 검사(검증됨)가 있고 모든 기존 행의 doc은 비어 있음, 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 노트 정책 1개). 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_attribute where attname = 'doc' and not attisdropped and atttypid = 'jsonb'::regtype
        and attrelid in ('public.app_notes'::regclass, 'public.app_suborganization_updates'::regclass, 'public.app_project_progress_updates'::regclass)) <> 3
     or (select count(*) from pg_constraint where connamespace = 'public'::regnamespace and contype = 'c' and convalidated
           and conname in ('app_notes_doc_check', 'app_suborganization_updates_doc_check', 'app_project_progress_updates_doc_check')) <> 3
     or exists (select 1 from public.app_notes where doc is not null)
     or exists (select 1 from public.app_suborganization_updates where doc is not null)
     or exists (select 1 from public.app_project_progress_updates where doc is not null)
     or exists (select 1 from pg_class where relrowsecurity = false
           and oid in ('public.app_notes'::regclass, 'public.app_suborganization_updates'::regclass, 'public.app_project_progress_updates'::regclass))
     or exists (select 1 from pg_class where relacl::text ~ '(^|[{,])(anon)?='
           and oid in ('public.app_notes'::regclass, 'public.app_suborganization_updates'::regclass, 'public.app_project_progress_updates'::regclass))
     or exists (select 1 from pg_policy
           where polrelid in ('public.app_notes'::regclass, 'public.app_suborganization_updates'::regclass, 'public.app_project_progress_updates'::regclass)
             and (polroles @> array[0::oid] or polroles @> array['anon'::regrole::oid]))
     or (select count(*) from pg_policy where polrelid = 'public.app_notes'::regclass) <> 1 then
    raise exception 'ED_FORMAT_COLUMNS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261023233000', 'ed_format_columns', array['ED③-1 DB: doc jsonb + ed1 shape CHECK on app_notes, app_suborganization_updates, app_project_progress_updates (existing owner RLS, no grants/policies/functions)']);
commit;
