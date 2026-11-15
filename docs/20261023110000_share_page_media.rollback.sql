begin;
-- 20261023110000_share_page_media의 짝 되돌리기. 새 표 1개(정책·색인 포함)와 이번 기록 1행만 지운다.
-- 사진 기록이 한 줄이라도 있으면 멈춘다. 내용을 지워서 통과시키지 않는다(버킷에 파일이 남고 주인을 잃는다).
-- 그런 경우 먼저 화면·Edge 사용을 멈추고, 사진 파일 목록을 보관한 뒤 복구 계획을 따로 세운다.
-- 기존 표·정책·함수에는 손대지 않는다. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_share_page_media in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261023110000' and name = 'share_page_media') <> 1 then
    raise exception 'SHARE_MEDIA_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_share_page_media) then
    raise exception 'SHARE_MEDIA_ROLLBACK_BLOCKED: share photos exist; preserve and plan recovery';
  end if;
end
$$;

drop table public.app_share_page_media;

delete from supabase_migrations.schema_migrations
  where version = '20261023110000' and name = 'share_page_media';
commit;
