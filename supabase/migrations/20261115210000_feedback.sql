begin;
-- FEEDBACK-의견보내기 PR4(명진 11/15 18:13 '가' — 답장 없음, 고친 것은 운영자가 '업데이트 소식'으로만 알림).
-- 메뉴 맨 아래 '의견 보내기'(모든 이용자)로 글(필수)·사진 1~3장(선택)·자동 정보(지금 보던 화면 이름·폰/폴드/PC·앱/브라우저·판 번호)를 보낸다.
-- 운영자 전용 '받은 의견'에서 보낸 사람 이름·시각·화면·기기·글·사진을 보고 [처리함]을 표시한다. 새 의견 숫자는 운영자만.
--  1) 새 표 public.app_feedback(의견), public.app_feedback_photos(사진 바이트 — 비공개 저장: 이 표 밖으로는 운영자 함수로만 나간다).
--     둘 다 RLS 켬·정책 없음·API 역할 권한 없음 → 아래 함수로만 읽고 쓴다. 사진을 파일 저장소 대신 이 표에 두는 까닭: 저장소 버킷·정책을
--     새로 열지 않고 같은 서버 판정 한 곳에서 쓰기(자기 것)·읽기(운영자)를 막기 위해서다. 크기는 장당 1MB·하루 상한으로 묶는다.
--  2) 쓰기 app_feedback_send(글, 자동 정보, 사진): 로그인한 사람만, 보낸 사람은 언제나 auth.uid()(화면이 보낸 id를 믿지 않음).
--     글 1~2000자, 자동 정보는 정해진 네 칸만(길이 제한, 그 밖 칸은 버림), 사진 0~3장(jpeg·png·webp, 장당 1MB), 24시간에 10건까지.
--  3) 운영자(운영자 기능 'dev_inbox' 작업공간 owner, private.app_workspace_has_feature)만: app_feedback_list(거르기), app_feedback_photo(id, 번호),
--     app_feedback_done(id, 처리함 여부), app_feedback_open_count(). 아니면 42501 OPERATOR_FEATURE_REQUIRED.
--     보낸 사람 본인도 보낸 뒤에는 읽지 못한다(읽기는 운영자만). 의견 글을 발송·공유·삭제와 자동으로 잇지 않는다(요청함 옮기기는 사람이 직접).
-- 안 하는 것: 운영자 기능 표·기존 함수·정책·권한 변경, 파일 저장소 버킷·정책, rtw_* 객체, 알림 보내기.
-- 짝: docs/20261115210000_feedback.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115210000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261103100000' and name = 'dev_inbox_feature') <> 1
     or to_regclass('public.app_feedback') is not null
     or to_regclass('public.app_feedback_photos') is not null
     or to_regclass('public.app_profiles') is null
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null then
    raise exception 'FEEDBACK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  workspace_id uuid,
  body text not null,
  screen text,
  device text,
  client text,
  app_version text,
  photo_count smallint not null default 0,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  constraint app_feedback_body check (char_length(body) between 1 and 2000),
  constraint app_feedback_screen check (screen is null or char_length(screen) <= 40),
  constraint app_feedback_device check (device is null or device in ('phone', 'fold', 'pc')),
  constraint app_feedback_client check (client is null or client in ('app', 'browser')),
  constraint app_feedback_version check (app_version is null or char_length(app_version) <= 40),
  constraint app_feedback_photo_count check (photo_count between 0 and 3)
);
create index app_feedback_user_time_idx on public.app_feedback (user_id, created_at desc);
create index app_feedback_open_idx on public.app_feedback (created_at desc) where done_at is null;
alter table public.app_feedback enable row level security;
revoke all on table public.app_feedback from public, anon, authenticated, service_role;

create table public.app_feedback_photos (
  feedback_id uuid not null references public.app_feedback(id) on delete cascade,
  idx smallint not null,
  mime text not null,
  bytes bytea not null,
  primary key (feedback_id, idx),
  constraint app_feedback_photos_idx check (idx between 0 and 2),
  constraint app_feedback_photos_mime check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  constraint app_feedback_photos_size check (octet_length(bytes) between 1 and 1048576)
);
alter table public.app_feedback_photos enable row level security;
revoke all on table public.app_feedback_photos from public, anon, authenticated, service_role;

-- 운영자 판정 한 곳(이 파일의 DEFINER 함수들만 부름, API 역할 실행 권한 없음).
create function private.app_feedback_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (select 1 from public.app_operator_features f
                  where f.feature = 'dev_inbox' and private.app_workspace_has_feature(f.workspace_id, 'dev_inbox'))
$$;

create function public.app_feedback_send(p_body text, p_context jsonb, p_photos jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_ctx jsonb := case when pg_catalog.jsonb_typeof(p_context) = 'object' then p_context else '{}'::jsonb end;
  v_photos jsonb := coalesce(p_photos, '[]'::jsonb);
  v_screen text;
  v_device text;
  v_client text;
  v_version text;
  v_id uuid;
  v_i integer := 0;
  v_item jsonb;
  v_bytes bytea;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if pg_catalog.char_length(v_body) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'FEEDBACK_BODY';
  end if;
  if pg_catalog.jsonb_typeof(v_photos) <> 'array' or pg_catalog.jsonb_array_length(v_photos) > 3 then
    raise exception using errcode = '22023', message = 'FEEDBACK_PHOTOS';
  end if;
  -- 하루 상한: 같은 사람 24시간에 10건(사람마다 잠가 동시에 보내도 넘지 않게).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feedback_send:' || v_user::text, 0));
  if (select pg_catalog.count(*) from public.app_feedback f where f.user_id = v_user and f.created_at > pg_catalog.now() - interval '24 hours') >= 10 then
    raise exception using errcode = '54000', message = 'FEEDBACK_DAILY_LIMIT';
  end if;
  v_screen := nullif(pg_catalog.left(pg_catalog.btrim(coalesce(v_ctx ->> 'screen', '')), 40), '');
  v_device := case when v_ctx ->> 'device' in ('phone', 'fold', 'pc') then v_ctx ->> 'device' end;
  v_client := case when v_ctx ->> 'client' in ('app', 'browser') then v_ctx ->> 'client' end;
  v_version := nullif(pg_catalog.left(pg_catalog.btrim(coalesce(v_ctx ->> 'version', '')), 40), '');
  insert into public.app_feedback (user_id, workspace_id, body, screen, device, client, app_version, photo_count)
  values (v_user,
          (select m.workspace_id from public.app_workspace_members m where m.user_id = v_user and m.role = 'owner' order by m.workspace_id limit 1),
          v_body, v_screen, v_device, v_client, v_version, pg_catalog.jsonb_array_length(v_photos))
  returning id into v_id;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_photos) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' or (v_item ->> 'mime') not in ('image/jpeg', 'image/png', 'image/webp')
       or pg_catalog.jsonb_typeof(v_item -> 'data') <> 'string' or pg_catalog.octet_length(v_item ->> 'data') > 1400000 then
      raise exception using errcode = '22023', message = 'FEEDBACK_PHOTOS';
    end if;
    begin
      v_bytes := pg_catalog.decode(v_item ->> 'data', 'base64');
    exception when others then
      raise exception using errcode = '22023', message = 'FEEDBACK_PHOTOS';
    end;
    if pg_catalog.octet_length(v_bytes) not between 1 and 1048576 then
      raise exception using errcode = '22023', message = 'FEEDBACK_PHOTOS';
    end if;
    insert into public.app_feedback_photos (feedback_id, idx, mime, bytes) values (v_id, v_i, v_item ->> 'mime', v_bytes);
    v_i := v_i + 1;
  end loop;
  return v_id;
end
$$;

create function public.app_feedback_list(p_state text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.app_feedback_operator() then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', f.id, 'name', coalesce(nullif(pg_catalog.btrim(p.display_name), ''), '이름 없음'),
             'created_at', f.created_at, 'screen', f.screen, 'device', f.device, 'client', f.client, 'version', f.app_version,
             'body', f.body, 'photos', f.photo_count, 'done_at', f.done_at) order by f.created_at desc)
      from (select * from public.app_feedback x
             where case coalesce(p_state, 'open') when 'open' then x.done_at is null when 'done' then x.done_at is not null else true end
             order by x.created_at desc limit 300) f
      left join public.app_profiles p on p.user_id = f.user_id), '[]'::jsonb);
end
$$;

create function public.app_feedback_photo(p_id uuid, p_idx integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.app_feedback_operator() then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  return (select pg_catalog.jsonb_build_object('mime', ph.mime, 'data', pg_catalog.translate(pg_catalog.encode(ph.bytes, 'base64'), E'\n', ''))
            from public.app_feedback_photos ph where ph.feedback_id = p_id and ph.idx = p_idx);
end
$$;

create function public.app_feedback_done(p_id uuid, p_done boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.app_feedback_operator() then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  update public.app_feedback f
     set done_at = case when coalesce(p_done, true) then coalesce(f.done_at, pg_catalog.now()) end
   where f.id = p_id;
  return found;
end
$$;

create function public.app_feedback_open_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.app_feedback_operator() then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  return (select pg_catalog.count(*)::integer from public.app_feedback f where f.done_at is null);
end
$$;

revoke all on function private.app_feedback_operator() from public, anon, authenticated, service_role;
revoke all on function public.app_feedback_send(text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.app_feedback_list(text) from public, anon, authenticated, service_role;
revoke all on function public.app_feedback_photo(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.app_feedback_done(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.app_feedback_open_count() from public, anon, authenticated, service_role;
grant execute on function public.app_feedback_send(text, jsonb, jsonb) to authenticated;
grant execute on function public.app_feedback_list(text) to authenticated;
grant execute on function public.app_feedback_photo(uuid, integer) to authenticated;
grant execute on function public.app_feedback_done(uuid, boolean) to authenticated;
grant execute on function public.app_feedback_open_count() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['public.app_feedback', 'public.app_feedback_photos'] loop
    if not (select relrowsecurity from pg_class where oid = t::regclass)
       or exists (select 1 from pg_policy where polrelid = t::regclass)
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('authenticated', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger') then
      raise exception 'FEEDBACK_POSTCHECK_FAILED: %', t;
    end if;
  end loop;
  if (select count(*) from pg_proc where oid in (to_regprocedure('private.app_feedback_operator()'), to_regprocedure('public.app_feedback_send(text,jsonb,jsonb)'),
        to_regprocedure('public.app_feedback_list(text)'), to_regprocedure('public.app_feedback_photo(uuid,integer)'),
        to_regprocedure('public.app_feedback_done(uuid,boolean)'), to_regprocedure('public.app_feedback_open_count()'))
        and prosecdef and proconfig = array['search_path=""']) <> 6
     or has_function_privilege('authenticated', 'private.app_feedback_operator()', 'execute')
     or has_function_privilege('anon', 'private.app_feedback_operator()', 'execute')
     or exists (select 1 from unnest(array['public.app_feedback_send(text,jsonb,jsonb)', 'public.app_feedback_list(text)', 'public.app_feedback_photo(uuid,integer)',
        'public.app_feedback_done(uuid,boolean)', 'public.app_feedback_open_count()']) f
        where has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute')
           or not has_function_privilege('authenticated', f, 'execute')) then
    raise exception 'FEEDBACK_POSTCHECK_FAILED: functions';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261115210000', 'feedback', array['FEEDBACK send feedback: new tables app_feedback and app_feedback_photos (bytea, jpeg/png/webp, 1 MB each; RLS on, no policies, no API privileges); app_feedback_send(text,jsonb,jsonb) for authenticated (sender is always auth.uid(), body 1-2000, four context fields only, 0-3 photos, 10 per 24 hours); operator-only (dev_inbox owner via private.app_feedback_operator) app_feedback_list(text), app_feedback_photo(uuid,integer), app_feedback_done(uuid,boolean), app_feedback_open_count(); no anon or service_role execute']);
commit;
