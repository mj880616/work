begin;
-- S67-09 NEWS-보관별표하나로 (명진 11/19 15:40 "ㅇㅇ"): 사회운동 글의 '보관' 표시를 별표 하나로 합친다(뉴스 기사와 같게).
-- 화면은 이 적용 뒤부터 사회운동 글도 별표(starred_at)만 읽고 쓴다. 이미 '보관'만 해 둔 글이 [보관] 탭에서 빠지지 않게
-- 사람별 표시 표(app_outside_article_marks)에서 보관 시각(archived_at)은 있고 별표 시각(starred_at)은 없는 줄만 starred_at = archived_at으로 채운다.
-- archived_at은 지우지 않고 그대로 둔다(되돌리기·데이터 보존). 다른 칸·다른 표(옛 app_outside_marks 포함)·행 수·권한·정책·함수·트리거는 바꾸지 않는다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
-- 출력: 사전·사후 확인은 행 수·예/아니오·해시만(글 제목·내용은 읽지 않음).
-- 되돌리기: 짝 rollback(SQL Editor 전용) — archived_at이 있고 starred_at이 archived_at과 같은 줄의 starred_at만 비우고 기록 1행을 지운다.
--   그래서 적용 전에 별표 시각과 보관 시각이 똑같은 줄이 이미 있으면(되돌리기가 그 줄까지 건드리게 되므로) 아무것도 바꾸지 않고 멈춘다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_outside_article_marks in share row exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261119120000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115150000' and name = 'outside_for_all') <> 1
     or (select count(*) from pg_attribute where attrelid = 'public.app_outside_article_marks'::regclass and not attisdropped
         and attname in ('starred_at', 'archived_at') and atttypid = 'timestamptz'::regtype) <> 2
     or exists (select 1 from pg_class where oid = 'public.app_outside_article_marks'::regclass and not relrowsecurity)
     or exists (select 1 from public.app_outside_article_marks where archived_at is not null and starred_at = archived_at) then
    raise exception 'OUTSIDE_ARCHIVE_TO_STAR_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

update public.app_outside_article_marks
  set starred_at = archived_at
  where archived_at is not null
    and starred_at is null;

-- 사후 확인: 보관만 있고 별표 없는 줄이 0, 표는 RLS 켜짐. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from public.app_outside_article_marks where archived_at is not null and starred_at is null)
     or not exists (select 1 from pg_class where oid = 'public.app_outside_article_marks'::regclass and relrowsecurity) then
    raise exception 'OUTSIDE_ARCHIVE_TO_STAR_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261119120000', 'outside_archive_to_star', array['NEWS star only: app_outside_article_marks.starred_at set to archived_at only where archived_at is set and starred_at is empty (archived_at kept); stops if any row already has starred_at equal to archived_at; no other column, table, row count, grant, policy, function or trigger change']);
commit;
