# 챙길 것(todo) 표에 운영자 허용 표 가드 넓히기 — 조사·제안 (EDGE-서버함수정리 C3)

작성: S47-51(Claude Code 웹), 근거 main `a7cea101`. **DB 변경 없음 — 이 문서는 제안이고, 적용은 아래 결정 뒤 따로 migration PR(짝 파일 5개)로 한다.**

## 1. 한 줄 요약

챙길 것 표는 6개다. 이 중 운영자 기능(텔레그램·통화)에 속한 것은 **`app_todo_ask_rooms`(텔레그램 방)과 `app_todo_candidates`의 텔레그램 출처 줄**뿐이고, 나머지 4개는 설계 D3("원장·챙길 것은 각자 자기 것으로 씀")에 따라 모든 사용자가 쓰는 표다. 그래서 "todo 계열 4표 전체에 가드"를 그대로 걸면 다른 사용자의 챙길 것이 막힌다. 어느 표에 걸지 명진(또는 CC) 결정이 필요하다.

## 2. 지금 상태(사실, migration 원문 기준)

| 표 | 만든 곳 | 쓰는 쪽 | 지금 보호 | 운영자 기능과의 관계 |
| --- | --- | --- | --- | --- |
| `app_todo_candidates` | 20261021075034, 20261029120000(텔레그램 출처 추가), 20261101180000(done 상태) | 화면(소유자, 정한 칸만), ai-assist(소유자 토큰), collector-feed(service_role → DEFINER 함수 `app_todo_candidate_from_telegram`만) | 소유자 정책 1개. service_role 표 권한 없음 | `source_kind='telegram'` 줄만 텔레그램 기능 |
| `app_todo_radar_state` | 20261021075034 | ai-assist(소유자 토큰) | 소유자 정책 | 없음(작업공간당 1행) |
| `app_todo_ask_rooms` | 20261029210000 | 화면(소유자: 넣기·지우기), ai-assist(읽기), collector-feed(DEFINER `app_todo_ask_filter`로 읽기만) | 소유자 정책 | **텔레그램 방 열쇠만 담음** |
| `app_todo_not_mine` | 20261029210000 | 화면(소유자), ai-assist(읽기), `app_todo_ask_filter` | 소유자 정책 | 없음(출처 종류 + 요약, 모든 출처) |
| `app_todo_feedback` | 20261101180000 | 화면(소유자) | 소유자 정책 | 없음 |
| `app_todo_rules` | 20261101180000 | 화면(소유자), ai-assist | 소유자 정책 | 없음 |

이미 막혀 있는 길(사실):
- 텔레그램 후보는 `app_todo_candidate_from_telegram`이 **그 작업공간의 텔레그램 소식 줄이 있어야** 넣는다. 소식 표(`app_feed_items`)는 20261029090000의 트리거 `trg_op_feature_guard`로 허용 없는 작업공간에는 줄이 생길 수 없다 → 허용 없는 작업공간에는 텔레그램 후보도 생기지 않는다.
- collector-feed는 `app_operator_feature_workspace('telegram')`가 돌려주는 운영자 작업공간 하나에만 쓴다.

남은 틈(위험 낮음):
- 허용 없는 사용자가 화면 API로 자기 작업공간 `app_todo_ask_rooms`에 방 열쇠를 넣을 수는 있다(자기 표, 다른 사람에 영향 없음, 수집기는 운영자 작업공간만 읽음).
- 허용 없는 사용자가 화면 API로 자기 후보에 `source_kind='telegram'`을 넣을 수 있는지: 화면 insert 권한 칸에 `source_kind`가 있고 검사식이 'telegram'을 허용하므로 **넣을 수 있다**(자기 작업공간 안 가짜 후보일 뿐, 다른 사람 자료 노출 없음).

## 3. 제안(권한을 넓히지 않고 좁히기만)

### 안 A(추천) — 텔레그램에 속한 2곳만
1. `app_todo_ask_rooms`: restrictive 읽기 정책 `op_feature_read`(authenticated) `using (private.app_workspace_has_feature(workspace_id, 'telegram'))` + BEFORE INSERT OR UPDATE 트리거(기존 `private.app_operator_feature_guard()` 재사용, 기능 'telegram').
2. `app_todo_candidates`: `source_kind='telegram'` 줄에만 같은 판정. restrictive 정책 `using (source_kind <> 'telegram' or private.app_workspace_has_feature(workspace_id, 'telegram'))`, 트리거도 같은 조건.
   - DEFINER 함수 `app_todo_candidate_from_telegram`(service_role)은 RLS를 거치지 않으므로 트리거가 길목이다. 기존 `private.app_operator_feature_guard()`는 `auth.uid()`를 보지 않고 **허용 행 존재만** 본다(20261029090000 원문 확인) → service_role 수집기에서도 그대로 쓸 수 있다.
   - 이 함수의 `by_source` 모드는 `source` 칸을 보는데 후보 표 칸 이름은 `source_kind`다 → 함수 본문을 고치지 않고 `create trigger … before insert or update on public.app_todo_candidates for each row when (new.source_kind = 'telegram') execute function private.app_operator_feature_guard('telegram')`로 건다.
- 나머지 4표(`radar_state`·`not_mine`·`feedback`·`rules`)는 D3대로 모든 사용자 것 → 가드 없음.

### 안 B — 지시서 문구 그대로 4표 전체
- 어느 4표인지 원문에 없음. 예: `candidates`·`ask_rooms`·`not_mine`·`radar_state`. 표 전체에 'telegram' 가드를 걸면 **허용 없는 사용자의 챙길 것(노트·업데이트·회의 출처)이 통째로 막힌다** → D3·단계 ② 가입 열기와 충돌. 추천하지 않음.

## 4. 적용할 때(결정 뒤 migration PR에서)
- 짝 파일 5개(`.precheck/.snapshot/.postcheck/.rollback.sql`, `.summary.md`), `commit;` 직전 `schema_migrations` 1행.
- 정책 추가·트리거 추가라 승인형 DB workflow 확장 규칙(권한을 좁히는 restrictive 정책·트리거) 대상인지 `docs/ops-db-workflow.md`로 확인. 아니면 SQL Editor(폰 경로 C).
- 사전 확인: 운영자 작업공간 밖에 `source_kind='telegram'` 후보 줄·`app_todo_ask_rooms` 줄이 0인지(있으면 트리거가 그 줄의 수정까지 막으므로 멈추고 보고).
- 일상어 3줄(초안): 무엇이 바뀌나 — 텔레그램 방 설정과 텔레그램에서 온 챙길 것은 운영자 작업공간에서만 저장된다 / 잘못되면 — 명진의 텔레그램 챙길 것 저장이 막힌다(허용 행이 있으므로 정상이면 영향 없음) / 되돌리는 방법 — 정책 1~2개·트리거 2개를 지우는 rollback SQL.
- Edge 쪽 변경 없음(collector-feed·ai-assist는 이미 운영자 작업공간·소유자 토큰으로만 접근).

## 5. 결정 필요
- 안 A / 안 B 중 무엇으로 할지(추천 A). 안 B라면 4표가 어느 것인지.
