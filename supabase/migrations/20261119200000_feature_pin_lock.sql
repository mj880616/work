begin;
-- SEC-기능PIN잠금 PR①(DB·서버). 설계 docs/design/feature-pin-lock.md(명진 11/19 "보안 기능 추가해줘. 네 자리 숫자 핀 번호를 기능별로", 시안 확정 "ㅇㅇ").
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지). 화면 PR은 적용 뒤.
--
-- 무엇: 새 표 1개(사람마다 한 줄: PIN 해시·잠근 기능·다시 잠그기·틀린 횟수)와 함수 9개(공개 RPC 6 + private 도우미 3).
--   잠금은 화면 가림(편의 장치)이다. 자료 자체의 접근 권한(owner 경계·RLS)은 그대로이고 이 파일은 그것을 바꾸지 않는다.
-- 보안(AGENTS.md 3절):
--   - 새 표: RLS 켬, 정책 없음, anon·authenticated·service_role·PUBLIC 표 권한 없음. 읽기·쓰기는 아래 함수로만.
--   - 공개 함수: SECURITY DEFINER, search_path = '', auth.uid() 없으면 거절(42501), PUBLIC·anon·service_role 실행 회수, authenticated만 실행.
--     user_id를 클라이언트에서 받지 않는다(늘 auth.uid()의 한 줄만).
--   - PIN 원문은 저장하지 않는다. 서버에서 bcrypt(pgcrypto crypt + gen_salt('bf', 10), 사람·바꿀 때마다 새 소금)로 해시해 저장하고 대조한다.
--     어떤 함수도 해시를 돌려주지 않는다. PIN은 숫자 4자리만 받는다.
--   - 틀린 횟수는 서버가 센다. 연속 5번 틀리면 막힘: 처음 15분, 막힐 때마다 두 배(30분·1시간…, 최대 24시간). 맞히면 0으로.
--     막힌 동안에는 대조하지 않는다(맞는 PIN도 거절). 틀림은 예외가 아니라 결과(jsonb)로 돌려줘 횟수 증가가 취소되지 않게 한다.
--   - PIN을 잊었을 때 새로 정하기는 '최근 10분 안에 로그인한 세션'(JWT amr의 로그인 시각)만 허용한다.
--   - 기존 표·정책·권한·자료는 한 줄도 바꾸지 않는다.
-- 짝: docs/20261119200000_feature_pin_lock.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261119200000')
     or to_regprocedure('extensions.crypt(text,text)') is null
     or to_regprocedure('extensions.gen_salt(text,integer)') is null
     or to_regprocedure('auth.uid()') is null
     or to_regprocedure('auth.jwt()') is null
     or to_regclass('public.app_feature_locks') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.proname like 'app\_lock\_%') then
    raise exception 'FEATURE_PIN_LOCK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 표 ---------------------------------------------------------------------------------------------

create table public.app_feature_locks (
  user_id uuid primary key,
  pin_hash text not null,
  features text[] not null default '{}'::text[],
  relock text not null default '5m',
  fail_count integer not null default 0,
  block_level integer not null default 0,
  blocked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_feature_locks_pin_hash_check check (char_length(pin_hash) = 60 and pin_hash like '$2%'),
  constraint app_feature_locks_features_check check (
    cardinality(features) <= 4 and features <@ array['diary', 'photos', 'calls', 'telegram']::text[]),
  constraint app_feature_locks_relock_check check (relock in ('now', '5m', '30m', 'close')),
  constraint app_feature_locks_fail_count_check check (fail_count between 0 and 4),
  constraint app_feature_locks_block_level_check check (block_level between 0 and 20)
);

alter table public.app_feature_locks enable row level security;
revoke all on table public.app_feature_locks from public, anon, authenticated, service_role;

-- private 도우미(실행권 아무에게도 없음 — DEFINER 공개 함수 안에서만 쓰임) ------------------------------------

-- PIN 모양: 숫자 4자리만.
create function private.app_lock_pin_shape(p_pin text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(p_pin ~ '^[0-9]{4}$', false)
$$;
revoke all on function private.app_lock_pin_shape(text) from public, anon, authenticated, service_role;

-- 잠글 기능 목록 정리: 정해진 4가지 안에서 겹침 없이 정렬. 모르는 이름이 있으면 null.
create function private.app_lock_clean_features(p_features text[])
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_features is null then '{}'::text[]
    when exists (select 1 from pg_catalog.unnest(p_features) f
                  where f is null or not (f = any (array['diary', 'photos', 'calls', 'telegram']::text[]))) then null
    else coalesce((select pg_catalog.array_agg(distinct f order by f) from pg_catalog.unnest(p_features) f), '{}'::text[])
  end
$$;
revoke all on function private.app_lock_clean_features(text[]) from public, anon, authenticated, service_role;

-- 대조 한 번: 그 사람 줄을 잠그고(for update) 막힘 확인 → 해시 대조 → 횟수 셈. 결과만 돌려준다(해시 없음).
create function private.app_lock_try(p_uid uuid, p_pin text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_row public.app_feature_locks%rowtype;
  v_level integer;
  v_until timestamptz;
begin
  select * into v_row from public.app_feature_locks where user_id = p_uid for update;
  if not found then
    raise exception using errcode = '22023', message = 'LOCK_PIN_MISSING';
  end if;
  if v_row.blocked_until is not null and v_row.blocked_until > now() then
    return pg_catalog.jsonb_build_object('ok', false, 'left', 0, 'blocked_until', v_row.blocked_until);
  end if;
  if extensions.crypt(p_pin, v_row.pin_hash) = v_row.pin_hash then
    update public.app_feature_locks
       set fail_count = 0, block_level = 0, blocked_until = null
     where user_id = p_uid;
    return pg_catalog.jsonb_build_object('ok', true, 'left', 5, 'blocked_until', null);
  end if;
  if v_row.fail_count + 1 >= 5 then
    v_level := least(v_row.block_level + 1, 20);
    v_until := now() + least(interval '15 minutes' * power(2, v_level - 1)::integer, interval '24 hours');
    update public.app_feature_locks
       set fail_count = 0, block_level = v_level, blocked_until = v_until
     where user_id = p_uid;
    return pg_catalog.jsonb_build_object('ok', false, 'left', 0, 'blocked_until', v_until);
  end if;
  update public.app_feature_locks
     set fail_count = v_row.fail_count + 1, blocked_until = null
   where user_id = p_uid;
  return pg_catalog.jsonb_build_object('ok', false, 'left', 5 - (v_row.fail_count + 1), 'blocked_until', null);
end
$$;
revoke all on function private.app_lock_try(uuid, text) from public, anon, authenticated, service_role;

-- 공개 함수 -------------------------------------------------------------------------------------------

-- 내 잠금 설정 읽기: PIN이 있는지·잠근 기능·다시 잠그기·막힘. 해시는 돌려주지 않는다.
create function public.app_lock_read()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.app_feature_locks%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'LOCK_AUTH_REQUIRED';
  end if;
  select * into v_row from public.app_feature_locks where user_id = v_uid;
  if not found then
    return pg_catalog.jsonb_build_object('has_pin', false, 'features', '[]'::jsonb, 'relock', '5m',
                                         'left', 5, 'blocked_until', null);
  end if;
  return pg_catalog.jsonb_build_object(
    'has_pin', true,
    'features', pg_catalog.to_jsonb(v_row.features),
    'relock', v_row.relock,
    'left', case when v_row.blocked_until > now() then 0 else 5 - v_row.fail_count end,
    'blocked_until', case when v_row.blocked_until > now() then v_row.blocked_until end);
end
$$;
revoke all on function public.app_lock_read() from public, anon, authenticated, service_role;
grant execute on function public.app_lock_read() to authenticated;

-- 처음 PIN 정하기(+ 처음 켠 기능·다시 잠그기). 이미 PIN이 있으면 거절(바꾸기는 app_lock_pin_change).
create function public.app_lock_setup(p_pin text, p_features text[], p_relock text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_features text[] := private.app_lock_clean_features(p_features);
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'LOCK_AUTH_REQUIRED';
  end if;
  if not private.app_lock_pin_shape(p_pin) then
    raise exception using errcode = '22023', message = 'LOCK_PIN_FORMAT';
  end if;
  if v_features is null or coalesce(p_relock, '') not in ('now', '5m', '30m', 'close') then
    raise exception using errcode = '22023', message = 'LOCK_SETTINGS_INVALID';
  end if;
  insert into public.app_feature_locks (user_id, pin_hash, features, relock)
  values (v_uid, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), v_features, p_relock)
  on conflict (user_id) do nothing;
  if not found then
    raise exception using errcode = '22023', message = 'LOCK_PIN_EXISTS';
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'features', pg_catalog.to_jsonb(v_features), 'relock', p_relock);
end
$$;
revoke all on function public.app_lock_setup(text, text[], text) from public, anon, authenticated, service_role;
grant execute on function public.app_lock_setup(text, text[], text) to authenticated;

-- PIN 대조(잠긴 화면 풀기). 결과만: ok·남은 횟수·막힌 끝 시각.
create function public.app_lock_check(p_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'LOCK_AUTH_REQUIRED';
  end if;
  if not private.app_lock_pin_shape(p_pin) then
    raise exception using errcode = '22023', message = 'LOCK_PIN_FORMAT';
  end if;
  return private.app_lock_try(v_uid, p_pin);
end
$$;
revoke all on function public.app_lock_check(text) from public, anon, authenticated, service_role;
grant execute on function public.app_lock_check(text) to authenticated;

-- 잠근 기능·다시 잠그기 바꾸기(켜기·끄기 모두). 지금 PIN이 맞아야 바뀐다(틀리면 횟수에 셈).
create function public.app_lock_save(p_pin text, p_features text[], p_relock text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_features text[] := private.app_lock_clean_features(p_features);
  v_try jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'LOCK_AUTH_REQUIRED';
  end if;
  if not private.app_lock_pin_shape(p_pin) then
    raise exception using errcode = '22023', message = 'LOCK_PIN_FORMAT';
  end if;
  if v_features is null or coalesce(p_relock, '') not in ('now', '5m', '30m', 'close') then
    raise exception using errcode = '22023', message = 'LOCK_SETTINGS_INVALID';
  end if;
  v_try := private.app_lock_try(v_uid, p_pin);
  if not (v_try->>'ok')::boolean then
    return v_try;
  end if;
  update public.app_feature_locks
     set features = v_features, relock = p_relock, updated_at = now()
   where user_id = v_uid;
  return v_try || pg_catalog.jsonb_build_object('features', pg_catalog.to_jsonb(v_features), 'relock', p_relock);
end
$$;
revoke all on function public.app_lock_save(text, text[], text) from public, anon, authenticated, service_role;
grant execute on function public.app_lock_save(text, text[], text) to authenticated;

-- PIN 바꾸기: 지금 PIN이 맞아야 새 PIN으로(새 소금).
create function public.app_lock_pin_change(p_pin text, p_new_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_try jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'LOCK_AUTH_REQUIRED';
  end if;
  if not private.app_lock_pin_shape(p_pin) or not private.app_lock_pin_shape(p_new_pin) then
    raise exception using errcode = '22023', message = 'LOCK_PIN_FORMAT';
  end if;
  v_try := private.app_lock_try(v_uid, p_pin);
  if not (v_try->>'ok')::boolean then
    return v_try;
  end if;
  update public.app_feature_locks
     set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)), updated_at = now()
   where user_id = v_uid;
  return v_try;
end
$$;
revoke all on function public.app_lock_pin_change(text, text) from public, anon, authenticated, service_role;
grant execute on function public.app_lock_pin_change(text, text) to authenticated;

-- PIN을 잊었을 때 새로 정하기: 이 요청의 세션이 최근 10분 안에 로그인한 것(JWT amr 로그인 시각)일 때만.
-- 잠근 기능·다시 잠그기는 그대로 두고, 틀린 횟수·막힘을 지운다.
create function public.app_lock_pin_renew(p_new_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_amr jsonb := (select auth.jwt()) -> 'amr';
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'LOCK_AUTH_REQUIRED';
  end if;
  if not private.app_lock_pin_shape(p_new_pin) then
    raise exception using errcode = '22023', message = 'LOCK_PIN_FORMAT';
  end if;
  if v_amr is null or pg_catalog.jsonb_typeof(v_amr) <> 'array' or not exists (
       select 1 from pg_catalog.jsonb_array_elements(v_amr) a
        where pg_catalog.jsonb_typeof(a) = 'object'
          and coalesce(a->>'timestamp', '') ~ '^[0-9]{9,11}$'
          and pg_catalog.to_timestamp((a->>'timestamp')::double precision) between now() - interval '10 minutes' and now() + interval '1 minute') then
    raise exception using errcode = '42501', message = 'LOCK_RECENT_LOGIN_REQUIRED';
  end if;
  update public.app_feature_locks
     set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)),
         fail_count = 0, block_level = 0, blocked_until = null, updated_at = now()
   where user_id = v_uid;
  if not found then
    raise exception using errcode = '22023', message = 'LOCK_PIN_MISSING';
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'left', 5, 'blocked_until', null);
end
$$;
revoke all on function public.app_lock_pin_renew(text) from public, anon, authenticated, service_role;
grant execute on function public.app_lock_pin_renew(text) to authenticated;

-- 사후 확인(같은 트랜잭션): 표 닫힘, 함수 모양·권한.
do $$
begin
  if not exists (select 1 from pg_class c where c.oid = to_regclass('public.app_feature_locks') and c.relrowsecurity)
     or exists (select 1 from pg_policy p where p.polrelid = to_regclass('public.app_feature_locks'))
     or has_table_privilege('anon', 'public.app_feature_locks', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_feature_locks', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_feature_locks', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'app\_lock\_%'
            and p.prosecdef and p.proconfig = array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute')
            and not has_function_privilege('service_role', p.oid, 'execute')
            and has_function_privilege('authenticated', p.oid, 'execute')
            and not exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0)) <> 6
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'app\_lock\_%') <> 6
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private' and p.proname like 'app\_lock\_%'
            and not p.prosecdef and p.proconfig = array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute')
            and not has_function_privilege('authenticated', p.oid, 'execute')
            and not has_function_privilege('service_role', p.oid, 'execute')) <> 3
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private' and p.proname like 'app\_lock\_%') <> 3
     or (select count(*) from public.app_feature_locks) <> 0 then
    raise exception 'FEATURE_PIN_LOCK_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261119200000', 'feature_pin_lock', array['SEC feature PIN lock: 1 new table app_feature_locks (RLS on, no policies, no anon/authenticated/service_role privileges; bcrypt pin_hash only, never the PIN); 6 public SECURITY DEFINER RPCs with empty search_path, auth.uid() required, authenticated execute only (lock_read, lock_setup, lock_check, lock_save, lock_pin_change, lock_pin_renew); 3 private invoker helpers with no execute grants; server-side wrong-try count with doubling block; no existing table, policy, grant or row changed']);
commit;
