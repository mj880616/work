-- SELECT only. 조각 ① 전에 저장하고, 되돌린 뒤 다시 실행해 대조한다. pg_catalog·migration 기록·지문 표 행 수만 읽는다(값·지문·주소 없음).
-- 되돌린 뒤 같아야 하는 것: history·fingerprint 줄. 확장 줄은 조각 ①이 켰다면 '켜짐'으로 남는다(되돌리기는 확장을 끄지 않음 — 읽생기와 같은 DB).
-- 예약·금고 이름은 cron·vault가 없을 수 있어 여기서 읽지 않는다: 되돌리기 끝의 검사가 4개 예약·금고 이름 둘이 없어졌는지 본다.
select 'extension' as kind,e as name,coalesce((select 'present '||x.extversion from pg_catalog.pg_extension x where x.extname=e),'absent') as definition
  from unnest(array['pg_cron','pg_net','supabase_vault','pgcrypto']) e
union all select 'fingerprint','web2_feed_cron',(select count(*)::text from public.app_cron_keys where name='web2_feed_cron')
union all select 'history',v,coalesce((select name from supabase_migrations.schema_migrations where version=v),'absent')
  from unnest(array['20261106040000','20261106070000']) v
order by 1,2;
