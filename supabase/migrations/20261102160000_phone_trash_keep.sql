begin;
-- S48-17 PHOTO-지우기두갈래(요청함 11/01 00:27, 시안 확정): '폰 공간만 비우기'로 폰에서 비운 사진을 목록에 남기고 [폰으로 되돌리기]로 제자리에 넣기 위한 칸 3개.
-- 이미 있는 표 public.app_phone_trash_log(20261101040000, 폰에서 지운 사진 기록)에 칸만 더한다:
--   keep boolean   = '폰 공간만 비우기'로 비운 사진(목록에 남김). 기존 행·사진 정리 [나머지 지우기]는 false(목록에 남기지 않음).
--   rel_path text  = 원래 폰 폴더(MediaStore 상대 경로, 예 'DCIM/Camera/'). 되돌릴 때 이 폴더에 넣는다.
--   taken_at timestamptz = 원래 찍은 시각(되돌릴 때 DATE_TAKEN, 목록의 날짜 자리).
-- 사진 이름·내용·크기·위치는 넣지 않는다. 넣기·고치기·지우기는 지금처럼 Edge onedrive-photos(service_role)만, 화면(authenticated)은 자기 작업공간 행 읽기만.
-- 안 하는 것: 권한·정책·함수·트리거 변경, 새 표, 기존 행 내용 변경, anon·PUBLIC 권한, 읽생기 표.
-- 앞 단계: 20261101040000(phone_trash_log)이 먼저 적용돼 있어야 한다.
-- 적용은 docs/ops-db-workflow.md "승인 한 번 흐름"(승인형 DB workflow)으로만 한다.
-- 짝: docs/20261102160000_phone_trash_keep.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261102160000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261101040000' and name = 'phone_trash_log') <> 1
     or to_regclass('public.app_phone_trash_log') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_phone_trash_log')
                and attname in ('keep', 'rel_path', 'taken_at') and not attisdropped)
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_phone_trash_log')) <> 1 then
    raise exception 'PHONE_TRASH_KEEP_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_phone_trash_log
  add column keep boolean not null default false,
  add column rel_path text,
  add column taken_at timestamptz,
  add constraint app_phone_trash_log_rel_path_check check (
    rel_path is null or (length(rel_path) between 1 and 255 and rel_path !~ '[[:cntrl:]]' and rel_path !~ '(^|/)\.\.(/|$)' and rel_path !~ '^/')
  );
create index app_phone_trash_log_keep_idx on public.app_phone_trash_log(workspace_id, taken_at desc) where keep and gone_at is null;

-- 사후 확인: 칸 3개·제약·인덱스, 권한·정책은 그대로(RLS 켜짐·anon 없음·authenticated 읽기만·service_role 넷·정책 1개). 다르면 전체 취소.
do $$
declare t regclass := 'public.app_phone_trash_log'::regclass;
begin
  if (select count(*) from pg_attribute where attrelid = t and attname in ('keep', 'rel_path', 'taken_at') and not attisdropped) <> 3
     or (select count(*) from pg_constraint where conrelid = t and conname = 'app_phone_trash_log_rel_path_check') <> 1
     or to_regclass('public.app_phone_trash_log_keep_idx') is null
     or not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_attribute where attrelid = t and attacl is not null)
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or not has_table_privilege('authenticated', t, 'select')
     or has_table_privilege('authenticated', t, 'insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('authenticated', t, 'insert,update,references')
     or not has_table_privilege('service_role', t, 'select,insert,update,delete')
     or has_table_privilege('service_role', t, 'truncate,references,trigger')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polcmd = 'r' and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
    raise exception 'PHONE_TRASH_KEEP_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261102160000', 'phone_trash_keep', array['S48-17 PHOTO-지우기두갈래: app_phone_trash_log keep, rel_path, taken_at (space-freed photos stay listed; restore to original folder and date)']);
commit;
