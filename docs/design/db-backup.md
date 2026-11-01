# 정기 DB 백업 설계 (OPS-DB백업)

📱 **폰 가능(설계만).** 이 문서는 설계다. workflow·스크립트·비밀값·DB는 바꾸지 않았다. 구현은 명진 결정(8절) 뒤 6절 순서로 한다.

- 작성: 2026-11-01, 작업 세션 S47-55(Claude Code 웹). 기준 `origin/main` `2787ca5`(#1699). 점검 근거는 원장 OPS-DB백업 행(main `156a4f5` 실사용 전수점검).
- production은 조회하지 않았다(웹 세션 규칙). "사실"은 저장소 파일, "공식 문서"는 Supabase 공개 문서(9절 링크, 2026-11-01 확인), "추정"·"확인 필요"는 그 밖이다.
- 관련: `AGENTS.md` 1절(운영 토큰 A안)·7절(DB, `supabase db push`·`migration repair` 영구 금지), [ops-db-workflow.md](../ops-db-workflow.md), [migration-history.md](../migration-history.md).

## 0. 명진용 요약

- **지금.** 운영 DB를 정기적으로 따로 떠 두는 장치가 없다. 10/24 프로젝트 실수 삭제 때 원장에 "PITR 없음"이 적혔다. Supabase 무료 요금제라면 Supabase 쪽 자동 백업도 없다(공식 문서: 일일 백업은 Pro 이상).
- **추천.** 매일 새벽 GitHub Actions가 DB 전체(웹2 + 읽생기)를 떠서 **잠근 뒤(암호화)** 명진만 보는 **비공개 GitHub 저장소**에 올린다. 30일치 + 매달 1일치 12개를 남긴다. 매달 한 번은 그 파일을 임시 DB에 되살려 표마다 줄 수가 맞는지 자동으로 본다. 운영 DB는 읽기만 한다.
- **비용.** 0원(추정). 공개 저장소의 Actions는 무료, 비공개 저장소 저장 공간도 무료 범위.
- **명진 손.** 처음 한 번만: ① Supabase 화면에서 요금제·백업 상태 보고 알려 주기(1절) ② 비공개 저장소 하나 만들기 ③ 비밀값 2~3개 붙여 넣기 ④ 잠금 해제 열쇠를 종이·비밀번호 관리 앱에 보관. 그 뒤는 CC가 한다.
- **대안.** Supabase를 유료(Pro, 월 25달러)로 올리면 7일치 일일 백업이 생기고, 여기에 시점 복구(PITR)를 더하면 월 약 100달러가 더 든다(7절). 다만 유료 백업은 Supabase 안에만 있어 계정·프로젝트 사고에는 같이 잃는다. 그래서 유료로 가도 매일 덤프는 두는 것을 추천한다.

## 1. 명진이 확인할 것 (Supabase 화면, 한 단계씩)

로그인·2단계 인증이 필요해 명진만 할 수 있다. 보고는 "요금제 이름, 백업 줄이 있는지, Point in Time 켜짐/꺼짐" 세 가지만 글로 알려 주면 된다(화면 캡처에 프로젝트 주소가 보여도 괜찮지만 비밀값 화면은 찍지 않는다).

1. 폰 크롬(또는 PC)에서 `supabase.com`에 들어가 오른쪽 위 **Sign in** → 평소 계정으로 로그인.
2. 프로젝트 목록에서 웹2가 쓰는 프로젝트(이름 `kptu-shared-checklists`)를 누른다.
3. **요금제**: 왼쪽 아래 톱니바퀴 **Project Settings** → 위쪽 또는 왼쪽 목록의 **Billing**(또는 조직 이름 → **Billing**)에서 `Free`인지 `Pro`인지 본다.
4. **백업**: 왼쪽 세로 메뉴 **Database**(원통 모양) → 안쪽 목록 **Backups**.
   - `Scheduled backups`(일일 백업) 칸에 날짜 줄이 있으면 → 일일 백업 있음. 무료면 "Pro로 올리라"는 안내만 보인다.
   - 같은 화면의 **Point in Time** 탭(또는 칸)에서 켜짐(Enabled)인지 본다. 꺼져 있으면 "Enable"·"Upgrade" 버튼이 보인다.
5. **DB 크기**(선택): 같은 **Database** 메뉴의 **Settings** 또는 홈 화면 **Usage**의 `Database size` 숫자(예: 120 MB).

> 메뉴 이름은 Supabase가 가끔 바꾼다. 못 찾으면 "Backups 화면을 못 찾음"이라고만 알려 주면 CC가 다른 길을 찾는다.

## 2. 지금 상태 (사실)

| 항목 | 내용 |
| --- | --- |
| 정기 백업 workflow | 0건. `.github/workflows/` 43개 중 DB 덤프·예약 백업 없음 |
| 적용 때 백업 | `db-migration-apply.yml`은 적용 직전 **바꾸는 표만** DB 안 백업 표로 복사(같은 DB 안이라 DB 전체 사고에는 무력). snapshot artifact는 카탈로그만 담는다(공개 저장소라 행 값 금지) |
| 운영 열쇠 | `production-edge` environment의 비밀값 `SUPABASE_ACCESS_TOKEN`(관리 API 토큰)과 변수 `SUPABASE_PROJECT_REF`만 있다. DB 비밀번호·접속 주소 비밀값은 없다 |
| DB | PostgreSQL 17(저장소 설계 문서 기준). 읽생기(`rtw_*`)와 Auth를 같은 DB에서 공유 |
| PITR | 원장 TRASH-삭제휴지통 행 "PITR 없음"(10/24). 요금제·일일 백업은 미확인(1절) |
| Storage 파일 | 비공개 버킷 `share-page-media`(공유 사진) 등의 **파일 자체는 DB 덤프에 들어가지 않는다**(DB에는 경로 기록만). 10절 범위 밖 발견 |

## 3. 매일 덤프 안

### 3-1. 무엇을 뜨나 — DB 전체(읽생기 포함) 추천

- **웹2와 읽생기는 같은 DB·같은 로그인(`auth.users`)을 쓴다.** 웹2 표만 뜨면 되살릴 때 `auth.users`·공용 함수와 짝이 맞지 않고, 읽생기만 잃는 사고도 막지 못한다. 그래서 **DB 하나를 통째로** 뜨는 것이 맞다.
- 대상 스키마: `public`(웹2·읽생기 표 모두), `private`(웹2 서버 함수·허용 표), `auth`(로그인 계정 — 행 포함), `storage`(버킷·파일 기록 행만, 파일 본문 아님), `supabase_migrations`(적용 기록). Supabase가 관리하는 나머지 스키마(`extensions`·`realtime`·`vault` 등)는 구조만 또는 제외(구현 PR에서 목록 고정).
- 읽생기 표를 **읽기만** 하므로 "rtw_ 표를 바꾸지 않는다"(AGENTS 5절)와 충돌하지 않는다. 다만 읽생기 사용자 자료가 명진의 백업 저장소에 들어가므로 명진 결정 질문 Q3로 둔다.
- 형식: `pg_dump --format=custom`(한 파일, 압축, 표 하나만 골라 되살리기 가능). 운영 DB 판(17)과 같은 판의 `pg_dump`를 Actions에서 설치해 쓴다. `supabase link`·`supabase db dump --linked`는 쓰지 않는다(`ops-db-workflow.md`가 `supabase link` 금지).

### 3-2. DB에 접속하는 열쇠 — 두 길

`pg_dump`는 관리 API가 아니라 DB 접속이 필요하다. 지금 비밀값에는 DB 비밀번호가 없다.

| 길 | 새 비밀값 | 명진 손 | 장단점 |
| --- | --- | --- | --- |
| **K1. 토큰으로 임시 DB 접속(추천, 쓸 수 있으면)** | 0개 | Supabase 화면에서 기능 켜기 1번(설정 위치는 구현 PR에서 안내) | 공식 changelog "Temporary token-based database access": 관리 토큰(PAT)으로 비밀번호 없이 접속, PG17 이상, 프로젝트별로 켬, 접속 역할·기간을 고름. 이미 있는 토큰 그대로라 새 비밀값이 없다. 단 **기능 미리보기 단계**라 바뀔 수 있다(확인 필요) |
| K2. 백업 전용 읽기 역할 + 접속 주소 비밀값 | 1개(`SUPABASE_BACKUP_DB_URL`) | 역할 만들기 SQL을 SQL Editor에서 1번 실행 + 비밀값 붙여 넣기 | 표준 방식이라 안정적. 다만 역할 만들기(`create role`)는 승인형 workflow의 확장 규칙이 거절하는 명령이라 SQL Editor 경로(폰 경로 C)로만 가능. RLS를 넘어 전부 읽는 역할이 되므로(`BYPASSRLS`, 쓰기 권한 없음) 비밀번호가 새면 전체 읽기 노출 |

- 관리 API의 SQL 실행 주소로 표마다 행을 뽑아 직접 덤프를 만드는 길(K3)은 새 비밀값이 없지만, 되살리기 표준 도구(`pg_restore`)를 못 쓰고 손으로 짠 덤프라 빠뜨림 위험이 커서 **쓰지 않는다**.
- 어느 길이든 `SUPABASE_ACCESS_TOKEN`은 이미 운영 DB 전체에 SQL을 실행할 수 있는 열쇠이므로, K1은 권한을 넓히지 않는다. K2는 "읽기 전용"이지만 열쇠가 하나 늘어난다.

### 3-3. 공개 저장소라서 지키는 것 (필수)

Actions 로그·산출물(artifact)은 공개로 본다. 그래서 구현은 아래를 **시험으로 고정**한다(`tests/security/` 정적 검사 추가).

1. `actions/upload-artifact`·`cache`·`gh release`(공개 저장소)로 덤프를 올리지 않는다. 덤프는 runner 임시 폴더에만 두고 잠근 뒤 바로 비공개 저장소로 보내고 지운다.
2. 덤프 파일을 화면에 찍지 않는다(`cat`·`head`·`pg_restore -l` 출력 금지, `set -x` 금지). `pg_dump`·업로드 명령의 오류 출력은 파일로 받고 로그에는 **고정 문구 + 종료 코드만** 쓴다(오류 원문에 표 이름·값이 섞일 수 있음).
3. 토큰·프로젝트 값·접속 주소는 `::add-mask::`로 가린다. 명령 인자에 비밀값을 넣지 않는다(환경 변수·`PGPASSFILE`).
4. job summary에는 **날짜, 잠근 파일 크기(MB 단위 반올림), 잠근 파일 SHA-256 앞 16자, 표 개수, 전체 줄 수 합계, 성공/실패**만 쓴다.
5. 실행 조건: `schedule`·`workflow_dispatch`만, main에서만(`github.ref == 'refs/heads/main'`), PR·fork에서는 돌지 않는다. 동시 실행 1개, 시간 제한 20분.
6. **잠금(암호화)**: `age`(공개 열쇠 방식)로 잠근다. 잠그는 공개 열쇠는 비밀이 아니라 변수(`DB_BACKUP_AGE_RECIPIENT`)로 둔다. 푸는 비밀 열쇠는 명진이 보관(종이·비밀번호 관리 앱)하고, 월 복구 시험용으로 따로 둔 environment에만 한 벌 넣는다(4절). 저장 장소가 새도 내용은 안 보인다.

### 3-4. 저장 위치 후보

용량 추정: DB 크기는 미확인(1절 5번). 무료 요금제 상한이 500 MB이므로 그 이하다. 압축 덤프는 보통 원래 크기의 10~30%(추정)라 **한 개 5~150 MB**. 보관 42개(매일 30 + 매달 12)면 **0.2~6 GB**(상한 추정). DB 크기를 알면 구현 PR에서 다시 계산한다.

| 후보 | 새 비밀값 | 명진 손(처음 한 번) | 비용 | 보존 | 단점 |
| --- | --- | --- | --- | --- | --- |
| **S1. 비공개 GitHub 저장소의 Release 파일(추천)** | 1개: 그 저장소만 쓰기 가능한 fine-grained 토큰(`DB_BACKUP_REPO_TOKEN`) | 비공개 저장소 만들기 + 토큰 만들기·붙여 넣기(화면 안내는 구현 PR) | 0원(Release 파일 하나 2 GB까지, 저장 공간 과금 없음 — 확인 필요) | 오래된 Release를 workflow가 지움(30일 + 매달 1일 12개) | 같은 GitHub 계정에 몰림(계정 잠김 시 같이 막힘). 토큰 만료일(최대 1년 권장) 갱신 필요 → 만료 30일 전 실패 알림 |
| S2. Cloudflare R2 비공개 버킷 | 2개: R2 접근 키 ID·비밀 키 | R2 켜기(**결제 수단 등록 필요**) + 버킷·키 만들기 + 수명 규칙 | 10 GB까지 무료(공식 요금 기준, 확인 필요) | 버킷 수명 규칙으로 자동 삭제 | 카드 등록, 기존 `CLOUDFLARE_API_TOKEN`은 권한 범위가 달라 재사용 안 함 |
| S3. Google Drive 비공개 폴더 | 1~3개: OAuth 클라이언트·갱신 토큰 | 동의 화면 거쳐 토큰 받기 | 0원(15 GB 공용) | workflow가 오래된 파일 지움 | 웹2 Google 앱이 아직 게시·검증 전(AGENTS 5절 D4)이라 **시험 모드 갱신 토큰은 7일 뒤 만료**(Google 일반 규칙) → 매주 끊김. 서비스 계정은 개인 Drive 저장 공간이 없음. 앱 검증 뒤 재검토 |
| ✕ Actions artifact | — | — | — | — | 공개 저장소라 금지(지시서) |
| ✕ Supabase Storage(같은 프로젝트) | — | — | — | — | 같은 프로젝트 사고에 같이 잃음 |
| ✕ 공개 저장소 커밋 | — | — | — | — | 잠가도 영구 공개 기록이 남음 |

### 3-5. 시각·알림

- 매일 KST 04:17(UTC 19:17, 정각 피함). 실패하면 workflow가 실패로 끝나 GitHub 알림이 가고, CC 점검 예약이 다음 점검 때 본다.
- 연속 2일 실패 또는 토큰 만료 30일 전이면 CC가 명진에게 한 줄 알린다(구현 PR에서 판정만 summary에 남김).

## 4. 월 1회 복구 시험

운영 DB는 건드리지 않는다. 되살리는 곳은 **GitHub runner 안의 일회용 PostgreSQL**이다(작업이 끝나면 기계째 사라짐).

1. 매달 2일 KST 05:17, 별도 workflow `db-restore-test.yml`(environment `db-restore`, main 전용, 비밀값 = 비밀 열쇠 + 백업 저장소 읽기 토큰).
2. 비공개 저장소에서 **가장 최근 덤프**를 받아 비밀 열쇠로 푼다(잠금·업로드까지 실제로 되는지 확인하는 것이 목적).
3. Supabase와 같은 판의 Postgres 이미지(`supabase/postgres` 17.x — Supabase 기본 역할·확장이 들어 있어 `auth`·RLS 정책이 그대로 되살아남)를 service container로 띄우고 `pg_restore`.
4. 대조: 덤프할 때 같은 시점(내보낸 snapshot을 `pg_dump --snapshot`에 넘김)으로 센 **표마다 줄 수 목록**을 잠근 파일 안에 함께 넣어 두고, 되살린 DB에서 센 값과 비교한다. 추가로 RLS 켜짐 표 수·정책 수·함수 수를 비교한다.
5. summary에는 "표 N개 중 N개 일치 / 불일치 표 개수 / 걸린 시간"만 쓴다. 불일치 **표 이름도 쓰지 않는다**(읽생기 표 이름은 이미 공개 migration에 있지만 규칙을 단순하게 둔다). 상세는 runner 안에서만 보고 버린다.
6. 실패하면 CC가 다음 점검 때 원인을 보고, 명진에게 한 줄 알린다.

자동화 정도: 1~6 모두 자동. 명진 손 없음. 다만 "운영에 되살리기"는 자동화하지 않는다(4-1).

### 4-1. 진짜로 되살려야 할 때 (사람 판단)

- 되살리기는 되돌릴 수 없고 읽생기까지 영향이 가므로 **명진 결정**이다. 기본은 **통째 덮어쓰기가 아니라 필요한 표·행만**: 덤프를 임시 DB에 되살림 → 필요한 행만 고른 SQL을 만듦 → 폰 경로 C(SQL Editor, `begin;`…`commit;`, 확인 SQL)로 넣음.
- 구현 PR 4에서 이 절차서(`docs/ops-db-restore.md`)를 쓴다. `supabase db push`·`migration repair`는 여기서도 영구 금지.

## 5. 추천안 한눈에

| 칸 | 추천 |
| --- | --- |
| 범위 | DB 전체(웹2 + 읽생기 + auth 행 + storage 기록 + migration 기록) |
| 접속 | K1(토큰 임시 접속), 안 되면 K2(읽기 역할 + 비밀값 1개) |
| 형식·잠금 | `pg_dump` custom 형식 + `age` 공개 열쇠 잠금 |
| 저장 | S1 비공개 GitHub 저장소 Release |
| 보존 | 매일 30개 + 매달 1일 12개 |
| 복구 시험 | 매달 runner 안 일회용 Postgres, 줄 수·정책 수 대조, 전부 자동 |
| 새 비밀값 | 접속 0~1 + 백업 저장소 토큰 1 + 복구용 비밀 열쇠 1 = **2~3개**. 기존 `SUPABASE_ACCESS_TOKEN`은 `production-edge`에 그대로(복사 안 함) |
| 비용 | 0원(추정) |

**확인 필요 — `production-edge` 승인자.** 매일 예약 실행이 `production-edge`의 토큰을 쓰는데, 그 environment에 승인자(required reviewers)가 걸려 있으면 매일 승인 대기에 멈춘다. CC 운영(승인 없이 돎)으로는 걸려 있지 않을 것으로 추정한다. 걸려 있으면 구현 PR 2 전에 명진 결정이 필요하다(토큰을 다른 environment에 복사하는 것은 강한 열쇠를 늘리므로 추천하지 않음 → 그때는 K2 읽기 역할을 별도 environment에).

## 6. 구현 PR 나눔 (줄 세우기)

| 순서 | PR | 내용 | 정지 지점 |
| --- | --- | --- | --- |
| 0 | (명진) | 1절 확인 + 8절 결정 | — |
| 1 | 준비(명진 손 + CC) | 비공개 저장소·토큰, `age` 열쇠 쌍(명진 폰/PC에서 만들고 공개 열쇠만 CC에 전달 — 만드는 법은 PR 2 본문에 단계별), K1 켜기 또는 K2 역할 SQL(폰 경로 C) | K2면 DB 역할 생성 = DB 변경 정지 지점 |
| 2 | `db-backup-daily.yml` + `scripts/ops/db-backup.mjs` + `tests/security/db-backup-workflow.test.mjs` | 3절 전부. 시험: artifact·cache 업로드 없음, `set -x`·`cat` 없음, main·예약 전용, 비밀값 인자 금지, summary 항목 고정, 공개 저장소 대상 업로드 없음 | 첫 실행은 `workflow_dispatch`로 CC가 보고 확인 |
| 3 | `db-restore-test.yml` + 대조 스크립트 + 시험 | 4절 1~6 | 없음(운영 읽기 없음, 백업 파일만 씀) |
| 4 | `docs/ops-db-restore.md` | 4-1 되살리기 절차서, 표 하나 되살리기 예시(가짜 이름) | 문서 |

PR 2·3은 같은 스크립트 폴더를 쓰므로 PR 3을 PR 2 위에서 시작한다(AGENTS 2절 줄 세우기).

## 7. 대안 비교 — 유료 PITR만 켜기

| | A. 추천안(매일 덤프, 무료 유지) | B. Pro로 올리기 | C. Pro + PITR |
| --- | --- | --- | --- |
| 월 비용 | 0원 | 25달러 | 25달러 + PITR 약 100달러(7일) + Small 컴퓨트 필요(공식 문서) |
| 되돌릴 수 있는 시점 | 하루 한 번(최대 24시간 손실) | 하루 한 번, 7일치 | 7일 안 아무 시각(초 단위) |
| 보관 위치 | Supabase 밖(비공개 GitHub) | Supabase 안 | Supabase 안(켜면 일일 백업은 멈춤 — 공식 문서) |
| 계정·프로젝트 통째 사고 | 살아남음 | 같이 잃음 | 같이 잃음 |
| 표 하나만 되살리기 | 쉬움(덤프에서 골라냄) | 어려움(프로젝트 통째 되돌림 → 읽생기도 같이 되돌아감) | 같음 |
| 복구 시험 | 매달 자동 | 직접 못 함(새 프로젝트로 복원은 가능, 손 필요) | 같음 |
| 명진 손 | 처음 한 번 | 결제 등록 | 결제 등록 |

- 결론: **A를 기본으로 추천.** 10/24 같은 "실수로 지움"은 휴지통(TRASH)과 하루 단위 덤프로 대부분 막힌다. "몇 분 전으로" 되돌려야 하는 일이 잦아지면 C를 더한다(그래도 A는 유지). 원장 10/16 결정(한 달 뒤 Claude 요금 낮추기)처럼 고정비를 줄이는 방향과도 맞다.

## 8. 명진 결정 질문

1. **Q1 저장 장소** — 매일 떠 둔 백업을 어디에 둘까요?
   - **가(추천): 명진만 보는 비공개 GitHub 저장소.** 돈 0원, 카드 등록 없음, 토큰 1년마다 갱신.
   - 나: Cloudflare R2(카드 등록 필요, 10 GB 무료).
   - 다: Google Drive(지금은 1주마다 연결이 끊겨서 웹2 구글 앱 검증 뒤로 미룸).
2. **Q2 DB 접속 열쇠** — **가(추천): 기존 열쇠로 임시 접속 기능을 켠다**(Supabase 화면에서 켜기 1번, 새 비밀값 없음). 안 되면 나: 백업 전용 읽기 계정을 만들고 비밀값 1개 추가.
3. **Q3 읽생기 포함** — **가(추천): 같이 뜬다.** DB가 하나라 같이 떠야 제대로 되살아난다(읽생기 자료도 명진 비공개 저장소에 잠긴 채 들어감). 나: 웹2 표만(되살릴 때 로그인 계정과 짝이 안 맞을 수 있음).
4. **Q4 보존 기간** — **가(추천): 최근 30일 + 매달 1일치 12개월.** 나: 최근 14일만(용량 적음).
5. **Q5 유료 PITR** — **가(추천): 지금은 안 켠다(0원 유지).** 나: Pro + PITR(월 약 125달러 이상).
6. **Q6 잠금 열쇠 보관** — 푸는 열쇠를 **가(추천): 명진 보관 1벌 + 월 복구 시험용 GitHub 비공개 칸 1벌.** 나: 명진만 보관(월 시험은 잠그기 전 단계까지만 확인, 푸는 것은 명진이 가끔 직접).

결정은 "백업 추천대로" 한 줄이면 된다. 1절 확인 결과(요금제·백업·PITR)는 따로 알려 주면 된다.

## 9. 근거 (공식 문서)

- Supabase Database Backups: https://supabase.com/docs/guides/platform/backups — 일일 백업은 Pro(7일)·Team(14일)·Enterprise(최대 30일). PITR은 Pro 이상 추가 기능, Small 컴퓨트 이상, 7일 약 100달러/월. PITR을 켜면 일일 백업 중단. 무료 요금제는 CLI `db dump` 등으로 직접 내보내 바깥에 보관하라고 권함. 대시보드 위치 Database > Backups.
- Supabase 무료 요금제 백업 FAQ: https://supabase.com/kb/faqs/platform/free-plan-backups
- PITR 사용량: https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery
- 토큰 기반 임시 DB 접속(미리보기): https://supabase.com/changelog/46346-feature-preview-temporary-token-based-database-access — PAT로 비밀번호 없이 접속, PG17 이상, 프로젝트별로 켬, 역할·기간 지정, 전용 pooler(6543) 불가.
- `supabase db dump` CLI: https://supabase.com/docs/reference/cli/supabase-db-dump (이 설계는 `supabase link`를 쓰지 않으므로 직접 `pg_dump`를 쓴다)

## 10. 범위 밖 발견

- **Storage 파일 백업 없음(사실).** 공유 사진 등 Supabase Storage 비공개 버킷의 파일 본문은 DB 덤프에 들어가지 않는다. 자료 원문은 Drive가 원본이라 영향이 작지만, Storage에만 있는 파일(공유 사진)은 따로 백업 장치가 없다. 별도 원장 행 후보(OPS-Storage백업)로 보고만 한다.
- `production-edge` 승인자 설정과 CC 운영 설명(승인 없이 돎)이 `ops-db-workflow.md`의 "승인자가 설정되어 있어야 승인 대기가 작동" 문장과 어긋나 보인다(확인 필요, 5절).
