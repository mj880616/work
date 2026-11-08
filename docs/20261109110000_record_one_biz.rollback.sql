begin;
-- 20261109110000_record_one_biz의 짝 되돌리기. 새 표 2개(색인·정책·트리거 포함)·트리거 함수 2개와 이번 기록 1행만 지운다.
-- 기존 표(사업·사업 보고·옛 사업 진행 기록)는 건드리지 않는다. 적어 둔 사업 기록·지금 상황 줄은 함께 사라진다.
-- 순서: 화면을 이 표를 쓰지 않는 이전 판으로 먼저 되돌린다. 옛 사업 진행 기록 옮기기(B-2)를 적용했다면 그 rollback을 먼저 실행한다(옮긴 줄이 남아 있으면 멈춤).
-- 보고용 표시 표(O-2)의 ref_kind='biz_record' 행은 가리킬 곳이 없어지지만 남는다(표시만, 화면은 쓰지 않음).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261109110000' and name = 'record_one_biz') <> 1 then
    raise exception 'RECORD_ONE_BIZ_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_business_records where source_kind = 'progress') then
    raise exception 'RECORD_ONE_BIZ_ROLLBACK_BLOCKED: moved rows remain; roll back the move first';
  end if;
end
$$;

drop table public.app_business_records;
drop function private.app_business_records_guard();
drop table public.app_business_now;
drop function private.app_business_now_guard();

delete from supabase_migrations.schema_migrations
  where version = '20261109110000' and name = 'record_one_biz';
commit;
