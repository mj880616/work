begin;
-- 20261125170000_reading_body_state_login_lead의 짝 되돌리기(승인형 workflow rollback 모드 또는 SQL Editor·폰 경로 C).
-- 먼저 Edge note-import와 화면을 이 변경 전 판으로 되돌린다(새 판은 lead·login을 저장한다).
-- 두 검사를 20261122100000_reading_items 판 글자 그대로로 되돌리고 이번 기록 1행만 지운다.
-- lead·login으로 저장된 줄이 하나라도 있으면 멈춘다(값을 지워서 통과시키지 않는다 — 남은 줄을 어떻게 할지 정한 뒤 다시 계획한다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_reading_items in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125170000' and name = 'reading_body_state_login_lead') <> 1 then
    raise exception 'READING_BODY_STATE_LOGIN_LEAD_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_reading_items where body_state in ('lead', 'login')) then
    raise exception 'READING_BODY_STATE_LOGIN_LEAD_ROLLBACK_BLOCKED: lead or login rows saved; decide them first';
  end if;
end
$$;

alter table public.app_reading_items drop constraint app_reading_items_body_state_check;
alter table public.app_reading_items
  add constraint app_reading_items_body_state_check check (
    body_state in ('pending', 'ok', 'paywall', 'bot_check', 'robots', 'too_big', 'blocked', 'failed'));
alter table public.app_reading_items drop constraint app_reading_items_body_check;
alter table public.app_reading_items
  add constraint app_reading_items_body_check check (
    (body is null or (body_state in ('ok', 'paywall') and char_length(body) between 1 and 200000
      and body !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'))
    and ((body_at is null) = (body_state = 'pending')));

delete from supabase_migrations.schema_migrations
  where version = '20261125170000' and name = 'reading_body_state_login_lead';
commit;
