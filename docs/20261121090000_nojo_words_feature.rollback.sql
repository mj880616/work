begin;
-- 20261121090000_nojo_words_feature의 짝 되돌리기. 검사 원래 모양(키 열)·이번 기록 1행만 되돌린다. 다른 허용 행은 그대로.
-- nojo_words 허용 행이 남아 있으면 멈춘다(커맨드센터가 넣은 행 — 먼저 docs/ops/nojo-words-operator.rollback.sql로 지운 뒤 이 SQL을 실행).
-- 되돌리면 모든 사람의 바탕 낱말 묶음이 빌드 얼굴(WORK ON) 낱말이 된다(허용 행이 없으므로).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261121090000' and name = 'nojo_words_feature') <> 1 then
    raise exception 'NOJO_WORDS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_operator_features where feature = 'nojo_words') then
    raise exception 'NOJO_WORDS_ROLLBACK_BLOCKED: allow rows remain';
  end if;
end
$$;

alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms'));

delete from supabase_migrations.schema_migrations
  where version = '20261121090000' and name = 'nojo_words_feature';
commit;
