begin;
-- 20261126201000_org_others_to_trash의 짝 되돌리기. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow의 rollback 모드는 자료 UPDATE·INSERT·표 지우기를 막는다).
-- 1) 백업 표(public.app_cleanup_s71_40_orgs)에 있는 조직 중 적용이 휴지통에 넣은 그대로인 조직(deleted_at = 백업 시각)을 휴지통에서 꺼낸다.
--    적용 뒤 사용자가 휴지통에서 이미 되살린 조직(deleted_at 없음)은 그대로 두고, 휴지통을 비워 영구 삭제된 조직은 백업 줄(row_data)로 다시 넣는다.
--    적용은 기록 줄을 지우거나 바꾸지 않았으므로, 휴지통에서 꺼낸 조직은 기록이 그대로 다시 이어진다(S71-44: 기록이 붙은 조직도 옮김).
--    단, 적용 뒤 휴지통을 비워 영구 삭제한 조직은 그때 cascade로 지워진 기록(주요 인물·분쟁 단계·주간 요약 등)과 set null로 비워진 연결
--    (자료·소식·원장 조직 등)을 이 rollback으로 되살리지 못한다 — 조직 줄만 돌아온다. 그 기록은 적용 직전 자동 사본(ops_backup)에도 없다
--    (조직 표만 백업). 그래서 이 조직들은 휴지통에서 영구 삭제하지 않는다(CC가 사용자에게 따로 알림).
-- 2) 백업 표와 이번 기록 1행을 지운다. 다른 표·칸·권한·정책·함수·트리거는 건드리지 않는다.
-- 실행 전 확인: 첫 줄 begin; · 마지막 줄 commit; · 대상 프로젝트. 실행 뒤 짝 precheck의 'backup table absent'·'new migration absent'가 예인지 본다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_suborganizations in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261126201000' and name = 'org_others_to_trash') <> 1
     or to_regclass('public.app_cleanup_s71_40_orgs') is null then
    raise exception 'ORG_OTHERS_TO_TRASH_ROLLBACK_BLOCKED: migration record or backup table differs';
  end if;
end
$$;

update public.app_suborganizations o
   set deleted_at = null
  from public.app_cleanup_s71_40_orgs b
 where o.id = b.organization_id
   and o.deleted_at = b.moved_at;

insert into public.app_suborganizations
select r.* from public.app_cleanup_s71_40_orgs b
 cross join lateral jsonb_populate_record(null::public.app_suborganizations, b.row_data) r
 where not exists (select 1 from public.app_suborganizations o where o.id = b.organization_id);

do $$
begin
  if exists (select 1 from public.app_cleanup_s71_40_orgs b
             where not exists (select 1 from public.app_suborganizations o where o.id = b.organization_id)
                or exists (select 1 from public.app_suborganizations o where o.id = b.organization_id and o.deleted_at = b.moved_at)) then
    raise exception 'ORG_OTHERS_TO_TRASH_ROLLBACK_CHECK_FAILED';
  end if;
end
$$;

drop table public.app_cleanup_s71_40_orgs;

delete from supabase_migrations.schema_migrations
  where version = '20261126201000' and name = 'org_others_to_trash';
commit;
