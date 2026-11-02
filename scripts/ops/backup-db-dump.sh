#!/usr/bin/env bash
# OPS-DB백업: backup-db-snapshot.sql 안에서 psql \! 로 불린다(같은 snapshot을 쓰려고).
# 접속 값은 PG* 환경 변수로만 받는다. 오류 원문은 파일에만 쓰고 화면에 찍지 않는다. 종료 코드는 dump.rc 에 남긴다.
set -uo pipefail
rc=0
pg_dump --format=custom --compress=6 --snapshot="$BACKUP_SNAPSHOT" \
  --schema=public --schema=private --schema=auth --schema=storage --schema=supabase_migrations \
  --file="$BACKUP_WORK/db.pgdump" > /dev/null 2> "$BACKUP_WORK/pg_dump.err" || rc=$?
printf '%s\n' "$rc" > "$BACKUP_WORK/dump.rc"
exit 0
