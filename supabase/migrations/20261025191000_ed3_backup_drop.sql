begin;
-- ED③ 백업 표 삭제 (명진 결정 2026-10-25 16:05: 백업 표는 버려도 됨). 20261024190000_ed3_text_backup이 만든
-- 비공개 표 public.app_ed3_text_backups 하나와 그 표의 정책(ed3_text_backups_owner_read)을 지운다.
-- 그 migration은 표·정책·권한만 만들었고 함수·트리거·뷰는 만들지 않았다. 앱·Edge Function은 이 표를 참조하지 않는다(옛 변환 단추는 #1196으로 삭제됨).
-- 지운 원문(노트·기록 백업)은 되돌릴 수 없다. 짝 rollback은 빈 표 구조만 다시 만든다.
-- 원래 노트·기록 표, 20261024190000 기록 1행, 다른 표·정책·권한·함수는 건드리지 않는다.
-- SQL Editor(폰 경로 C) 전용이다: 승인형 DB workflow는 DROP TABLE을 차단한다(docs/ops-db-workflow.md).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_ed3_text_backups in access exclusive mode;

-- 사전 조건이 다르면 아무것도 지우지 않고 멈춘다: 이번 기록 없음, 백업 만든 기록(20261024190000) 있음, 표 있음,
-- 정책은 소유자 읽기 하나뿐, 다른 표의 외래 키·뷰가 이 표를 가리키지 않음, 함수 본문에 이 표 이름 없음.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025191000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261024190000' and name = 'ed3_text_backup') <> 1
     or to_regclass('public.app_ed3_text_backups') is null
     or (select count(*) from pg_policy where polrelid = 'public.app_ed3_text_backups'::regclass
         and polname = 'ed3_text_backups_owner_read') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_ed3_text_backups'::regclass) <> 1
     or exists (select 1 from pg_constraint where confrelid = 'public.app_ed3_text_backups'::regclass)
     or exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid and d.classid = 'pg_rewrite'::regclass
         where d.refobjid = 'public.app_ed3_text_backups'::regclass and r.ev_class <> d.refobjid)
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private') and p.prosrc like '%app_ed3_text_backups%') then
    raise exception 'ED3_BACKUP_DROP_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

drop table public.app_ed3_text_backups;

-- 사후 확인: 표가 없고, 원래 세 표(노트·담당조직 기록·프로젝트 기록)는 그대로 있다. 다르면 전체 취소.
do $$
begin
  if to_regclass('public.app_ed3_text_backups') is not null
     or to_regclass('public.app_notes') is null
     or to_regclass('public.app_suborganization_updates') is null
     or to_regclass('public.app_project_progress_updates') is null then
    raise exception 'ED3_BACKUP_DROP_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261025191000', 'ed3_backup_drop', array['ED③ backup drop: drop private table app_ed3_text_backups (and its owner-read policy); original note and record tables untouched; dropped backup text is not recoverable']);
commit;
