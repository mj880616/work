# TASK-구현 0단계: 설계 대조·구현 계획

- 기준: main `84ba80f`. 조사일 2026-09-27. 조사 방식은 저장소 코드 읽기, Supabase MCP 조회 전용(구조·개수만, 제목·내용은 조회하지 않음), Edge 로그 집계(건수·소요 시간만).
- 이 문서는 계획이다. 코드·DB·Edge 변경은 하지 않았다. 아래 SQL은 모두 **초안이며 실행 금지**다. migration 파일도 만들지 않았다.
- 선행 설계: [묶음A 조사 문서](web2-bundle-a-investigation.md) 3절(TASK-설계, #319), 4절(업무 인박스 구조).
- 2026-09-27 사용자 결정(6절 1~9)과 표시 범위 정정(확정 사항 5)을 반영했다.

## 0. 확정 사항 (이 계획의 전제)

1. 할 일 원본은 Google Tasks다. Web2는 할 일 자체(제목·기한·완료 여부)를 저장하지 않고 연결 정보만 가진다.
2. 새 할 일의 기본 목록은 Google "내 할 일"(`@default`)이다.
3. 할 일·메모가 함께 쓰는 꼬리표 표를 하나 둔다. 연결 대상은 프로젝트·조직 둘 다다.
4. Web2 할 일 58건은 백업 없이 삭제한다(2026-09-27 사용자 재확인).
5. Google 할 일 표시 범위(2026-09-27 사용자 정정. 이전 기록 "기한 지남·기한 없음 표시 안 함"은 잘못 기록된 것):
   - 할 일 화면: 기한 지난 미완료(맨 위 별도 묶음, 최우선) + 오늘~6일 후 기한. 완료 항목은 최근 3일만 표시한다(묶음C-2·C-3).
   - 기한 없음: 7일 목록에서는 빼고, 연결 안 된 할 일 모음과 프로젝트·조직 화면에서 표시한다.
   - 홈: 오늘·밀린 할 일을 표시한다(디자인·홈 신설 범위).
   - 기한 지남 표시는 TASK-구현 PR 1 앞의 묶음C-4에서 한다(Edge 조회 조건 + 앱 표시, Edge 재배포).
6. 25(개인 업무 AI)가 이 꼬리표 표로 사업·조직을 분류한다. 구조를 그에 맞춘다.
7. CAL-할일(캘린더에 오늘 할 일 표시)이 이 구조를 쓴다.
8. 할 일 완료·완료 취소는 누르는 즉시 화면에 반영하고 Google 저장은 뒤에서 처리한다. 저장이 실패하면 원래 상태로 되돌리고 실패를 안내한다.

원장에 이미 기록된 결정(2026-09-26)도 그대로 따른다.

- 할 일 목록은 Google 기본 목록 "내 할 일" **하나**를 쓴다(조사 문서 3.2 선택지 A).
- 할 일 연결과 메모 연결은 표 하나(조사 문서 4.4 통합안 `app_record_links`)로 한다. 이 안을 택했으므로 메모 표(`app_notes`)도 TASK-구현에서 함께 만든다.
- 기존 기능 제거는 21(코드)·29(DB)에서 한다.
- TASK-구현 범위(원장 행): 화면별 할 일 추가를 Google Tasks로, 연결 안 된 할 일 모음, 목록 개수 기준 변경.

## 1. 현재 구조 / 목표 구조 / 차이

### 1.1 현재 구조

**DB (행 수는 2026-09-27 조회, 개수만)**

| 표 | 행 수 | 역할 | 정책·트리거 |
| --- | --- | --- | --- |
| `app_tasks` | 58 (58건 모두 완료 상태) | Web2 자체 할 일 | 정책 `task12a_owner_all`(authenticated), 트리거 3개(`app_tasks_workspace_consistency`, `app_tasks_child_project_guard`, `trg_app_prepare_task_assignment`), 나가는 FK 5개, 들어오는 FK 없음 |
| `app_suborganization_updates` | 3 | 조직 "기록"(18) | `task12a_owner_all` |
| `app_suborganization_status_items` | 0 | 조직 예전 메모(읽기 전용, 18b 삭제만) | `task12a_owner_all` |
| `app_project_progress_updates` | 1 | 프로젝트 진행상황(16) | 공간 권한 함수 기반 4개 |
| `app_project_update_labels` | 0 | 진행상황 라벨 | 4개 |
| `app_org_affiliation_tags` | 6 | 조직 소속 칩(협의회·사업단) | `task12a_owner_all` |
| `app_project_suborganizations` | 0 | 프로젝트↔조직 | — |
| `app_google_calendar_connections` | 1 | Google 토큰(일정·할 일 공용) | — |
| 참고: `app_spaces` 7, `app_suborganizations` 94, `app_meetings` 6, `app_workspaces` 1 | | | |

- 인박스 메모 표(`app_notes`)와 연결 표(`app_record_links`, `app_task_links`)는 **아직 없다**.
- 조사 문서 1.9에서는 미완료가 2건이었으나, 지금은 58건 모두 완료 상태다. 미완료 2건 처리(조사 문서 3.5의 2단계)는 사실상 끝났다(사용자 처리로 추정).
- `app_tasks`를 참조하는 DB 함수:
  - `private.app_enforce_workspace_links()`: 공용 트리거 함수이며 `app_tasks` 분기만 있다. 표를 지워도 다른 표에는 영향이 없다.
  - `private.app_unlink_retained_project_records()`: **`app_spaces` 삭제 전 트리거(`app_spaces_unlink_retained_records_before_delete`)가 쓴다.** 이 함수를 먼저 고치지 않고 `app_tasks`를 지우면 프로젝트 삭제가 오류로 멈춘다.
  - `public.app_public_projects_snapshot()`: Task 13에서 실행 권한이 회수된 옛 공개 RPC다(anon·authenticated 실행 불가). 표를 지우기 전이나 함께 지운다(26 범위).
- Web1 사용 여부: 저장소 루트 공개 페이지·Web1 함수에서 `app_tasks`, 할 일 관련 RPC, `google-tasks`를 쓰는 곳은 없다. Web1 영향은 없다.

**앱 (`app_tasks`를 읽거나 쓰는 파일)**

| 파일 | 로드 여부 | 하는 일 |
| --- | --- | --- |
| `task-layout.js` | `view-loader.js` | 할 일 탭의 Web2 할 일 목록·추가·수정·완료 |
| `project-system-v3.js` | `view-loader.js` | 프로젝트 상세의 할 일 목록·추가, 목록 화면 할 일 개수 합계(#305) |
| `meeting-round-detail.js` | `view-loader.js` | 회의 후속 할 일 생성·수정·삭제(`source_type=meeting`) |
| `team.js` | `loader-v2.js` | 전체 할 일 조회, 배정 저장 |
| `app.js` | `index.html` | 요청 경로 `/app_tasks`를 화면 이름 `tasks`로 분류(캐시 무효화 용도) |
| `workflow-ai-v3.js`, `home-dashboard-v2.js`, `task-notes.js`, `project-task-link.js` | 어느 로더도 불러오지 않음(비활성) | 31 정리 대상 |

- Google 할 일: `google-tasks.js`는 `view-loader.js`가 불러온다. 할 일 탭 아래 "Google 할 일" 칸에서 쓴다.
- Edge:
  - `team-ai`가 `app_tasks`를 조회한다(25에서 제거).
  - `google-tasks`(v9, verify_jwt=false)는 `overview / status / lists / tasks / create / update / toggle / delete / start`를 제공한다. 조회는 모든 목록을 읽는다.
- `app_tasks`를 참조하는 테스트: `supabase/tests/authz_task_assignee.sql`, `authz_sole_owner.sql`, `tests/security/task12a-sole-owner-migration.test.mjs`, `document-edge-authz.test.mjs`, `tests/app-e2e/` 14개 파일(`workspace`, `project-system-v3`, `meeting-entry`, `home-dashboard-v2`, `task-layout-fixture` 등).

### 1.2 완료 처리 경로와 지연 원인 (2026-09-27 제보: 폰에서 1~2초 반응 없음)

현재 경로(`app/google-tasks.js` `toggleTask` → Edge `action=toggle` → Google `PATCH`):

1. 앱이 `POST google-tasks {action:'toggle'}`을 보낸다. 브라우저가 먼저 CORS 사전 요청(`OPTIONS`)을 보낸다.
2. Edge가 로그인 확인(`auth.getUser`) → 연결 행 조회(`ensureAccess`, 만료 시 토큰 갱신) → Google `PATCH`를 차례로 거친다.
3. 응답이 오면 앱이 `load(true)`로 **전체 목록을 다시 받는다**(`overview`: 로그인 확인 + 연결 조회 + 권한 확인과 목록·할 일 조회). 여기서도 `OPTIONS`가 먼저 간다.
4. 목록을 다 받은 뒤에야 체크 표시가 바뀐다.

운영 로그(최근 24시간, `google-tasks`, 건수·소요 시간만):

| 요청 | 건수 | 중앙값 | 90% |
| --- | --- | --- | --- |
| `OPTIONS` | 208 | 155ms | 198ms |
| `POST`(생성·수정·완료·삭제) | 6 | 868ms | 1,016ms |
| `GET`(`overview`) | 194 | 903ms | 1,187ms |

- 원인(사실): 화면 반영이 "저장 왕복 + 전체 재조회 왕복" 두 번(각각 사전 요청 포함)을 모두 기다린다. 중앙값만 더해도 약 2.1초다. 제보된 1~2초와 맞는다.
- 부수 위험(코드 확인): `load()`는 같은 세션의 조회가 진행 중이면 바로 돌아간다(`loadingEpoch===epoch`). 조회 중에 완료를 누르면 저장 뒤의 재조회가 건너뛰어진다. 그러면 진행 중이던 조회의 옛 상태가 화면에 남을 수 있다(추정, 재현은 안 함). 즉시 반영 방식으로 바꿀 때 함께 막는다(4절).

### 1.3 목표 구조

- 할 일: Google Tasks가 유일한 원본이다. 읽기·만들기 모두 "내 할 일" 목록 하나만 쓴다. 할 일 화면은 기한 지난 미완료(맨 위 별도 묶음) + 오늘~6일 후 기한으로 표시한다(확정 사항 5, 묶음C-4).
- 연결: 꼬리표 표 1개(`app_record_links`, 조사 문서 4.4 통합안을 확정 사항 3·6에 맞게 줄임). 출처는 Google 할 일 1건 또는 메모 1건이다. 대상은 프로젝트 또는 조직 1개이고, 할 일 하나를 여러 대상에 연결할 수 있다(결정 2). 25용 `status`(`suggested`/`confirmed`)·`report_kind` 칸을 처음부터 둔다. 메모 원문 표 `app_notes`를 함께 만든다(빈 표, 메모 입력은 25).
- 목록 개수용 완료 여부: 연결 표의 할 일 행에 Google 완료 여부 사본을 둔다(결정 4, 4.3절). 확정 사항 1의 예외다. 화면 표시는 계속 Google 응답을 쓰고, 이 사본은 프로젝트 목록 개수에만 쓴다.
- 연결 안 된 할 일 모음: "내 할 일"의 미완료 중 연결이 없는 것을 기한과 무관하게(기한 없음 포함) 할 일 화면 아래 접힌 칸에 모아 보여 주고, 거기서 바로 연결한다(결정 7).
- Web2 자체 할 일: 화면·코드(21) → 참조 Edge(25) → DB(29) 순서로 제거한다. 58건은 백업 없이 삭제한다.
- 완료 처리: 화면을 먼저 바꾸고 저장은 뒤에서 한다. 실패하면 되돌리고 안내한다. 저장 뒤 전체 재조회는 하지 않고 Edge 응답의 할 일 1건으로 바꿔 끼운다.

### 1.4 차이

| 항목 | 현재 | 목표 | 담당 |
| --- | --- | --- | --- |
| 연결 정보 | 없음(`app_tasks.project_id`·`source_id`만) | `app_record_links` | TASK-구현(DB, 정지 지점) |
| 읽는 목록 | Edge가 모든 목록을 읽음 | "내 할 일" 하나 | TASK-구현(Edge) |
| 새 할 일 목록 | 편집창에서 사용자가 목록 선택 | "내 할 일" 고정(선택칸 제거) | TASK-구현(앱·Edge) |
| 메모 원문 표 | 없음 | `app_notes`(빈 표) | TASK-구현(DB, 정지 지점) |
| 할 일 화면 표시 범위 | 오늘~6일 후 기한만(기한 지남 안 보임) | 기한 지난 미완료(맨 위 별도 묶음) + 오늘~6일 후 | 묶음C-4(Edge·앱) |
| 연결 안 된 할 일 모음 | 없음 | 할 일 화면 아래 접힌 칸, 기한과 무관하게 미완료 전부(결정 7) | TASK-구현(앱·Edge) |
| 할 일 추가 시 연결 | 없음 | 프로젝트·조직 연결은 고르지 않아도 됨, 나중에 연결 가능(결정 1). 여러 개 가능(결정 2). 할 일 편집창과 프로젝트·조직 화면 양쪽에서 지정(결정 6) | TASK-구현(앱·Edge) |
| 프로젝트·조직 화면의 할 일 | 프로젝트 상세가 `app_tasks` 목록 | 연결된 미완료 전부(기한 없음·지남 포함) + 최근 3일 완료(결정 3) | TASK-구현(앱·Edge) |
| 목록 화면 할 일 개수(#305) | `app_tasks` 개수 | 연결된 **미완료** 할 일 수. 연결 표의 완료 여부 사본으로 DB만 세어 계산(결정 4, 4.3절) | TASK-구현(DB·Edge·앱) |
| 회의 후속 할 일 | `app_tasks` 생성 | Google 할 일로 만들고 그 회의의 프로젝트에 자동 연결(결정 5) | TASK-구현 |
| 완료 처리 반영 | 저장·재조회 후 약 2초 | 즉시 반영, 실패 시 되돌림 | TASK-구현(앱) |
| 설계와의 차이 | 조사 문서 3.3은 회의도 연결 대상 | 연결 대상은 프로젝트·조직만. 회의 후속은 회의의 프로젝트에 연결(결정 5) | 정리됨 |
| Google에서 지운 할 일의 연결 | 해당 없음 | 프로젝트·조직 화면을 열 때 서버가 확인해 연결을 지움(결정 8) | TASK-구현(Edge) |
| Web2 할 일 코드·표 | 활성 | 제거 | 21·25·29 |

## 2. DB 변경 초안 (실행 금지)

### 2.1 새로 만들 것: 꼬리표 표

```sql
-- 초안. 실행 금지. 2.2의 app_notes를 먼저 만든다.
create table public.app_record_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  -- 출처: Google 할 일 1건 또는 메모 1건
  google_task_id text,
  google_tasklist_id text,
  note_id uuid references public.app_notes(id) on delete cascade,
  -- 대상: 프로젝트 또는 조직 1개
  project_id uuid references public.app_spaces(id) on delete cascade,
  organization_id uuid references public.app_suborganizations(id) on delete cascade,
  -- 25(개인 업무 AI)용: AI 제안/사용자 확정, 사업·조직 보고 구분
  status text not null default 'confirmed' check (status in ('suggested','confirmed')),
  report_kind text check (report_kind in ('business','organization')),
  -- 목록 개수용 Google 완료 여부 사본(결정 4, 4.3절). 할 일 행만 채운다. 화면 표시에는 쓰지 않는다.
  task_completed boolean,
  task_checked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint app_record_links_one_source check (num_nonnulls(google_task_id, note_id) = 1),
  constraint app_record_links_task_list check ((google_task_id is null) = (google_tasklist_id is null)),
  constraint app_record_links_task_state check ((google_task_id is null) = (task_completed is null)),
  constraint app_record_links_one_target check (num_nonnulls(project_id, organization_id) = 1),
  constraint app_record_links_unique unique nulls not distinct (google_task_id, note_id, project_id, organization_id)
);
create index app_record_links_project_idx on public.app_record_links(project_id) where project_id is not null;
create index app_record_links_org_idx on public.app_record_links(organization_id) where organization_id is not null;
create index app_record_links_task_idx on public.app_record_links(google_task_id) where google_task_id is not null;
-- 프로젝트 목록 개수: 미완료 할 일 연결만 센다(4.3절)
create index app_record_links_open_project_idx on public.app_record_links(project_id)
  where google_task_id is not null and task_completed = false and project_id is not null;

alter table public.app_record_links enable row level security;
revoke all on public.app_record_links from anon;
grant select, insert, update, delete on public.app_record_links to authenticated;
create policy record_links_owner_all on public.app_record_links for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (project_id is null or private.app_space_in_workspace(project_id, workspace_id))
    and (organization_id is null or exists (
      select 1 from public.app_suborganizations o where o.id = organization_id and o.workspace_id = app_record_links.workspace_id))
  );
```

- 대상별 FK 칸을 따로 두는 이유(조사 문서 3.3과 같음): 프로젝트·조직이 지워지면 연결도 DB가 함께 지운다.
- Google 할 일 ID는 FK가 될 수 없다. Google에서 지워진 할 일의 연결은 프로젝트·조직 화면을 열 때 서버가 확인해 지운다(결정 8).
- `task_completed`는 Google 완료 여부의 사본이다. 같은 할 일의 연결 행이 여럿이면(결정 2) 모두 같은 값으로 갱신한다. 갱신 시점과 늦어지는 조건은 4.3절.
- 권한은 기존 sole-owner 경계(`private.app_is_workspace_owner`)를 그대로 쓴다. anon 권한과 공개 경로는 없다.
- PostgreSQL 17.6(조회 확인)이라 `unique nulls not distinct`를 쓸 수 있다.

### 2.2 새로 만들 것: 메모 원문 표 (2.1보다 먼저)

```sql
-- 초안. 실행 금지. 조사 문서 4.4와 같다.
create table public.app_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  raw_text text not null check (length(raw_text) between 1 and 20000),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_notes enable row level security;
revoke all on public.app_notes from anon;
grant select, insert, update, delete on public.app_notes to authenticated;
create policy notes_owner_all on public.app_notes for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
```

- TASK-구현에서는 빈 표로만 둔다. 메모 입력·주간 정리는 25다.

### 2.3 바꿀 것 (29 단계, 표 삭제 전 필수)

```sql
-- 초안. 실행 금지. 29에서 app_tasks를 지우기 전에 적용한다.
-- private.app_unlink_retained_project_records(): app_tasks 관련 문장만 빼고 나머지 그대로 다시 정의한다.
-- (현재 본문은 적용 PR에서 pg_get_functiondef로 snapshot을 떠서 저장소에 두고, 그 원문에서 app_tasks 부분만 지운다.)
```

### 2.4 지울 것 (29 단계)

```sql
-- 초안. 실행 금지. 순서: 참조 함수 수정(2.3) → 트리거 → 정책 → 표.
drop trigger if exists trg_app_prepare_task_assignment on public.app_tasks;
drop trigger if exists app_tasks_child_project_guard on public.app_tasks;
drop trigger if exists app_tasks_workspace_consistency on public.app_tasks;  -- 공용 함수는 남긴다
drop policy if exists task12a_owner_all on public.app_tasks;
drop table public.app_tasks;              -- 58행이 함께 사라진다. 되돌릴 수 없다.
drop function if exists public.app_prepare_task_assignment();
drop function if exists public.app_task_child_project_guard();
-- public.app_public_projects_snapshot()은 26에서 정리(같이 지울지 26에서 결정).
```

- 함수 스키마(`public`/`private`)는 적용 PR에서 snapshot으로 다시 확인한다.

## 3. 적용 순서와 단계별 복구 경로

| 단계 | 내용 | 정지 지점 | 복구 |
| --- | --- | --- | --- |
| 0 | 묶음C-4: Edge 미완료 조회에 기한 지남 포함 + 앱 표시 | Edge 배포 | 운영 v9 원본(main `84ba80f`)을 `--use-api --no-verify-jwt`로 재배포, 앱은 PR revert |
| A | `app_notes` → `app_record_links` 생성 | DB migration | `drop table public.app_record_links; drop table public.app_notes;` + `delete from supabase_migrations.schema_migrations where version = '<파일 version>';`. 적용 직후에는 빈 표라 데이터 손실이 없다. 앱에서 연결을 쓰기 시작한 뒤 되돌리면 연결 정보가 사라진다(할 일 자체는 Google에 남음) |
| B | 앱: 할 일 추가·연결·표시·즉시 완료 | 없음(Pages 배포) | PR revert |
| C | Edge `google-tasks`: 기본 목록·연결 저장·단건 확인 | Edge 배포 | 직전 main commit 원본을 `--use-api --no-verify-jwt`로 재배포 |
| D | 21: Web2 할 일 화면·코드 제거 | 없음 | PR revert(표·데이터는 그대로 있음) |
| E | 25: `team-ai`의 `app_tasks` 조회 제거 | Edge 배포 | 직전 원본 재배포 |
| F | 29: 참조 함수 수정 → `app_tasks` 삭제(58건) | DB migration | **58건은 되돌릴 수 없다(백업 없이 삭제, 사용자 결정).** 구조는 rollback SQL로 되살릴 수 있지만 행은 비어 있다. 함수 수정은 snapshot 원문으로 되돌린다 |

- 모든 DB 적용은 AGENTS.md 7절을 따른다. 로컬 read-only 사전 확인 → 사용자가 SQL Editor에서 실행(`commit;` 직전에 `schema_migrations` 1행) → 로컬 read-only 사후 검증.
- `supabase db push`·`migration repair`는 쓰지 않는다.

## 4. 앱·Edge 변경 범위

### 4.1 앱 (`app/google-tasks.js` 중심, 캐시 버전 `google-tasks.js` → `view-loader.js` → `loader-v2.js` → `app.js`·`index.html`)

1. **즉시 완료 반영**(확정 사항 8)
   - 누르면 `lastTasks`의 해당 항목 상태를 바로 바꿔 다시 그린다.
   - 저장 요청은 뒤에서 보낸다. 성공하면 응답의 할 일 1건으로 교체한다. 전체 재조회는 하지 않는다.
   - 실패하면 원래 상태로 되돌리고 칸 위에 실패 안내를 띄운다(`role="status"`).
   - 같은 항목을 연달아 누르면 마지막 상태만 저장하고, 진행 중 요청은 순서를 지킨다.
   - 저장 중 조회 결과가 도착하면, 그 조회가 옛 상태를 덮어쓰지 않게 대기 중인 변경을 우선한다(1.2 부수 위험).
   - 직전 결과 캐시(C-2)도 같은 상태로 갱신한다.
2. 목록: 편집창의 목록 선택칸을 없애고 "내 할 일"로 고정한다.
3. 연결 선택: 편집창에 프로젝트·조직 선택을 둔다. 고르지 않아도 저장된다(결정 1). 여러 개를 고를 수 있다(결정 2). 프로젝트·조직 화면에서도 연결을 추가·삭제한다(결정 6).
4. 연결 안 된 할 일 모음: 할 일 화면 아래 접힌 칸(`<details>`). 기한과 무관하게 미완료 전부(기한 없음 포함)를 보여 주고 거기서 바로 연결한다(결정 7). 칸을 펼칠 때 불러와 할 일 화면 첫 표시를 늦추지 않는다.
5. 프로젝트 상세·조직 상세: 연결된 미완료 할 일 전부(기한 없음·지남 포함) + 최근 3일 완료를 표시한다(결정 3). 프로젝트 상세의 `app_tasks` 목록·추가는 Google 할 일로 바꾼다. 여기서 만든 할 일은 그 프로젝트·조직에 자동 연결한다.
6. 프로젝트 목록 할 일 개수(#305): 연결된 미완료 할 일 수. DB만 세어 계산한다(결정 4, 4.3절).
7. 회의 후속 할 일: Google 할 일로 만들고 그 회의의 프로젝트에 자동 연결한다(결정 5). 회의에 프로젝트가 없으면 연결 없이 만들어 연결 안 된 할 일 모음에 나오게 한다.
8. 테스트:
   - E2E: 즉시 반영, 실패 되돌림, 연달아 누르기, 조회 중 누르기.
   - 연결 추가·삭제(여러 개), 연결 없이 저장, 기본 목록, 프로젝트·조직 화면 표시, 연결 안 된 모음, 목록 개수(미완료만).
   - 기존 `google-tasks-push`·`google-tasks-cache` 회귀.

### 4.2 Edge (`google-tasks`, verify_jwt=false 유지)

0. 읽기(`overview`·`tasks`)를 "내 할 일"(`@default`) 하나로 줄인다. 지금 목록이 1개라 결과는 같고, 목록 조회 1회가 빠진다. 기한 지난 미완료 포함(확정 사항 5)은 이 PR 전에 묶음C-4에서 한다.
1. `create`: 목록을 `@default`로 고정한다. 요청에 연결 대상이 있으면(0개 이상, 결정 1·2) 할 일 생성 뒤 `app_record_links`에 저장한다(`task_completed=false`). 서버가 소유자 확인과 대상 소속을 검사한다(클라이언트가 보낸 ID를 그대로 믿지 않음).
2. 연결 조회·추가·삭제 동작(예: `links`, `link`, `unlink`). DB 접근은 사용자 JWT로 해서 RLS가 적용되게 한다. service role로 우회하지 않는다. `link`는 Google에서 그 할 일을 한 번 읽어 `task_completed`를 채운다.
3. 연결된 할 일 조회(프로젝트·조직 화면, 결정 3·8): 대상의 연결 행을 읽고 할 일을 ID로 개별 조회한다(동시 처리 제한 유지). Google이 없는 할 일(404)이라고 답하면 그 연결 행을 지운다. 읽은 완료 여부로 `task_completed`를 맞춘다.
4. 연결 안 된 할 일(결정 7): "내 할 일" 미완료 전부(기한 조건 없이)를 읽고 연결 행이 있는 ID를 빼서 돌려준다. 할 일 화면 첫 조회(`overview`)와 나누어 모음을 펼칠 때만 부른다.
5. `toggle`·`update`는 이미 할 일 1건을 돌려준다. 앱이 그대로 쓴다. Google 저장이 성공하면 같은 요청에서 그 할 일의 연결 행 `task_completed`를 함께 갱신한다(4.3절).
6. 테스트: `tests/security/google-tasks-edge-list.test.mjs` 방식의 가짜 Google·Supabase로 기본 목록, 연결 저장 권한, 여러 연결, 404 연결 정리, 완료 여부 사본 갱신, 비로그인 거부를 고정한다.

### 4.3 프로젝트 목록 할 일 개수: 미완료만, 빠르게 (결정 4)

목록 화면을 열 때 Google을 부르지 않는다. 연결 표의 완료 여부 사본(`task_completed`)으로 DB에서만 센다.

```sql
-- 초안. 실행 금지. 앱이 사용자 JWT로 읽는다(RLS 적용). 새 RPC 없이 PostgREST 조회로 충분하다.
select project_id, count(*) from public.app_record_links
 where google_task_id is not null and task_completed = false and project_id is not null
 group by project_id;
```

- 앱은 지금 #305의 할 일 개수 자리에서 `app_tasks` 대신 이 값을 쓴다. 조회 1회이고 2.1의 부분 색인을 탄다.

**사본을 갱신하는 때**(모두 Edge가 사용자 JWT로 갱신, 같은 할 일의 연결 행 전부)

| 때 | 갱신 내용 |
| --- | --- |
| Web2에서 할 일 만들기(연결 포함) | `false`로 저장 |
| Web2에서 연결 추가 | 그 할 일을 Google에서 읽어 저장 |
| Web2에서 완료·완료 취소·수정 | Google 저장 성공 후 응답의 완료 여부로 갱신. 실패하면 갱신하지 않음 |
| 할 일 화면 조회(`overview`) | 받은 할 일 중 연결된 것의 완료 여부를 맞춤(기한 지남·오늘~6일 미완료, 최근 3일 완료) |
| 프로젝트·조직 화면 열기 | 연결된 할 일을 ID로 모두 읽으므로 그 대상의 연결 전부를 맞춤. 없어진 할 일은 연결을 지움(결정 8) |

**Google 앱에서 직접 바꿨을 때 개수 반영이 늦어지는 조건**

Web2는 Google의 변경 알림을 받지 않는다. 사본은 위 표의 때에만 맞춰진다. 그래서 아래 경우 목록 개수가 실제와 다를 수 있다.

1. Google 앱에서 완료한 뒤, Web2 할 일 화면도 그 프로젝트 화면도 열지 않고 프로젝트 목록만 본 경우: 완료한 할 일이 여전히 개수에 들어간다.
2. Google 앱에서 완료한 지 3일이 지나도록 할 일 화면을 열지 않은 경우: 할 일 화면 조회는 최근 3일 완료만 읽으므로 더는 맞춰지지 않는다. 그 프로젝트·조직 화면을 열어야 맞춰진다.
3. Google 앱에서 완료를 취소했는데 그 할 일이 기한 없음이거나 7일 뒤 기한인 경우: 할 일 화면 조회에 나오지 않는다. 그 프로젝트·조직 화면을 열어야 개수에 다시 들어간다.
4. Google 앱에서 할 일을 지운 경우: 그 프로젝트·조직 화면을 열 때까지 개수에 남는다(결정 8).
5. Google 앱에서 할 일을 "내 할 일" 밖의 목록으로 옮긴 경우: Web2는 지운 것으로 본다(ID가 바뀔 수 있음, 8절). 4와 같다.

- 반영 시점: 1은 할 일 화면이나 해당 프로젝트 화면을 한 번 열면, 2~5는 해당 프로젝트·조직 화면을 한 번 열면 맞춰진다.
- 목록 화면이 느려지지 않도록, 목록을 열 때 사본을 Google과 맞추는 조회는 하지 않는다. 필요하면 이후 "목록 화면을 연 뒤 뒤에서 오래된 사본(`task_checked_at` 기준)만 확인" 방식을 따로 제안한다(이번 범위 아님).
- 이 사본은 확정 사항 1(Web2는 완료 여부를 저장하지 않음)의 예외다. 목록 개수에만 쓰고, 할 일 화면·프로젝트 화면 표시는 항상 Google 응답을 쓴다.

## 5. PR 나누기 제안

| 순서 | PR | 범위 | DB·배포 |
| --- | --- | --- | --- |
| 0 | 묶음C-4: 할 일 화면에 기한 지난 미완료 표시 | Edge `google-tasks` 미완료 조회에서 아래 경계(`dueMin`)를 없애고 오늘+6일까지(한국 날짜)만 남김. 기한 없음은 계속 뺌. 앱은 기한 지난 미완료를 맨 위 별도 묶음으로 표시(`google-tasks.js`, 캐시 버전 연쇄) | **Edge 정지 지점**(verify_jwt=false 유지) + Pages |
| 1 | TASK-구현 1: 즉시 완료 반영 | 앱만(4.1의 1). DB·Edge 변경 없음 | Pages만 |
| 2 | TASK-구현 2: 메모·꼬리표 표 | `app_notes`·`app_record_links`(완료 여부 사본 칸 포함) migration·rollback·snapshot 파일, 권한 테스트(`supabase/tests`) | **DB 정지 지점(A)** |
| 3 | TASK-구현 3: Edge "내 할 일" 하나·연결·완료 여부 사본 | 4.2 | **Edge 정지 지점(C)**. PR 2 적용 뒤 |
| 4 | TASK-구현 4: 앱 연결·표시·연결 안 된 모음·개수 | 4.1의 2~7, 4.3 | Pages. PR 3 배포 뒤 |
| 5 | 21 | Web2 할 일 화면·코드 제거, 관련 E2E 정리 | Pages |
| 6 | 25 일부 또는 별도 | `team-ai`의 `app_tasks` 조회 제거 | Edge 정지 지점(E) |
| 7 | 29 | 2.3 → 2.4 | **DB 정지 지점(F)**, 58건 삭제 |

- 일정 인증-1은 PR 3과 같은 Edge 파일을 고친다. 7절 참고.

## 6. 사용자 결정 (2026-09-27)

처음 미결정 목록 8개(PR #331 댓글)에 대한 사용자 결정이다. 9는 결정과 함께 사용자가 표시 범위 전제를 정정한 항목이다.

| 번호 | 질문 | 결정 |
| --- | --- | --- |
| 1 | 할 일을 만들 때 프로젝트·조직 연결을 꼭 골라야 하나 | (가) 고르지 않아도 됨, 나중에 연결 가능 |
| 2 | 할 일 하나를 여러 프로젝트·조직에 연결할 수 있나 | (가) 여러 개 가능 |
| 3 | 프로젝트·조직 화면에서 연결된 할 일을 어떻게 보여 주나 | (가) 연결된 미완료 전부(기한 없음·지남 포함) + 최근 3일 완료 |
| 4 | 프로젝트 목록 화면의 할 일 개수 | (가)를 수정: 연결된 할 일 중 **미완료만** 센다(완료 제외). 목록 화면이 느려지지 않도록 연결 표의 완료 여부 사본으로 DB에서만 센다. 방식과 늦어지는 조건은 4.3절 |
| 5 | 회의 결과의 "후속 할 일" | (가) Google 할 일로 만들고 그 회의의 프로젝트에 자동 연결 |
| 6 | 연결은 어디서 지정하나 | (가) 할 일 편집창과 프로젝트·조직 화면 양쪽 |
| 7 | 연결 안 된 할 일 모음의 위치·범위 | (가) 할 일 화면 아래 접힌 칸, 기한과 무관하게 미완료 전부 |
| 8 | Google에서 지운 할 일의 연결 정리 | (가) 프로젝트·조직 화면을 열 때 서버가 확인해 연결을 지움 |
| 9 | 할 일 화면의 기한 지남·기한 없음 표시 | (나) 표시함. 전제 정정: 원장의 "기한 지남·기한 없음 표시 안 함"은 잘못 기록된 것. 할 일 화면은 기한 지난 미완료(맨 위 별도 묶음, 최우선) + 오늘~6일 기한. 기한 없음은 7일 목록에서 빼고 연결 안 된 할 일 모음·프로젝트/조직 화면에서 표시. 홈은 오늘·밀린 할 일 표시(확정 사항 5). 기한 지남 표시는 묶음C-4 |

- 결정 4의 완료 여부 사본은 확정 사항 1(Web2는 완료 여부를 저장하지 않음)의 예외다. 목록 개수에만 쓴다.

## 7. 21·일정 인증-1과의 겹침

- **21(Web2 할 일 코드 제거)**: 겹친다. 프로젝트 상세·회의 후속은 TASK-구현이 Google 할 일로 바꾸고, 할 일 탭 Web2 목록(`task-layout.js`)·`team.js`·비활성 파일은 21이 지운다. 같은 파일(`project-system-v3.js`, `meeting-round-detail.js`)을 두 PR이 고치므로 TASK-구현 PR 4 → 21 순서로 한다. 동시에 진행하지 않는다.
- **일정 인증-1(400→401)**: `google-tasks` Edge 파일이 겹친다. 앱은 오류 문구로 판단하고 상태 코드는 보지 않는다(`google-tasks.js`는 `TASKS_SCOPE_REQUIRED|권한` 문구 검사). 401로 바꿔도 앱 영향은 작을 것으로 추정한다. 권장: TASK-구현 PR 3 배포가 끝난 뒤 따로 PR을 내고, `google-calendar`와 함께 배포한다. 같은 PR에 섞지 않는다(되돌리기 단위를 나누기 위해).

## 8. 남은 위험

- `private.app_unlink_retained_project_records()`를 고치지 않고 `app_tasks`를 지우면 프로젝트 삭제가 멈춘다. 29 적용 SQL에 반드시 포함한다(2.3).
- Web2는 "내 할 일" 목록만 읽는다. 운영 로그(overview, 2026-09-27)상 지금 Google 할 일 목록은 1개뿐이라 당장 보이는 할 일은 달라지지 않는다. 이후 폰 Google Tasks 앱에서 다른 목록을 만들어 쓰면 그 할 일은 Web2에 보이지 않고, 목록을 옮기면 ID가 바뀌어 연결이 끊길 수 있다(추정). 적용 PR에서 화면 안내 문구로 알린다.
- 프로젝트 목록의 미완료 개수는 연결 표의 완료 여부 사본으로 센다. Google 앱에서 직접 완료·완료 취소·삭제하면 할 일 화면이나 그 프로젝트·조직 화면을 열 때까지 개수가 늦게 맞춰진다(4.3절 조건 1~5).
- 묶음C-4 뒤 할 일 화면은 기한 지난 미완료를 모두 읽는다. 오래 밀린 할 일이 많으면 조회량이 늘 수 있다. C-4에서 운영 로그의 소요 시간을 배포 전후로 확인한다.
- 즉시 반영 방식에서 네트워크가 끊긴 채 여러 번 누르면 화면과 Google 상태가 잠시 다를 수 있다. 실패 되돌림과 다음 조회로 맞춘다.
- `app_project_progress_updates` 정책은 `roles=public`에 공간 권한 함수를 쓴다(조회만 함). 이 작업 범위가 아니다.
