begin;
-- 20261104233000_family_notes의 짝 되돌리기. 새 표·트리거 함수·family 허용 행·검사 원래 모양(키 다섯)·이번 기록 1행만 되돌린다. 다른 허용 행은 그대로.
-- 새 표에 줄이 하나라도 있으면 멈춘다(뽑은 제안·명진이 고른 상태가 사라지므로). 줄이 있는데 꼭 되돌려야 하면 그 판단은 명진이 한다.
-- 되돌리면 Edge collector-feed의 가족 뽑기는 저장 실패(표 없음)로 개수만 세고, 화면은 기능 없음으로 칸을 그리지 않는다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 표 삭제·자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261104233000' and name = 'family_notes') <> 1
     or to_regclass('public.app_family_notes') is null then
    raise exception 'FAMILY_NOTES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_family_notes) then
    raise exception 'FAMILY_NOTES_ROLLBACK_BLOCKED: rows exist';
  end if;
end
$$;

drop table public.app_family_notes;
drop function private.app_family_feature_guard();
delete from public.app_operator_features where feature = 'family';
alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox'));

delete from supabase_migrations.schema_migrations
  where version = '20261104233000' and name = 'family_notes';
commit;
