begin;
-- 20261029124500_diary_stars_taken_day_fix의 짝 되돌리기. 이번 기록 1행만 지운다.
-- 별표 날짜(taken_day)를 옛 값으로 되돌리지는 않는다(데이터 UPDATE는 되돌리기 파일에서 허용되지 않는다). 옛 값은 적용 직전 승인 흐름이 만든
-- app_diary_stars 사본(ops_backup)에 그대로 있고, 되살릴지는 명진이 정한다. 옛 값은 하루 늦은 날짜라 되살릴 까닭은 거의 없다.
-- 표 권한·정책·함수·다른 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261029124500' and name = 'diary_stars_taken_day_fix') <> 1 then
    raise exception 'DIARY_STARS_TAKEN_DAY_FIX_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

delete from supabase_migrations.schema_migrations where version = '20261029124500' and name = 'diary_stars_taken_day_fix';
commit;
