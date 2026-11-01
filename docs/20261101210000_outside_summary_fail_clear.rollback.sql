begin;
-- 20261101210000_outside_summary_fail_clear의 짝 되돌리기. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow의 rollback 모드는 자료 UPDATE·표 삭제를 막는다).
-- 1) 비공개 표 app_outside_summary_fixes에 남긴 옛 요약·옛 핵심 문장으로 되돌린다(지금 요약이 비어 있는 글만).
-- 2) 그 표와 이번 기록 1행을 지운다. 다른 칸·표·권한·정책·함수는 건드리지 않는다.
-- 적용 뒤 요약이 다시 채워진 글이 있거나 글이 지워졌으면 멈춘다(그 글의 옛 요약이 이 표에만 있으므로 표를 지우지 않는다). 그때는 명진이 볼지 정한 뒤 다시 계획한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_outside_posts in share row exclusive mode;
lock table public.app_outside_summary_fixes in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261101210000' and name = 'outside_summary_fail_clear') <> 1 then
    raise exception 'OUTSIDE_SUMMARY_FAIL_CLEAR_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_outside_summary_fixes f left join public.app_outside_posts p on p.id = f.post_id
             where p.id is null or p.summary_ko is not null or p.key_sentences <> '[]'::jsonb) then
    raise exception 'OUTSIDE_SUMMARY_FAIL_CLEAR_ROLLBACK_BLOCKED: some posts changed after the clear';
  end if;
end
$$;

update public.app_outside_posts p
  set summary_ko = f.old_summary_ko, key_sentences = f.old_key_sentences
  from public.app_outside_summary_fixes f
  where f.post_id = p.id
    and p.summary_ko is null;

drop table public.app_outside_summary_fixes;

delete from supabase_migrations.schema_migrations
  where version = '20261101210000' and name = 'outside_summary_fail_clear';
commit;
