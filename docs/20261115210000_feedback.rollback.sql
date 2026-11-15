begin;
-- 20261115210000_feedback의 짝 되돌리기(SQL Editor 새 쿼리 창 전용).
-- 함수 여섯·이번 기록 1행만 지운다. 표 둘은 남긴다(받은 의견·사진 보존 — 지울지는 따로 결정, 개인정보 처리방침의 보관 기간을 따른다).
-- 화면 PR(PR5)이 운영에 있으면 그것을 먼저 되돌린다(아니면 [보내기]가 실패 안내가 된다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261115210000' and name = 'feedback') <> 1 then
    raise exception 'FEEDBACK_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function if exists public.app_feedback_send(text, jsonb, jsonb);
drop function if exists public.app_feedback_list(text);
drop function if exists public.app_feedback_photo(uuid, integer);
drop function if exists public.app_feedback_done(uuid, boolean);
drop function if exists public.app_feedback_open_count();
drop function if exists private.app_feedback_operator();

delete from supabase_migrations.schema_migrations where version = '20261115210000' and name = 'feedback';
commit;
