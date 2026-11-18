begin;
-- 20261116030000_ppwu_forms_feature의 짝 되돌리기. 검사 원래 모양(키 아홉)·이번 기록 1행만 되돌린다. 다른 허용 행은 그대로.
-- ppwu_forms 허용 행이 남아 있으면 멈춘다(커맨드센터가 넣은 행 — 지울지는 사람이 정한다. 먼저 그 행을 지운 뒤 이 SQL을 실행).
-- 되돌리면 Edge는 모든 작업공간을 일반 규칙으로 판정한다(허용 행이 없으므로).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261116030000' and name = 'ppwu_forms_feature') <> 1 then
    raise exception 'PPWU_FORMS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_operator_features where feature = 'ppwu_forms') then
    raise exception 'PPWU_FORMS_ROLLBACK_BLOCKED: allow rows remain';
  end if;
end
$$;

alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside'));

delete from supabase_migrations.schema_migrations
  where version = '20261116030000' and name = 'ppwu_forms_feature';
commit;
