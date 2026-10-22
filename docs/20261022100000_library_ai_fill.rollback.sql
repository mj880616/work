begin;
-- 20261022100000_library_ai_fill의 짝 되돌리기. 새 칸 1개(+검사)와 이번 기록 1행만 지운다.
-- 다시 쓴 글자 칸(extracted_text 등)은 이 migration이 만든 것이 아니므로 지우지 않는다(값도 그대로).
-- 화면·Edge를 먼저 이전으로 되돌린 뒤에 쓴다(새 화면·Edge는 이 칸·표를 쓰므로).
-- 안쪽 기록(field_origin)이 한 줄이라도 있으면 멈춘다. 지워서 통과시키지 않는다(자료 값 자체에는 영향 없음).
-- 보관 여부를 정한 뒤 다시 계획한다. 기존 자료 값·정책·권한에는 손대지 않는다. SQL Editor(폰 경로 C) 전용.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_documents in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261022100000' and name = 'library_ai_fill') <> 1 then
    raise exception 'LIBRARY_AI_FILL_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_documents where field_origin <> '{}'::jsonb) then
    raise exception 'LIBRARY_AI_FILL_ROLLBACK_BLOCKED: field origin records exist; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_documents drop constraint app_documents_field_origin_check;
alter table public.app_documents drop column field_origin;

delete from supabase_migrations.schema_migrations
  where version = '20261022100000' and name = 'library_ai_fill';
commit;
