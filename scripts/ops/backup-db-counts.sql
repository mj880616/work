-- OPS-DB백업: 표마다 줄 수와 RLS 표·정책·함수 개수를 센다.
-- 덤프 때(같은 snapshot 안)와 되살리기 시험 때 똑같이 쓴다. 결과는 psql 변수 :out 파일로만 쓰고 화면에 찍지 않는다.
-- 대상 스키마는 scripts/ops/backup-db.mjs 의 SCHEMAS, scripts/ops/backup-db-dump.sh 의 -n 목록과 같다.
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'
\pset footer off
\o :out
select format('select %L || E''\t'' || count(*) from %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname in ('public', 'private', 'auth', 'storage', 'supabase_migrations')
  and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
order by n.nspname, c.relname
\gexec
select 'meta:rls_tables' || E'\t' || count(*)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and c.relrowsecurity
  and n.nspname in ('public', 'private', 'auth', 'storage', 'supabase_migrations');
select 'meta:policies' || E'\t' || count(*)
from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'private', 'auth', 'storage', 'supabase_migrations');
select 'meta:functions' || E'\t' || count(*)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private', 'auth', 'storage', 'supabase_migrations')
  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
\o
