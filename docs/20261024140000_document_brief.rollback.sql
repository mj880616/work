begin;
-- 20261024140000_document_brief의 짝 되돌리기. 검사 하나(app_document_ai_index_brief_check)와 이번 기록 1행만 지운다.
-- 요약 행(b1:)은 지우지 않는다. 검사가 없어도 행은 해가 없다(화면은 b1: 행만 읽고, 옛 행은 그대로).
-- 행을 지우거나 고쳐서 통과시키지 않는다. 표·칸·권한·정책·RLS에는 손대지 않는다.
-- 화면·Edge를 먼저 이전으로 되돌린 뒤에 쓴다(새 Edge는 이 검사를 전제로 요약을 쓴다). SQL Editor(폰 경로 C) 또는 승인형 workflow rollback.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_document_ai_index in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261024140000' and name = 'document_brief') <> 1 then
    raise exception 'DOCUMENT_BRIEF_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

alter table public.app_document_ai_index drop constraint app_document_ai_index_brief_check;

delete from supabase_migrations.schema_migrations
  where version = '20261024140000' and name = 'document_brief';
commit;
