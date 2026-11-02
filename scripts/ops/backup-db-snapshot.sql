-- OPS-DB백업: 읽기 전용 거래 하나를 열고 그 시점(snapshot)을 pg_dump에 넘긴 뒤, 같은 시점으로 줄 수를 센다.
-- 그래서 덤프 내용과 줄 수 목록이 정확히 같은 순간의 것이 된다. 운영 DB에는 아무것도 쓰지 않는다(READ ONLY).
\set ON_ERROR_STOP on
begin isolation level repeatable read read only;
select pg_export_snapshot() as backup_snapshot \gset
\setenv BACKUP_SNAPSHOT :backup_snapshot
\! bash "$BACKUP_DUMP_SCRIPT"
\ir backup-db-counts.sql
rollback;
