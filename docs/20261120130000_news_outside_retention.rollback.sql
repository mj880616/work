begin;
-- 20261120130000_news_outside_retention의 짝 되돌리기. SQL Editor(폰 경로 C) 전용이다
-- (승인형 workflow rollback 모드는 이전 함수를 CREATE OR REPLACE로 되살리는 일을 지원하지 않는다, docs/ops-db-workflow.md).
-- 먼저 매일 정리 예약을 끈다(docs/ops/retention-daily.rollback.sql) — 끄지 않으면 예약이 없는 함수를 불러 실패 기록만 남는다.
-- 1) public.app_news_prune을 20261101233000_news_clipping 판 본문(옛 표 매체 30일·키워드 180일, 별표·노트 메모 남김) 그대로 되살린다.
-- 2) public.app_outside_prune을 지운다. 3) 이번 기록 1행을 지운다.
-- ★ 이미 지운 기사·본문·읽음·자세히는 되살리지 않는다(되살릴 수 없음). 표·정책·권한·트리거는 건드리지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261120130000' and name = 'news_outside_retention') <> 1 then
    raise exception 'NEWS_OUTSIDE_RETENTION_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

create or replace function public.app_news_prune(p_now timestamptz, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $prune$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_n integer;
begin
  with doomed as (
    select i.id from public.app_news_items i
    where i.starred_at is null
      and ((i.lane = 'media' and coalesce(i.published_at, i.created_at) < v_now - interval '30 days')
        or (i.lane = 'keyword' and coalesce(i.published_at, i.created_at) < v_now - interval '180 days'))
      and not exists (
        select 1 from public.app_notes n
        where n.workspace_id = i.workspace_id and n.metadata ->> 'news_item_id' = i.id::text)
    order by coalesce(i.published_at, i.created_at)
    limit v_limit
  )
  delete from public.app_news_items i using doomed where i.id = doomed.id;
  get diagnostics v_n = row_count;
  return v_n;
end
$prune$;
revoke all on function public.app_news_prune(timestamptz, integer) from public, anon, authenticated, service_role;
grant execute on function public.app_news_prune(timestamptz, integer) to service_role;

drop function public.app_outside_prune(timestamptz, integer);

delete from supabase_migrations.schema_migrations
  where version = '20261120130000' and name = 'news_outside_retention';
commit;
