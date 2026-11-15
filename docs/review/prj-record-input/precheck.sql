-- PRJ-기록입력 merge 전 읽기 전용 확인(select만, 📱 폰 경로 C의 확인 SQL). 데이터·권한을 바꾸지 않는다.
-- 새 기록은 진행상황 항목 없이(workstream_id null), 종류 없이(status_label null) app_project_progress_updates에 저장된다.
-- 기대 결과: ① workstream_id·status_label·next_step is_nullable = YES ② 정책이 project_id의 공간 권한만 확인
-- ③ workstream_id를 필수로 만드는 제약·트리거 없음. 하나라도 다르면 merge하지 말고 알려 주세요.

-- ① 칸
select column_name, is_nullable, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'app_project_progress_updates'
order by ordinal_position;

-- ② 정책
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'app_project_progress_updates';

-- ③ 제약·트리거
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.app_project_progress_updates'::regclass;

select tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where tgrelid = 'public.app_project_progress_updates'::regclass and not tgisinternal;

-- 참고: 지금 항목 없는 기록 수
select count(*) filter (where workstream_id is null) as no_item, count(*) as total
from public.app_project_progress_updates;
