begin;
-- S68-46 UPDATE-소식자동(명진 11/23 12:37 "업데이트 기록 기본 자동으로 보내고 수동으로는 회수 가능하게").
-- 새 개발 기록(app/release-notes/*.json)이 main에 배포되면 서버가 이용자 '업데이트 소식'으로 바로 보낸다. 운영자는 거두기(기존 길)·다시 보내기만 한다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(확장 규칙)으로만 한다. 새 Edge 배포 없음(Edge release-notes-sync는 몸통을 그대로 넘긴다).
--
-- 무엇:
--  1) app_update_news에 칸 둘: auto(서버가 자동으로 보낸 소식인가, 기본 false), source_files(그 소식이 된 기록 파일 이름 — 버전명은 같은 날 기록이
--     늦게 merge되면 순번이 밀리므로 파일 이름으로 '이미 보낸 기록'을 가린다). 표 권한·정책·RLS 그대로(API 역할 권한 없음).
--  2) private.app_update_news_auto(이전 묶음, 새 묶음): 새 묶음에 있고 이전 묶음에 없던 기록 파일만 소식 한 개씩으로 넣는다(제목 없음, 줄 = 바뀐 점,
--     '폰에서 볼 것'은 빼기 — 손으로 보낼 때 기본과 같음). 실행권 없음(아래 3의 DEFINER 함수 안에서만 불림).
--     - 옛 기록은 보내지 않는다: 이전 묶음에 파일 이름 칸(file)이 하나도 없으면(이 변경 전 빌드가 만든 묶음) 아무것도 보내지 않는다. 그다음 묶음부터 차이만.
--     - 한 번 다룬 파일은 다시 보내지 않는다(거둔 것 포함 — 어느 소식의 source_files에라도 있으면 건너뜀). 옛 커밋을 다시 배포했다 돌아와도 같다.
--     - 모양이 틀린 기록(버전명·파일 이름·줄 수·글자 수)은 건너뛴다. 한 번에 20개 넘게 새로 보이면 이상한 경우로 보고 하나도 보내지 않는다.
--     - 보낸 사람은 운영자(dev_inbox 허용 작업공간 owner). 없으면 보내지 않는다. 시작 날짜가 없으면 오늘(서울)로 정한다(전에는 아무것도 안 보이던 상태).
--     - 폰 알림·점·숫자는 없다(업데이트 소식은 원래 알림이 없음 — 메뉴 › 업데이트 소식을 눌러야 보임).
--  3) public.app_release_notes_put 같은 서명·같은 검사로 다시: 이전 묶음을 잠가 읽고(for update) 바꾼 뒤 2)를 부른다. 돌려주는 값에 auto(보낸 개수, 건너뜀은 음수) 더함.
--  4) public.app_update_news_admin 같은 서명으로 다시: 항목에 auto·source_files를 더한다(운영자만).
--  5) public.app_update_news_resend(id) — authenticated, 운영자만(서버 판정): 거둔 소식을 다시 보이게(withdrawn_at 비움, 보낸 시각 그대로).
-- 권한: 새 공개 함수 실행권은 app_update_news_resend만 authenticated. anon·PUBLIC·service_role 없음. app_release_notes_put은 지금처럼 service_role만.
-- 안 하는 것: 운영자 기능 표·기존 정책·표 권한 변경, 다른 표, rtw_* 객체, 알림 보내기, 이용자 읽기 함수(list·seen) 변경.
-- 되돌리기: docs/20261123150000_update_news_auto.rollback.sql(SQL Editor 전용 — 함수 둘을 이전 본문으로 되돌림).
-- 짝: docs/20261123150000_update_news_auto.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다. 다시 정의하는 두 함수는 저장소 원문 판이어야 한다(되돌리기가 그 판으로 돌아가므로).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261123150000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115190000' and name = 'release_notes_store') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115200000' and name = 'update_news') <> 1
     or to_regclass('public.app_update_news') is null
     or to_regclass('public.app_update_news_start') is null
     or to_regclass('public.app_release_notes') is null
     or exists (select 1 from pg_attribute where attrelid = 'public.app_update_news'::regclass
         and attname in ('auto', 'source_files') and not attisdropped)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_release_notes_put(jsonb,text)')
         and prosecdef and proconfig = array['search_path=""'] and md5(prosrc) = 'e83753fbe9d1088cf171c6f32806e35d')
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_update_news_admin()')
         and prosecdef and proconfig = array['search_path=""'] and md5(prosrc) = 'e56d58a037be4749c5047593761a6e2a')
     or to_regprocedure('private.app_update_news_operator()') is null
     or to_regprocedure('private.app_update_news_auto(jsonb,jsonb)') is not null
     or to_regprocedure('public.app_update_news_resend(uuid)') is not null then
    raise exception 'UPDATE_NEWS_AUTO_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 자동 표시 + 기록 파일 이름.
alter table public.app_update_news
  add column auto boolean not null default false,
  add column source_files text[] not null default '{}'::text[];
alter table public.app_update_news
  add constraint app_update_news_source_files check (cardinality(source_files) <= 30);

-- 2) 새 기록 → 소식(서버 안에서만).
create function private.app_update_news_auto(p_old jsonb, p_new jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_file_re constant text := '^[0-9]{8}-[0-9]{4}-[a-z0-9][a-z0-9-]{0,59}$';
  v_sender uuid;
  v_new jsonb;
  v_count integer;
  v_sent integer := 0;
  v_note jsonb;
  v_lines text[];
begin
  if p_old is null or p_new is null
     or pg_catalog.jsonb_typeof(p_old -> 'notes') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_new -> 'notes') is distinct from 'array'
     or not exists (select 1 from pg_catalog.jsonb_array_elements(p_old -> 'notes') o
                     where pg_catalog.jsonb_typeof(o) = 'object' and (o ->> 'file') ~ v_file_re) then
    return 0;
  end if;

  select coalesce(pg_catalog.jsonb_agg(x.n order by x.f), '[]'::jsonb) into v_new
    from (select distinct on (n ->> 'file') n ->> 'file' as f, n
            from pg_catalog.jsonb_array_elements(p_new -> 'notes') n
           where pg_catalog.jsonb_typeof(n) = 'object'
             and (n ->> 'file') ~ v_file_re
             and not exists (select 1 from pg_catalog.jsonb_array_elements(p_old -> 'notes') o
                              where pg_catalog.jsonb_typeof(o) = 'object' and (o ->> 'file') = (n ->> 'file'))
             and not exists (select 1 from public.app_update_news u where (n ->> 'file') = any (u.source_files))
           order by n ->> 'file') x;
  v_count := pg_catalog.jsonb_array_length(v_new);
  if v_count = 0 then
    return 0;
  end if;
  if v_count > 20 then
    return -v_count;
  end if;

  select m.user_id into v_sender
    from public.app_operator_features f
    join public.app_workspace_members m on m.workspace_id = f.workspace_id and m.role = 'owner'
   where f.feature = 'dev_inbox'
   order by m.user_id
   limit 1;
  if v_sender is null then
    return 0;
  end if;

  insert into public.app_update_news_start (id, start_on, updated_at)
  values (1, (pg_catalog.now() at time zone 'Asia/Seoul')::date, pg_catalog.now())
  on conflict (id) do nothing;

  for v_note in select e.value from pg_catalog.jsonb_array_elements(v_new) with ordinality as e(value, o) order by e.o loop
    if (v_note ->> 'v') is null or (v_note ->> 'v') !~ '^[0-9]{1,2}/[0-9]{1,2}-[0-9]{1,3}$'
       or pg_catalog.jsonb_typeof(v_note -> 'changes') is distinct from 'array'
       or exists (select 1 from pg_catalog.jsonb_array_elements(v_note -> 'changes') c where pg_catalog.jsonb_typeof(c) <> 'string') then
      continue;
    end if;
    select coalesce(pg_catalog.array_agg(pg_catalog.btrim(c) order by o), '{}'::text[]) into v_lines
      from pg_catalog.jsonb_array_elements_text(v_note -> 'changes') with ordinality as x(c, o)
     where pg_catalog.btrim(c) <> '';
    if cardinality(v_lines) not between 1 and 12
       or exists (select 1 from pg_catalog.unnest(v_lines) l where pg_catalog.char_length(l) > 200) then
      continue;
    end if;
    insert into public.app_update_news (title, lines, sources, source_files, sent_by, sent_at, auto)
    values (null, v_lines, array[v_note ->> 'v'], array[v_note ->> 'file'], v_sender, pg_catalog.clock_timestamp(), true);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end
$$;

-- 3) 묶음 저장(같은 서명·같은 검사) + 자동 보내기.
create or replace function public.app_release_notes_put(p_notes jsonb, p_commit text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_auto integer;
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
  select r.notes into v_old from public.app_release_notes r where r.id = 1 for update;
  insert into public.app_release_notes (id, notes, commit_sha, updated_at)
  values (1, p_notes, p_commit, pg_catalog.now())
  on conflict (id) do update set notes = excluded.notes, commit_sha = excluded.commit_sha, updated_at = excluded.updated_at
    where public.app_release_notes.id = 1;
  v_auto := private.app_update_news_auto(v_old, p_notes);
  return pg_catalog.jsonb_build_object('ok', true, 'count', pg_catalog.jsonb_array_length(p_notes -> 'notes'), 'auto', v_auto);
end
$$;

-- 4) 운영자 관리 목록에 auto·source_files.
create or replace function public.app_update_news_admin()
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
               'sources', pg_catalog.to_jsonb(u.sources), 'source_files', pg_catalog.to_jsonb(u.source_files), 'auto', u.auto,
               'sent_at', u.sent_at, 'edited_at', u.edited_at, 'withdrawn_at', u.withdrawn_at,
               'reads', (select pg_catalog.count(*) from public.app_update_news_reads r where r.news_id = u.id and r.user_id <> v_user))
             order by u.sent_at desc)
        from public.app_update_news u), '[]'::jsonb));
end
$$;

-- 5) 거둔 소식 다시 보내기(운영자만).
create function public.app_update_news_resend(p_id uuid)
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
  update public.app_update_news u set withdrawn_at = null
   where u.id = p_id and u.withdrawn_at is not null;
  return found;
end
$$;

revoke all on function private.app_update_news_auto(jsonb, jsonb) from public;
revoke all on function private.app_update_news_auto(jsonb, jsonb) from anon;
revoke all on function private.app_update_news_auto(jsonb, jsonb) from authenticated;
revoke all on function private.app_update_news_auto(jsonb, jsonb) from service_role;
revoke all on function public.app_release_notes_put(jsonb, text) from public;
revoke all on function public.app_release_notes_put(jsonb, text) from anon;
revoke all on function public.app_release_notes_put(jsonb, text) from authenticated;
revoke all on function public.app_release_notes_put(jsonb, text) from service_role;
grant execute on function public.app_release_notes_put(jsonb, text) to service_role;
revoke all on function public.app_update_news_admin() from public;
revoke all on function public.app_update_news_admin() from anon;
revoke all on function public.app_update_news_admin() from authenticated;
revoke all on function public.app_update_news_admin() from service_role;
grant execute on function public.app_update_news_admin() to authenticated;
revoke all on function public.app_update_news_resend(uuid) from public;
revoke all on function public.app_update_news_resend(uuid) from anon;
revoke all on function public.app_update_news_resend(uuid) from authenticated;
revoke all on function public.app_update_news_resend(uuid) from service_role;
grant execute on function public.app_update_news_resend(uuid) to authenticated;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_update_news'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_update_news'::regclass)
     or has_table_privilege('anon', 'public.app_update_news', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_update_news', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_update_news', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from pg_proc where oid in (to_regprocedure('private.app_update_news_auto(jsonb,jsonb)'),
           to_regprocedure('public.app_release_notes_put(jsonb,text)'), to_regprocedure('public.app_update_news_admin()'),
           to_regprocedure('public.app_update_news_resend(uuid)'))
           and prosecdef and proconfig = array['search_path=""']) <> 4
     or has_function_privilege('anon', 'private.app_update_news_auto(jsonb,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'private.app_update_news_auto(jsonb,jsonb)', 'execute')
     or has_function_privilege('service_role', 'private.app_update_news_auto(jsonb,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.app_release_notes_put(jsonb,text)', 'execute')
     or has_function_privilege('authenticated', 'public.app_release_notes_put(jsonb,text)', 'execute')
     or not has_function_privilege('service_role', 'public.app_release_notes_put(jsonb,text)', 'execute')
     or exists (select 1 from unnest(array['public.app_update_news_admin()', 'public.app_update_news_resend(uuid)']) f
         where has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute')
            or not has_function_privilege('authenticated', f, 'execute')) then
    raise exception 'UPDATE_NEWS_AUTO_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261123150000', 'update_news_auto', array['UPDATE news auto-send: app_update_news gets auto boolean and source_files text[] (no privilege or policy change); private.app_update_news_auto(jsonb,jsonb) (no API execute) inserts one news per release-note file that is new compared with the previous stored bundle (none when the previous bundle has no file names, never a file already in any news, skips malformed notes, none when more than 20 are new; sender is the dev_inbox owner; sets the start date to today only when none); app_release_notes_put same signature and checks, locks the previous bundle and calls it (service_role only); app_update_news_admin adds auto and source_files; new operator-only app_update_news_resend(uuid) for authenticated clears withdrawn_at']);
commit;
