begin;
-- 20261104223000_folder_look_prefs의 짝 되돌리기. 함수 2개·새 표·앨범의 검사와 칸 2개를 지우고 기록 1행을 지운다.
-- SQL Editor 경로 전용(이 migration은 확장 규칙이라 workflow rollback 모드 밖). 고른 폴더·앨범 색과 직접 정한 순서만 사라진다(화면은 모든 폴더를 안 고른 폴더처럼 이름순으로 본다). 폴더·앨범·사진은 그대로다.
-- 먼저 이 변경을 쓰는 화면 PR을 되돌리거나, 되돌린 뒤 색·순서 단추가 저장 실패 알림만 내는 것을 알고 진행한다.
-- 값이 버려져도 멈추지 않는다(꾸미기뿐이고 다시 고르면 된다). 개수는 아래 확인 SQL로 먼저 볼 수 있다.
--   select count(*) from public.app_folder_prefs;  select count(*) from public.app_photo_tags where color is not null or sort_order <> 0;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261104223000' and name = 'folder_look_prefs') <> 1 then
    raise exception 'FOLDER_LOOK_PREFS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_photo_tag_look_apply(uuid, jsonb);
drop function public.app_folder_prefs_apply(uuid, text, jsonb);
drop table public.app_folder_prefs;

alter table public.app_photo_tags drop constraint app_photo_tags_color_check;
alter table public.app_photo_tags drop column sort_order;
alter table public.app_photo_tags drop column color;

delete from supabase_migrations.schema_migrations
  where version = '20261104223000' and name = 'folder_look_prefs';
commit;
