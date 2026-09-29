💻 PC 로컬 필요

# TASK-29 옛 `app_tasks` 행 삭제: 적용 전후 조회와 복구 한계

이 PR은 SQL 파일만 준비한다. 운영 DB 조회·적용은 하지 않았다. 앱 코드와 표·트리거·정책·함수는 바꾸지 않는다.

## 변경·위험·되돌리기

- 무엇이 바뀌나: 옛 Web2 할 일 `public.app_tasks`의 완료 행 58건을 삭제한다. 표와 권한은 남는다.
- 잘못되면: 예상 행 수·상태·시각이 다르거나 잠금을 얻지 못하면 transaction이 중단되어 삭제와 migration 기록 모두 남지 않는다. 성공하면 앱의 옛 할 일 목록은 빈 목록이 된다.
- 되돌리는 방법: **백업 없음(2026-09-29 사용자 결정), 성공 적용 뒤 행 복구 불가.** 원본 행을 되살릴 rollback SQL은 없다. migration 기록만 지워도 행은 돌아오지 않으므로 그런 SQL을 제공하지 않는다. 안전장치로 중단된 경우에는 아무것도 바뀌지 않아 되돌릴 작업이 없다.

## 조사 snapshot과 적용 순서

2026-09-29 Claude Code 로컬의 읽기 전용 조사 결과(이 PR에서 운영 DB 재조회 없음): `app_tasks` 58건, 모두 완료·완료 시각 있음, 미완료 0건, 다른 담당자 0건, 출처 없음 30·project 26·meeting 2. 마지막 수정·완료는 2026-09-27. 다른 표에서 `app_tasks`를 가리키는 FK 없음. 표의 트리거 3개는 INSERT/UPDATE용이다. 이 수치는 아래 사전 조회의 대체물이 아니다.

1. PR merge 뒤 Claude Code 로컬에서 아래 **사전 확인**을 읽기 전용으로 실행해 결과를 대조한다. 값이 다르면 적용하지 않고 원인을 다시 조사한다.
2. 별도 적용 승인 후 사용자가 SQL Editor에서 main의 `supabase/migrations/20260929072329_task29_delete_app_tasks_rows.sql` 원문 전체를 실행한다. 끝 줄 `commit;`과 결과 `Success`를 확인한다. Codex는 적용하지 않는다.
3. Claude Code 로컬에서 아래 **사후 확인**을 읽기 전용으로 실행하고 사전 결과와 비교한다.

### 사전 확인 SELECT

제목·설명·메모는 조회하지 않는다. 시각 기준은 `2026-09-28 00:00 KST`를 명시한 `+09` 오프셋이다.

```sql
select count(*) as task_rows,
       count(*) filter (where status = 'done') as done_rows,
       count(*) filter (where status is distinct from 'done') as not_done_rows,
       count(*) filter (where updated_at is null or completed_at is null) as missing_timestamps,
       count(*) filter (where updated_at >= timestamptz '2026-09-28 00:00:00+09'
                           or completed_at >= timestamptz '2026-09-28 00:00:00+09') as recent_rows,
       max(updated_at) as last_updated_at,
       max(completed_at) as last_completed_at,
       (select count(*) from supabase_migrations.schema_migrations
         where version = '20260929072329') as migration_records
from public.app_tasks;

select 'app_record_links' as table_name, count(*) as row_count from public.app_record_links
union all select 'app_notes', count(*) from public.app_notes
union all select 'app_spaces', count(*) from public.app_spaces
union all select 'app_meetings', count(*) from public.app_meetings
union all select 'app_workspaces', count(*) from public.app_workspaces
order by table_name;
```

기대: `task_rows=58`, `done_rows=58`, `not_done_rows=0`, `missing_timestamps=0`, `recent_rows=0`, 마지막 수정·완료 시각은 2026-09-28 00:00 KST 전, `migration_records=0`. 다른 표의 행 수는 사전 비교 기준으로 기록한다. 예상과 다르면 멈춘다.

### 사후 확인 SELECT

```sql
select count(*) as task_rows,
       count(*) filter (where status = 'done') as done_rows,
       count(*) filter (where status is distinct from 'done') as not_done_rows,
       max(updated_at) as last_updated_at,
       max(completed_at) as last_completed_at,
       (select count(*) from supabase_migrations.schema_migrations
         where version = '20260929072329' and name = 'task29_delete_app_tasks_rows') as migration_records
from public.app_tasks;

select 'app_record_links' as table_name, count(*) as row_count from public.app_record_links
union all select 'app_notes', count(*) from public.app_notes
union all select 'app_spaces', count(*) from public.app_spaces
union all select 'app_meetings', count(*) from public.app_meetings
union all select 'app_workspaces', count(*) from public.app_workspaces
order by table_name;
```

기대: `app_tasks` 0행, 완료·미완료 각 0행, 마지막 수정·완료 시각 null, 해당 migration 기록 정확히 1행. 비교한 다른 표의 행 수는 사전 값과 같아야 한다. 앱에서 동시 쓰기가 발생하면 다른 표의 행 수 비교는 그 쓰기와 구분해 조사한다.

## 안전장치 중단 시

Migration은 단일 transaction이다. 58건이 아니거나, 하나라도 미완료·시각 누락·2026-09-28 00:00 KST 이후 수정/완료된 행이 있거나, 같은 version 기록이 이미 있거나, 삭제 행 수가 58이 아니면 예외가 난다. 잠금/실행 제한 시간 초과도 실패다. 이때 transaction 전체를 rollback하며 행과 migration 기록은 바뀌지 않는다. SQL Editor가 열린 transaction을 남겼다면 `rollback;`으로 종료하고, 사전 SELECT를 다시 실행해 원인을 확인한다. 조건을 임의로 느슨하게 바꿔 재실행하지 않는다.
