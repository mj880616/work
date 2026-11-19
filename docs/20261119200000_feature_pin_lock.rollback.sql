begin;
-- 20261119200000_feature_pin_lock의 짝 되돌리기. 새 표 1개·새 함수 9개와 이번 기록 1행만 지운다.
-- 기존 표·정책·권한·owner 함수는 건드리지 않는다. 정해 둔 PIN·잠금 설정은 함께 사라진다(각자 기록은 그대로).
-- 지우기 전에 화면을 이 함수를 쓰지 않는 이전 판으로 되돌린다(화면 PR이 나간 뒤라면).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261119200000' and name = 'feature_pin_lock') <> 1 then
    raise exception 'FEATURE_PIN_LOCK_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_lock_pin_renew(text);
drop function public.app_lock_pin_change(text, text);
drop function public.app_lock_save(text, text[], text);
drop function public.app_lock_check(text);
drop function public.app_lock_setup(text, text[], text);
drop function public.app_lock_read();
drop function private.app_lock_try(uuid, text);
drop function private.app_lock_clean_features(text[]);
drop function private.app_lock_pin_shape(text);

drop table public.app_feature_locks;

delete from supabase_migrations.schema_migrations
  where version = '20261119200000' and name = 'feature_pin_lock';
commit;
