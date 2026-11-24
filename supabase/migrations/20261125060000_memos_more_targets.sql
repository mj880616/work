begin;
-- S69-95 NOTE-메모넓히기(명진 11/25 03:16~03:17 "또 메모 남길만한 거 뭐가 있을까 워크온+ 내에" → 자료실 파일·사업 관리 회의 기록·조직 관리 담당조직 기록·
-- 텔레그램 소식 / "중요한 건 메모를 모아두는 화면에서는 메모도 보이지만 그 메모를 남긴 원문 기록으로 연결도 되어야").
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 앞 단계 20261125030000_memos 기록이 있어야 하고, 없으면 멈춘다.
--
-- 바꾸는 것(메모 표 public.app_memos 하나만):
--  ① 대상 종류 검사(app_memos_target_type_check)에 네 종류를 더한다(지우고 같은 이름으로 다시 만듦, 있던 다섯 종류는 그대로):
--     document = 자료실 자료(app_documents.id) · meeting = 사업 보고(app_meetings.id) · org_record = 담당조직 기록(app_suborganization_updates.id) ·
--     telegram = 텔레그램 소식 한 건(app_feed_items.id, source='telegram').
--  ② 넣기 정책(memos_owner_insert)을 같은 이름·같은 표·같은 역할(authenticated)·같은 명령(insert)으로 다시 만들며 조건만 더 좁힌다:
--     새 네 종류는 넣을 때 그 원문이 같은 작업공간 것이어야 한다(담당조직 기록은 그 조직의 작업공간). 텔레그램은 그 작업공간에 운영자 기능 'telegram'이
--     서버 허용 표(private.app_workspace_has_feature)에 있어야 한다 — 다른 사람·다른 작업공간 원문에는 메모를 남길 수 없다. 노트 규칙과 옛 종류는 그대로.
-- 바꾸지 않는 것: 읽기·고치기·지우기 정책(주인만), 표·칸 권한, 원문 표(자료·사업 보고·조직 기록·텔레그램 소식)와 그 정책·권한, 메모 줄, rtw_* 객체.
-- 외래 키는 두지 않는다(원문을 지워도 메모는 남고 화면이 '원래 기록이 없어요'로 링크만 끈다 — 20261125030000과 같음).
-- 공유(COLLAB): 메모는 늘 작업공간 주인만 본다. 공유 읽기 함수(app_collab_*)에는 메모 표가 없고, 공유로 원문을 받은 사람도 남의 메모를 읽지 못한다.
-- 짝: docs/20261125060000_memos_more_targets.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125060000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261125030000' and name = 'memos') <> 1
     or to_regclass('public.app_memos') is null
     or to_regclass('public.app_documents') is null
     or to_regclass('public.app_meetings') is null
     or to_regclass('public.app_suborganizations') is null
     or to_regclass('public.app_suborganization_updates') is null
     or to_regclass('public.app_feed_items') is null
     or (select count(*) from pg_attribute where attnum > 0 and not attisdropped and atttypid = 'uuid'::regtype and attname = 'workspace_id'
           and attrelid in ('public.app_documents'::regclass, 'public.app_meetings'::regclass, 'public.app_suborganizations'::regclass,
                            'public.app_feed_items'::regclass)) <> 4
     or (select count(*) from pg_attribute where attrelid = 'public.app_suborganization_updates'::regclass and attnum > 0 and not attisdropped
           and attname = 'organization_id' and atttypid = 'uuid'::regtype) <> 1
     or (select count(*) from pg_attribute where attrelid = 'public.app_feed_items'::regclass and attnum > 0 and not attisdropped
           and attname = 'source') <> 1
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null
     or (select count(*) from pg_constraint where conrelid = 'public.app_memos'::regclass
         and conname = 'app_memos_target_type_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''brief''' and pg_get_constraintdef(oid) !~ '''document''') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_memos'::regclass and polname = 'memos_owner_insert' and polcmd = 'a'
         and polpermissive and polroles = array['authenticated'::regrole]::oid[]
         and pg_get_expr(polwithcheck, polrelid) ~ 'app_notes' and pg_get_expr(polwithcheck, polrelid) !~ 'app_documents') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_memos'::regclass) <> 4
     or exists (select 1 from public.app_memos where target_type not in ('note', 'news', 'outside', 'reading', 'brief')) then
    raise exception 'MEMOS_MORE_TARGETS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_memos drop constraint app_memos_target_type_check;
alter table public.app_memos add constraint app_memos_target_type_check
  check (target_type in ('note', 'news', 'outside', 'reading', 'brief', 'document', 'meeting', 'org_record', 'telegram'));

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
        where f.id = target_id and f.workspace_id = app_memos.workspace_id and f.source = 'telegram'))));

-- 사후 확인: 검사 1개(아홉), 정책 4개(authenticated만, 넣기는 새 조건), RLS 켜짐, anon·PUBLIC·service_role 권한 없음, 칸 권한 그대로. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_memos'::regclass;
begin
  if (select count(*) from pg_constraint where conrelid = t and conname = 'app_memos_target_type_check' and contype = 'c'
        and pg_get_constraintdef(oid) ~ '''document''' and pg_get_constraintdef(oid) ~ '''meeting''' and pg_get_constraintdef(oid) ~ '''org_record'''
        and pg_get_constraintdef(oid) ~ '''telegram''' and pg_get_constraintdef(oid) ~ '''brief''' and pg_get_constraintdef(oid) ~ '''reading''') <> 1
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
         and pg_get_expr(polwithcheck, polrelid) ~ 'app_feed_items' and pg_get_expr(polwithcheck, polrelid) ~ 'app_workspace_has_feature') <> 1 then
    raise exception 'MEMOS_MORE_TARGETS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125060000', 'memos_more_targets', array['S69-95 NOTE-메모넓히기: app_memos_target_type_check adds document, meeting, org_record, telegram; memos_owner_insert recreated (same name, table, role, command) requiring same-workspace target for the new kinds and the telegram operator feature; no grants, functions, columns or row changes']);
commit;
