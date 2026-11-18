begin;
-- UPDATE-운영자전용기록업데이트소식 PR1(명진 11/15 12:56~12:59 확정): 개발 기록 '업데이트 기록'은 운영자만 본다.
-- 지금은 Pages 빌드가 app/release-notes.json을 공개 배포물에 실어 주소만 알면 로그인 없이도 열린다. 그 파일을 배포물에서 빼고,
-- 운영자 화면은 이 서버 표에서 읽는다.
--  1) 새 표 public.app_release_notes(한 행, id = 1): 묶은 기록 JSON·만든 커밋·시각. RLS 켬·정책 없음·API 역할 권한 없음 → 아래 두 함수로만.
--  2) public.app_release_notes_read(): 로그인한 사람 중 운영자 기능 'dev_inbox'(개발 요청함 — 운영자 개발 기능 묶음, 서버 허용 표)가 있는
--     작업공간 owner만 읽는다(private.app_workspace_has_feature, 통화·텔레그램과 같은 판정). 아니면 42501 OPERATOR_FEATURE_REQUIRED.
--  3) public.app_release_notes_put(p_notes jsonb, p_commit text): 수집 서버(service_role)만. Edge release-notes-sync가 GitHub Actions(main의 Pages 배포)
--     OIDC 토큰을 확인한 뒤 부른다. 모양({schema:1, current, notes:[...]}, 크기 상한)을 확인하고 한 행을 바꾼다.
-- 안 하는 것: 운영자 기능 표·기존 함수·정책·권한 변경, 앱 표 변경, rtw_* 객체.
-- 짝: docs/20261115190000_release_notes_store.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115190000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261103100000' and name = 'dev_inbox_feature') <> 1
     or to_regclass('public.app_release_notes') is not null
     or to_regprocedure('public.app_release_notes_read()') is not null
     or to_regprocedure('public.app_release_notes_put(jsonb,text)') is not null
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null then
    raise exception 'RELEASE_NOTES_STORE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_release_notes (
  id smallint primary key,
  notes jsonb not null,
  commit_sha text not null,
  updated_at timestamptz not null default now(),
  constraint app_release_notes_single check (id = 1),
  constraint app_release_notes_shape check (pg_catalog.jsonb_typeof(notes) = 'object' and pg_catalog.jsonb_typeof(notes -> 'notes') = 'array'),
  constraint app_release_notes_commit check (commit_sha ~ '^[0-9a-f]{40}$')
);
alter table public.app_release_notes enable row level security;
revoke all on table public.app_release_notes from public, anon, authenticated, service_role;

create function public.app_release_notes_read()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if not exists (select 1 from public.app_operator_features f
                  where f.feature = 'dev_inbox' and private.app_workspace_has_feature(f.workspace_id, 'dev_inbox')) then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  return (select r.notes from public.app_release_notes r where r.id = 1);
end
$$;

create function public.app_release_notes_put(p_notes jsonb, p_commit text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_notes is null or pg_catalog.jsonb_typeof(p_notes) <> 'object' or (p_notes ->> 'schema') is distinct from '1'
     or pg_catalog.jsonb_typeof(p_notes -> 'notes') <> 'array'
     or pg_catalog.jsonb_array_length(p_notes -> 'notes') > 20000
     or pg_catalog.octet_length(p_notes::text) > 8000000 then
    raise exception using errcode = '22023', message = 'RELEASE_NOTES_SHAPE';
  end if;
  if p_commit is null or p_commit !~ '^[0-9a-f]{40}$' then
    raise exception using errcode = '22023', message = 'RELEASE_NOTES_COMMIT';
  end if;
  insert into public.app_release_notes (id, notes, commit_sha, updated_at)
  values (1, p_notes, p_commit, pg_catalog.now())
  on conflict (id) do update set notes = excluded.notes, commit_sha = excluded.commit_sha, updated_at = excluded.updated_at
    where public.app_release_notes.id = 1;
  return pg_catalog.jsonb_build_object('ok', true, 'count', pg_catalog.jsonb_array_length(p_notes -> 'notes'));
end
$$;

revoke all on function public.app_release_notes_read() from public, anon, authenticated, service_role;
revoke all on function public.app_release_notes_put(jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.app_release_notes_read() to authenticated;
grant execute on function public.app_release_notes_put(jsonb, text) to service_role;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_release_notes'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_release_notes'::regclass)
     or has_table_privilege('anon', 'public.app_release_notes', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_release_notes', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_release_notes', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from pg_proc where oid in (to_regprocedure('public.app_release_notes_read()'), to_regprocedure('public.app_release_notes_put(jsonb,text)'))
           and prosecdef and proconfig = array['search_path=""']) <> 2
     or has_function_privilege('anon', 'public.app_release_notes_read()', 'execute')
     or has_function_privilege('service_role', 'public.app_release_notes_read()', 'execute')
     or not has_function_privilege('authenticated', 'public.app_release_notes_read()', 'execute')
     or has_function_privilege('anon', 'public.app_release_notes_put(jsonb,text)', 'execute')
     or has_function_privilege('authenticated', 'public.app_release_notes_put(jsonb,text)', 'execute')
     or not has_function_privilege('service_role', 'public.app_release_notes_put(jsonb,text)', 'execute') then
    raise exception 'RELEASE_NOTES_STORE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261115190000', 'release_notes_store', array['UPDATE operator-only release notes: new table app_release_notes (single row; RLS on, no policies, no API privileges); app_release_notes_read() for authenticated, returns notes only for an owner of a workspace with operator feature dev_inbox (private.app_workspace_has_feature), else 42501; app_release_notes_put(jsonb,text) for service_role only (Edge release-notes-sync after GitHub OIDC check), validates shape and size']);
commit;
