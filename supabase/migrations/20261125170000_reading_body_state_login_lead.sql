begin;
-- S70-40a READ-실패까닭(명진 11/25 15:06 "여기 디자인이 전반적으로 영;" — [저장한 글]에서 로그인이 필요한 페이지를 '유료 기사'로 부름).
-- 저장한 글 원문 사본 상태에 두 값을 더한다: lead(본문을 못 찾아 메타 설명만 — 예전에는 paywall로 저장돼 '유료'로 불렸다) ·
-- login(로그인 화면이 와서 가져오지 못함 — 그 화면 제목·리드를 저장하지 않음). 설계 docs/design/reading-screens.md 2절 A5·A6, 6절 ②.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. Edge note-import 배포는 이 적용 뒤에(새 까닭 login을 돌려주므로).
--
-- 무엇: app_reading_items의 검사 둘을 지우고 같은 이름으로 다시 만든다(20261122100000_reading_items 판 글자에서 값만 넓힘).
--   1) app_reading_items_body_state_check: 허용 값에 lead·login 더함.
--   2) app_reading_items_body_check: 본문을 둘 수 있는 상태에 lead 더함(ok·paywall·lead). 글자 수·제어 문자·받은 시각 규칙은 그대로.
--   기존 행은 건드리지 않는다(옛 paywall 줄은 그대로 — 다시 가져오면 바른 상태로 바뀜).
-- 권한: grant·revoke·정책·RLS·함수·트리거·칸 변경 없음. 정책 reading_items_owner_all 그대로.
-- 앞 단계: 20261122100000_reading_items·20261122230000_reading_one_store 기록이 있어야 한다.
-- 짝: docs/20261125170000_reading_body_state_login_lead.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_reading_items in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125170000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261122100000' and name = 'reading_items') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261122230000' and name = 'reading_one_store') <> 1
     or to_regclass('public.app_reading_items') is null
     or exists (select 1 from pg_class where oid = 'public.app_reading_items'::regclass and not relrowsecurity)
     or (select count(*) from pg_constraint where conrelid = 'public.app_reading_items'::regclass and contype = 'c' and convalidated
         and conname in ('app_reading_items_body_state_check', 'app_reading_items_body_check')) <> 2
     -- 옛 모양 그대로여야 한다(20261122100000 판 — lead·login 없음).
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_reading_items_body_state_check'
           and check_clause ~ 'paywall' and check_clause ~ 'bot_check' and check_clause !~ '''lead''' and check_clause !~ '''login''') <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_reading_items_body_check'
           and check_clause ~ '200000' and check_clause ~ 'paywall' and check_clause !~ '''lead''') <> 1 then
    raise exception 'READING_BODY_STATE_LOGIN_LEAD_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_reading_items drop constraint app_reading_items_body_state_check;
alter table public.app_reading_items
  add constraint app_reading_items_body_state_check check (
    body_state in ('pending', 'ok', 'paywall', 'lead', 'bot_check', 'robots', 'too_big', 'blocked', 'login', 'failed'));
alter table public.app_reading_items drop constraint app_reading_items_body_check;
alter table public.app_reading_items
  add constraint app_reading_items_body_check check (
    (body is null or (body_state in ('ok', 'paywall', 'lead') and char_length(body) between 1 and 200000
      and body !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'))
    and ((body_at is null) = (body_state = 'pending')));

-- 사후 확인은 짝 postcheck(읽기 전용)로 한다.

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125170000', 'reading_body_state_login_lead', array['S70-40a READ-fail-reason: app_reading_items_body_state_check and app_reading_items_body_check rebuilt on the reading_items version with body_state also accepting lead (meta description only) and login (login page), body allowed for ok, paywall and lead; no privilege, policy, RLS, function, trigger or column change; existing rows untouched']);
commit;
