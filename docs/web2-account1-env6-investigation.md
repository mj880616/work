# 계정-1 · ENV-6 조사: 본인 외 계정 3개 삭제 준비 · 저장소에 원본 없는 Edge Function 점검

- 조사일: 2026-09-26
- 기준: `main` `8532bcb` (#319 포함)
- 세션: 로컬. production은 Supabase MCP read-only 조회(`execute_sql` SELECT, `query_logs`)와 `supabase functions list`만 사용했다. DB 쓰기·계정 삭제·Edge 배포·삭제 없음.
- 이 문서의 SQL은 초안이며 실행하지 않았다. 계정은 역할로만 적고 이메일·ID는 적지 않는다. SQL은 ID 대신 조건으로 대상을 고르고, 조건이 어긋나면 스스로 멈추도록 작성했다.
- 참고: [묶음A 조사 문서](web2-bundle-a-investigation.md) 1.2·1.8·5절.

## 0. 요약

- 삭제 대상 3개(사용자 확정: 모두 본인 소유, 전부 삭제): 계정 B(비구성원, Google), 계정 C(보조 관리자, Google), 계정 D(비구성원, Google). 본인 계정은 A.
- 세 계정 모두 옮길 업무 자료가 없다. 읽생기(`rtw_*`) 자료 0, 저장소 파일 0, 소유한 프로젝트·자료·회의·조직 0.
- **계정 B는 지금 상태로는 삭제가 막힌다(사실, 함수 정의로 확인).** 본인이 만든 회의 후속 할 일 1건이 계정 B에게 배정되어 있다. 계정을 지우면 DB가 이 할 일의 담당자를 비우는데(`ON DELETE SET NULL`), 할 일 표 트리거 `app_tasks_workspace_consistency`가 "담당자는 구성원이어야 한다"(`app_user_in_workspace(NULL, …)` = false)로 거부해 계정 삭제 전체가 실패한다. 먼저 담당자를 본인으로 바꾸면 풀린다(2.1 A).
- 그 밖에 삭제를 막는 외래키는 없다. 제한(`RESTRICT`/`NO ACTION`) 외래키 중 세 계정을 가리키는 행은 0이다.
- 역할 자동 지정 트리거에 고정된 이메일은 본인 계정 A의 것이다. 세 계정과 무관하다.
- ENV-6: 배포된 함수 38개 중 17개가 두 저장소 어디에도 원본이 없다(git 전체 이력에도 없음). 판정: 원본 복구 필요 8, 삭제 후보 7, 사용자 결정 2(3절).

## 1. 계정-1: 계정별 남은 자료

### 1.1 계정 개요

| 계정 | 로그인 | 가입 | 마지막 로그인 | Web2 구성원 | 세션 |
| --- | --- | --- | --- | --- | --- |
| A(본인) | 이메일 + Google | 9/11 | 9/26 | owner | 유지 |
| B | Google | 9/12 | 9/20 | 없음 | 5 |
| C | Google | 9/14 | 9/14 | admin | 1 |
| D | Google | 9/21(KST) | 9/21(KST) | 없음 | 3 |

### 1.2 남은 행 (auth.users를 가리키는 외래키 전체 + 외래키 없는 사용자 ID 칸 전수)

조회 범위: `auth.users`를 가리키는 외래키 75개 전부(Web2 `app_*` 53, 읽생기 `rtw_*` 12, Supabase `auth.*` 10)와, 외래키 없이 사용자 ID를 담는 uuid 칸(`public`·`private`·`storage`)을 계정별로 셌다. 0이 아닌 것만 적는다.

| 계정 | 표 | 행 | 계정 삭제 시 | 비고 |
| --- | --- | --- | --- | --- |
| B | `app_tasks.assignee_id` | 1 | 담당자 비움 시도 → **트리거가 거부, 삭제 실패** | 본인이 만든 회의 후속 할 일(미완료). 조사 문서 1.3·1.9의 "비구성원 배정 1건" |
| B | `app_google_calendar_connections` | 1 | 함께 삭제 | Google 토큰 포함, 9/13 연결 후 갱신 없음 |
| B | `app_google_oauth_states` | 1 | 함께 삭제 | 9/13 만료된 연결 시도 흔적 |
| B | `app_direct_messages` | 5(보냄 2, 받음 3) | 함께 삭제 | 본인 A와 주고받은 짧은 시험 쪽지(각 2글자). 쪽지 화면은 제거됨 |
| B | `app_profiles` | 1 | 함께 삭제 | |
| C | `app_workspace_members` | 1(admin) | 함께 삭제 | 삭제 트리거 없음(역할 트리거는 추가·수정 때만) |
| C | `app_access_requests` | 1(승인됨, 9/14) | 함께 삭제 | 검토자 칸이 본인 A(본인은 삭제 대상 아님) |
| C | `app_profiles` | 1 | 함께 삭제 | |
| D | `app_access_requests` | 1(**대기 중**, 9/21 KST) | 함께 삭제 | 사용자 결정: 거절 후 삭제 |
| D | `app_profiles` | 1 | 함께 삭제 | |
| B·C·D | `auth.identities` 각 1, `auth.sessions`(B 5·C 1·D 3) | | 함께 삭제 | Supabase 내부 |
| B·C·D | `rtw_*` 12표, `storage.objects` | 0 | | 읽생기 자료·파일 없음 |

### 1.3 트리거·외래키 점검

- `auth.users` 트리거: `app_auth_user_profile`(가입 때만). 삭제 때 도는 트리거 없음.
- 세 계정 행이 있는 표 중 삭제·수정 때 도는 트리거는 `app_tasks`의 수정 전 트리거 3개뿐이다. 이 중 `app_tasks_workspace_consistency`(`private.app_enforce_workspace_links`)가 담당자 없음(NULL)을 거부한다. 외래키의 담당자 비우기도 수정으로 처리되므로 트리거가 돈다. 이것이 계정 B 삭제를 막는다.
- 담당자를 본인 A로 바꾸면 세 트리거를 모두 통과한다: 본인은 구성원, 할 일에 프로젝트·세부 항목 없음, 출처 회의가 같은 작업공간(조회로 확인).
- 제한 외래키(`app_pages.owner_id` RESTRICT, 그 밖의 `created_by`·`author_id` 등 NO ACTION) 중 세 계정을 가리키는 행은 0.
- `app_access_requests.reviewed_by`(NO ACTION)는 본인 A를 가리킨다. 본인은 지우지 않으므로 영향 없음.
- 역할 자동 지정 트리거 `trg_app_enforce_workspace_member_role`의 고정 이메일은 본인 A. 추가·수정 때만 돌고 삭제와 무관하다.
- 읽생기 `rtw-delete-account`는 `app_workspace_members`로 "Web2 계정인지" 판정한다(조사 문서 1.10). 계정 C의 구성원 행이 사라지면 C는 "일반 사용자"로 판정되지만 C를 통째로 지우므로 영향 없음.

### 1.4 준비 SQL (실행 금지, 초안)

공통 규칙

- 대상은 ID 대신 조건으로 고른다: 본인(작업공간 owner 1명)이 아니고, 2026-09-21 00:00 UTC 이전에 가입한 계정. 읽생기 등으로 이후에 생긴 계정은 대상에 들지 않는다.
- 각 SQL은 맨 앞 확인 단계에서 대상이 정확히 3개, 본인 1명, 읽생기 자료 0이 아니면 멈추고 아무것도 바꾸지 않는다.
- 스키마 변경이 아니라 데이터 정리이므로 `supabase_migrations.schema_migrations` 기록은 넣지 않는다(migration 파일 없음).
- 저장소에는 행 데이터를 남길 수 없다. 되돌리기에 필요한 값은 사전 확인(0단계) 결과를 사용자 PC에 CSV로 내려받아 둔다.

#### 0단계. 사전 확인 (읽기 전용)

```sql
-- 계정-1 사전 확인. 읽기 전용. 결과 3개를 모두 CSV로 내려받아 PC에 보관한다.
-- (1) 대상 계정 목록: 3행이어야 한다. 이메일로 본인 계정이 아닌지 눈으로 확인.
with owner as (
  select user_id from public.app_workspace_members where role = 'owner'
), targets as (
  select u.id from auth.users u
  where u.id not in (select user_id from owner)
    and u.created_at < timestamptz '2026-09-21 00:00:00+00'
)
select u.id, u.email, u.created_at, u.last_sign_in_at, u.raw_app_meta_data->>'provider' as provider,
       (select string_agg(m.role, ',') from public.app_workspace_members m where m.user_id = u.id) as web2_role,
       (select count(*) from owner) as owner_count
from auth.users u where u.id in (select id from targets) order by u.created_at;

-- (2) 대상 계정을 가리키는 모든 행 수 (0이 아닌 것만)
with targets as (
  select u.id from auth.users u
  where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
    and u.created_at < timestamptz '2026-09-21 00:00:00+00'
), fk as (
  select c.conrelid::regclass::text as tbl, a.attname as col, c.confdeltype as on_delete
  from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
), counted as (
  select t.id, fk.tbl, fk.col, fk.on_delete,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s where %I = %L', fk.tbl, fk.col, t.id), false, true, '')))[1]::text::int as n
  from fk cross join targets t
)
select * from counted where n > 0 order by id, tbl;

-- (3) 되돌리기용 값: 옮길 할 일, 접근 요청, Google 연결(토큰 칸 제외)
select 'task' as kind, id, assignee_id as user_id, status, source_type, created_at from public.app_tasks
 where assignee_id in (select u.id from auth.users u
   where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
     and u.created_at < timestamptz '2026-09-21 00:00:00+00');
select * from public.app_access_requests
 where user_id in (select u.id from auth.users u
   where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
     and u.created_at < timestamptz '2026-09-21 00:00:00+00');
select user_id, calendar_ids, enabled, connected_at, updated_at from public.app_google_calendar_connections
 where user_id in (select u.id from auth.users u
   where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
     and u.created_at < timestamptz '2026-09-21 00:00:00+00');
```

기대값: (1) 3행, `owner_count` 1. (2) 1.2 표와 같은 행 수, `rtw_*` 없음. (3) 할 일 1, 접근 요청 2, Google 연결 1.

#### A. 옮길 자료: 계정 B에게 배정된 할 일을 본인에게 (되돌릴 수 있음)

```sql
-- 계정-1 A. 계정 B에게 배정된 할 일 1건의 담당자를 본인으로 바꾼다.
begin;

do $$
declare v_targets int; v_owners int; v_rtw int; v_tasks int;
begin
  select count(*) into v_owners from public.app_workspace_members where role = 'owner';
  select count(*) into v_targets from auth.users u
   where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
     and u.created_at < timestamptz '2026-09-21 00:00:00+00';
  select count(*) into v_tasks from public.app_tasks
   where assignee_id in (select u.id from auth.users u
     where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
       and u.created_at < timestamptz '2026-09-21 00:00:00+00');
  select (select count(*) from public.rtw_notes where owner_id in (select u.id from auth.users u
            where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
              and u.created_at < timestamptz '2026-09-21 00:00:00+00'))
       + (select count(*) from public.rtw_records where owner_id in (select u.id from auth.users u
            where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
              and u.created_at < timestamptz '2026-09-21 00:00:00+00'))
    into v_rtw;
  if v_owners <> 1 or v_targets <> 3 or v_tasks <> 1 or v_rtw <> 0 then
    raise exception '사전 조건 불일치: owner=%, targets=%, tasks=%, rtw=%', v_owners, v_targets, v_tasks, v_rtw;
  end if;
end $$;

update public.app_tasks
   set assignee_id = (select user_id from public.app_workspace_members where role = 'owner')
 where assignee_id in (select u.id from auth.users u
   where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
     and u.created_at < timestamptz '2026-09-21 00:00:00+00');
-- 기대: UPDATE 1

commit;
```

- 영향: 이 할 일(미완료 회의 후속 1건)이 본인 할 일 목록에 새로 보인다. 할 일 데이터는 29에서 보관 없이 삭제 예정이므로 그때 함께 사라진다.
- 되돌리기(계정 B 삭제 전까지만 가능): `update public.app_tasks set assignee_id = '<0단계 (3) task의 user_id>' where id = '<0단계 (3) task의 id>';`

#### B. 접근 요청 거절 후 삭제, 남은 Google 연결 정보 삭제

```sql
-- 계정-1 B. 대기 중 접근 요청 거절 → 대상 계정의 접근 요청 전부 삭제 → Google 연결 정보 삭제.
begin;

do $$
declare v_targets int; v_owners int; v_req int; v_pending int; v_gcal int;
begin
  select count(*) into v_owners from public.app_workspace_members where role = 'owner';
  select count(*) into v_targets from auth.users u
   where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
     and u.created_at < timestamptz '2026-09-21 00:00:00+00';
  select count(*), count(*) filter (where status = 'pending') into v_req, v_pending
    from public.app_access_requests
   where user_id in (select u.id from auth.users u
     where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
       and u.created_at < timestamptz '2026-09-21 00:00:00+00');
  select count(*) into v_gcal from public.app_google_calendar_connections
   where user_id in (select u.id from auth.users u
     where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
       and u.created_at < timestamptz '2026-09-21 00:00:00+00');
  if v_owners <> 1 or v_targets <> 3 or v_req <> 2 or v_pending <> 1 or v_gcal <> 1 then
    raise exception '사전 조건 불일치: owner=%, targets=%, requests=%, pending=%, gcal=%', v_owners, v_targets, v_req, v_pending, v_gcal;
  end if;
end $$;

-- 1) 대기 중 요청 거절 (사용자 결정 "거절 후 삭제")
update public.app_access_requests
   set status = 'rejected', reviewed_at = now(),
       reviewed_by = (select user_id from public.app_workspace_members where role = 'owner')
 where status = 'pending'
   and user_id in (select u.id from auth.users u
     where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
       and u.created_at < timestamptz '2026-09-21 00:00:00+00');
-- 기대: UPDATE 1

-- 2) 대상 계정의 접근 요청 삭제 (거절 1 + 승인 1)
delete from public.app_access_requests
 where user_id in (select u.id from auth.users u
   where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
     and u.created_at < timestamptz '2026-09-21 00:00:00+00');
-- 기대: DELETE 2

-- 3) 남은 Google 연결 정보(토큰)와 만료된 연결 시도 흔적 삭제
delete from public.app_google_calendar_connections
 where user_id in (select u.id from auth.users u
   where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
     and u.created_at < timestamptz '2026-09-21 00:00:00+00');
-- 기대: DELETE 1
delete from public.app_google_oauth_states
 where user_id in (select u.id from auth.users u
   where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
     and u.created_at < timestamptz '2026-09-21 00:00:00+00');
-- 기대: DELETE 1

commit;
```

- 되돌리기: 접근 요청은 0단계 (3) CSV 값으로 다시 넣을 수 있다(계정 삭제 전까지). 대기 요청을 되살리면 승인 RPC가 아직 살아 있어(조사 문서 1.2) 구성원이 늘 수 있으므로 되살리지 않는 것을 권장한다.
- Google 연결은 토큰 칸을 CSV에 받지 않으므로 행으로 되돌리지 않는다. 필요하면 계정 B로 다시 로그인해 Google 연결을 새로 하면 된다(계정 삭제 전까지).
- Google 쪽에 남은 허용: 계정 B의 Google 계정 보안 설정 "연결된 앱·서비스"에서 이 앱의 접근을 해제하면 Google 쪽 토큰도 무효가 된다. 선택 사항(계정 B는 사용자 본인 소유).

#### 사후 확인 1 (A·B 뒤, 읽기 전용)

```sql
select
  (select count(*) from public.app_tasks where assignee_id in (select u.id from auth.users u
     where u.id not in (select user_id from public.app_workspace_members where role = 'owner')
       and u.created_at < timestamptz '2026-09-21 00:00:00+00')) as tasks_left,          -- 0
  (select count(*) from public.app_access_requests) as access_requests_total,           -- 0
  (select count(*) from public.app_google_calendar_connections) as gcal_total,          -- 1 (본인)
  (select count(*) from public.app_google_calendar_connections
    where user_id = (select user_id from public.app_workspace_members where role = 'owner')) as gcal_owner; -- 1
```

#### C. 계정 삭제 (Supabase 화면, 되돌릴 수 없음)

1. 사후 확인 1이 기대값인지 확인한다. 아니면 멈춘다.
2. Supabase 대시보드 → 프로젝트 → Authentication → Users.
3. 0단계 (1) 결과의 이메일 3개를 목록에서 찾는다. 본인 이메일 행은 절대 선택하지 않는다.
4. 한 계정씩: 행 오른쪽 ⋯ → Delete user → 확인. 세 번 반복한다.
5. 한 계정이라도 오류가 나면 나머지를 멈추고 오류 문구를 보고한다(예상 가능한 원인은 A를 건너뛴 경우의 할 일 트리거 거부).

함께 사라지는 것(DB가 자동 처리): 계정 B·C·D의 프로필, 계정 C의 구성원 행, 계정 B의 쪽지 5건, 세션·로그인 연결.

#### 사후 확인 2 (C 뒤, 읽기 전용)

```sql
select
  (select count(*) from auth.users) as users_total,                                   -- 1 (조사 뒤 새 가입이 없다면)
  (select count(*) from auth.users where created_at < timestamptz '2026-09-21 00:00:00+00') as users_before_0921, -- 1
  (select count(*) from public.app_workspace_members) as members_total,                -- 1
  (select role from public.app_workspace_members) as owner_role,                       -- owner
  (select count(*) from public.app_profiles) as profiles_total,                        -- 1
  (select count(*) from public.app_direct_messages) as dm_total,                       -- 0
  (select count(*) from public.app_tasks) as tasks_total;                              -- 58 (변화 없음)
```

추가로 본인 계정으로 Web2에 로그인해 일정·할 일·Google 연결이 그대로인지 확인한다.

### 1.5 적용 순서와 되돌릴 수 없는 단계

| 순서 | 단계 | 되돌리기 | 이 단계 전 복구 준비 |
| --- | --- | --- | --- |
| 0 | 사전 확인(읽기) | 해당 없음 | 결과 3개 CSV 저장 |
| 1 | A: 할 일 담당자를 본인으로 | 가능(계정 B 삭제 전까지, CSV 값으로 되돌림) | 0단계 CSV |
| 2 | B: 접근 요청 거절·삭제, Google 연결 삭제 | 접근 요청은 CSV로 재입력 가능(권장 안 함). Google 연결은 재연결로만 | 0단계 CSV |
| 3 | 사후 확인 1 | 해당 없음 | |
| 4 | **C: 계정 3개 삭제** | **불가.** 같은 Google 계정으로 다시 로그인하면 새 계정이 생기지만 이전 쪽지·프로필은 돌아오지 않는다. 행 복구 경로는 Supabase 자동 백업(요금제에 따라 기간 다름)뿐 | 사후 확인 1 기대값 확인 |
| 5 | 사후 확인 2 + 본인 로그인 확인 | 해당 없음 | |

- 30(보조 Auth 계정 제거) 행의 범위를 이 작업이 앞당겨 처리한다. 20·27·28의 코드·DB 정리(가입 화면, 승인 RPC, 역할 체계)는 그대로 남는다. 계정이 없어져도 승인 RPC 등은 27에서 지운다.

## 2. (예비) 계정 삭제 뒤 남는 협업 구조

계정 삭제는 행만 지운다. 아래는 그대로 남으며 기존 담당 작업에서 처리한다.

- 가입 화면·접근 요청 화면(20), 승인·초대 RPC(27), `app_workspace_members` 역할 체계와 고정 이메일 트리거(28), 할 일 담당자 트리거(29).
- 가입은 여전히 열려 있다(Auth 설정은 읽생기와 공유라 바꾸지 않음). 새 Google 로그인 계정이 생기면 FIRST ADMIN 화면이 보일 수 있다(20에서 제거).

## 3. ENV-6: 저장소에 원본 없는 Edge Function

### 3.1 방법

- 배포 목록: `supabase functions list`(읽기 전용) 38개.
- 원본 대조: 이 저장소와 read-think-write 저장소의 원격 `main` `supabase/functions/` 목록, 그리고 두 저장소 전체 git 이력(`git log --all -- supabase/functions/<이름>`).
- 호출 기록: `function_edge_logs`를 하루 단위로 2026-09-12 21:00 ~ 09-26 21:00 KST 범위 조회. 그 이전은 조회하지 않았다.
- 사용처: 두 저장소 원격 `main`에서 `functions/v1/<이름>` 참조 검색.

### 3.2 원본 있는 함수 (21개, 대조만)

이 저장소 15: `document-actions`, `document-ai-index`, `event-media`, `google-calendar`, `google-tasks`, `library-files`, `meeting-ai-draft`, `meeting-ai-ingest`, `meeting-files`, `page-ai-draft`, `pc0921-board`, `public-page-edit`, `public-policy-drive`, `team-ai`, `workspace-drive`.
읽생기 저장소 6: `rtw-ai-read`, `rtw-claim-personal-owner`, `rtw-delete-account`, `rtw-personal-write`, `rtw-recommend`, `rtw-url-import`.

### 3.3 원본 없는 함수 (17개)

시각은 KST. "마지막 배포"는 함수 목록의 갱신 시각. 17개 모두 두 저장소 git 전체 이력에 없다(한 번도 저장소에 들어온 적 없음).

| 이름 | 버전 | 마지막 배포 | verify_jwt | 최근 호출(조회 범위 내) | 사용처(원격 main) | 제품 | 판정 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `auth-handoff` | v3 | 09-12 09:13 | false | 마지막 09-22 00:53. 9/12~13 54회, 이후 드묾 | `app/loader-v2.js`가 부르는 `auth-handoff-client.js`, `native-auth-bridge.js`(안드로이드 앱 로그인 전달) | Web2 | **원본 복구 필요**. 활성 로그인 경로 |
| `rtw-beta-status` | v1 | 09-21 13:35 | false | 마지막 09-26 20:14. 매일 호출 | 읽생기 `src/api.js`, 테스트 2개 | 읽생기 | **원본 복구 필요**(읽생기 저장소) |
| `rail-1007-plan` | v6 | 09-13 06:27 | false | 마지막 09-22 16:18. 9/13 440회 | `rail-council/2026-1007-delegates/`, `assets/rail-1007-controls.js` | 공개 페이지(철도 10/7 대의원) | **원본 복구 필요**. 행사일이 아직 오지 않음 |
| `rail-declaration-comments` | v3 | 09-11 03:57 | false | 마지막 09-21 22:31 | `rail-council/2026-retreat-declaration/` | 공개 페이지 | **원본 복구 필요**(페이지 유지 시) |
| `rail-declaration-content` | v4 | 09-11 04:10 | false | 마지막 09-14 23:32 | 같은 페이지 | 공개 페이지 | **원본 복구 필요**(페이지 유지 시) |
| `pc0914-checklist` | v4 | 09-11 15:41 | false | 마지막 09-24 11:06 | `workforce/press-conference-0914/` | 공개 페이지(9/14 기자회견) | **원본 복구 필요**(페이지 유지 시) |
| `press-conference-files` | v4 | 09-14 08:49 | false | 마지막 09-24 11:06 | `assets/press-0914-tools.js`(위 페이지) | 공개 페이지 | **원본 복구 필요**(페이지 유지 시) |
| `joint-struggle-files` | v3 | 09-12 23:08 | false | 마지막 09-21 17:03 | `workforce/joint-struggle-0921/` | 공개 페이지(9/21 공동투쟁) | **원본 복구 필요**(페이지 유지 시) |
| `wedding-mc-shared` | v2 | 09-13 22:25 | false | 마지막 09-25 04:58. 9/15 216회 | `wedding/mc-script/` | 개인 공개 페이지 | 사용자 결정: 페이지 유지면 원본 복구, 행사 끝났으면 페이지와 함께 삭제 후보 |
| `kptu-board-probe` | v2 | 09-18 22:00 | false | 마지막 09-18 22:05, 1회 | `kptu-probe/`(시험 페이지) | 시험용 | 사용자 결정: 시험 페이지와 함께 삭제 후보 |
| `push-notifications` | v4 | 09-25 08:38 | true | 마지막 09-25 08:37. 이후 0회 | 앱 코드 없음(#272에서 호출 제거, 09-25 08:38 merge). 테스트 모의 응답만 | Web2(제거된 알림) | **삭제 후보**. 제거 migration `20260925060000_remove_web2_push_delivery` 적용됨 |
| `rtw-owner-claim` | v3 | 09-18 21:57 | false | 마지막 09-18 22:17. 9/17~18 약 1,540회 집중 | 없음 | 읽생기(옛 버전) | **삭제 후보**. `rtw-claim-personal-owner`로 대체된 것으로 보임(추정) |
| `rtw-owner-setup` | v4 | 09-17 20:44 | false | 마지막 09-17 20:30 | 없음 | 읽생기(옛 버전) | **삭제 후보** |
| `rail-1007-page` | v3 | 09-13 05:41 | false | 마지막 09-13 05:43 | 없음 | 공개 페이지 초기 시도 | **삭제 후보** |
| `rail-1007-page-v2` | v3 | 09-13 05:42 | false | 마지막 09-13 05:43 | 없음 | 공개 페이지 초기 시도 | **삭제 후보** |
| `pc0914-storage-test` | v5 | 09-18 09:05 | true | 마지막 09-14 08:47 | 없음 | 시험용 | **삭제 후보** |
| `pc-file-test` | v3 | 09-18 09:05 | true | 조회 범위 내 0회 | 없음 | 시험용 | **삭제 후보** |

집계: 원본 복구 필요 8(`auth-handoff`, `rtw-beta-status`, `rail-1007-plan`, `rail-declaration-comments`, `rail-declaration-content`, `pc0914-checklist`, `press-conference-files`, `joint-struggle-files`), 사용자 결정 2(`wedding-mc-shared`, `kptu-board-probe`), 삭제 후보 7.

### 3.4 원본 복구 방법(제안, 실행 안 함)

- 배포된 코드를 내려받아 저장소에 커밋한다: `supabase functions download <이름> --project-ref <ref>`(읽기 전용, 배포 상태 변경 없음). 로컬 세션에서 한다. `supabase/.temp`는 커밋하지 않는다.
- 내려받은 코드에 비밀값이 박혀 있지 않은지 확인한 뒤 커밋한다(공개 저장소).
- `auth-handoff`는 verify_jwt=false로 로그인 토큰을 봉인·해제하는 함수다. 원본을 들여온 뒤 보안 검토(토큰 수명·재사용 방지)를 권장한다.
- `rtw-beta-status`는 읽생기 저장소로 복구한다(RTW 작업).
- 공개 페이지 함수 6개는 모두 verify_jwt=false다. 페이지를 내릴지 먼저 정하면 복구 대상이 줄어든다.

### 3.5 삭제 절차(제안, 실행 안 함)

- 삭제는 되돌릴 수 없다(같은 이름으로 재배포하려면 원본이 필요한데 원본이 없다). 삭제 전에 3.4의 download로 코드를 PC에 보관한다.
- 명령은 함수 이름을 지정한 `supabase functions delete <이름>`, 로컬 세션 manual mode. 정지 지점으로 다룬다.
- 삭제 후 해당 이름으로 요청하면 404가 나는지 확인한다.

## 4. 범위 밖 발견사항 (고치지 않음)

1. `app_tasks`의 담당자 트리거 때문에, 비구성원·삭제된 사용자에게 배정된 할 일은 어떤 수정도 할 수 없다(담당자 NULL 거부). 29에서 표를 지우면 사라지는 문제.
2. 공개 페이지용 함수 대부분이 verify_jwt=false이고 원본이 없어 권한 검사를 검토할 수 없다. 원본 복구 뒤 점검 필요.
3. `rtw-owner-claim`이 9/17~18에 하루 1,275회까지 호출됐다. 당시 읽생기 쪽 반복 호출로 보인다(추정). 현재는 0회.
