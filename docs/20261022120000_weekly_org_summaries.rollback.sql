begin;
-- 20261022120000_weekly_org_summaries의 짝 되돌리기. 새 표 1개(정책·색인 포함)와 이번 기록 1행만 지운다.
-- 고친 요약(edited=true)이 한 줄이라도 있으면 멈춘다. 명진이 직접 고친 글을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 화면 사용을 멈추고(ai-assist를 이전 운영 소스로 되돌리면 새 요약이 생기지 않음), 고친 요약을 캡처해 보관한 뒤 다시 계획한다.
-- AI가 만든 요약(edited=false)은 [요약 만들기]로 다시 만들 수 있으므로 표와 함께 지운다.
-- 기존 표·정책·함수에는 손대지 않는다. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_weekly_org_summaries in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261022120000' and name = 'weekly_org_summaries') <> 1 then
    raise exception 'WEEKLY_ORG_SUMMARIES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_weekly_org_summaries where edited) then
    raise exception 'WEEKLY_ORG_SUMMARIES_ROLLBACK_BLOCKED: edited summaries exist; preserve and plan recovery';
  end if;
end
$$;

drop table public.app_weekly_org_summaries;

delete from supabase_migrations.schema_migrations
  where version = '20261022120000' and name = 'weekly_org_summaries';
commit;
