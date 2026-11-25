begin;
-- 20261125235000_ai_usage_events의 짝 되돌리기. 새 표 app_ai_usage_events(색인·정책 포함)를 지우고,
-- app_ai_cost_entries 검사 두 개(kind·month)를 원래 모양(topup·bill)으로 되돌리고, 이번 기록 1행만 지운다.
-- 되돌리기 전에 Edge(5단계에서 이 표에 넣는 함수들)·화면(6단계)을 이 표를 쓰지 않는 이전 판으로 먼저 되돌린다.
-- 명진이 넣은 'cap'·'reload' 금액 줄이 있으면 멈춘다(자료를 몰래 지우지 않는다. 그 줄을 지울지는 명진이 정한 뒤 화면에서 지운다).
-- 지우면 기능별 사용 기록(숫자만)이 사라진다. 하루 한도·월 상한·홈 사용량 줄이 쓰는 app_ai_daily_usage 등은 그대로다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 표 삭제를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_ai_cost_entries in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125235000' and name = 'ai_usage_events') <> 1 then
    raise exception 'AI_USAGE_EVENTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_ai_cost_entries where kind in ('cap', 'reload')) then
    raise exception 'AI_USAGE_EVENTS_ROLLBACK_BLOCKED: cap or reload rows exist';
  end if;
end
$$;

drop table public.app_ai_usage_events;
alter table public.app_ai_cost_entries drop constraint app_ai_cost_entries_kind_check;
alter table public.app_ai_cost_entries add constraint app_ai_cost_entries_kind_check check (kind in ('topup', 'bill'));
alter table public.app_ai_cost_entries drop constraint app_ai_cost_entries_month_check;
alter table public.app_ai_cost_entries add constraint app_ai_cost_entries_month_check check (
  (kind = 'topup' and month is null)
  or (kind = 'bill' and month is not null and extract(day from month) = 1 and month >= date '2026-01-01'));

delete from supabase_migrations.schema_migrations
  where version = '20261125235000' and name = 'ai_usage_events';
commit;
