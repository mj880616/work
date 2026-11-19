begin;
-- SEC-기능PIN잠금 노트 폴더 잠금(DB). 명진 11/19 20:37 "노트는 특정 폴더만 잠금 가능하게". 설계 docs/design/feature-pin-lock.md 6절.
-- 앞 단계 20261119200000_feature_pin_lock(운영 적용됨)은 한 줄도 바꾸지 않고 더하기만 한다: 같은 PIN(app_feature_locks의 해시)·
-- 같은 틀린 횟수 셈(private.app_lock_try)을 그대로 쓴다. 다시 잠그기는 화면이 기능 잠금과 같은 규칙으로 한다(풀림은 화면 메모리에만).
--
-- 무엇: 새 표 1개(잠근 노트 폴더: 사람·폴더 한 쌍마다 한 줄)와 공개 함수 2개.
--   잠금은 화면 가림(편의 장치)이다. 노트·폴더 자체의 접근 권한(owner 경계·RLS)은 그대로이고 이 파일은 그것을 바꾸지 않는다.
-- 보안(AGENTS.md 3절):
--   - 새 표: RLS 켬, 정책 없음, anon·authenticated·service_role·PUBLIC 표 권한 없음. 읽기·쓰기는 아래 함수로만.
--   - 공개 함수: SECURITY DEFINER, search_path = '', auth.uid() 없으면 거절(42501), PUBLIC·anon·service_role 실행 회수, authenticated만 실행.
--     사람 id·작업공간 id를 클라이언트에서 받지 않는다. 폴더는 서버가 폴더 줄의 작업공간을 읽어 private.app_is_workspace_owner가 참일 때만
--     받는다(없는 폴더·남의 폴더는 같은 오류 LOCK_FOLDER_FORBIDDEN, 구분해 알려 주지 않음).
--   - 잠그기·풀기는 지금 PIN이 맞아야 한다(틀리면 기능 잠금과 같은 횟수에 셈, 막힌 동안은 거절). PIN 원문·해시는 이 파일에서 다루지 않는다.
--   - 사람마다 잠근 폴더는 50개까지(LOCK_FOLDER_LIMIT). 폴더가 지워지면 그 줄도 함께 지워진다(on delete cascade).
--   - 기존 표·정책·권한·트리거·자료는 한 줄도 바꾸지 않는다.
-- 짝: docs/20261119233000_note_folder_lock.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261119233000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261119200000' and name = 'feature_pin_lock') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261028170000' and name = 'note_folders') <> 1
     or to_regclass('public.app_feature_locks') is null
     or to_regclass('public.app_note_folders') is null
     or to_regprocedure('private.app_lock_try(uuid,text)') is null
     or to_regprocedure('private.app_lock_pin_shape(text)') is null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or to_regprocedure('auth.uid()') is null
     or to_regclass('public.app_note_folder_locks') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.proname like 'app\_lock\_note\_folder%') then
    raise exception 'NOTE_FOLDER_LOCK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 표 ---------------------------------------------------------------------------------------------

create table public.app_note_folder_locks (
  user_id uuid not null,
  folder_id uuid not null references public.app_note_folders(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, folder_id)
);
create index app_note_folder_locks_folder_idx on public.app_note_folder_locks(folder_id);

alter table public.app_note_folder_locks enable row level security;
revoke all on table public.app_note_folder_locks from public, anon, authenticated, service_role;

-- 공개 함수 -------------------------------------------------------------------------------------------

-- 내가 잠근 노트 폴더 id 목록(지금도 내 작업공간에 있는 폴더만). 폴더 이름·노트 내용은 돌려주지 않는다.
create function public.app_lock_note_folders()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'LOCK_AUTH_REQUIRED';
  end if;
  return pg_catalog.jsonb_build_object('folders', coalesce((
    select pg_catalog.jsonb_agg(l.folder_id order by l.folder_id)
      from public.app_note_folder_locks l
      join public.app_note_folders f on f.id = l.folder_id
     where l.user_id = v_uid and private.app_is_workspace_owner(f.workspace_id)), '[]'::jsonb));
end
$$;
revoke all on function public.app_lock_note_folders() from public, anon, authenticated, service_role;
grant execute on function public.app_lock_note_folders() to authenticated;

-- 노트 폴더 하나를 잠그거나(p_locked true) 풀기(false). 지금 PIN이 맞아야 바뀐다(틀리면 횟수에 셈). 결과: 대조 결과 + 잠근 폴더 목록.
create function public.app_lock_note_folder_set(p_pin text, p_folder uuid, p_locked boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ws uuid;
  v_try jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'LOCK_AUTH_REQUIRED';
  end if;
  if not private.app_lock_pin_shape(p_pin) then
    raise exception using errcode = '22023', message = 'LOCK_PIN_FORMAT';
  end if;
  if p_folder is null or p_locked is null then
    raise exception using errcode = '22023', message = 'LOCK_SETTINGS_INVALID';
  end if;
  select f.workspace_id into v_ws from public.app_note_folders f where f.id = p_folder;
  if v_ws is null or not private.app_is_workspace_owner(v_ws) then
    raise exception using errcode = '42501', message = 'LOCK_FOLDER_FORBIDDEN';
  end if;
  v_try := private.app_lock_try(v_uid, p_pin);
  if not (v_try->>'ok')::boolean then
    return v_try;
  end if;
  if p_locked then
    if not exists (select 1 from public.app_note_folder_locks where user_id = v_uid and folder_id = p_folder)
       and (select count(*) from public.app_note_folder_locks where user_id = v_uid) >= 50 then
      raise exception using errcode = '22023', message = 'LOCK_FOLDER_LIMIT';
    end if;
    insert into public.app_note_folder_locks (user_id, folder_id) values (v_uid, p_folder)
    on conflict (user_id, folder_id) do nothing;
  else
    delete from public.app_note_folder_locks where user_id = v_uid and folder_id = p_folder;
  end if;
  return v_try || pg_catalog.jsonb_build_object('folders', coalesce((
    select pg_catalog.jsonb_agg(l.folder_id order by l.folder_id)
      from public.app_note_folder_locks l
      join public.app_note_folders f on f.id = l.folder_id
     where l.user_id = v_uid and private.app_is_workspace_owner(f.workspace_id)), '[]'::jsonb));
end
$$;
revoke all on function public.app_lock_note_folder_set(text, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.app_lock_note_folder_set(text, uuid, boolean) to authenticated;

-- 사후 확인(같은 트랜잭션): 표 닫힘, 함수 모양·권한, 앞 단계 함수 그대로.
do $$
begin
  if not exists (select 1 from pg_class c where c.oid = to_regclass('public.app_note_folder_locks') and c.relrowsecurity)
     or exists (select 1 from pg_policy p where p.polrelid = to_regclass('public.app_note_folder_locks'))
     or has_table_privilege('anon', 'public.app_note_folder_locks', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_note_folder_locks', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_note_folder_locks', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'app\_lock\_note\_folder%'
            and p.prosecdef and p.proconfig = array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute')
            and not has_function_privilege('service_role', p.oid, 'execute')
            and has_function_privilege('authenticated', p.oid, 'execute')
            and not exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0)) <> 2
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'private') and p.proname like 'app\_lock\_note\_folder%') <> 2
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'app\_lock\_%') <> 8
     or (select count(*) from public.app_note_folder_locks) <> 0 then
    raise exception 'NOTE_FOLDER_LOCK_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261119233000', 'note_folder_lock', array['SEC feature PIN lock, note folders: 1 new table app_note_folder_locks (user and note folder pairs, cascade with the folder; RLS on, no policies, no anon/authenticated/service_role privileges); 2 public SECURITY DEFINER RPCs with empty search_path, auth.uid() required, authenticated execute only (lock_note_folders read, lock_note_folder_set with the same PIN and server-side tries of feature_pin_lock, folder owner checked by the server, at most 50 folders); feature_pin_lock objects and every existing table, policy, grant or row unchanged']);
commit;
