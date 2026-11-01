begin;
-- S47-50 DB-협업잔재차단: 가입을 열기 전(MULTI 단계 ②) 협업 잔재의 쓰기 입구를 닫는다. 표·함수·자료는 지우지 않는다(로드맵 Task 19~31 소관).
-- (a) 협업 DEFINER 함수 9개: PUBLIC·anon·authenticated 실행권 회수. 앱·Edge 호출 0건(저장소 grep). service_role 권한은 그대로 둔다.
--     app_accept_invite·app_claim_owner·app_request_workspace_access·app_respond_project_invitation은 task12a에서 authenticated만 회수했고
--     PUBLIC·anon 회수 줄이 없었다. app_create_invite·app_set_workspace_member_role·app_approve/reject_access_request는 owner가 지금도 부를 수 있었다.
-- (b) app_invites: Web2에 초대 기능 없음(앱·Edge 호출 0건) → anon·authenticated의 insert·update·delete를 restrictive 정책으로 막는다. 읽기는 그대로.
-- (c) app_workspace_members: 소유자 확인이 기대는 owner 행을 지키며, owner라도 남의 행을 넣거나 역할을 바꾸거나 행을 지우지 못하게
--     anon·authenticated의 insert·update·delete를 restrictive 정책으로 막는다. 본인 행·작업공간 읽기(owner 확인)는 그대로.
--     앱·Edge는 이 표를 읽기만 한다(쓰기 0건). 단계 ②의 가입 함수는 DEFINER(표 소유자)로 넣으므로 이 정책의 대상이 아니다(FORCE RLS 꺼짐을 사전 확인).
-- 기존 permissive 정책·표 권한·RLS 설정·트리거는 한 글자도 바꾸지 않는다. rtw_ 객체는 건드리지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.app_invites') is null or to_regclass('public.app_workspace_members') is null
     or to_regprocedure('public.app_create_invite(text,uuid,timestamptz)') is null
     or to_regprocedure('public.app_set_workspace_member_role(uuid,text)') is null
     or to_regprocedure('public.app_approve_access_request(uuid,text)') is null
     or to_regprocedure('public.app_reject_access_request(uuid)') is null
     or to_regprocedure('public.app_accept_invite(text)') is null
     or to_regprocedure('public.app_claim_owner(text,text)') is null
     or to_regprocedure('public.app_request_workspace_access(text)') is null
     or to_regprocedure('public.app_respond_project_invitation(uuid,boolean)') is null
     or to_regprocedure('public.app_join_default_team()') is null then
    raise exception 'COLLAB_LOCKDOWN_PRECHECK_FAILED: expected table or function missing';
  end if;
  if exists (select 1 from pg_class where oid in (to_regclass('public.app_invites'), to_regclass('public.app_workspace_members'))
             and (not relrowsecurity or relforcerowsecurity)) then
    raise exception 'COLLAB_LOCKDOWN_PRECHECK_FAILED: RLS must be on and not forced';
  end if;
  if exists (select 1 from pg_policy where polname like 'collab\_lock\_%'
             and polrelid in (to_regclass('public.app_invites'), to_regclass('public.app_workspace_members'))) then
    raise exception 'COLLAB_LOCKDOWN_PRECHECK_FAILED: policies already exist';
  end if;
end
$$;

-- (a) 협업 DEFINER 함수 실행권 회수
revoke execute on function public.app_create_invite(text, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.app_set_workspace_member_role(uuid, text) from public, anon, authenticated;
revoke execute on function public.app_approve_access_request(uuid, text) from public, anon, authenticated;
revoke execute on function public.app_reject_access_request(uuid) from public, anon, authenticated;
revoke execute on function public.app_accept_invite(text) from public, anon, authenticated;
revoke execute on function public.app_claim_owner(text, text) from public, anon, authenticated;
revoke execute on function public.app_request_workspace_access(text) from public, anon, authenticated;
revoke execute on function public.app_respond_project_invitation(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.app_join_default_team() from public, anon, authenticated;

-- (b) 초대 표 쓰기 차단
create policy collab_lock_no_insert on public.app_invites as restrictive for insert to anon, authenticated with check (false);
create policy collab_lock_no_update on public.app_invites as restrictive for update to anon, authenticated using (false) with check (false);
create policy collab_lock_no_delete on public.app_invites as restrictive for delete to anon, authenticated using (false);

-- (c) 구성원 표 쓰기 차단(owner 행 보호, 읽기 유지)
create policy collab_lock_no_insert on public.app_workspace_members as restrictive for insert to anon, authenticated with check (false);
create policy collab_lock_no_update on public.app_workspace_members as restrictive for update to anon, authenticated using (false) with check (false);
create policy collab_lock_no_delete on public.app_workspace_members as restrictive for delete to anon, authenticated using (false);

do $$
begin
  if exists (
       select 1 from pg_proc p
       where p.oid in (
         to_regprocedure('public.app_create_invite(text,uuid,timestamptz)'),
         to_regprocedure('public.app_set_workspace_member_role(uuid,text)'),
         to_regprocedure('public.app_approve_access_request(uuid,text)'),
         to_regprocedure('public.app_reject_access_request(uuid)'),
         to_regprocedure('public.app_accept_invite(text)'),
         to_regprocedure('public.app_claim_owner(text,text)'),
         to_regprocedure('public.app_request_workspace_access(text)'),
         to_regprocedure('public.app_respond_project_invitation(uuid,boolean)'),
         to_regprocedure('public.app_join_default_team()'))
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))
     or (select count(*) from pg_policy where polname like 'collab\_lock\_%' and polpermissive = false
         and polrelid in (to_regclass('public.app_invites'), to_regclass('public.app_workspace_members'))) <> 6 then
    raise exception 'COLLAB_LOCKDOWN_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261102013000', 'collab_lockdown', array['S47-50 DB-협업잔재차단: revoke PUBLIC/anon/authenticated execute on 9 collaboration definer RPCs (invite, member role, access request, project invitation, default team) + restrictive no-write policies (insert/update/delete, anon+authenticated) on app_invites and app_workspace_members; reads, owner row, data and existing policies unchanged']);
commit;
