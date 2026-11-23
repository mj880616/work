begin;
-- 20261123150000_update_news_auto의 짝 되돌리기(SQL Editor 전용: 함수 둘을 이전 본문으로 다시 정의하므로 승인형 workflow rollback 모드 대상 아님).
-- 먼저 화면을 이 DB를 쓰기 전 판(S68-14 거두기 판 — [다시 보내기] 없음)으로 되돌린다. 그다음 이 파일을 새 쿼리 창(+)에서 실행한다.
-- 되돌리는 것: app_release_notes_put·app_update_news_admin을 이전 본문으로, 새 함수 둘(app_update_news_auto·app_update_news_resend) 삭제,
--   app_update_news의 새 칸 둘(auto·source_files)과 그 검사 삭제, 기록 1행 삭제.
-- 남는 것: 자동으로 보낸 소식 줄은 지우지 않는다(손으로 보낸 소식처럼 남음 — 거두려면 운영자 화면 [거두기]). 시작 날짜도 그대로.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261123150000' and name = 'update_news_auto') <> 1
     or to_regprocedure('public.app_update_news_resend(uuid)') is null
     or to_regprocedure('private.app_update_news_auto(jsonb,jsonb)') is null then
    raise exception 'UPDATE_NEWS_AUTO_ROLLBACK_BLOCKED: migration record or functions differ';
  end if;
end
$$;

create or replace function public.app_release_notes_put(p_notes jsonb, p_commit text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_notes is null or pg_catalog.jsonb_typeof(p_notes) <> 'object' or (p_notes ->> 'schema') is distinct from '1'
     or pg_catalog.jsonb_typeof(p_notes -> 'notes') <> 'array'
     or pg_catalog.jsonb_array_length(p_notes -> 'notes') > 20000
     or pg_catalog.octet_length(p_notes::text) > 8000000 then
    raise exception using errcode = '22023', message = 'RELEASE_NOTES_SHAPE';
  end if;
  if p_commit is null or p_commit !~ '^[0-9a-f]{40}$' then
    raise exception using errcode = '22023', message = 'RELEASE_NOTES_COMMIT';
  end if;
  insert into public.app_release_notes (id, notes, commit_sha, updated_at)
  values (1, p_notes, p_commit, pg_catalog.now())
  on conflict (id) do update set notes = excluded.notes, commit_sha = excluded.commit_sha, updated_at = excluded.updated_at
    where public.app_release_notes.id = 1;
  return pg_catalog.jsonb_build_object('ok', true, 'count', pg_catalog.jsonb_array_length(p_notes -> 'notes'));
end
$$;

create or replace function public.app_update_news_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if not private.app_update_news_operator() then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  return pg_catalog.jsonb_build_object(
    'start_on', (select s.start_on from public.app_update_news_start s where s.id = 1),
    'users', (select pg_catalog.count(distinct m.user_id) from public.app_workspace_members m where m.role = 'owner' and m.user_id <> v_user),
    'items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', u.id, 'title', u.title, 'lines', pg_catalog.to_jsonb(u.lines),
               'sources', pg_catalog.to_jsonb(u.sources), 'sent_at', u.sent_at, 'edited_at', u.edited_at, 'withdrawn_at', u.withdrawn_at,
               'reads', (select pg_catalog.count(*) from public.app_update_news_reads r where r.news_id = u.id and r.user_id <> v_user))
             order by u.sent_at desc)
        from public.app_update_news u), '[]'::jsonb));
end
$$;

drop function if exists public.app_update_news_resend(uuid);
drop function if exists private.app_update_news_auto(jsonb, jsonb);
alter table public.app_update_news drop constraint if exists app_update_news_source_files;
alter table public.app_update_news drop column if exists source_files;
alter table public.app_update_news drop column if exists auto;

delete from supabase_migrations.schema_migrations where version = '20261123150000' and name = 'update_news_auto';
commit;
