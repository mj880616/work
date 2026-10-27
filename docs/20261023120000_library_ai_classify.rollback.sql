begin;
-- 20261023120000_library_ai_classify의 짝 되돌리기. 새 함수 3개·새 표 1개(정책·색인 포함)를 지우고, 검사 2개를 예전(4칸)으로 되돌리고,
-- 이번 기록 1행만 지운다. 먼저 화면·ai-assist를 이전으로 되돌린다(새 화면·서버가 이 표·함수를 쓰므로). 그 뒤 SQL Editor(폰 경로 C)에서 쓴다.
-- 자료 값을 지워서 통과시키지 않는다: 연결 칸 기록(field_origin의 project_id·organization_id)이나 연결 백업 행이 한 줄이라도 있으면 멈춘다.
-- 그런 경우 먼저 public.app_library_classify_revert_since(시작 시각)으로 값을 되돌리고(그 사이 고친 칸은 건너뜀), 남은 행은 캡처해
-- 보관한 뒤 다시 계획한다(표·함수는 남겨 두어도 화면·서버가 쓰지 않으면 아무 일도 하지 않는다).
-- 승인형 DB workflow는 표 삭제를 막으므로 SQL Editor(폰 경로 C) 전용이다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_library_classify_attempts in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261023120000' and name = 'library_ai_classify') <> 1 then
    raise exception 'LIBRARY_AI_CLASSIFY_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_documents where field_origin ?| array['project_id', 'organization_id']) then
    raise exception 'LIBRARY_AI_CLASSIFY_ROLLBACK_BLOCKED: link origin records exist; revert or preserve first';
  end if;
  if exists (select 1 from public.app_library_tidy_backups where field in ('project_id', 'organization_id')) then
    raise exception 'LIBRARY_AI_CLASSIFY_ROLLBACK_BLOCKED: link backups exist; preserve first';
  end if;
end
$$;

drop function public.app_library_classify_revert_since(timestamptz);
drop function public.app_library_classify_revert(uuid);
drop function public.app_library_classify_apply(uuid, jsonb);
drop table public.app_library_classify_attempts;

alter table public.app_library_tidy_backups
  drop constraint app_library_tidy_backups_field_check;
alter table public.app_library_tidy_backups
  add constraint app_library_tidy_backups_field_check
  check (field in ('title', 'category', 'source', 'document_date'));
alter table public.app_documents
  drop constraint app_documents_field_origin_check;
alter table public.app_documents
  add constraint app_documents_field_origin_check check (
    jsonb_typeof(field_origin) = 'object'
    and (field_origin - array['title', 'category', 'source', 'document_date']) = '{}'::jsonb
    and not jsonb_path_exists(field_origin, 'strict $.* ? (@.type() != "string")')
    and not jsonb_path_exists(field_origin, 'strict $.* ? (@ != "ai" && @ != "user")')
  );

delete from supabase_migrations.schema_migrations
  where version = '20261023120000' and name = 'library_ai_classify';
commit;
