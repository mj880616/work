begin;
-- S71-71 RECORD-기록하나로(사용자 결정 2026-11-26 "조직 보고로 한 번 편입되면 걍 조직 기록이야 … 메뉴도 다 통일 / 수정 / 메모 / 삭제"):
-- 조직·사업 관리의 모든 기록 줄 ⋯에 [메모]가 있다. 잊지 말기·업데이트에서 연결한 기록 줄(app_record_links 한 행)에도 메모를 남길 수 있게
-- 메모 대상 종류에 record_link를 더한다. 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 앞 단계 20261125060000 기록이 있어야 하고, 없으면 멈춘다.
--
-- 바꾸는 것(메모 표 public.app_memos 하나만):
--  ① 대상 종류 검사(app_memos_target_type_check)에 record_link를 더한다(지우고 같은 이름으로 다시 만듦, 있던 아홉 종류는 그대로).
--  ② 넣기 정책(memos_owner_insert)을 같은 이름·같은 표·같은 역할(authenticated)·같은 명령(insert)으로 다시 만들며 조건만 더 좁힌다:
--     record_link는 넣을 때 그 연결 줄이 같은 작업공간 것이고 확정(confirmed)이어야 한다. 있던 종류의 조건은 글자 그대로.
-- 바꾸지 않는 것: 읽기·고치기·지우기 정책(주인만), 표·칸 권한, 연결 표(app_record_links)와 그 정책·권한, 메모 줄, rtw_* 객체.
-- 외래 키는 두지 않는다(연결 줄을 지워도 메모는 남고 화면이 '원래 기록이 없어요'로 링크만 끈다 — 20261125030000과 같음).
-- 공유(COLLAB): 메모는 늘 작업공간 주인만 본다. 공유 읽기 함수(app_collab_*)에는 메모 표가 없다.
-- 짝: docs/20261127030000_memos_record_link.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261127030000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261125060000' and name = 'memos_more_targets') <> 1
     or to_regclass('public.app_memos') is null
     or to_regclass('public.app_record_links') is null
     or (select count(*) from pg_attribute where attrelid = 'public.app_record_links'::regclass and attnum > 0 and not attisdropped
           and ((attname = 'workspace_id' and atttypid = 'uuid'::regtype) or (attname = 'id' and atttypid = 'uuid'::regtype) or attname = 'status')) <> 3
     or (select count(*) from pg_constraint where conrelid = 'public.app_memos'::regclass
         and conname = 'app_memos_target_type_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''telegram''' and pg_get_constraintdef(oid) !~ '''record_link''') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_memos'::regclass and polname = 'memos_owner_insert' and polcmd = 'a'
         and polpermissive and polroles = array['authenticated'::regrole]::oid[]
         and pg_get_expr(polwithcheck, polrelid) ~ 'app_feed_items' and pg_get_expr(polwithcheck, polrelid) !~ 'app_record_links') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_memos'::regclass) <> 4
     or exists (select 1 from public.app_memos where target_type not in ('note', 'news', 'outside', 'reading', 'brief', 'document', 'meeting', 'org_record', 'telegram')) then
    raise exception 'MEMOS_RECORD_LINK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_memos drop constraint app_memos_target_type_check;
alter table public.app_memos add constraint app_memos_target_type_check
  check (target_type in ('note', 'news', 'outside', 'reading', 'brief', 'document', 'meeting', 'org_record', 'telegram', 'record_link'));

drop policy memos_owner_insert on public.app_memos;
create policy memos_owner_insert on public.app_memos for insert to authenticated
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (target_type <> 'note' or exists (
      select 1 from public.app_notes n
      where n.id = target_id and n.workspace_id = app_memos.workspace_id and n.kind = 'note'))
    and (target_type <> 'document' or exists (
      select 1 from public.app_documents d
      where d.id = target_id and d.workspace_id = app_memos.workspace_id))
    and (target_type <> 'meeting' or exists (
      select 1 from public.app_meetings m
      where m.id = target_id and m.workspace_id = app_memos.workspace_id))
    and (target_type <> 'org_record' or exists (
      select 1 from public.app_suborganization_updates u
      join public.app_suborganizations o on o.id = u.organization_id
      where u.id = target_id and o.workspace_id = app_memos.workspace_id))
    and (target_type <> 'telegram' or (
      private.app_workspace_has_feature(workspace_id, 'telegram')
      and exists (
        select 1 from public.app_feed_items f
        where f.id = target_id and f.workspace_id = app_memos.workspace_id and f.source = 'telegram')))
    and (target_type <> 'record_link' or exists (
      select 1 from public.app_record_links l
      where l.id = target_id and l.workspace_id = app_memos.workspace_id and l.status = 'confirmed')));

-- 사후 확인: 검사 1개(열), 정책 4개(authenticated만, 넣기는 새 조건), RLS 켜짐, anon·PUBLIC·service_role 권한 없음, 칸 권한 그대로. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_memos'::regclass;
begin
  if (select count(*) from pg_constraint where conrelid = t and conname = 'app_memos_target_type_check' and contype = 'c'
        and pg_get_constraintdef(oid) ~ '''record_link''' and pg_get_constraintdef(oid) ~ '''telegram''' and pg_get_constraintdef(oid) ~ '''org_record'''
        and pg_get_constraintdef(oid) ~ '''document''' and pg_get_constraintdef(oid) ~ '''brief''' and pg_get_constraintdef(oid) ~ '''reading''') <> 1
     or not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', t, 'update,truncate,references,trigger')
     or has_column_privilege('authenticated', t, 'target_type', 'update')
     or has_column_privilege('authenticated', t, 'target_id', 'update')
     or has_column_privilege('authenticated', t, 'workspace_id', 'update')
     or not has_column_privilege('authenticated', t, 'body', 'update')
     or not has_table_privilege('authenticated', t, 'select,delete')
     or (select count(*) from pg_policy where polrelid = t) <> 4
     or (select count(*) from pg_policy where polrelid = t and polroles = array['authenticated'::regrole]::oid[]) <> 4
     or (select count(*) from pg_policy where polrelid = t and polname = 'memos_owner_insert' and polcmd = 'a' and polpermissive
         and pg_get_expr(polwithcheck, polrelid) ~ 'app_notes' and pg_get_expr(polwithcheck, polrelid) ~ 'app_documents'
         and pg_get_expr(polwithcheck, polrelid) ~ 'app_meetings' and pg_get_expr(polwithcheck, polrelid) ~ 'app_suborganization_updates'
         and pg_get_expr(polwithcheck, polrelid) ~ 'app_feed_items' and pg_get_expr(polwithcheck, polrelid) ~ 'app_workspace_has_feature'
         and pg_get_expr(polwithcheck, polrelid) ~ 'app_record_links') <> 1 then
    raise exception 'MEMOS_RECORD_LINK_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261127030000', 'memos_record_link', array['S71-71 RECORD-기록하나로: app_memos_target_type_check adds record_link; memos_owner_insert recreated (same name, table, role, command) requiring a confirmed same-workspace app_record_links row for record_link; no grants, functions, columns or row changes']);
commit;
