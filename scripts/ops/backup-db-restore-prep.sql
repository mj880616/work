-- OPS-DB백업 되살리기 시험: runner 안 일회용 PostgreSQL에 Supabase 기본 역할·확장 자리만 만든다.
-- 운영 DB와 상관없는 빈 시험 DB다. 역할은 정책(TO authenticated 등)이 되살아나도록 이름만 둔다(로그인 불가).
\set ON_ERROR_STOP on
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin', 'dashboard_user', 'pgbouncer'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
-- 덤프에 public 스키마 만들기가 들어 있으므로 빈 시험 DB의 기본 public 을 먼저 지운다.
drop schema if exists public cascade;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
