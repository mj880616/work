begin;
-- MEMO-노트·JOURNAL-일지 0단계: app_notes에 종류(kind)·제목(title)·날짜(journal_day) 열과 검사 조건·색인만 추가한다.
-- 설계: docs/design/journal-memo-diary-design.md (J1 추천안 A). 초안: docs/design/sql/20261020090000_journal_memo_notes_kind.sql.
-- 새 함수·새 권한·RLS/정책 변경·Edge 변경·기존 행 변경 없음. 기존 owner 정책 notes_owner_all을 그대로 쓴다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_notes in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
-- 기존 바구니 본문 규칙(app_notes_raw_text_check)이 검증된 상태면 모든 기존 행은 새 규칙의 basket 갈래도 만족한다.
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261013034836' and name = 'basket_photo_ocr_db') <> 1
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261017052234')
     or exists (select 1 from pg_attribute
       where attrelid = 'public.app_notes'::regclass and not attisdropped
         and attname in ('kind', 'title', 'journal_day'))
     or exists (select 1 from pg_class where oid = 'public.app_notes'::regclass and not relrowsecurity)
     -- anon 또는 PUBLIC 표 권한이 있으면 멈춘다(권한을 고쳐서 통과시키지 않는다).
     or exists (select 1 from pg_class where oid = 'public.app_notes'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_trigger where tgrelid = 'public.app_notes'::regclass and not tgisinternal)
     or (select count(*) from pg_policy where polrelid = 'public.app_notes'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_notes'::regclass
         and polname = 'notes_owner_all' and polcmd = '*'
         and polroles = array['authenticated'::regrole::oid]) <> 1
     or (select count(*) from pg_constraint
         where conrelid = 'public.app_notes'::regclass and conname = 'app_notes_raw_text_check' and contype = 'c' and convalidated) <> 1
     or exists (select 1 from pg_constraint
         where conrelid = 'public.app_notes'::regclass
           and conname in ('app_notes_kind_check', 'app_notes_title_check', 'app_notes_journal_day_check',
                           'app_notes_work_line_check', 'app_notes_diary_private_check', 'app_notes_raw_text_kind_check'))
     or exists (select 1 from pg_class
         where relnamespace = 'public'::regnamespace and relname in ('app_notes_journal_day_unique', 'app_notes_kind_occurred_idx')) then
    raise exception 'JOURNAL_MEMO_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 종류: basket(바구니, 기존 행 전부) / note(노트) / work(업무일지 한 줄) / diary(일기).
alter table public.app_notes
  add column kind text not null default 'basket',
  add column title text,
  add column journal_day date;

alter table public.app_notes
  add constraint app_notes_kind_check check (kind in ('basket', 'note', 'work', 'diary')),
  -- 제목은 노트만, 한 줄 1~200자.
  add constraint app_notes_title_check check (
    case when kind = 'note'
      then title is not null and length(btrim(title)) >= 1 and length(title) <= 200 and title !~ '[\r\n]'
      else title is null end
  ),
  -- 날짜는 업무일지·일기만. 하루에 종류별 1행(아래 고유 색인).
  add constraint app_notes_journal_day_check check (
    case when kind in ('work', 'diary')
      then journal_day is not null and journal_day between date '2000-01-01' and date '2100-12-31'
      else journal_day is null end
  ),
  -- 업무일지는 "오늘 한 줄"만 저장한다. 첨부 없음.
  add constraint app_notes_work_line_check check (
    kind <> 'work' or (length(btrim(raw_text)) between 1 and 300 and raw_text !~ '[\r\n]' and attachments = '[]'::jsonb)
  ),
  -- 일기는 AI 내보내기 대상에서 늘 빠진다(바구니 흐름이 종류 필터를 빠뜨려도 AI 복사에 섞이지 않게).
  add constraint app_notes_diary_private_check check (kind <> 'diary' or ai_export_allowed = false),
  -- 본문 길이: 노트만 10만 자까지(빈 본문 허용, 제목 필수). 나머지는 기존 바구니 규칙 그대로.
  add constraint app_notes_raw_text_kind_check check (
    case kind
      when 'note' then length(raw_text) <= 100000
      when 'work' then true
      else length(raw_text) <= 20000 and (length(raw_text) >= 1 or jsonb_array_length(attachments) >= 1)
    end
  );
alter table public.app_notes drop constraint app_notes_raw_text_check;
alter table public.app_notes rename constraint app_notes_raw_text_kind_check to app_notes_raw_text_check;

create unique index app_notes_journal_day_unique
  on public.app_notes (workspace_id, kind, journal_day) where journal_day is not null;
create index app_notes_kind_occurred_idx
  on public.app_notes (workspace_id, kind, occurred_at desc);

-- 사후 확인: 권한 경계가 그대로이고 기존 행이 전부 basket인지 확인한다. 다르면 트랜잭션 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_notes'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_notes'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_notes'::regclass) <> 1
     or exists (select 1 from pg_trigger where tgrelid = 'public.app_notes'::regclass and not tgisinternal)
     or exists (select 1 from public.app_notes where kind <> 'basket' or title is not null or journal_day is not null) then
    raise exception 'JOURNAL_MEMO_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261017052234', 'journal_memo_notes_kind', array['MEMO-노트·JOURNAL-일지: app_notes kind/title/journal_day, no new grants or policies']);
commit;
