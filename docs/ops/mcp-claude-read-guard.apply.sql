begin;
-- MCP-Claude읽기 M-3 L1·L2(설계 docs/design/mcp-claude-read.md 4.3·7.4·7.5). SQL Editor(폰 경로 C) 전용.
-- 왜 따로인가: 승인형 DB workflow 규칙은 `alter role`(차단 목록), storage 스키마의 정책(public 표만), anon 실행권 부여(grant-anon-public)를 받지 않는다.
--   규칙을 넓히지 않고 이 부분만 이 파일로 나눴다. 짝: docs/ops/mcp-claude-read-guard.precheck.sql · .rollback.sql.
-- 적용 순서: 20261120090000_mcp_claude_read(승인형 workflow) → precheck의 ok 칸 모두 true 확인 → 이 파일 → 바로 Web2·읽생기 화면 한 번씩 열어 보기.
--   OAuth 2.1 서버 켜기(M-6)는 이 파일과 Edge 재배포(M-2 L3)가 모두 운영에 선 뒤에만.
--
-- L1 요청 전 함수 public.app_mcp_pre_request(): PostgREST가 요청마다 요청 역할(anon·authenticated·service_role)로 부른다.
--   열쇠에 client_id가 없으면(지금의 모든 Web2·읽생기·Edge 요청) 아무것도 하지 않는다.
--   client_id가 있으면(Supabase OAuth로 받은 위임 열쇠) POST /rpc/app_mcp_<도구 7개> 말고는 모두 403으로 거절한다(표·다른 RPC·GraphQL·스키마 문서).
--   데이터를 읽지 않고 거절만 한다. 요청 역할이 부를 수 있어야 하므로 anon·authenticated·service_role에 실행권을 준다(PUBLIC 회수) — CC 판단 항목.
--   private 스키마는 anon에 USAGE가 없어 요청 전 함수로 부를 수 없으므로 public에 둔다(설계 7.4 "안 되면 public").
-- L2 Storage 제한(restrictive) 정책 2개: 위임 열쇠는 파일·버킷을 모두 거절. 좁히기만 하며 일반 로그인에는 영향 없음.
-- 위험: 이 함수가 오류를 내면 REST 전체(Web2·읽생기)가 멈춘다. 그래서 본문은 설정값 두 개만 보고, 적용 직후 화면을 연다.
--   멈추면 즉시 rollback 파일의 1단계(요청 전 설정 해제)만 실행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261120090000' and name = 'mcp_claude_read') <> 1
     or exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole cross join lateral unnest(s.setconfig) x(v)
                where r.rolname = 'authenticator' and x.v like 'pgrst.db\_pre\_request=%')
     or to_regprocedure('public.app_mcp_pre_request()') is not null
     or exists (select 1 from pg_policy p where p.polname in ('app_mcp_no_delegated_storage', 'app_mcp_no_delegated_buckets'))
     or to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null
     or to_regprocedure('auth.jwt()') is null
     or not exists (select 1 from pg_roles where rolname = 'authenticator')
     or exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.roleid
                where m.member = (select oid from pg_roles where rolname = 'authenticator')
                  and r.rolname not in ('anon', 'authenticated', 'service_role')) then
    raise exception 'MCP_CLAUDE_READ_GUARD_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create function public.app_mcp_pre_request()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_client text;
begin
  if v_claims is null then
    return;
  end if;
  v_client := coalesce(v_claims::jsonb ->> 'client_id', '');
  if v_client = '' then
    return;
  end if;
  if coalesce(current_setting('request.method', true), '') <> 'POST'
     or coalesce(current_setting('request.path', true), '')
        !~ '^/rpc/app_mcp_(org_status|business_reports|project_status|ledger_search|ledger_get|notes_search|google_where)$' then
    raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';
  end if;
end
$$;
revoke all on function public.app_mcp_pre_request() from public;
grant execute on function public.app_mcp_pre_request() to anon, authenticated, service_role;

create policy app_mcp_no_delegated_storage on storage.objects as restrictive for all to authenticated
  using (coalesce((select auth.jwt()) ->> 'client_id', '') = '')
  with check (coalesce((select auth.jwt()) ->> 'client_id', '') = '');
create policy app_mcp_no_delegated_buckets on storage.buckets as restrictive for all to authenticated
  using (coalesce((select auth.jwt()) ->> 'client_id', '') = '')
  with check (coalesce((select auth.jwt()) ->> 'client_id', '') = '');

alter role authenticator set pgrst.db_pre_request = 'public.app_mcp_pre_request';
notify pgrst, 'reload config';
commit;
