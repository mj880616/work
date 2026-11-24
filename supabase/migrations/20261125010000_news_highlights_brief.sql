begin;
-- S69-86 BRIEF-밑줄노트 ① DB(요청함 11/25 00:50 "브리핑 밑줄 저장, 답글 달기(노트에 메모로 저장), 보관(노트로 보관) … 브리핑룸에서 없애도 파생 저장은 남기게").
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 화면은 같은 PR — 적용 전에는 브리핑에서 [밑줄 저장]만 거절되고(알림 한 줄) 답글·보관 노트는 그대로 된다.
--
--  app_news_highlights 종류 칸 검사(app_news_highlights_type_check)에 'brief'(브리핑 룸 자료 = app_documents.id)를 더한다.
--  검사를 지우고 같은 이름으로 다시 만든다(news·outside·telegram·note·reading 다섯 가지는 그대로). 다른 검사·열·정책·권한·색인은 그대로.
--  외래 키는 두지 않는다(20261108070000과 같음 — 브리핑만 지우거나 자료까지 지워도 밑줄 글·출처 사본(자료 이름·날짜)은 따로 남는다).
--
-- 권한: 바꾸지 않는다. RLS 켬 + private.app_is_workspace_owner(workspace_id) 소유자 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음 그대로.
-- 안 하는 것: 새 표·열·함수·정책·트리거·권한, 기존 밑줄 행 변경, 브리핑 표(app_document_briefs)·자료 표 변경, rtw_* 객체.
-- 짝: docs/20261125010000_news_highlights_brief.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125010000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261122100000' and name = 'reading_items') <> 1
     or to_regclass('public.app_news_highlights') is null
     or (select count(*) from pg_constraint where conrelid = 'public.app_news_highlights'::regclass
         and conname = 'app_news_highlights_type_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''reading''' and pg_get_constraintdef(oid) !~ '''brief''') <> 1
     or exists (select 1 from public.app_news_highlights where source_type not in ('news', 'outside', 'telegram', 'note', 'reading')) then
    raise exception 'NEWS_HIGHLIGHTS_BRIEF_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_news_highlights drop constraint app_news_highlights_type_check;
alter table public.app_news_highlights add constraint app_news_highlights_type_check
  check (source_type in ('news', 'outside', 'telegram', 'note', 'reading', 'brief'));

-- 사후 확인: 검사 1개(여섯), RLS 켜짐·anon·PUBLIC·service_role 권한 없음·정책 1개(authenticated만) 그대로. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_news_highlights'::regclass;
begin
  if (select count(*) from pg_constraint where conrelid = t and conname = 'app_news_highlights_type_check' and contype = 'c'
        and pg_get_constraintdef(oid) ~ '''brief''' and pg_get_constraintdef(oid) ~ '''reading''' and pg_get_constraintdef(oid) ~ '''note''') <> 1
     or not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
    raise exception 'NEWS_HIGHLIGHTS_BRIEF_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125010000', 'news_highlights_brief', array['S69-86 BRIEF-밑줄노트: app_news_highlights_type_check adds brief (news, outside, telegram, note, reading, brief); no grants, policies, functions, columns or row changes']);
commit;
