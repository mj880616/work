begin;
-- 20261116110000_document_brief_delete의 짝 되돌리기. 새 함수 1개와 이번 기록 1행만 지운다.
-- 이미 지운 브리핑 행은 되살아나지 않는다(자료·Drive 파일은 처음부터 그대로). 표·정책·권한은 처음부터 바꾸지 않았다.
-- 지우기 전에 화면을 이전 판으로 되돌린다(브리핑 룸 [브리핑만 삭제]만 사라진다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 DEFINER 함수 삭제 되돌리기를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261116110000' and name = 'document_brief_delete') <> 1 then
    raise exception 'DOCUMENT_BRIEF_DELETE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_document_brief_delete(uuid);

delete from supabase_migrations.schema_migrations
  where version = '20261116110000' and name = 'document_brief_delete';
commit;
