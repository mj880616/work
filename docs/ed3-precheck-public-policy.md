# ED③ DB 사전 확인 멈춤 — 프로젝트 기록 표 PUBLIC 정책

📱 폰 경로 C — 적용은 사용자가 Supabase SQL Editor에서 한다(승인형 DB workflow는 이 파일을 거절한다).

## 1. 사실

- 승인형 DB workflow run #58(`20261023233000_ed_format_columns.sql`)이 사전 확인에서 멈췄다. 쓰기 없음.
- 사전 확인 값: `anon or public table privilege = 아니오`(기대대로), **`anon or public policy = 예`(기대 아니오)**, `notes policies count = 1`, `org updates policies count = 1`, `project records policies count = 4`, `notes one owner policy = 예`, `org updates owner policy = 예`.
- 노트 표는 정책 1개이고 그 1개가 authenticated 대상 `notes_owner_all`, 담당조직 기록 표도 정책 1개이고 그 1개가 authenticated 대상 `task12a_owner_all`이다. 따라서 PUBLIC 또는 anon 대상 정책은 **프로젝트 기록 표(`app_project_progress_updates`)의 정책 4개 중에 있다**(소거법, 사실).
- 저장소 기록: `docs/web2-task-impl-plan.md`(2026-09-27 운영 조회)가 이 표의 정책을 "공간 권한 함수 기반 4개", "`roles=public`에 공간 권한 함수를 쓴다"로 적어 두었다.
- 저장소 `supabase/migrations/` 어디에도 이 표의 `create policy`가 없다. 정책은 **운영에만 있다**(이름·조건식 원문 없음).
- 원인 이력: Task 12a(`20260925084844_task12a_sole_owner_db.sql`)가 32개 표의 정책을 지우고 authenticated 소유자 정책으로 바꿨는데, 그 목록에 프로젝트 계열 표(`app_project_progress_updates` 등)가 없었다.
- ED③ DB 시험(`tests/auth-handoff/ed-format-columns.test.mjs`)은 이 표를 authenticated 소유자 정책 1개로 꾸며 만들어 운영 모양(PUBLIC 4개)을 재현하지 못했다. 그래서 시험은 통과하고 운영 사전 확인에서 멈췄다.
- 추정: 정책 4개 모두 PUBLIC 대상(2026-09-27 기록 기준). 새 migration은 이 추정이 틀리면(4개가 아니거나 PUBLIC이 아닌 정책이 섞이면) 아무것도 바꾸지 않고 멈춘다.

## 2. 위험 판단

- 표 권한에 anon·PUBLIC이 없으므로(run #58 `아니오`) 비로그인 요청은 정책을 보기 전에 표 권한 단계에서 거절된다. **지금 실제로 열려 있는 접근은 없다.**
- 그래도 정책 대상이 PUBLIC이면 경계가 표 권한 하나에만 기댄다. 누가 실수로 표 권한을 anon에 주면 정책이 그대로 열린다. 다른 Web2 표와 같이 `authenticated`로 좁히는 것이 원칙이다(AGENTS.md 3절 7항).

## 3. 선택지 비교

| | (가) 선행 migration으로 정책 대상을 authenticated로 좁힘 — **추천** | (나) ED③ 사전 확인 조건 완화 |
| --- | --- | --- |
| 무엇 | 정책 4개의 대상 역할만 PUBLIC → authenticated. 조건식·명령·permissive 그대로 | ED③ precheck·migration의 "anon·PUBLIC 정책 없음" 조건을 빼거나 프로젝트 기록 표만 예외 |
| 권한 | 좁아짐(축소) | 그대로(PUBLIC 정책 남음) |
| ED③ 파일 | 그대로 재적용 | 수정 필요(이미 리뷰·merge된 검사를 약화) |
| 위험 | 정책 이름을 모르므로 이름 대신 카탈로그로 고름 → 사전 조건이 정확히 맞을 때만 실행, 전후 조건식 해시 비교 | 검사 약화(3절 1항 취지에 어긋남), 문제를 덮고 남김 |
| 적용 경로 | SQL Editor(폰 경로 C). 승인형 workflow 확장 규칙은 기존 정책 ALTER(`policy-drop-alter`)·동적 DO(`do-block`)를 거절 | 승인형 workflow |

(나)는 검사를 약하게 만드는 해결이라 하지 않는다.

## 4. (가) 파일과 순서

- migration: `supabase/migrations/20261023232000_project_records_policies_authenticated.sql`
- 짝 파일 5개: `docs/20261023232000_project_records_policies_authenticated.{precheck,snapshot,postcheck,rollback}.sql`, `.summary.md`
- 시험: `tests/auth-handoff/project-records-policies-authenticated.test.mjs`(run #58 재현 → 적용 → 소유자 읽기·넣기·고치기·지우기 전후 동일, 남·anon 거절, 다른 모양이면 멈춤, ED③ 원본 그대로 적용, 되돌리기), `tests/security/project-records-policies-authenticated-migration.test.mjs`(정적 검사, workflow 거절 사유 `do-block` 고정)

적용 순서:

1. SQL Editor 새 창 → `…precheck.sql` 실행 → 캡처. 기대: `policies count = 4`, `public-only policies count = 4`, `authenticated-only policies count = 0`, `anon policy = 아니오`, `anon or public table privilege = 아니오`, 나머지 예/아니오 항목은 `예`.
2. 새 창 → `…snapshot.sql` 실행 → 캡처(운영 정책 원문의 유일한 사본).
3. 새 창 → migration 원문 붙여 넣기 → 첫 줄 `begin;`·마지막 줄 `commit;`·대상 프로젝트 확인 → 실행 → Success.
4. 새 창 → `…postcheck.sql` 실행 → 캡처. 예/아니오 항목은 모두 `예`, 해시·행 수는 1의 같은 이름 값과 같아야 한다.
5. 그 뒤 ED③(`20261023233000_ed_format_columns.sql`)을 **파일 그대로** 승인형 DB workflow로 다시 시작한다.

되돌리기: `…rollback.sql`을 SQL Editor 새 창에서 실행한다. 정책 4개의 대상만 PUBLIC으로 돌리고 기록 1행을 지운다(조건식 그대로). ED③이 이미 적용된 뒤에도 ED③ 칸에는 영향이 없다.

## 5. version 순서 판단

- ED③ 파일 이름(`20261023233000_ed_format_columns`)은 운영에 들어갈 기록과 같아야 하므로 바꾸지 않는다.
- `docs/migration-history.md` 방침은 "파일 이름과 운영 기록 version을 소급해 맞추지 않고, 적용 SQL 안에서 파일과 같은 version으로 기록 1행을 넣는다"이다. 운영 적용 순서는 각 migration의 사전 조건(guard)이 지킨다. ED③ guard는 "앞선 기록 `20261023180000` 있음 + 이번 기록 없음"만 보고 더 늦은 version의 존재는 보지 않는다. 그래서 선행 migration의 version이 ED③보다 늦어도 **적용 순서만 지키면 동작한다**.
- 그래도 이번에는 `20261023232000`(ED③ 바로 앞, 아직 운영 미적용인 `20261023231500_ref_bundle_db`보다 뒤)으로 두었다. 저장소 정렬 순서와 실제 적용 순서가 같아 읽는 사람이 헷갈리지 않는다. 앞선 기록 조건은 ED③과 같은 `20261023180000`(적용 완료)이라 `20261023231500`의 적용 여부와 무관하다.

## 6. 같은 꼴 전수(목록만, 고치지 않음)

저장소 기준:

- 저장소 migration의 `create policy`는 모두 `to authenticated` 또는 `to service_role`이다. 대상 생략(PUBLIC)·`to public`·`to anon`은 없다(사실, 정적 검사).
- 확인됨: `app_project_progress_updates` — 이번 PR.
- 같은 조사에서 "정책 4개"로만 적힌 표: `app_project_update_labels`(대상 역할 기록 없음, 같은 모양일 가능성 높음 — 추정).
- 정책 정의가 저장소에 없고 Task 12a 목록에도 없는 Web2 표(운영 확인 필요): `app_project_milestones`, `app_project_workstreams`, `app_project_sections`, `app_project_blocks`, `app_project_checkitems`, `app_project_modules`, `app_project_updates`, `app_project_drive_folders`, `app_project_suborganizations`, `app_space_members`, `app_meeting_drive_folders`, `app_drive_settings`, `app_drive_download_tokens`, `app_google_calendar_connections`, `app_google_oauth_states`, `app_private_feature_access`.

운영 확인용 읽기 전용 SQL(select만, 이름·역할·권한 여부만 나오고 자료는 안 나옴):

```sql
select c.relname as table_name, p.polname as policy_name, p.polcmd::text as cmd,
  trim(case when 0::oid = any(p.polroles) then 'PUBLIC ' else '' end
    || case when 'anon'::regrole::oid = any(p.polroles) then 'anon' else '' end) as wide_roles,
  c.relrowsecurity as rls_on,
  coalesce(c.relacl::text ~ '(^|[{,])(anon)?=', false) as anon_or_public_table_grant
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'app\_%'
  and (0::oid = any(p.polroles) or 'anon'::regrole::oid = any(p.polroles))
order by 1, 2;
```

결과에 `anon_or_public_table_grant = true`인 줄이 있으면 실제로 열린 접근일 수 있으므로 먼저 알린다. 나머지는 이번과 같은 "좁히기" 후속 작업 후보로 원장에 올린다.
