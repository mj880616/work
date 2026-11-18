begin;
-- 20261118100000_collab_groups의 짝 되돌리기. 새 표 6개(인덱스·제약 포함)·새 함수 13개와 이번 기록 1행만 지운다.
-- 기존 표·정책·권한·owner 함수는 건드리지 않는다. 만들어진 묶음·멤버·초대 링크·요청·기록은 함께 사라진다(각자 작업공간 자료는 그대로).
-- 지우기 전에 화면을 이 함수를 쓰지 않는 이전 판으로 되돌린다(화면 PR이 나간 뒤라면).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261118100000' and name = 'collab_groups') <> 1 then
    raise exception 'COLLAB_GROUPS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_collab_admin_move(uuid);
drop function public.app_collab_member_remove(uuid);
drop function public.app_collab_leave(uuid);
drop function public.app_collab_my_groups();
drop function public.app_collab_request_decide(uuid, boolean);
drop function public.app_collab_invite_accept(text, boolean);
drop function public.app_collab_invite_peek(text);
drop function public.app_collab_invite_revoke_all(uuid);
drop function public.app_collab_invite_create(uuid);
drop function public.app_collab_group_create(text, text, text, boolean);
drop function private.app_collab_my_role(uuid);
drop function private.app_collab_my_workspace();
drop function private.app_collab_clean_name(text);

drop table public.app_collab_member_log;
drop table public.app_collab_join_attempts;
drop table public.app_collab_join_requests;
drop table public.app_collab_invites;
drop table public.app_collab_members;
drop table public.app_collab_groups;

delete from supabase_migrations.schema_migrations
  where version = '20261118100000' and name = 'collab_groups';
commit;
