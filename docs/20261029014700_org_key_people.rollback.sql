begin;
-- 20261029014700_org_key_people의 짝 되돌리기. 새 표 2개(색인·정책·트리거 포함)·트리거 함수 1개와 이번 기록 1행만 지운다.
-- 기존 표(담당조직·통화·텔레그램·회의)는 건드리지 않는다. 지정해 둔 주요 인물·'요즘' 문장은 함께 사라진다(통화·기록 원본은 그대로).
-- 지우기 전에 화면을 이 표를 쓰지 않는 이전 판으로 되돌려도 되고, 새 화면은 표가 없으면 [주요 인물] 탭을 조용히 빈 탭으로 보인다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261029014700' and name = 'org_key_people') <> 1 then
    raise exception 'ORG_KEY_PEOPLE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_org_key_people_briefs;
drop table public.app_org_key_people;
drop function private.app_org_key_people_guard();

delete from supabase_migrations.schema_migrations
  where version = '20261029014700' and name = 'org_key_people';
commit;
