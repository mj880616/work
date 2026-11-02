begin;
-- 20261102160000_phone_trash_keep의 짝 되돌리기. 인덱스 1개·제약 1개·칸 3개(keep, rel_path, taken_at)와 이번 기록 1행만 지운다.
-- 지워지는 것: '폰 공간만 비우기'로 비운 사진의 표시(목록에 남김)·원래 폰 폴더·찍은 시각뿐. 기록 행 자체와 원드라이브·폰 사진은 그대로다.
-- 먼저 Edge onedrive-photos·화면을 이 칸을 쓰기 전 판으로 되돌린 뒤 실행한다(그러지 않으면 비우기 기록 저장이 실패해 '기록 일부를 남기지 못했어요'가 뜰 뿐 사진은 지워지지 않음).
-- SQL Editor(폰 경로 C) 전용이다. 권한·정책·함수는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261102160000' and name = 'phone_trash_keep') <> 1 then
    raise exception 'PHONE_TRASH_KEEP_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop index public.app_phone_trash_log_keep_idx;
alter table public.app_phone_trash_log
  drop constraint app_phone_trash_log_rel_path_check,
  drop column taken_at,
  drop column rel_path,
  drop column keep;

delete from supabase_migrations.schema_migrations
  where version = '20261102160000' and name = 'phone_trash_keep';
commit;
