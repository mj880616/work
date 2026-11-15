# DB 되살리기 절차서 (OPS-DB백업 4-1)

💻 **PC 로컬 필요.** 백업 파일을 풀고 임시 DB에 되살리는 일은 명진 PC(Claude Code 로컬)에서만 한다. 운영 DB에 넣는 마지막 단계만 📱 폰 경로 C(SQL Editor)로도 된다.

- 근거: 설계 [design/db-backup.md](design/db-backup.md) 4-1절, 설정 [ops-db-backup-setup.md](ops-db-backup-setup.md), 장치 `.github/workflows/db-backup-daily.yml`·`db-restore-test.yml`·`scripts/ops/backup-db*`.
- 이 문서는 절차만 담는다. 표 이름은 **가짜 이름**(`app_example_items`)으로 쓴다. 실제 표·행 값은 문서·PR·채팅·Actions 로그에 쓰지 않는다.
- 규칙: `AGENTS.md` 3절(보안)·6절(정지 지점: production 데이터 변경)·7절(DB 적용). **`supabase db push`·`migration repair`는 여기서도 영구 금지**(DB를 읽생기와 공유, `docs/migration-history.md`).

## 0. 명진용 요약

- **누가 정하나.** 되살리기는 되돌리기 어렵고 읽생기·로그인 계정까지 닿을 수 있어 **명진 결정**이다. CC·작업 세션은 준비(임시 DB에 되살려 고를 행 찾기, SQL 만들기)까지 하고, 운영 DB에 넣기 직전에 멈춘다.
- **기본은 필요한 행만.** 운영 DB를 백업으로 통째 덮어쓰지 않는다. 백업을 명진 PC 안의 임시 DB에 되살림 → 잃은 행만 고른 SQL을 만듦 → 확인 SQL로 앞뒤를 보고 SQL Editor에서 넣는다.
- **통째 복구는 최후.** Supabase 프로젝트 자체를 잃었을 때만 3절을 따로 계획한다.
- **명진 손.** ① 어느 날 어느 자료가 사라졌는지 일상어로 알려 주기 ② 비밀 열쇠(`AGE-SECRET-KEY-1…`)를 PC에서 잠깐 꺼내 주기 ③ 마지막 SQL 실행(SQL Editor, 4단계) ④ 결과 캡처.

## 1. 언제 쓰나 — 먼저 볼 것

| 상황 | 먼저 쓸 것 | 이 절차서 |
| --- | --- | --- |
| 화면에서 실수로 지운 자료(30일 안) | 앱 휴지통(TRASH-삭제휴지통) | 쓰지 않음 |
| 휴지통에 없는 행·표가 사라짐, 잘못된 일괄 변경 | — | **2절(행만 되살리기)** |
| 운영 migration이 표를 망가뜨림 | 그 migration의 rollback SQL(`supabase/migrations/*`의 짝 파일, `db-migration-apply.yml` 적용 직전 DB 안 백업 표) | 그래도 모자랄 때 2절 |
| Supabase 프로젝트가 통째로 사라짐·잠김 | — | **3절(통째 복구 계획)** |

- 백업은 하루 한 번(KST 04:17)이다. 마지막 백업 뒤에 생긴 행은 백업에 없다. 사라진 시각 **바로 전날 새벽** 백업을 고른다.
- 보관: 최근 30개 + 최근 12개 달의 첫 백업(`scripts/ops/backup-db.mjs` `planRetention`).

## 2. 행만 되살리기 (기본 절차)

### 2-1. 준비 (Claude Code 로컬, 명진 PC, 처음 한 번)

Windows PowerShell 기준. Claude Code 로컬 세션이 실행하고 명진은 설치 창의 [예]만 누른다.

```
winget install --id FiloSottile.age -e
winget install --id PostgreSQL.PostgreSQL.17 -e
```

- PostgreSQL 17은 **명진 PC 안에서만** 도는 빈 임시 DB다(설치 때 정하는 비밀번호는 이 PC 전용, 문서·채팅에 쓰지 않음). 운영 DB와 판(17)을 맞춘다.
- 비공개 백업 저장소 받기는 `gh`(명진 로그인)로 한다. 토큰 값을 명령 인자에 넣지 않는다.

### 2-2. 백업 받기 → 풀기 (명진 PC 안에서만)

작업 폴더는 저장소 **밖**(예: `$HOME\db-restore-작업날짜`)에 만든다. 저장소 안에 두면 실수로 커밋될 수 있다.

```
$w = "$HOME\db-restore-work"; New-Item -ItemType Directory -Force $w | Out-Null; Set-Location $w
gh release list --repo <계정>/web2-db-backup --limit 50
gh release download db-YYYYMMDD --repo <계정>/web2-db-backup --pattern "web2-db-*.tar.age" --dir $w
age -d -i <비밀 열쇠 파일> -o backup.tar web2-db-YYYYMMDD.tar.age
tar -xf backup.tar
```

- 태그는 `db-YYYYMMDD`(KST 날짜), 파일은 `web2-db-YYYYMMDD.tar.age`. 풀면 `db.pgdump`(pg_dump custom 형식)와 `counts.tsv`(덤프 때 센 표마다 줄 수)가 나온다.
- 비밀 열쇠는 명진이 보관본에서 잠깐 파일로 꺼내고, 2-3이 끝나면 **바로 지운다**. 열쇠·백업 파일을 채팅·메일·Drive에 올리지 않는다.
- `db.pgdump`·`counts.tsv` 내용(`pg_restore -l` 목록 포함)을 채팅·PR에 붙이지 않는다. 필요한 판단은 개수와 가짜 이름으로만 보고한다.

### 2-3. 임시 DB에 되살리기 (명진 PC)

```
createdb -U postgres -T template0 restore_tmp
psql -U postgres -X -q -d restore_tmp -f <저장소>\scripts\ops\backup-db-restore-prep.sql
pg_restore -U postgres --no-owner --no-acl -d restore_tmp db.pgdump 2> restore.err
psql -U postgres -X -q -d restore_tmp -v out=counts-restored.tsv -f <저장소>\scripts\ops\backup-db-counts.sql
```

- `backup-db-restore-prep.sql`·`backup-db-counts.sql`은 월 시험(`db-restore-test.yml`)과 같은 파일이다. Supabase 기본 역할 이름만 만들고(로그인 불가) 기본 public을 비운다.
- `counts.tsv`와 `counts-restored.tsv`가 맞는지 Claude Code가 비교한다(`node scripts/ops/backup-db.mjs compare counts.tsv counts-restored.tsv restore.err`). 맞지 않으면 그 백업을 쓰지 않고 하루 전 백업으로 다시 한다.
- 표 하나만 필요하면 `pg_restore -t app_example_items --schema=public ...`로 그 표만 되살려도 된다(외래 키 짝 표가 있으면 같이).

### 2-4. 고를 행 찾기 (읽기만)

1. 명진이 일상어로 말한 "사라진 것"을 Claude Code 로컬이 표·조건으로 바꾼다(예: "11월 3일에 쓴 메모 2개" → `app_example_items`의 작업공간·날짜 조건).
2. 운영 DB 쪽 지금 상태는 Claude Code 로컬의 **조회 전용** Supabase MCP로 본다(`select`만). 쓰기 도구는 쓰지 않는다.
3. 임시 DB에서 같은 조건으로 행을 찾고, **운영에 없는 행만** 고른다(기본 키로 대조). 운영에 이미 있는 행을 덮어쓰지 않는다.
4. 주인 경계 확인: 고른 행의 작업공간(`workspace_id`)이 명진이 말한 작업공간 하나뿐인지 본다. 다른 작업공간·읽생기(`rtw_*`)·로그인 계정(`auth.*`) 행은 이 절차로 넣지 않는다(필요하면 따로 명진 결정).
5. 보고는 "표 1개, 행 N개, 작업공간 1개" 같은 **개수만**.

### 2-5. 넣는 SQL 만들기 (명진 PC 파일로)

- 임시 DB에서 고른 행으로 `insert ... on conflict (기본 키) do nothing` SQL을 만든다(값은 파일에만, 저장소 밖 작업 폴더).
- 모양(가짜 이름):

```sql
-- 확인 SQL(넣기 전) — select만
select count(*) from public.app_example_items where id in ('<id1>', '<id2>');

begin;
insert into public.app_example_items (id, workspace_id, title, created_at, updated_at)
values
  ('<id1>', '<ws>', '<...>', '<...>', '<...>'),
  ('<id2>', '<ws>', '<...>', '<...>', '<...>')
on conflict (id) do nothing;
-- 넣은 줄 수가 고른 수와 다르면 여기서 rollback; 하고 멈춘다
commit;

-- 확인 SQL(넣은 뒤) — select만
select count(*) from public.app_example_items where id in ('<id1>', '<id2>');
```

- **되돌리기 SQL을 먼저 만든다**: 같은 id 목록으로 `begin; delete from public.app_example_items where id in (...) and <넣기 전에는 없던 행 조건>; commit;`. 넣기 전 확인 SQL 결과가 0이었던 id만 대상으로 한다.
- 트리거가 있는 표(수정 시각·변경 기록 등)는 넣을 때 트리거가 돈다. 트리거 결과가 문제 되면 넣지 말고 멈춰 보고한다(트리거 끄기·RLS 끄기로 우회하지 않는다 — `AGENTS.md` 3절).
- 이 SQL은 데이터 복구라 `supabase_migrations.schema_migrations` 기록은 넣지 않는다(migration이 아님). 대신 원장 행·PR 댓글에 "언제 어느 백업에서 표 몇 개·행 몇 개 되살림"을 개수로 남긴다.

### 2-6. 운영에 넣기 (정지 지점 — 명진 결정)

`AGENTS.md` 6절(production 데이터 변경)·7절 그대로.

1. 명진에게 일상어 3줄을 먼저 보인다: **무엇이 바뀌나**(예: 지운 메모 2개가 돌아옴) / **잘못되면 어떤 일이 생기나**(예: 같은 메모가 두 번 보일 수 있음 — `on conflict do nothing`이라 기존 행은 안 바뀜) / **되돌리는 방법**(2-5의 되돌리기 SQL).
2. 명진이 SQL Editor에서 **새 쿼리 창(+)** → 넣기 전 확인 SQL 실행·캡처 → 넣는 SQL 붙여 넣기 → 첫 줄 `begin;`·마지막 줄 `commit;`·대상 프로젝트 확인 → 실행 → Success 캡처 → 넣은 뒤 확인 SQL 실행·캡처.
3. 길면 폰 경로 C처럼 조각마다 `begin;`…`commit;`으로 나누고, 조각 사이에 확인 SQL을 둔다.
4. Claude Code 로컬이 조회 전용 MCP로 사후 확인(개수)하고, 화면에서 명진이 자료가 돌아온 것을 본다.
5. AI가 `apply_migration` 등 쓰기 도구로 직접 넣지 않는다. 승인형 DB workflow(`db-migration-apply.yml`)는 migration 파일용이라 행 값이 든 SQL에는 쓰지 않는다(공개 저장소에 행 값이 올라감).

### 2-7. 뒷정리 (명진 PC)

```
dropdb -U postgres restore_tmp
Remove-Item -Recurse -Force $HOME\db-restore-work
```

- 비밀 열쇠 파일·풀린 덤프·넣는 SQL 파일을 모두 지운다. 휴지통도 비운다.
- 원장(커맨드센터)에 "OPS-DB백업 되살리기 1회: 날짜, 백업 태그, 표·행 개수"만 남긴다.

## 3. 프로젝트를 통째로 잃었을 때 (계획만)

이 경우는 자동화하지 않고, 일이 생기면 CC가 아래 순서로 따로 계획서를 만들어 명진 결정을 받는다.

1. Supabase에 새 프로젝트를 만든다(명진 로그인). 같은 Postgres 17.
2. 새 프로젝트는 Supabase 기본 스키마(`auth`·`storage` 등)를 이미 갖고 있으므로, 백업의 `public`·`private`·`supabase_migrations`는 구조+행, `auth`·`storage`는 **행만** 넣는 순서를 시험 프로젝트(또는 명진 PC 임시 DB)에서 먼저 맞춘다.
3. 읽생기(`rtw_*`)도 같은 DB라 같이 돌아온다. 읽생기 쪽에 알리고 같이 확인한다.
4. Edge Function·비밀값·Storage 파일 본문(백업에 없음, 설계 10절)·도메인·OAuth 설정은 따로 다시 건다.
5. 웹2·읽생기 화면의 프로젝트 주소를 새 프로젝트로 바꾸는 PR은 따로.

## 4. 하지 않는 것

- 운영 DB를 백업으로 통째 덮어쓰기(`pg_restore --clean` 등을 운영에 대고 실행).
- `supabase db push`·`migration repair`·`supabase link`.
- 백업 파일·풀린 덤프·행 값·비밀 열쇠를 공개 저장소·Actions artifact·로그·채팅·Drive에 두기.
- 넣기 위해 RLS·트리거·권한을 끄거나 넓히기.
- 다른 작업공간·읽생기·로그인 계정 행을 명진 결정 없이 넣기.
