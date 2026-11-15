begin;
-- 되돌리기(SQL Editor 새 쿼리 창, 폰 경로 C): 적용 전 쓰기 정책과 쓰기 권한을 그대로 되살리고 기록 1행을 지운다.
-- 정책: 적용 때 이 migration 기록 행 statements[2..]에 남긴 원래 create policy 문장을 그대로 실행한다(이름·명령·대상·조건 그대로).
--   실행 전 snapshot 캡처의 'restore policy' 줄과 같은 문장인지 아래 select로 먼저 본다:
--   select unnest(statements[2:]) from supabase_migrations.schema_migrations where version = '20261029234500';
-- 권한: 기본값은 Supabase가 public 표에 주는 기본 권한(anon·authenticated 쓰기 전체)이다.
--   실행 전 snapshot 캡처의 'grant' 줄과 대조해, 적용 전에 없던 권한은 아래 grant 목록에서 빼고 실행한다(권한을 원래보다 넓히지 않기).
-- 행·칸·RLS·select 권한·읽기 정책은 건드리지 않는다. 되돌리면 적용 전 쓰기 경로도 그대로 돌아온다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations
                  where version = '20261029234500' and name = 'web1_upcoming_events_readonly')
     or to_regclass('public.main_upcoming_events') is null
     or exists (select 1 from pg_policy where polrelid = to_regclass('public.main_upcoming_events') and polcmd in ('a', 'w', 'd', '*')) then
    raise exception 'WEB1_UPCOMING_EVENTS_ROLLBACK_PREREQUISITE: history row missing, table missing or write policy already present; stop';
  end if;
end
$$;

-- 기록에 남은 문장만, 이 표의 쓰기 정책 모양일 때만 실행한다(다른 문장이면 전체 취소).
do $$
declare
  v_sql text;
begin
  for v_sql in
    select s from supabase_migrations.schema_migrations m, unnest(m.statements[2:]) with ordinality u(s, n)
     where m.version = '20261029234500' and m.name = 'web1_upcoming_events_readonly'
     order by u.n
  loop
    if v_sql !~ '^create policy ("[^"]+"|[a-z_][a-z0-9_$]*) on public\.main_upcoming_events as permissive for (insert|update|delete) to [a-z_", ]+( using \(true\))?( with check \(true\))?$'
       or v_sql ~ ';' then
      raise exception 'WEB1_UPCOMING_EVENTS_ROLLBACK_STATEMENT: unexpected restore statement; stop';
    end if;
    execute v_sql;
  end loop;
end
$$;

grant insert, update, delete, truncate, references, trigger on table public.main_upcoming_events to anon, authenticated;

delete from supabase_migrations.schema_migrations where version = '20261029234500' and name = 'web1_upcoming_events_readonly';
commit;
