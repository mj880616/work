begin;
-- 20261101040000_phone_trash_log의 짝 되돌리기. 새 표 하나·이번 기록 1행만 되돌린다.
-- 지워지는 것: 사진 정리로 폰에서 지운 사진 기록(사진 번호·사본 id·시각)뿐. 원드라이브·폰 사진은 그대로다.
-- 먼저 화면·Edge가 이 표를 부르지 않게 되돌린 뒤 실행한다(부르면 지우기 전 확인이 실패해 지우기가 멈출 뿐, 사진은 지워지지 않음).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다). 기존 표·정책·함수는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261101040000' and name = 'phone_trash_log') <> 1 then
    raise exception 'PHONE_TRASH_LOG_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_phone_trash_log;

delete from supabase_migrations.schema_migrations
  where version = '20261101040000' and name = 'phone_trash_log';
commit;
