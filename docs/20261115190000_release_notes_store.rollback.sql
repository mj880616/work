begin;
-- 20261115190000_release_notes_store의 짝 되돌리기(SQL Editor 새 쿼리 창 전용).
-- 두 함수·이번 기록 1행만 지운다. 표는 남긴다(지울지는 따로 결정 — 내용은 저장소 기록 파일로 다시 만들 수 있다).
-- 되돌린 뒤 운영자 '업데이트 기록' 화면은 못 읽음 안내가 된다. 화면 PR(배포물에서 빼기)을 먼저 되돌리면 옛 공개 파일로 돌아간다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261115190000' and name = 'release_notes_store') <> 1 then
    raise exception 'RELEASE_NOTES_STORE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function if exists public.app_release_notes_read();
drop function if exists public.app_release_notes_put(jsonb, text);

delete from supabase_migrations.schema_migrations where version = '20261115190000' and name = 'release_notes_store';
commit;
