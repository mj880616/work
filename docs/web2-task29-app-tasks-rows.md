💻 PC 로컬 필요

# TASK-29 `app_tasks` 쓰기 차단·63행 삭제 적용 안내

이 PR은 저장소 파일만 준비한다. 운영 DB 조회·적용은 하지 않았다. 아래의 운영 수치는 사용자가 전달한 사전 확인 결과이며, 적용 직전 로컬 세션에서 다시 확인해야 한다. 할 일 제목·설명·메모는 조회·기록하지 않는다.

## 무엇이 바뀌나 / 위험 / 되돌리기

- 무엇이 바뀌나: `authenticated`·`anon`의 `public.app_tasks` INSERT·UPDATE·DELETE 권한을 회수하고, 확인된 63행을 모두 삭제한다. `authenticated` SELECT는 유지한다.
- 잘못되면: 행 수·상태·시각·권한·migration 기록 중 하나라도 예상과 다르면 transaction 전체가 중단된다. 조건이 맞아 삭제되면 빈 목록을 읽게 된다.
- 되돌리는 방법: **백업 없이 삭제하기로 한 결정 때문에 행은 복구할 수 없다.** 권한 회수만 되돌리는 SQL은 [rollback](web2-task29-app-tasks-rollback.sql)에 있다. 이를 실행하려면 별도 승인과 당시 권한 확인이 필요하다.

## #359 파일 처리와 적용 순서

#359의 `20260929072329_task29_delete_app_tasks_rows.sql`은 운영에 적용되지 않았다는 사용자 확인을 근거로 이 PR에서 삭제한다. 58행 전제의 구 SQL을 보관해 두면 잘못 적용할 위험이 있어 새 version `20260929081500` 한 개로 대체한다. 구 version이 이미 기록되어 있다면 새 migration은 예외로 중단된다. 정책·트리거·함수·앱 코드는 이번 PR에서 변경하지 않는다.

저장소 기준 권한·의존성: 2026-09-25 snapshot의 `app_tasks` GRANT는 `authenticated`에 SELECT·INSERT·UPDATE·DELETE·MAINTAIN, `anon`에는 권한 없음, `service_role`에는 별도 권한이 있다. Task 12A migration은 이전 정책을 제거하고 `authenticated` 소유자용 `task12a_owner_all` 한 개를 만들었다. 저장소 조사 문서에 기록된 트리거 세 개는 `app_tasks_workspace_consistency`, `app_tasks_child_project_guard`, `trg_app_prepare_task_assignment`다. `trg_app_notify_task_assignment`는 앞선 migration에서 제거되었다. 이 PR은 정책·트리거와 `service_role`·DB 관리자 권한을 변경하지 않는다. 따라서 권한 회수의 쓰기 차단 범위는 `anon`·`authenticated`이며, 특권 연결을 통한 쓰기까지 막는 것은 아니다. 운영의 실제 권한·정책·트리거 상태는 이번 PR에서 조회하지 않았다.

1. PR merge 이후 Claude Code 로컬에서 [사전 확인 SQL](web2-task29-app-tasks-precheck.sql)을 읽기 전용으로 실행한다. 아래 기대값과 다르면 적용하지 않는다.
2. 별도 적용 승인 후 사용자가 SQL Editor에서 main의 `supabase/migrations/20260929081500_task29_block_writes_delete_app_tasks_rows.sql` **원문 전체**를 실행한다. 마지막 `commit;`과 실행 결과 `Success`를 확인한다. `db push`·`migration repair`는 사용하지 않는다.
3. Claude Code 로컬에서 [사후 확인 SQL](web2-task29-app-tasks-postcheck.sql)을 읽기 전용으로 실행해 사전 snapshot과 대조한다.

## 사전 확인 기대값

| 항목 | 기대값 |
| --- | ---: |
| `app_tasks` 전체 / `done` / 미완료 | 63 / 58 / 5 |
| 완료 58건의 수정·완료 시각 누락 | 0 |
| 완료 58건의 2026-09-28 00:00 KST 이후 수정·완료 | 0 |
| 미완료 5건 중 `todo`, 완료 시각 null, 생성·수정 시각이 2026-09-29 16:24:03 KST의 같은 초가 아닌 행 | 0 |
| 전체 중 2026-09-29 16:25:00 KST 이후 생성·수정·완료된 행 | 0 |
| 구 version `20260929072329` / 새 version `20260929081500` 기록 | 0 / 0 |

저장소의 2026-09-25 권한 snapshot에는 `authenticated` SELECT·INSERT·UPDATE·DELETE, `anon`에는 이 네 권한이 없었다. 사전 SQL에서 현행 권한을 다시 확인한다. `anon`에 SELECT를 새로 부여하지 않는다. Web2는 로그인 후 `team.js`가 `authenticated`로 읽으며, 익명 읽기 허용은 보안 경계를 넓힌다.

사전 SQL의 정책·트리거 이름도 보관한다. 저장소 기준 기대는 정책 `task12a_owner_all` 한 개와 위 트리거 세 개이며, 다르면 적용 전 원인을 확인한다.

다른 표의 사용자 제공 기준은 `app_meetings=6`, `app_record_links=7`, `app_spaces=7`, `app_workspaces=1`, `app_notes=0`이다. 적용 직전 값이 다르면 원인을 먼저 확인한다. 사전 조회의 실제 행 수를 사후 비교 기준으로 저장한다.

## 사후 확인 기대값과 중단 시 조치

`app_tasks=0`, 새 version·name 기록 1, 구 version 기록 0. `authenticated` SELECT=true·INSERT/UPDATE/DELETE=false, `anon` SELECT=false·INSERT/UPDATE/DELETE=false. 정책·트리거 이름과 다른 다섯 표의 행 수는 사전 값과 같아야 한다. 다른 작업에 의한 동시 변경이 의심되면 원인을 분리해 조사한다.

Migration은 `access exclusive` 잠금과 하나의 transaction으로 쓰기 권한 회수, 안전장치, 63행 삭제, migration 기록을 함께 처리한다. 예외·잠금 시간 초과·삭제 행 수 불일치가 발생하면 전체가 rollback된다. SQL Editor에 실패 transaction이 남았다면 `rollback;`으로 종료한 뒤 사전 SELECT를 다시 실행한다. 안전장치를 완화해 재실행하지 않는다.
