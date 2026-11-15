begin;
-- SEC-옛표쓰기정리: 옛 Web1 일정 표(main_upcoming_events)의 쓰기 권한 정리. 저장소의 어떤 화면·함수도 이 표를 쓰지 않는다(#243에서 Web1 첫 페이지 일정 칸 삭제).
-- anon·authenticated·PUBLIC의 쓰기 권한(insert·update·delete·truncate·references·trigger)을 회수하고, 쓰기 정책(INSERT·UPDATE·DELETE)을 지운다.
-- 읽기(select) 권한·읽기 정책·RLS 설정·행·칸은 바꾸지 않는다. 새 권한을 주지 않는다. service_role·소유자(SQL Editor)는 그대로 쓸 수 있다.
-- 이 표는 저장소 migration 밖에서 만들어져 정책 이름이 저장소에 없다. 그래서 지우는 정책은 이름이 아니라 아래 guard가 허용한 모양으로 고르고,
-- 지우기 전 원래 정의(create policy 문장)를 이 migration 기록 행의 statements에 그대로 남긴다(짝 rollback이 이것으로 되살린다).
-- 동적 실행(EXECUTE)과 DROP POLICY가 있어 승인형 DB workflow가 거절한다 → SQL Editor 경로(폰 경로 C) 전용.
-- 짝: docs/20261029234500_web1_upcoming_events_readonly.*
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1) 사전 guard: 이미 적용됨·표 없음·예상 밖 정책 모양이면 아무것도 바꾸지 않고 멈춘다.
--    지울 수 있는 정책 = permissive, 명령 INSERT·UPDATE·DELETE, 대상 PUBLIC·anon·authenticated 안, 조건이 없거나 true.
--    ALL 정책·restrictive 쓰기 정책·조건 있는 쓰기 정책이 있으면 멈춘다(읽기까지 묶이거나 운영자가 따로 만든 것일 수 있음).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029234500')
     or to_regclass('public.main_upcoming_events') is null
     or exists (
       select 1 from pg_policy p
        where p.polrelid = to_regclass('public.main_upcoming_events')
          and (p.polcmd = '*'
               or (p.polcmd in ('a', 'w', 'd')
                   and (not p.polpermissive
                        or coalesce(pg_get_expr(p.polqual, p.polrelid), 'true') <> 'true'
                        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), 'true') <> 'true'
                        or exists (select 1 from unnest(p.polroles) r(oid)
                                    where r.oid <> 0 and r.oid not in ('anon'::regrole::oid, 'authenticated'::regrole::oid)))))) then
    raise exception 'WEB1_UPCOMING_EVENTS_PREREQUISITE_CHANGED: already applied, table missing or unexpected policy shape; stop';
  end if;
end
$$;

-- 2) 지우기 전 상태를 이 트랜잭션 안에만 기억한다(읽기 권한 비교, 되살리기 문장).
select set_config('web1_upcoming.read_before',
  (select string_agg(r || '=' || has_table_privilege(r, 'public.main_upcoming_events', 'select')::text, ',' order by r)
     from unnest(array['anon', 'authenticated']) r), true);
select set_config('web1_upcoming.read_policies_before',
  (select count(*)::text from pg_policy where polrelid = to_regclass('public.main_upcoming_events') and polcmd = 'r'), true);
select set_config('web1_upcoming.restore',
  coalesce((select string_agg(
      format('create policy %I on public.main_upcoming_events as permissive for %s to %s%s%s',
        p.polname,
        case p.polcmd when 'a' then 'insert' when 'w' then 'update' else 'delete' end,
        (select string_agg(case when r.oid = 0 then 'public' else quote_ident(r.oid::regrole::text) end, ', ' order by r.oid)
           from unnest(p.polroles) r(oid)),
        case when p.polqual is null then '' else ' using (' || pg_get_expr(p.polqual, p.polrelid) || ')' end,
        case when p.polwithcheck is null then '' else ' with check (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')' end),
      E'\n' order by p.polname)
     from pg_policy p
    where p.polrelid = to_regclass('public.main_upcoming_events') and p.polcmd in ('a', 'w', 'd')), ''), true);

-- 3) 쓰기 정책 지우기(guard가 허용한 모양만 남아 있음).
do $$
declare
  v_name name;
begin
  for v_name in
    select polname from pg_policy
     where polrelid = to_regclass('public.main_upcoming_events') and polcmd in ('a', 'w', 'd')
     order by polname
  loop
    execute format('drop policy %I on public.main_upcoming_events', v_name);
  end loop;
end
$$;

-- 4) 쓰기 권한 회수. select는 그대로.
revoke insert, update, delete, truncate, references, trigger on table public.main_upcoming_events from public, anon, authenticated;

-- 5) 사후 guard: 쓰기 권한·쓰기 정책이 남았거나 읽기 쪽이 바뀌었으면 전체 취소.
do $$
begin
  if exists (select 1 from unnest(array['anon', 'authenticated']) r
              where has_table_privilege(r, 'public.main_upcoming_events', 'insert')
                 or has_table_privilege(r, 'public.main_upcoming_events', 'update')
                 or has_table_privilege(r, 'public.main_upcoming_events', 'delete')
                 or has_table_privilege(r, 'public.main_upcoming_events', 'truncate'))
     or exists (select 1 from pg_policy where polrelid = to_regclass('public.main_upcoming_events') and polcmd in ('a', 'w', 'd', '*'))
     or (select string_agg(r || '=' || has_table_privilege(r, 'public.main_upcoming_events', 'select')::text, ',' order by r)
           from unnest(array['anon', 'authenticated']) r) <> current_setting('web1_upcoming.read_before')
     or (select count(*)::text from pg_policy where polrelid = to_regclass('public.main_upcoming_events') and polcmd = 'r')
          <> current_setting('web1_upcoming.read_policies_before') then
    raise exception 'WEB1_UPCOMING_EVENTS_REVOKE_INCOMPLETE: write still allowed (role membership?) or read changed; rolled back';
  end if;
end
$$;

-- 6) 기록 1행. statements[1] = 설명, statements[2..] = 지운 정책의 원래 create policy 문장(rollback이 그대로 실행).
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029234500', 'web1_upcoming_events_readonly',
  array['SEC-옛표쓰기정리: revoke anon/authenticated/public writes and drop write policies on main_upcoming_events (select kept)']
  || coalesce(string_to_array(nullif(current_setting('web1_upcoming.restore'), ''), E'\n'), array[]::text[]));
commit;
