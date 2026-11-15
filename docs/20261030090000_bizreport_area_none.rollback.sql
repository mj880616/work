begin;
-- 20261030090000_bizreport_area_none의 짝 되돌리기(SQL Editor 전용: drop column은 승인형 workflow rollback 허용 목록 밖). 칸 business_area_none 하나와 이번 기록 1행만 지운다.
-- 기존 표·정책·권한·다른 칸·사업 보고 내용에는 손대지 않는다.
-- '사업영역 없음'으로 고른 보고가 하나라도 있으면(화면이 쓰기 시작한 뒤) 멈춘다. 지워서 통과시키지 않는다.
-- 그런 경우: ① docs/20261030090000_bizreport_area_none.preserve.sql(id만 읽기)을 SQL Editor에서 실행해 결과를 저장소 밖에 보관
--   ② 화면을 [없음]이 없는 판으로 되돌림 ③ 그 표시를 비우는 쓰기는 커맨드센터가 별도로 승인한 SQL로만 한 뒤 이 파일을 다시 실행.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261030090000' and name = 'bizreport_area_none') <> 1 then
    raise exception 'BIZREPORT_AREA_NONE_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_meetings where business_area_none) then
    raise exception 'BIZREPORT_AREA_NONE_ROLLBACK_BLOCKED: reports marked none; run the preserve SQL first';
  end if;
end
$$;

alter table public.app_meetings drop column business_area_none;

delete from supabase_migrations.schema_migrations
  where version = '20261030090000' and name = 'bizreport_area_none';
commit;
