begin;
-- S70-16 UI-고른글메뉴·형광펜(명진 2026-11-25 09:51 "하이라이트(형광펜) 기능 … 메모나 밑줄처럼 따로 저장안하더라도 그 글 자체 안에서 형광펜 표시",
--   09:54 "형광펜 색상 지정도 가능했으면"). 시안: docs/design/mockups/highlight-underline-options.html.
-- 바꾸는 것: 기존 밑줄 표 app_news_highlights에 칸 두 개만 더한다(새 표·함수·트리거·정책 바꾸기 없음).
--  mark_kind  : 비움 = 지금까지의 '밑줄 저장'(모아 보기에 나옴), 'highlight' = 형광펜(글 안에만 칠함).
--  mark_color : 비움 또는 yellow·green·blue·pink·orange(톤다운 다섯 색). 형광 줄은 색이 있어야 하고 메모가 없다.
-- 기존 행: 한 줄도 바꾸지 않는다(두 칸 비움 = 지금 밑줄 그대로).
-- 권한: owner만(기존 정책 news_highlights_owner_all 그대로). 새 칸 넣기(mark_kind·mark_color)·색 바꾸기(mark_color)만 authenticated에 칸 권한으로 더한다.
--   anon·PUBLIC·service_role 권한 없음. 공유(COLLAB) 함수는 이 표를 읽지 않는다(공유 항목에 칠한 표시도 칠한 사람에게만).
-- 적용 경로: 기존 표의 새 칸에만 칸 권한을 주므로 승인형 DB workflow 확장 규칙(새 칸 권한)이 받는다.
--   짝: docs/20261125113000_news_highlights_marks.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125113000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261125010000' and name = 'news_highlights_brief')
     or to_regclass('public.app_news_highlights') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_news_highlights')
         and attname in ('mark_kind', 'mark_color') and not attisdropped)
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_news_highlights')
         and conname = 'app_news_highlights_type_check' and contype = 'c')
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_news_highlights')) <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_news_highlights')
         and polname = 'news_highlights_owner_all') <> 1 then
    raise exception 'NEWS_HIGHLIGHTS_MARKS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_news_highlights add column mark_kind text;
alter table public.app_news_highlights add column mark_color text;
alter table public.app_news_highlights add constraint app_news_highlights_mark_check check (
  (mark_kind is null and mark_color is null)
  or (mark_kind = 'highlight' and mark_color is not null and mark_color in ('yellow', 'green', 'blue', 'pink', 'orange') and memo is null));
-- (mark_color is not null을 따로 둔다: 비운 색은 in 검사가 '모름'이 되어 check를 통과하므로)

grant insert (mark_kind, mark_color) on table public.app_news_highlights to authenticated;
grant update (mark_color) on table public.app_news_highlights to authenticated;

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 작업공간·출처·글 고치기 권한 없음, 모양 고치기 권한 없음, 트리거 없음. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_news_highlights'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
     or not has_table_privilege('authenticated', t, 'select,delete')
     or has_column_privilege('authenticated', t, 'workspace_id', 'update')
     or has_column_privilege('authenticated', t, 'source_id', 'update')
     or has_column_privilege('authenticated', t, 'quote', 'update')
     or has_column_privilege('authenticated', t, 'mark_kind', 'update')
     or has_column_privilege('authenticated', t, 'id', 'insert')
     or not has_column_privilege('authenticated', t, 'mark_kind', 'insert')
     or not has_column_privilege('authenticated', t, 'mark_color', 'insert')
     or not has_column_privilege('authenticated', t, 'mark_color', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polname = 'news_highlights_owner_all'
         and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*') <> 1
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0 then
    raise exception 'NEWS_HIGHLIGHTS_MARKS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125113000', 'news_highlights_marks', array['S70-16: app_news_highlights mark_kind (highlight) and mark_color (five colors) columns with column grants; no policy, function or row changes']);
commit;
