begin;
-- 20261028010000_onedrive_photo_index의 짝 되돌리기. 새 표 2개(색인 포함)·연결 표의 새 칸 5개·제약 1개·이번 기록 1행만 지운다.
-- 색인 표의 내용은 원드라이브에서 언제든 다시 받을 수 있는 목록 사본이라 지워도 데이터 손실이 아니다(켜고 끈 폴더 설정만 처음 상태로 돌아간다).
-- 지우기 전에 Edge onedrive-photos를 색인을 쓰지 않는 이전 판으로 되돌린다(새 판은 이 표가 없으면 사진 목록을 못 읽는다).
-- 기존 연결 행·토큰·별표는 손대지 않는다. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_onedrive_connections in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261028010000' and name = 'onedrive_photo_index') <> 1 then
    raise exception 'ONEDRIVE_INDEX_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_onedrive_photos;
drop table public.app_onedrive_folders;
alter table public.app_onedrive_connections drop constraint app_onedrive_connections_links_check;
alter table public.app_onedrive_connections
  drop column delta_link,
  drop column next_link,
  drop column index_done_at,
  drop column synced_at,
  drop column index_lock_until;

delete from supabase_migrations.schema_migrations
  where version = '20261028010000' and name = 'onedrive_photo_index';
commit;
