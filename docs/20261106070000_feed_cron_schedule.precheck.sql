-- SELECT only. 조각 ① 전에 SQL Editor 새 창에서 실행(폰 경로 C). pg_catalog·migration 기록·지문 표 행 수만 읽는다(값·지문·주소를 찍지 않음).
-- cron·vault 표는 아직 없을 수 있어 여기서는 읽지 않는다: 같은 이름 예약·금고 이름은 migration 파일의 '확인 1'(조각 ① 뒤)과 조각 ②·③ 앞 검사가 본다.
-- 적용 전 기대: 앞 3줄·pgcrypto·vault·지문 행 없음 = 예. 확장 pg_cron·pg_net은 기록(이미 켜져 있으면 조각 ①이 건너뜀, 없으면 켬).
-- expect: new migration absent = 예
-- expect: P1a feed_cron_tables recorded = 예
-- expect: app_cron_keys table = 예
-- expect: feed functions present = 예
-- expect: fingerprint row absent = 예
-- expect: supabase_vault installed = 예
-- expect: pgcrypto gen_random_bytes = 예
-- expect: pg_cron available = 예
-- expect: pg_net available = 예
-- expect: extension pg_cron = 기록
-- expect: extension pg_net = 기록
-- expect: cron timezone = 기록
-- expect: web2_feed jobs absent = 예
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261106070000') then '예' else '아니오' end as value
union all select 'P1a feed_cron_tables recorded',case when exists(select 1 from supabase_migrations.schema_migrations
  where version='20261106040000' and name='feed_cron_tables') then '예' else '아니오' end
union all select 'app_cron_keys table',case when to_regclass('public.app_cron_keys') is not null then '예' else '아니오' end
union all select 'feed functions present',case when to_regprocedure('private.app_feed_enqueue(text)') is not null
  and to_regprocedure('private.app_feed_claim(text)') is not null and to_regprocedure('private.app_feed_sent(uuid,bigint)') is not null
  and to_regprocedure('private.app_feed_settle(bigint,integer,text)') is not null and to_regprocedure('private.app_feed_tidy()') is not null then '예' else '아니오' end
union all select 'fingerprint row absent',case when not exists(select 1 from public.app_cron_keys where name='web2_feed_cron') then '예' else '아니오' end
union all select 'supabase_vault installed',case when exists(select 1 from pg_catalog.pg_extension where extname='supabase_vault')
  and to_regclass('vault.decrypted_secrets') is not null then '예' else '아니오' end
union all select 'pgcrypto gen_random_bytes',case when to_regprocedure('extensions.gen_random_bytes(integer)') is not null then '예' else '아니오' end
union all select 'pg_cron available',case when exists(select 1 from pg_catalog.pg_available_extensions where name='pg_cron') then '예' else '아니오' end
union all select 'pg_net available',case when exists(select 1 from pg_catalog.pg_available_extensions where name='pg_net') then '예' else '아니오' end
union all select 'extension pg_cron',coalesce((select '켜짐 '||extversion from pg_catalog.pg_extension where extname='pg_cron'),'꺼짐')
union all select 'extension pg_net',coalesce((select '켜짐 '||extversion from pg_catalog.pg_extension where extname='pg_net'),'꺼짐')
union all select 'cron timezone',coalesce(current_setting('cron.timezone',true),'없음')
union all select 'web2_feed jobs absent',case when to_regclass('cron.job') is null then '예' else '확인 1에서' end
union all select 'recent migrations',coalesce((select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r),'없음');
