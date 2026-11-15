begin;
-- 20261030234000_org_status_rows의 짝 되돌리기. 새 표 1개(색인·정책·트리거 포함)·트리거 함수 1개와 이번 기록 1행만 지운다.
-- 기존 표(담당조직·기록)는 건드리지 않는다. 적어 둔 현황 표 줄은 함께 사라진다(조직 기록 원본은 그대로).
-- 지우기 전에 화면을 이 표를 쓰지 않는 이전 판으로 되돌려도 되고, 새 화면은 표가 없으면 [현황 표]에 '준비 중' 한 줄만 보인다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261030234000' and name = 'org_status_rows') <> 1 then
    raise exception 'ORG_STATUS_ROWS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_org_status_rows;
drop function private.app_org_status_rows_guard();

delete from supabase_migrations.schema_migrations
  where version = '20261030234000' and name = 'org_status_rows';
commit;
