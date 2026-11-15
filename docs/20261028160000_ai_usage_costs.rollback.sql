begin;
-- 20261028160000_ai_usage_costs의 짝 되돌리기. 새 표 2개(색인·정책 포함)와 이번 기록 1행만 지운다.
-- 지우면 Gemini 사용량 보고와 명진이 넣은 충전·청구 금액이 사라진다(OpenAI 사용 기록 app_ai_daily_usage·app_feed_days는 그대로).
-- 지우기 전에 Edge drive-summary를 이 표를 쓰지 않는 이전 판으로 되돌린다(새 판은 표가 없으면 AI 사용량 줄만 '확인 불가'가 된다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261028160000' and name = 'ai_usage_costs') <> 1 then
    raise exception 'AI_USAGE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_ai_cost_entries;
drop table public.app_ai_external_usage;

delete from supabase_migrations.schema_migrations
  where version = '20261028160000' and name = 'ai_usage_costs';
commit;
