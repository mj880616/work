begin;
-- UPDATE-운영자전용기록업데이트소식 PR2(명진 11/15 12:59·13:37 확정, 시안 PR #2638): 이용자용 '업데이트 소식'.
-- 개발 기록(업데이트 기록)은 운영자만 보고, 이용자에게는 운영자가 골라(여러 기록 묶기 가능) 문구를 고쳐 보낸 소식만 보인다.
-- 보이는 범위: 운영자가 정한 시작 날짜(서울 날짜) 이후 보낸 것 전부(가입일과 상관없음), 거둔 것은 빼고. 새 소식 알림·점·숫자는 없다(화면 PR).
--  1) 새 표 public.app_update_news(소식), public.app_update_news_start(시작 날짜 한 행), public.app_update_news_reads(누가 읽었는지 — 운영자 '읽음 n/m').
--     셋 다 RLS 켬·정책 없음·API 역할 권한 없음 → 아래 함수로만 읽고 쓴다.
--  2) 운영자 판정: 운영자 기능 'dev_inbox'(개발 요청함 — 업데이트 기록과 같은 운영자 개발 묶음)가 있는 작업공간의 owner(private.app_workspace_has_feature,
--     통화·텔레그램과 같은 서버 판정). 쓰기·관리 목록은 운영자만, 아니면 42501 OPERATOR_FEATURE_REQUIRED.
--  3) 이용자 함수(authenticated): app_update_news_list()(보이는 소식), app_update_news_seen()(지금 보이는 소식을 읽음으로 — 화면을 열 때).
--     운영자 함수(authenticated + 서버 판정): app_update_news_admin(), app_update_news_save(id, 제목, 줄, 출처 기록), app_update_news_withdraw(id),
--     app_update_news_set_start(날짜).
-- 안 하는 것: 운영자 기능 표·기존 함수·정책·권한 변경, 앱 표 변경, rtw_* 객체, 알림 보내기.
-- 짝: docs/20261115200000_update_news.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115200000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261103100000' and name = 'dev_inbox_feature') <> 1
     or to_regclass('public.app_update_news') is not null
     or to_regclass('public.app_update_news_start') is not null
     or to_regclass('public.app_update_news_reads') is not null
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null then
    raise exception 'UPDATE_NEWS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_update_news (
  id uuid primary key default gen_random_uuid(),
  title text,
  lines text[] not null,
  sources text[] not null default '{}'::text[],
  sent_by uuid not null,
  sent_at timestamptz not null default now(),
  edited_at timestamptz,
  withdrawn_at timestamptz,
  constraint app_update_news_title check (title is null or char_length(title) between 1 and 80),
  constraint app_update_news_lines check (cardinality(lines) between 1 and 12),
  constraint app_update_news_sources check (cardinality(sources) <= 30)
);
create index app_update_news_sent_idx on public.app_update_news (sent_at desc);
alter table public.app_update_news enable row level security;
revoke all on table public.app_update_news from public, anon, authenticated, service_role;

create table public.app_update_news_start (
  id smallint primary key,
  start_on date not null,
  updated_at timestamptz not null default now(),
  constraint app_update_news_start_single check (id = 1)
);
alter table public.app_update_news_start enable row level security;
revoke all on table public.app_update_news_start from public, anon, authenticated, service_role;

create table public.app_update_news_reads (
  news_id uuid not null references public.app_update_news(id) on delete cascade,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (news_id, user_id)
);
alter table public.app_update_news_reads enable row level security;
revoke all on table public.app_update_news_reads from public, anon, authenticated, service_role;

-- 운영자 판정 한 곳(이 파일의 DEFINER 함수들만 부름, API 역할 실행 권한 없음).
create function private.app_update_news_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (select 1 from public.app_operator_features f
                  where f.feature = 'dev_inbox' and private.app_workspace_has_feature(f.workspace_id, 'dev_inbox'))
$$;

create function public.app_update_news_list()
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
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', n.id, 'title', n.title, 'lines', pg_catalog.to_jsonb(n.lines),
             'sent_at', n.sent_at, 'edited_at', n.edited_at) order by n.sent_at desc)
      from (select * from public.app_update_news u
             where u.withdrawn_at is null
               and u.sent_at >= (select (s.start_on::timestamp at time zone 'Asia/Seoul') from public.app_update_news_start s where s.id = 1)
             order by u.sent_at desc
             limit 200) n), '[]'::jsonb);
end
$$;

create function public.app_update_news_seen()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  insert into public.app_update_news_reads (news_id, user_id)
  select u.id, v_user from public.app_update_news u
   where u.withdrawn_at is null
     and u.sent_at >= (select (s.start_on::timestamp at time zone 'Asia/Seoul') from public.app_update_news_start s where s.id = 1)
  on conflict (news_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create function public.app_update_news_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if not private.app_update_news_operator() then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  return pg_catalog.jsonb_build_object(
    'start_on', (select s.start_on from public.app_update_news_start s where s.id = 1),
    'users', (select pg_catalog.count(distinct m.user_id) from public.app_workspace_members m where m.role = 'owner' and m.user_id <> v_user),
    'items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', u.id, 'title', u.title, 'lines', pg_catalog.to_jsonb(u.lines),
               'sources', pg_catalog.to_jsonb(u.sources), 'sent_at', u.sent_at, 'edited_at', u.edited_at, 'withdrawn_at', u.withdrawn_at,
               'reads', (select pg_catalog.count(*) from public.app_update_news_reads r where r.news_id = u.id and r.user_id <> v_user))
             order by u.sent_at desc)
        from public.app_update_news u), '[]'::jsonb));
end
$$;

create function public.app_update_news_save(p_id uuid, p_title text, p_lines text[], p_sources text[])
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_title text := nullif(pg_catalog.btrim(coalesce(p_title, '')), '');
  v_lines text[];
  v_sources text[] := coalesce(p_sources, '{}'::text[]);
  v_id uuid;
begin
  if not private.app_update_news_operator() then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  select coalesce(pg_catalog.array_agg(pg_catalog.btrim(l) order by o), '{}'::text[]) into v_lines
    from pg_catalog.unnest(coalesce(p_lines, '{}'::text[])) with ordinality as x(l, o)
   where pg_catalog.btrim(l) <> '';
  if cardinality(v_lines) not between 1 and 12
     or exists (select 1 from pg_catalog.unnest(v_lines) l where pg_catalog.char_length(l) > 200)
     or (v_title is not null and pg_catalog.char_length(v_title) > 80)
     or cardinality(v_sources) > 30
     or exists (select 1 from pg_catalog.unnest(v_sources) s where s is null or s !~ '^[0-9]{1,2}/[0-9]{1,2}-[0-9]{1,3}$') then
    raise exception using errcode = '22023', message = 'UPDATE_NEWS_SHAPE';
  end if;
  if p_id is null then
    insert into public.app_update_news (title, lines, sources, sent_by)
    values (v_title, v_lines, v_sources, v_user)
    returning id into v_id;
  else
    update public.app_update_news u
       set title = v_title, lines = v_lines, sources = v_sources, edited_at = pg_catalog.now()
     where u.id = p_id and u.withdrawn_at is null
    returning u.id into v_id;
    if v_id is null then
      raise exception using errcode = 'P0002', message = 'UPDATE_NEWS_NOT_FOUND';
    end if;
  end if;
  return v_id;
end
$$;

create function public.app_update_news_withdraw(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.app_update_news_operator() then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  update public.app_update_news u set withdrawn_at = pg_catalog.now()
   where u.id = p_id and u.withdrawn_at is null;
  return found;
end
$$;

create function public.app_update_news_set_start(p_start date)
returns date
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.app_update_news_operator() then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  if p_start is null or p_start < date '2026-01-01' or p_start > date '2100-01-01' then
    raise exception using errcode = '22023', message = 'UPDATE_NEWS_START';
  end if;
  insert into public.app_update_news_start (id, start_on, updated_at)
  values (1, p_start, pg_catalog.now())
  on conflict (id) do update set start_on = excluded.start_on, updated_at = excluded.updated_at
    where public.app_update_news_start.id = 1;
  return p_start;
end
$$;

revoke all on function private.app_update_news_operator() from public, anon, authenticated, service_role;
revoke all on function public.app_update_news_list() from public, anon, authenticated, service_role;
revoke all on function public.app_update_news_seen() from public, anon, authenticated, service_role;
revoke all on function public.app_update_news_admin() from public, anon, authenticated, service_role;
revoke all on function public.app_update_news_save(uuid, text, text[], text[]) from public, anon, authenticated, service_role;
revoke all on function public.app_update_news_withdraw(uuid) from public, anon, authenticated, service_role;
revoke all on function public.app_update_news_set_start(date) from public, anon, authenticated, service_role;
grant execute on function public.app_update_news_list() to authenticated;
grant execute on function public.app_update_news_seen() to authenticated;
grant execute on function public.app_update_news_admin() to authenticated;
grant execute on function public.app_update_news_save(uuid, text, text[], text[]) to authenticated;
grant execute on function public.app_update_news_withdraw(uuid) to authenticated;
grant execute on function public.app_update_news_set_start(date) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['public.app_update_news', 'public.app_update_news_start', 'public.app_update_news_reads'] loop
    if not (select relrowsecurity from pg_class where oid = t::regclass)
       or exists (select 1 from pg_policy where polrelid = t::regclass)
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('authenticated', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger') then
      raise exception 'UPDATE_NEWS_POSTCHECK_FAILED: %', t;
    end if;
  end loop;
  if (select count(*) from pg_proc where oid in (to_regprocedure('private.app_update_news_operator()'), to_regprocedure('public.app_update_news_list()'),
        to_regprocedure('public.app_update_news_seen()'), to_regprocedure('public.app_update_news_admin()'),
        to_regprocedure('public.app_update_news_save(uuid,text,text[],text[])'), to_regprocedure('public.app_update_news_withdraw(uuid)'),
        to_regprocedure('public.app_update_news_set_start(date)'))
        and prosecdef and proconfig = array['search_path=""']) <> 7
     or has_function_privilege('authenticated', 'private.app_update_news_operator()', 'execute')
     or has_function_privilege('anon', 'private.app_update_news_operator()', 'execute')
     or exists (select 1 from unnest(array['public.app_update_news_list()', 'public.app_update_news_seen()',
        'public.app_update_news_admin()', 'public.app_update_news_save(uuid,text,text[],text[])', 'public.app_update_news_withdraw(uuid)',
        'public.app_update_news_set_start(date)']) f
        where has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute')
           or not has_function_privilege('authenticated', f, 'execute')) then
    raise exception 'UPDATE_NEWS_POSTCHECK_FAILED: functions';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261115200000', 'update_news', array['UPDATE user-facing update news: new tables app_update_news, app_update_news_start (single row), app_update_news_reads (RLS on, no policies, no API privileges); private.app_update_news_operator() (owner of a workspace with operator feature dev_inbox via private.app_workspace_has_feature); authenticated readers app_update_news_list() and app_update_news_seen() (sent on/after the operator start date, not withdrawn); operator-only app_update_news_admin(), app_update_news_save(uuid,text,text[],text[]), app_update_news_withdraw(uuid), app_update_news_set_start(date) (42501 otherwise); no anon or service_role execute']);
commit;
