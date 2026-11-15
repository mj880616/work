begin;
-- PHOTO-찍은시각 바로잡기 DB (명진 10/29 07:59 "사진 시각이 다 잘못돼 있다").
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 원인: onedrive-photos가 Graph photo.takenDateTime(카메라 벽시계 시각에 'Z'만 붙은 값)을 UTC로 읽어, 서울 15:00~23:59에 찍은 사진의
--   날짜(taken_day)를 하루 늦게 적었다. 별표(app_diary_stars)는 별을 누를 때 화면이 그 날짜를 같이 저장하므로 같은 하루 늦은 날짜를 갖고 있다.
-- 무엇: 고친 onedrive-photos(같은 PR)가 사진 색인을 처음부터 다시 받아 색인 날짜를 바로잡은 뒤, 원드라이브 별표의 taken_day 한 칸만
--   색인의 날짜와 같게 맞춘다. 색인이 새 규칙으로 다시 적힌 줄(updated_at이 고침 기준 시각 이후)만 기준으로 쓴다. 직접 올린 사진 별표·색인에
--   없는 별표는 그대로 둔다. 다른 칸·행 개수·권한·정책·RLS·함수·트리거 변경 없음.
-- 사전 조건: 폴더를 고른 연결이 모두 새 규칙으로 색인을 다 받았어야 한다(index_done_at이 고침 기준 시각 이후). 아니면 아무것도 바꾸지 않고 멈춘다.
-- 고침 기준 시각 2026-10-28T23:00:00Z는 supabase/functions/onedrive-photos/graph.ts TAKEN_FIX_AT과 같다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_diary_stars in share row exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029124500')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261028010000' and name = 'onedrive_photo_index') <> 1
     or exists (select 1 from public.app_onedrive_connections
         where folder_id is not null and (index_done_at is null or index_done_at < timestamptz '2026-10-28 23:00:00+00'))
     or exists (select 1 from pg_class where oid = 'public.app_diary_stars'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_diary_stars'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_diary_stars'::regclass) <> 1 then
    raise exception 'DIARY_STARS_TAKEN_DAY_FIX_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

update public.app_diary_stars s
  set taken_day = p.taken_day
  from public.app_onedrive_photos p
  where s.source = 'onedrive'
    and p.workspace_id = s.workspace_id
    and p.item_id = s.item_key
    and p.updated_at >= timestamptz '2026-10-28 23:00:00+00'
    and s.taken_day <> p.taken_day;

-- 사후 확인: 새 규칙 색인과 날짜가 다른 원드라이브 별표 0, 권한 경계 그대로. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from public.app_diary_stars s join public.app_onedrive_photos p
         on p.workspace_id = s.workspace_id and p.item_id = s.item_key
       where s.source = 'onedrive' and p.updated_at >= timestamptz '2026-10-28 23:00:00+00' and s.taken_day <> p.taken_day)
     or exists (select 1 from pg_class where oid = 'public.app_diary_stars'::regclass and not relrowsecurity)
     or (select count(*) from pg_policy where polrelid = 'public.app_diary_stars'::regclass) <> 1 then
    raise exception 'DIARY_STARS_TAKEN_DAY_FIX_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029124500', 'diary_stars_taken_day_fix', array['PHOTO taken time fix: onedrive stars take taken_day from the re-walked photo index (data only; no column, grant, policy or function change)']);
commit;
