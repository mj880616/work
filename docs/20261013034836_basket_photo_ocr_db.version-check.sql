-- Independent SELECT only: run before snapshot/precheck/postcheck/rollback.
-- These reads do not reference PostgreSQL 16+ membership catalog columns.
-- An unknown result or server_version_num < 160000 means stop, not retry apply.
select 'server_version_num' item,current_setting('server_version_num') value
union all select 'server_version',current_setting('server_version')
union all select 'PostgreSQL 16+ catalog prerequisite',case when current_setting('server_version_num')::integer>=160000 then '예'else '아니오'end;
