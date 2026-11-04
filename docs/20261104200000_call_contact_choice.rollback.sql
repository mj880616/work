begin;
-- 20261104200000_call_contact_choice의 짝 되돌리기(SQL Editor 경로 전용: 표·칸 삭제는 workflow rollback 허용 목록 밖).
-- 기억한 선택(app_call_contact_choice)에 줄이 하나라도 있으면 멈춘다(자료를 잃지 않으려고). 그때는 Edge collector-feed를 먼저 이전 SHA로 되돌리고, 선택을 지울지 명진 확인 뒤 별도 승인으로 정한다.
-- 통화 줄 표는 이 migration이 바꾸지 않았으므로 건드리지 않는다. 통화 한 건↔상대 열쇠 표(app_call_contact_ref)는 선택이 없으면 통화 내용이 아니라 열쇠뿐이라 함께 지운다.
-- 순서: 옮기기 함수를 앞 단계(20261025200000) 본문으로 되돌림 → 새 표 둘 삭제 → 기록 1행 삭제.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261104200000' and name = 'call_contact_choice') <> 1 then
    raise exception 'CALL_CONTACT_CHOICE_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_call_contact_choice) then
    raise exception 'CALL_CONTACT_CHOICE_ROLLBACK_BLOCKED: remembered choices exist; revert the Edge function first and clear them only with separate approval';
  end if;
end
$$;

create or replace function public.app_call_move(p_id uuid, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.app_feed_items%rowtype;
  p public.app_call_personal%rowtype;
begin
  if p_to is null or p_to not in ('work', 'personal') then
    raise exception using errcode = '22023', message = 'CALL_MOVE_TARGET';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_call_move:' || coalesce(p_id::text, ''), 0));

  select * into w from public.app_feed_items f where f.id = p_id;
  if found then
    if not private.app_is_workspace_owner(w.workspace_id) then
      raise exception using errcode = 'P0002', message = 'CALL_NOT_FOUND';
    end if;
    if w.source <> 'call' then
      raise exception using errcode = '23514', message = 'CALL_NOT_CALL';
    end if;
    if p_to = 'work' then
      return pg_catalog.jsonb_build_object('ok', true, 'id', w.id, 'from', 'work', 'to', 'work', 'changed', false, 'needs_refill', false);
    end if;
    delete from public.app_feed_items f where f.id = w.id and f.workspace_id = w.workspace_id;
    insert into public.app_call_personal (id, workspace_id, kind, day, occurred_at, title, summary, points, counterpart, speaker_split,
      raw_text, source_ref, drive_url, hidden_at, model, judged_at, moved_at, created_at, updated_at)
    values (w.id, w.workspace_id, 'personal', w.day, w.occurred_at, w.title, w.summary, w.points, w.counterpart, w.speaker_split,
      w.raw_text, w.source_ref, w.drive_url, w.hidden_at, w.model, w.judged_at, pg_catalog.now(), w.created_at, pg_catalog.now());
    return pg_catalog.jsonb_build_object('ok', true, 'id', w.id, 'from', 'work', 'to', 'personal', 'changed', true, 'needs_refill', false);
  end if;

  select * into p from public.app_call_personal c where c.id = p_id;
  if not found or not private.app_is_workspace_owner(p.workspace_id) then
    raise exception using errcode = 'P0002', message = 'CALL_NOT_FOUND';
  end if;
  if p_to = 'personal' then
    if p.kind = 'personal' then
      return pg_catalog.jsonb_build_object('ok', true, 'id', p.id, 'from', 'personal', 'to', 'personal', 'changed', false, 'needs_refill', false);
    end if;
    update public.app_call_personal c set kind = 'personal', updated_at = pg_catalog.now()
     where c.id = p.id and c.workspace_id = p.workspace_id;
    return pg_catalog.jsonb_build_object('ok', true, 'id', p.id, 'from', 'unsure', 'to', 'personal', 'changed', true, 'needs_refill', false);
  end if;
  delete from public.app_call_personal c where c.id = p.id and c.workspace_id = p.workspace_id;
  insert into public.app_feed_items (id, workspace_id, source, day, occurred_at, title, summary, points, counterpart, speaker_split,
    raw_text, raw_count, source_ref, drive_url, hidden_at, model, judged_at, moved_at, refilled_at, created_at, updated_at)
  values (p.id, p.workspace_id, 'call', p.day, p.occurred_at, p.title, p.summary, p.points, p.counterpart, p.speaker_split,
    p.raw_text, 0, p.source_ref, p.drive_url, p.hidden_at, p.model, p.judged_at, pg_catalog.now(), null, p.created_at, pg_catalog.now());
  return pg_catalog.jsonb_build_object('ok', true, 'id', p.id, 'from', p.kind, 'to', 'work', 'changed', true, 'needs_refill', true);
end
$$;
revoke all on function public.app_call_move(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.app_call_move(uuid, text) to authenticated;

drop table public.app_call_contact_ref;
drop table public.app_call_contact_choice;

delete from supabase_migrations.schema_migrations
  where version = '20261104200000' and name = 'call_contact_choice';
commit;
