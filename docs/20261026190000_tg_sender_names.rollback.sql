begin;
-- 20261026190000_tg_sender_names의 짝 되돌리기(SQL Editor 경로 전용: 자료 보호 확인(DO 블록)이 있어 승인형 workflow rollback 모드는 받지 않는다).
-- 이름표(app_tg_senders)나 방·날짜 연결(app_tg_day_senders)이 한 줄이라도 있으면 멈춘다(붙여 둔 이름을 잃지 않으려고). 그때 순서:
--   1) 필요하면 이름 표 관리 화면에서 이름을 따로 적어 둔다(이 되돌리기는 두 표를 지우므로 이름도 함께 사라진다).
--   2) 명진이 "이름표를 버려도 된다"고 결정했을 때만 두 표를 비운 뒤(SQL Editor에서 별도 승인) 이 되돌리기를 실행한다. 이 파일은 줄을 지우지 않는다.
-- 순서: 함수 4개 삭제 → 새 표 둘 삭제(정책·색인 함께) → 기록 1행 삭제. 소식 표(app_feed_items)와 기존 권한·정책은 건드리지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261026190000' and name = 'tg_sender_names') <> 1 then
    raise exception 'TG_SENDER_NAMES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_tg_senders) or exists (select 1 from public.app_tg_day_senders) then
    raise exception 'TG_SENDER_NAMES_ROLLBACK_BLOCKED: sender names exist; decide to discard them first';
  end if;
end
$$;

drop function public.app_tg_senders_upsert(uuid, text, date, jsonb);
drop function public.app_tg_sender_set_name(text, date, text, text);
drop function public.app_tg_sender_merge(uuid, uuid);
drop function public.app_tg_sender_forget(uuid);
drop table public.app_tg_day_senders;
drop table public.app_tg_senders;

delete from supabase_migrations.schema_migrations
  where version = '20261026190000' and name = 'tg_sender_names';
commit;
