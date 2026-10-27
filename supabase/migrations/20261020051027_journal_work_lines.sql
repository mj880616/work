begin;
-- JOURNAL-오늘한줄목록: 업무일지 "오늘 한 줄"을 하루 여러 줄 목록으로. 저장 구조는 지금 그대로(하루 1행, app_notes_journal_day_unique)
-- 두고, 그 행 본문(raw_text)에 줄을 저장 순서대로 줄바꿈(\n) 하나로 이어 담는다. 바꾸는 것은 업무일지 검사 조건
-- app_notes_work_line_check 하나뿐이다(한 줄 → 줄마다 1~300자, 빈 줄 없음, 하루 50줄까지, 첨부 없음).
-- 새 열·색인·함수·권한·RLS/정책 변경·Edge 변경·기존 행 변경 없음. 기존 한 줄 기록은 그대로 그날의 첫 줄이다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_notes in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다. 새 규칙에 안 맞는 기존 업무일지 행이 있어도 멈춘다(행을 고쳐서 통과시키지 않는다).
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261017052234' and name = 'journal_memo_notes_kind') <> 1
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261020051027')
     or exists (select 1 from pg_class where oid = 'public.app_notes'::regclass and not relrowsecurity)
     -- anon 또는 PUBLIC 표 권한이 있으면 멈춘다(권한을 고쳐서 통과시키지 않는다).
     or exists (select 1 from pg_class where oid = 'public.app_notes'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_trigger where tgrelid = 'public.app_notes'::regclass and not tgisinternal)
     or (select count(*) from pg_policy where polrelid = 'public.app_notes'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_notes'::regclass
         and polname = 'notes_owner_all' and polcmd = '*'
         and polroles = array['authenticated'::regrole::oid]) <> 1
     or (select count(*) from pg_constraint
         where conrelid = 'public.app_notes'::regclass and conname = 'app_notes_work_line_check' and contype = 'c' and convalidated) <> 1
     or (select count(*) from pg_class
         where relnamespace = 'public'::regnamespace and relname = 'app_notes_journal_day_unique' and relkind = 'i') <> 1
     or exists (select 1 from public.app_notes
         where kind = 'work' and not (
           raw_text ~ '^[^\r\n]+(\n[^\r\n]+)*$'
           and raw_text !~ '(^|\n)[ \t]*(\n|$)'
           and raw_text !~ '[^\n]{150}[^\n]{151}'
           and raw_text !~ '(\n[^\n]*){50}'
           and attachments = '[]'::jsonb)) then
    raise exception 'JOURNAL_WORK_LINES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 업무일지 본문 = 줄 1~50개, 줄 사이는 \n 하나. 줄마다 1~300자(공백만 있는 줄 없음), \r 없음, 앞뒤 줄바꿈 없음. 첨부 없음.
-- PostgreSQL 정규식 반복 상한(255) 때문에 300자 초과는 150+151자 연속으로 검사한다.
alter table public.app_notes
  drop constraint app_notes_work_line_check,
  add constraint app_notes_work_line_check check (
    kind <> 'work' or (
      raw_text ~ '^[^\r\n]+(\n[^\r\n]+)*$'
      and raw_text !~ '(^|\n)[ \t]*(\n|$)'
      and raw_text !~ '[^\n]{150}[^\n]{151}'
      and raw_text !~ '(\n[^\n]*){50}'
      and attachments = '[]'::jsonb
    )
  );

-- 사후 확인: 권한 경계·하루 1행 색인이 그대로인지 확인한다. 다르면 트랜잭션 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_notes'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_notes'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_notes'::regclass) <> 1
     or exists (select 1 from pg_trigger where tgrelid = 'public.app_notes'::regclass and not tgisinternal)
     or (select count(*) from pg_constraint
         where conrelid = 'public.app_notes'::regclass and conname = 'app_notes_work_line_check' and contype = 'c' and convalidated) <> 1
     or (select count(*) from pg_class
         where relnamespace = 'public'::regnamespace and relname = 'app_notes_journal_day_unique' and relkind = 'i') <> 1 then
    raise exception 'JOURNAL_WORK_LINES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261020051027', 'journal_work_lines', array['JOURNAL-오늘한줄목록: app_notes_work_line_check allows 1-50 lines per day, no new grants or policies']);
commit;
