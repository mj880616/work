# DB 백업 켜기 — 명진 할 일 (OPS-DB백업)

💻 **PC 권장(4단계 열쇠 만들기만 PC 필요).** 1~3·5단계는 폰 브라우저로도 된다. 설계는 [design/db-backup.md](design/db-backup.md), 만든 장치는 아래 "무엇이 도나".

## 0. 한눈에

- **무엇이 도나.** 매일 새벽 4시 17분(한국 시각) GitHub가 운영 DB(웹2 + 읽생기)를 **읽기만** 해서 한 파일로 뜬 뒤 **잠가서(암호화)** 명진만 보는 비공개 저장소에 올린다. 최근 30개 + 최근 12개 달의 첫 백업만 남기고 나머지는 지운다. 매달 2일 새벽 5시 17분에는 가장 최근 백업을 GitHub 안의 빈 임시 DB에 되살려 표마다 줄 수가 맞는지 자동으로 본다.
- **설정 전에는.** 아래 설정이 없으면 두 작업 모두 "설정 안 됨"으로 아무것도 하지 않고 끝난다(실패 알림 없음).
- **명진 손.** 처음 한 번만 아래 1~6단계. 그 뒤는 CC가 본다. 1년마다 토큰 2개 갱신(만료 30일 전부터 백업 결과에 경고가 뜬다).
- **값 붙여 넣는 곳은 GitHub 화면뿐.** 토큰·열쇠 값은 채팅·문서·메일에 쓰지 않는다. CC에게는 "몇 단계 끝"만 알려 주면 된다. 4단계의 **공개 열쇠(age1로 시작)** 만은 비밀이 아니라 채팅으로 보내도 된다.

| 이름 | 종류 | 넣는 곳 | 값 |
| --- | --- | --- | --- |
| `DB_BACKUP_REPO` | 변수 | work 저장소 → Actions **Variables**(저장소) | `계정이름/web2-db-backup` |
| `DB_BACKUP_AGE_RECIPIENT` | 변수 | work 저장소 → Actions **Variables**(저장소) | 4단계 공개 열쇠 `age1…` |
| `DB_BACKUP_REPO_TOKEN` | 비밀값 | work 저장소 → Environments → **production-edge** | 3단계 토큰 ①(쓰기) |
| `DB_RESTORE_REPO_TOKEN` | 비밀값 | work 저장소 → Environments → **db-restore**(새로 만듦) | 3단계 토큰 ②(읽기) |
| `DB_BACKUP_AGE_IDENTITY` | 비밀값 | work 저장소 → Environments → **db-restore** | 4단계 비밀 열쇠 `AGE-SECRET-KEY-1…` 한 줄 |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | (이미 있음) | production-edge | 바꾸지 않는다 |
| `DB_BACKUP_POOLER_HOST` | 변수(선택) | 저장소 Variables | 보통 비워 둔다. CC가 요청할 때만 |

## 1. Supabase — 임시 접속 켜기 (로그인 필요)

백업은 DB 비밀번호 없이 이미 있는 운영 토큰으로 잠깐 접속한다(Supabase "temporary access"). 이 기능을 켜야 한다.

1. `supabase.com` → **Sign in** → 웹2 프로젝트(`kptu-shared-checklists`)를 누른다.
2. 왼쪽 아래 톱니바퀴 **Project Settings** → **General**에서 Postgres 판이 `17.6.1.081` 이상인지 본다. 낮으면 "판이 낮음"이라고 CC에 알리고 멈춘다.
3. 왼쪽 원통 모양 **Database** → **Settings**(또는 Project Settings → **Database**).
   - **SSL Configuration**의 **Enforce SSL on incoming connections**가 켜져 있는지 본다. 꺼져 있으면 켠다.
   - **Enable temporary access**(임시 접속) 칸에서 켠다(Enable).
   - 사람 → 역할 연결 칸(Map team members to Postgres roles)에서 **명진 계정**을 **`postgres`** 역할에 연결한다. 기간 제한은 두지 않거나 길게, 네트워크 제한은 두지 않는다(GitHub 주소가 매번 바뀜).
4. 끝나면 CC에 "1단계 끝"이라고 알린다. 메뉴 이름이 다르면 "임시 접속 메뉴 못 찾음"이라고만 알린다.
5. (설계 문서 1절) 같은 김에 요금제 이름·Backups 화면·Point in Time 켜짐 여부를 글로 알려 주면 좋다.

> 백업은 `pg_dump`가 여는 **읽기 전용** 거래로만 읽는다. 쓰기는 하지 않는다. `postgres` 역할을 고른 까닭: 웹2·읽생기·로그인 계정 표를 빠짐없이 읽으려면 필요하다.

## 2. GitHub — 비공개 백업 저장소 만들기

1. `github.com` 로그인 → 오른쪽 위 **+** → **New repository**.
2. Repository name: `web2-db-backup`.
3. **Private**를 고른다(꼭). 공개면 백업 작업이 올리기 전에 멈춘다.
4. **Add a README file**에 체크(빈 저장소면 백업을 붙일 자리가 없다).
5. **Create repository**.

## 3. GitHub — 토큰 2개 만들기

같은 방법으로 두 번 만든다. ①은 올리기·지우기용, ②는 월 시험 때 받기용이다.

1. 오른쪽 위 내 사진 → **Settings** → 왼쪽 맨 아래 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Token name: ① `web2-db-backup-write` / ② `web2-db-backup-read`.
3. Expiration: **Custom** → 1년 뒤 날짜(가장 길게).
4. Repository access: **Only select repositories** → `web2-db-backup` 하나만.
5. Permissions → Repository permissions → **Contents**: ① **Read and write** / ② **Read-only**. 다른 칸은 건드리지 않는다(Metadata 읽기는 자동).
6. **Generate token** → 화면에 한 번만 보이는 값을 복사해 바로 5단계에 붙여 넣는다(메모장·채팅에 두지 않는다).

## 4. 잠금 열쇠 만들기 (PC, 처음 한 번)

백업 파일을 잠그는 **공개 열쇠**와 여는 **비밀 열쇠** 한 쌍을 명진 PC에서 만든다. CC가 만들면 비밀 열쇠가 AI를 거치므로 명진이 만든다.

1. 윈도우 시작 → `PowerShell` 입력 → 연다.
2. 아래 두 줄을 한 줄씩 붙여 넣고 Enter.
   ```
   winget install --id FiloSottile.age -e
   ```
   (끝나면 PowerShell 창을 닫았다 다시 연다)
   ```
   age-keygen -o $HOME\Documents\web2-db-backup-key.txt
   ```
3. 화면에 `Public key: age1…`이 한 줄 나온다. 이것이 **공개 열쇠**다. CC에게 채팅으로 보내도 된다(5단계 변수 `DB_BACKUP_AGE_RECIPIENT`).
4. `문서` 폴더의 `web2-db-backup-key.txt`를 메모장으로 연다. `AGE-SECRET-KEY-1`로 시작하는 줄이 **비밀 열쇠**다.
   - 비밀번호 관리 앱(또는 종이)에 그 줄을 보관한다. **이 열쇠를 잃으면 백업을 풀 수 없다.**
   - 같은 줄을 5단계 `DB_BACKUP_AGE_IDENTITY`에 붙여 넣는다(월 시험용 한 벌).
   - 다 넣은 뒤 PC의 `web2-db-backup-key.txt`는 지워도 된다(보관본이 있을 때만).

## 5. GitHub — 이름별로 값 넣기 (work 저장소)

work 저장소 화면 → 위쪽 **Settings**.

1. **변수 2개**: 왼쪽 **Secrets and variables** → **Actions** → 위쪽 **Variables** 탭 → **New repository variable**.
   - Name `DB_BACKUP_REPO`, Value `계정이름/web2-db-backup`(2단계 저장소 주소의 github.com/ 뒤 부분).
   - Name `DB_BACKUP_AGE_RECIPIENT`, Value 4단계 `age1…` 한 줄.
2. **production-edge에 비밀값 1개**: 왼쪽 **Environments** → **production-edge** → 아래 **Environment secrets** → **Add environment secret**.
   - Name `DB_BACKUP_REPO_TOKEN`, Value 토큰 ①.
3. **db-restore 새로 만들기**: **Environments** → **New environment** → Name `db-restore` → **Configure environment**.
   - **Deployment branches and tags** → **Selected branches and tags** → **Add deployment branch or tag rule** → `main`.
   - **Required reviewers**는 켜지 않는다(켜면 매달 승인 대기에 멈춤).
   - **Add environment secret**: Name `DB_RESTORE_REPO_TOKEN`, Value 토큰 ②.
   - **Add environment secret**: Name `DB_BACKUP_AGE_IDENTITY`, Value 4단계 `AGE-SECRET-KEY-1…` 한 줄.
4. **production-edge 승인자 확인**: **Environments** → **production-edge**에 **Required reviewers**가 켜져 있으면 매일 백업이 승인 대기에 멈춘다. 켜져 있으면 끄지 말고 CC에 "production-edge 승인자 켜져 있음"이라고 알린다(그때 따로 정한다).

## 6. 첫 실행 확인 (CC가 한다)

명진이 "백업 설정 끝"이라고 알리면 CC가:

1. **DB backup daily**를 수동 실행(Run workflow)해 요약표(날짜·잠근 크기·해시 앞 16자·표 개수·줄 수 합계·보관 개수·토큰 남은 날)를 본다.
2. 이어서 **DB restore test monthly**를 수동 실행해 "표 N개 중 N개 일치"를 본다.
3. 실패하면 분류 코드(`AUTH`·`PERMISSION`·`NETWORK`·`VERSION` 등)만 보고 원인을 찾는다. 오류 원문은 공개 로그에 남기지 않는다.

## 7. 갱신·문제 때

- **토큰 만료**: 1년 뒤. 만료 30일 전부터 백업 요약에 경고가 뜨면 3단계를 다시 해서 같은 이름(`DB_BACKUP_REPO_TOKEN`·`DB_RESTORE_REPO_TOKEN`)에 새 값을 덮어 넣는다.
- **열쇠를 바꿀 때**: 4단계를 다시 하고 변수·비밀값을 둘 다 바꾼다. 옛 백업은 옛 비밀 열쇠로만 풀리므로 옛 열쇠도 30일 + 12개월 동안 보관한다.
- **운영 DB 판이 18로 오르면**: 백업이 `VERSION`으로 실패한다. CC가 workflow의 판 번호를 올린다.
- **진짜로 되살려야 할 때**: 명진 결정. 통째 덮어쓰기가 아니라 필요한 표·행만 골라 넣는다(설계 4-1절, 절차서는 다음 PR).
- **백업을 멈추고 싶을 때**: 5단계 1의 변수 `DB_BACKUP_REPO`를 지우면 두 작업 모두 "설정 안 됨"으로 멈춘다.

## 8. 무엇이 어디에 남나 (CC·검토용)

| 장치 | 파일 | 하는 일 |
| --- | --- | --- |
| 매일 백업 | `.github/workflows/db-backup-daily.yml` | 설정 확인(비밀값 없이) → production-edge에서 접속 준비 → 읽기 전용 snapshot 하나로 `pg_dump`(custom) + 같은 snapshot으로 줄 수 세기 → `age` 잠금 → 비공개 확인 뒤 Release 올리기 → 보관 정리 |
| 월 시험 | `.github/workflows/db-restore-test.yml` | db-restore에서 최근 백업 받기 → 풀기 → runner 안 `postgres:17` 빈 DB에 `pg_restore` → 줄 수·RLS 표·정책·함수 개수 비교. 운영 열쇠 없음 |
| 도우미 | `scripts/ops/backup-db.mjs` | 설정 확인, 접속 준비(임시 접속 상태·pooler 주소), 오류 분류, 올리기·보관 정리·받기, 비교 |
| SQL·셸 | `scripts/ops/backup-db-snapshot.sql`, `backup-db-dump.sh`, `backup-db-counts.sql`, `backup-db-restore-prep.sql` | snapshot·덤프·줄 수·시험 DB 준비 |
| 시험 | `tests/security/db-backup-workflow.test.mjs` | 설정 없음 → 조용히 끝, 보관 개수 계산, 공개 로그·산출물 금지, 비밀값 경로 고정 |

- 공개 로그·요약에 남는 것: 날짜, 잠근 크기(MB), 잠근 파일 SHA-256 앞 16자, 표 개수, 줄 수 합계, 보관 개수, 토큰 남은 날, 일치 개수, 분류 코드. 표 이름·행 값·접속 주소·토큰은 남지 않는다.
- DB 쪽 변경(migration·역할 만들기)은 없다. 읽기 전용 백업 역할(K2)은 임시 접속이 안 될 때만 따로 PR로 만든다.
