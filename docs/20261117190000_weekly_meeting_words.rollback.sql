begin;
-- 20261117190000_weekly_meeting_words의 짝 되돌리기(SQL Editor 새 창 전용 — 프로필 값을 고치는 update가 있어 승인형 workflow rollback 모드는 받지 않는다).
-- 1) 먼저 화면 PR을 이전 판으로 되돌린다(이전 판 화면 코드에는 내부 정례 회의 단어가 고정돼 있어 명진 결과가 같다).
-- 2) 이 파일: 모든 프로필에서 이번에 넣은 '*단어*' 여섯 항목만 지우고(다른 항목·순서 그대로), 기본값을 원래 두 종류로 되돌린 뒤 이번 기록 1행만 지운다.
--    적용 때 빈 목록으로 비운 다른 사람 행과 적용 뒤 새로 가입한 행은 빈 목록 그대로 둔다(어느 행이 비운 행인지 이 파일은 모른다 —
--    필요하면 적용 때 workflow가 만든 백업 표 ops_backup."20261117190000_app_profiles_<run_id>"의 같은 user_id 값과 대조해 사람이 따로 정한다).
--    표 권한·정책·함수·칸·검사에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261117190000' and name = 'weekly_meeting_words') <> 1 then
    raise exception 'WEEKLY_MEETING_WORDS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

update public.app_profiles
   set weekly_hidden_meeting_kinds = array(select k from unnest(weekly_hidden_meeting_kinds) with ordinality u(k, n)
                                          where k <> all (array['*상집*', '*중집*', '*집행위*', '*집행국*', '*상무집행*', '*중앙집행*']::text[]) order by n)
 where weekly_hidden_meeting_kinds && array['*상집*', '*중집*', '*집행위*', '*집행국*', '*상무집행*', '*중앙집행*']::text[];

alter table public.app_profiles
  alter column weekly_hidden_meeting_kinds set default array['궤도집행국회의', '본부집행위']::text[];

delete from supabase_migrations.schema_migrations
  where version = '20261117190000' and name = 'weekly_meeting_words';
commit;
