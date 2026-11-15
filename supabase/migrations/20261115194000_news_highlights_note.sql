begin;
-- S62-17 NOTE-노트에서도밑줄 ① DB(요청함 11/15 17:39·17:58, NOTE-News밑줄보관보기 #2635 이어서).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 DB 적용이 먼저, 노트 본문에서 [밑줄 저장]을 여는 화면 PR이 나중.
--
--  app_news_highlights 종류 칸 검사(app_news_highlights_type_check)에 'note'(노트 = app_notes.id)를 더한다.
--  검사를 지우고 같은 이름으로 다시 만든다(news·outside·telegram 세 가지는 그대로). 다른 검사·열·정책·권한·색인은 그대로.
--  외래 키는 두지 않는다(20261108070000과 같음 — 노트가 지워지거나 글이 바뀌어도 밑줄 글·출처 사본은 따로 남는다).
--
-- 권한: 바꾸지 않는다. RLS 켬 + private.app_is_workspace_owner(workspace_id) 소유자 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음 그대로.
-- 안 하는 것: 새 표·열·함수·정책·트리거·권한, 기존 밑줄 행 변경, 노트 표(app_notes) 변경, rtw_* 객체.
-- 짝: docs/20261115194000_news_highlights_note.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115194000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261108070000' and name = 'news_highlights') <> 1
     or to_regclass('public.app_news_highlights') is null
     or (select count(*) from pg_constraint where conrelid = 'public.app_news_highlights'::regclass
         and conname = 'app_news_highlights_type_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''telegram''' and pg_get_constraintdef(oid) !~ '''note''') <> 1
     or exists (select 1 from public.app_news_highlights where source_type not in ('news', 'outside', 'telegram')) then
    raise exception 'NEWS_HIGHLIGHTS_NOTE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_news_highlights drop constraint app_news_highlights_type_check;
alter table public.app_news_highlights add constraint app_news_highlights_type_check
  check (source_type in ('news', 'outside', 'telegram', 'note'));

-- 사후 확인: 검사 1개(넷), RLS 켜짐·anon·PUBLIC·service_role 권한 없음·정책 1개(authenticated만) 그대로. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_news_highlights'::regclass;
begin
  if (select count(*) from pg_constraint where conrelid = t and conname = 'app_news_highlights_type_check' and contype = 'c'
        and pg_get_constraintdef(oid) ~ '''note''' and pg_get_constraintdef(oid) ~ '''telegram''') <> 1
     or not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
    raise exception 'NEWS_HIGHLIGHTS_NOTE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261115194000', 'news_highlights_note', array['S62-17 NOTE-노트에서도밑줄: app_news_highlights_type_check adds note (news, outside, telegram, note); no grants, policies, functions, columns or row changes']);
commit;
