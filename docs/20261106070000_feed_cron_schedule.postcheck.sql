-- SELECT only. 조각 ③ 뒤 SQL Editor 새 창에서 실행(폰 경로 C). 모두 예여야 한다. 값·지문·주소는 찍지 않고 예/아니오만.
-- (되돌린 뒤에는 쓰지 않는다: 되돌리기 끝의 검사가 대신 본다.)
-- expect: this migration recorded = 예
-- expect: four web2_feed jobs = 예
-- expect: outside 08:07 13:07 18:07 KST = 예
-- expect: news 08:22 13:22 18:22 KST = 예
-- expect: news_fill other hours at 22 = 예
-- expect: tick every minute = 예
-- expect: jobs run as postgres = 예
-- expect: cron timezone UTC = 예
-- expect: fingerprint row 1 = 예
-- expect: fingerprint matches vault key = 예
-- expect: no key or URL in job commands = 예
-- expect: tick calls settle, tidy, claim, http_post, sent = 예
-- expect: no new API role privileges on feed tables = 예
select 'this migration recorded' as item,case when exists(select 1 from supabase_migrations.schema_migrations
  where version='20261106070000' and name='feed_cron_schedule') then '예' else '아니오' end as value
union all select 'four web2_feed jobs',case when (select count(*) from cron.job where jobname like 'web2\_feed\_%')=4 then '예' else '아니오' end
union all select 'outside 08:07 13:07 18:07 KST',case when exists(select 1 from cron.job where jobname='web2_feed_outside' and schedule='7 4,9,23 * * *' and active
  and command=$c$select private.app_feed_enqueue('outside')$c$) then '예' else '아니오' end
union all select 'news 08:22 13:22 18:22 KST',case when exists(select 1 from cron.job where jobname='web2_feed_news' and schedule='22 4,9,23 * * *' and active
  and command=$c$select private.app_feed_enqueue('news')$c$) then '예' else '아니오' end
union all select 'news_fill other hours at 22',case when exists(select 1 from cron.job where jobname='web2_feed_news_fill' and schedule='22 0-3,5-8,10-22 * * *' and active
  and command=$c$select private.app_feed_enqueue('news_fill')$c$) then '예' else '아니오' end
union all select 'tick every minute',case when exists(select 1 from cron.job where jobname='web2_feed_tick' and schedule='* * * * *' and active) then '예' else '아니오' end
union all select 'jobs run as postgres',case when not exists(select 1 from cron.job where jobname like 'web2\_feed\_%' and username<>'postgres') then '예' else '아니오' end
union all select 'cron timezone UTC',case when coalesce(current_setting('cron.timezone',true),'') in ('GMT','UTC','Etc/UTC') then '예' else '아니오' end
union all select 'fingerprint row 1',case when (select count(*) from public.app_cron_keys where name='web2_feed_cron')=1 then '예' else '아니오' end
union all select 'fingerprint matches vault key',case when exists(select 1 from vault.decrypted_secrets s join public.app_cron_keys k on k.name=s.name
  where s.name='web2_feed_cron' and k.secret_sha256=encode(pg_catalog.sha256(convert_to(s.decrypted_secret,'UTF8')),'hex')) then '예' else '아니오' end
union all select 'no key or URL in job commands',case when not exists(select 1 from cron.job j,vault.decrypted_secrets s
  where j.jobname like 'web2\_feed\_%' and s.name in ('web2_feed_cron','web2_feed_project_url') and position(s.decrypted_secret in j.command)>0)
  and not exists(select 1 from cron.job where jobname like 'web2\_feed\_%' and command ~ 'supabase\.co') then '예' else '아니오' end
union all select 'tick calls settle, tidy, claim, http_post, sent',case when exists(select 1 from cron.job where jobname='web2_feed_tick'
  and strpos(command,'private.app_feed_settle(')>0 and strpos(command,'private.app_feed_tidy()')>strpos(command,'private.app_feed_settle(')
  and strpos(command,'private.app_feed_claim(')>strpos(command,'private.app_feed_tidy()')
  and strpos(command,'net.http_post(')>strpos(command,'private.app_feed_claim(')
  and strpos(command,'private.app_feed_sent(')>strpos(command,'net.http_post(')
  and strpos(command,'timeout_milliseconds := 150000')>0) then '예' else '아니오' end
union all select 'no new API role privileges on feed tables',case when not exists(select 1 from unnest(array['public.app_cron_keys','public.app_feed_runs','public.app_feed_jobs']) t
  where has_table_privilege('anon',t,'select,insert,update,delete') or has_table_privilege('authenticated',t,'select,insert,update,delete')
    or has_table_privilege('service_role',t,'insert,update,delete,truncate')) then '예' else '아니오' end;
