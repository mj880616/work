begin;
-- 20261113220000_document_briefs의 짝 되돌리기. 새 표 1개(색인·정책·참조 포함)와 이번 기록 1행만 지운다.
-- 지우면 브리핑 작업 기록(진행·다섯 칸 브리핑)이 사라진다. 자료 파일(Drive)·자료실 자료 행·폴더·사용량 기록은 그대로다.
-- 지우기 전에 화면을 이전 판으로, Edge ai-assist를 이전 판으로 되돌린다(브리핑 룸만 사라진다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261113220000' and name = 'document_briefs') <> 1 then
    raise exception 'DOCUMENT_BRIEFS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_document_briefs;

delete from supabase_migrations.schema_migrations
  where version = '20261113220000' and name = 'document_briefs';
commit;
