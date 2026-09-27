# TASK-구현 PR 2: 메모·꼬리표 표 DB 적용 절차

- 계획: [계획 문서](web2-task-impl-plan.md) 2.1·2.2·3절 단계 A·4.3절.
- 적용 SQL: `supabase/migrations/20260927103344_task_impl2_notes_record_links.sql`(파일 이름은 Supabase CLI 2.118.0 `migration new`로 만듦).
- 되돌리기 SQL: `docs/web2-task-impl2-rollback.sql`.
- 시험: `tests/auth-handoff/record-links.test.mjs`(실제 PostgreSQL 17.6 임시 클러스터, CI `auth-handoff-postgres`), `supabase/tests/authz_task_impl2_record_links.sql`(적용 후 리허설용, 끝에 `rollback;`).
- 이 문서의 SQL은 운영에서 아직 실행하지 않았다.

## 1. 무엇이 바뀌나 (일상어 3줄)

- 무엇이 바뀌나: 빈 표 두 개(메모 원문 `app_notes`, 할 일·메모를 프로젝트·조직에 잇는 꼬리표 `app_record_links`)가 새로 생긴다. 기존 표·데이터·권한은 그대로다.
- 잘못되면: 적용이 중간에 실패하면 한 묶음(transaction)이라 아무것도 남지 않는다. 표가 생긴 뒤에도 앱·Edge가 아직 쓰지 않으므로 화면에는 변화가 없다.
- 되돌리는 방법: `docs/web2-task-impl2-rollback.sql`을 실행하면 두 표와 기록 1행만 지워진다. 지금은 빈 표라 잃는 것이 없다.

## 2. 사전 조회 (2026-09-27, read-only)

| 항목 | 결과 |
| --- | --- |
| PostgreSQL | 17.6 (`unique nulls not distinct` 사용 가능) |
| `app_notes`·`app_record_links`·`app_task_links` | 없음 |
| migration `20260927103344` 기록 | 없음 |
| `private.app_is_workspace_owner(uuid)` | 있음. 본문이 저장소(Task 12a)와 같음. authenticated 실행 권한 있음 |
| `private.app_space_in_workspace(uuid,uuid)` | 있음. SECURITY DEFINER. authenticated 실행 권한 있음 |
| `app_spaces`·`app_suborganizations`의 `id`·`workspace_id` | uuid, not null |
| `app_suborganizations` 정책 | `task12a_owner_all`(소유자만) |
| `app_workspaces` | 1행 |
| public 기본 표 권한 | 새 표에 anon·authenticated·service_role ALL이 기본 부여됨 |

기본 권한 때문에 계획 초안의 `revoke all ... from anon` + `grant ... to authenticated`만으로는 authenticated에 TRUNCATE·REFERENCES·TRIGGER가 남는다. 그래서 `public, anon, authenticated`에서 모두 걷어 낸 뒤 네 가지(select·insert·update·delete)만 다시 준다. 계획의 권한 목록과 같은 결과이고 권한을 넓히지 않는다. service_role은 다른 Web2 표와 같이 기본값을 그대로 둔다.

## 3. 적용 순서

1. PR 2를 main에 merge한다(적용 SQL은 main 파일 원문으로 실행한다. AGENTS.md 7절).
2. 로컬 세션이 **1단계 사전 확인**을 다시 조회한다.
3. 사용자가 SQL Editor에서 **2단계 적용**을 실행한다.
4. 로컬 세션이 **3단계 사후 확인**을 조회한다.
5. 그다음 PR 3(Edge)으로 넘어간다. PR 3은 이 표가 있어야 동작한다.

적용 SQL을 표별로 나눠 따로 commit하지 않는다. `app_record_links`가 `app_notes`를 참조하므로 반쯤 적용된 상태를 만들지 않도록 한 묶음(transaction)으로 실행한다. 대신 앞뒤 확인을 단계로 나눈다.

### 1단계 사전 확인 (조회만)

```sql
select to_regclass('public.app_notes') as notes,
       to_regclass('public.app_record_links') as links,
       (select count(*) from supabase_migrations.schema_migrations where version = '20260927103344') as record,
       to_regprocedure('private.app_is_workspace_owner(uuid)') is not null as owner_fn,
       to_regprocedure('private.app_space_in_workspace(uuid,uuid)') is not null as space_fn;
```

기대: `notes`·`links`는 null, `record` 0, `owner_fn`·`space_fn` true. 다르면 실행하지 않는다.

### 2단계 적용 (사용자가 SQL Editor에서)

main의 `supabase/migrations/20260927103344_task_impl2_notes_record_links.sql` 원문 전체를 그대로 붙여 실행한다. 마지막 줄이 `commit;`인지 확인한다. 결과가 Success인지 확인한다.

### 3단계 사후 확인 (조회만)

```sql
select c.relname, c.relrowsecurity,
       has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_any,
       has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as auth_crud,
       has_table_privilege('authenticated', c.oid, 'TRUNCATE,REFERENCES,TRIGGER') as auth_extra,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_index i where i.indrelid = c.oid) as indexes
from pg_class c
where c.oid in ('public.app_notes'::regclass, 'public.app_record_links'::regclass)
order by 1;

select polrelid::regclass as tbl, polname, polcmd, polroles::regrole[] as roles
from pg_policy
where polrelid in ('public.app_notes'::regclass, 'public.app_record_links'::regclass);

select conname from pg_constraint
where conrelid = 'public.app_record_links'::regclass and contype in ('c','u')
order by 1;

select (select count(*) from public.app_notes) as notes_rows,
       (select count(*) from public.app_record_links) as links_rows,
       (select count(*) from supabase_migrations.schema_migrations
         where version = '20260927103344' and name = 'task_impl2_notes_record_links') as record;
```

기대:

- 두 표 모두 `relrowsecurity` true, `anon_any` false, `auth_crud` true, `auth_extra` false, 정책 1개. 색인은 `app_notes` 1개(기본 키), `app_record_links` 6개(기본 키·unique·부분 색인 4개).
- 정책: `notes_owner_all`, `record_links_owner_all`, 둘 다 `*`, `{authenticated}`.
- 제약(7개): `app_record_links_one_source`, `app_record_links_one_target`, `app_record_links_report_kind_check`, `app_record_links_status_check`, `app_record_links_task_list`, `app_record_links_task_state`, `app_record_links_unique`.
- 행 0, 0, 기록 1.

## 4. 되돌리기

`docs/web2-task-impl2-rollback.sql` 원문을 SQL Editor에서 실행한다(마지막 줄 `commit;`). PR 3(Edge)이 배포된 뒤라면 Edge를 먼저 이전 버전으로 되돌린다. 연결을 쓰기 시작한 뒤 되돌리면 연결 정보·메모가 사라진다(할 일 자체는 Google에 남음).

되돌린 뒤 확인(조회만):

```sql
select to_regclass('public.app_notes') as notes,
       to_regclass('public.app_record_links') as links,
       (select count(*) from supabase_migrations.schema_migrations where version = '20260927103344') as record;
```

기대: null, null, 0.

## 5. 시험 결과

- 로컬 PC(Windows ARM64)는 `embedded-postgres`가 지원하지 않아 실행하지 못했다. 같은 시험을 CI `auth-handoff-postgres`(ubuntu, PostgreSQL 17.6 임시 클러스터)에서 실행한다.
- 시험 내용: 호스팅 기본 권한 재현 → 적용 → RLS·권한(anon·PUBLIC 없음, authenticated 네 가지만, TRUNCATE 거부) → 소유자 연결(할 일 하나를 프로젝트 2개·조직 1개에, 메모 연결) → 미완료 개수 조회 → 제약(출처·대상 1개, 목록·완료 사본 짝, status·report_kind 값, 중복, 메모 길이) → 비소유자·비로그인 읽기 0건·쓰기 거부 → 다른 workspace 프로젝트·조직 연결 거부 → 프로젝트·조직·메모 삭제 시 연결 삭제 → 되돌리기(두 표와 기록 1행만 삭제, 다른 기록 유지) → 재적용.
