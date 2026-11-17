begin;
-- WEEKLY-내부회의사람별(요청함 11/17 17:45, 명진 "이건 나에게만 해당되는"): 주간 보고에서 내부 정례 회의를 빼는 말(상집·중집·집행위·
-- 집행국·상무집행·중앙집행)은 지금까지 화면 코드(app/weekly-major-schedule.mjs)에 고정돼 모든 사람에게 걸렸다. 그 말을 운영자 프로필 한 행으로 옮긴다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇:
--  1) 같은 칸 app_profiles.weekly_hidden_meeting_kinds(20261022090000)를 그대로 쓴다. 새 칸·새 표·새 검사 없음.
--     목록 항목 가운데 '*단어*' 모양은 "이름에 이 말이 들어간 회의는 빼기"로 읽는다(app/journal-meeting-kinds.js). 기존 CHECK가 그대로 받는 모양이다.
--  2) 새 사람의 기본값을 빈 목록으로 바꾼다(전에는 '궤도집행국회의'·'본부집행위' 둘).
--     명진 결정(11/17 18:42 "비워"): 이미 가입한 다른 사람(운영자 제외)의 행 가운데 값이 옛 기본값과 정확히 같은 행만 빈 목록으로 비운다.
--     직접 바꾼 목록(다른 값)은 그대로 둔다. 값은 읽지 않고 같은지만 비교한다(지운 값은 옛 기본값 그 자체라 되살릴 내용이 따로 없음).
--  3) 운영자(허용 표 app_operator_features의 calls 작업공간 owner, 20261105131500과 같은 근거) 프로필 한 행에만 옛 고정 단어 여섯을
--     '*단어*'로 끝에 더한다. 지금 값(두 종류와 그 뒤 더한 종류)은 그대로 둔다 — 명진의 주간 보고 결과는 바뀌지 않는다.
--     운영자 프로필이 정확히 1행이 아니거나, 이미 '*…*' 항목이 있거나, 더하면 100개를 넘으면 멈춘다. 다른 사람의 행에는 단어를 넣지 않는다.
-- 권한: grant·revoke·정책·RLS·함수·트리거·칸·검사 변경 없음. 프로필 정책은 task12a 두 개 그대로(자기 행만 읽고 씀).
-- 짝: docs/20261117190000_weekly_meeting_words.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261117190000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261022090000' and name = 'weekly_report_meeting_kinds') <> 1
     -- 칸과 기본값·검사가 20261022090000 모양 그대로.
     or (select count(*) from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
         where a.attrelid = 'public.app_profiles'::regclass and not a.attisdropped and a.attname = 'weekly_hidden_meeting_kinds'
           and a.attnotnull and format_type(a.atttypid, a.atttypmod) = 'text[]'
           and pg_get_expr(d.adbin, d.adrelid) = 'ARRAY[''궤도집행국회의''::text, ''본부집행위''::text]') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass
         and conname = 'app_profiles_weekly_hidden_meeting_kinds_check' and contype = 'c' and convalidated) <> 1
     -- 권한 경계: RLS 켜짐, anon·PUBLIC 표 권한 없음, 정책은 task12a 두 개.
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1
     -- 아직 아무 행에도 '*…*' 항목이 없다.
     or exists (select 1 from public.app_profiles p, unnest(p.weekly_hidden_meeting_kinds) k where k like '*%*')
     -- 운영자 프로필 정확히 1행, 더해도 100개 이하.
     or (select count(*) from public.app_profiles p
         where p.user_id in (select m.user_id from public.app_workspace_members m
                             where m.role = 'owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'calls'))
           and cardinality(p.weekly_hidden_meeting_kinds) <= 94) <> 1 then
    raise exception 'WEEKLY_MEETING_WORDS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 2) 새 사람은 빈 목록으로 시작한다(기존 행 값은 그대로).
alter table public.app_profiles
  alter column weekly_hidden_meeting_kinds set default '{}'::text[];

-- 2-b) 운영자가 아닌 행 중 옛 기본값과 정확히 같은 행만 빈 목록으로.
update public.app_profiles
   set weekly_hidden_meeting_kinds = '{}'::text[]
 where weekly_hidden_meeting_kinds = array['궤도집행국회의', '본부집행위']::text[]
   and user_id not in (select m.user_id from public.app_workspace_members m
                       where m.role = 'owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'calls'));

-- 3) 운영자 프로필 한 행에만 옛 고정 단어 여섯을 '*단어*'로 끝에 더한다(순서·기존 항목 그대로).
update public.app_profiles
   set weekly_hidden_meeting_kinds = weekly_hidden_meeting_kinds || array['*상집*', '*중집*', '*집행위*', '*집행국*', '*상무집행*', '*중앙집행*']::text[]
 where user_id in (select m.user_id from public.app_workspace_members m
                   where m.role = 'owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'calls'));

-- 사후 확인: 권한 경계 그대로, 기본값은 빈 목록, 운영자 아닌 행 중 옛 기본값 그대로인 행 없음,
-- '*…*' 항목이 있는 프로필은 운영자 1행뿐이고 여섯 단어가 모두 있다. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
         where a.attrelid = 'public.app_profiles'::regclass and not a.attisdropped and a.attname = 'weekly_hidden_meeting_kinds'
           and pg_get_expr(d.adbin, d.adrelid) = '''{}''::text[]') <> 1
     or exists (select 1 from public.app_profiles p
         where p.weekly_hidden_meeting_kinds = array['궤도집행국회의', '본부집행위']::text[]
           and p.user_id not in (select m.user_id from public.app_workspace_members m
                                 where m.role = 'owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'calls')))
     or (select count(*) from public.app_profiles p where exists (select 1 from unnest(p.weekly_hidden_meeting_kinds) k where k like '*%*')) <> 1
     or (select count(*) from public.app_profiles p
         where p.weekly_hidden_meeting_kinds @> array['*상집*', '*중집*', '*집행위*', '*집행국*', '*상무집행*', '*중앙집행*']::text[]
           and p.user_id in (select m.user_id from public.app_workspace_members m
                             where m.role = 'owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'calls'))) <> 1 then
    raise exception 'WEEKLY_MEETING_WORDS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261117190000', 'weekly_meeting_words', array['WEEKLY-내부회의사람별: app_profiles.weekly_hidden_meeting_kinds default now empty; non-operator rows equal to the old default emptied; operator profile (calls owner) gets six *word* entries; no grants, policies, columns or checks changed']);
commit;
