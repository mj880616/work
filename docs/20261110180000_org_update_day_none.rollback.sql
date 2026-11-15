begin;
-- 20261110180000_org_update_day_none의 짝 되돌리기. 이번에 만든 것만 지운다: 검사 1개·칸 1개(day_none)·이번 기록 1행.
-- 사라지는 것: '날짜 없음' 표시(그 기록은 쓴 날 날짜로 다시 보인다). 조직 기록 글·날짜·끝나는 날·정책·권한은 그대로.
-- 순서: 화면을 day_none을 읽지 않는 이전 판으로 먼저 되돌린다(화면은 칸이 없으면 '없음'만 감추고 그대로 동작한다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_suborganization_updates in access exclusive mode;
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261110180000' and name = 'org_update_day_none') <> 1 then
    raise exception 'ORG_UPDATE_DAY_NONE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;
alter table public.app_suborganization_updates drop constraint app_suborganization_updates_day_none_check;
alter table public.app_suborganization_updates drop column day_none;
delete from supabase_migrations.schema_migrations
  where version = '20261110180000' and name = 'org_update_day_none';
commit;
