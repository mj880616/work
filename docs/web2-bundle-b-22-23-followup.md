# 묶음B PR 2 — 일정 참석자·프로젝트 멤버 제거와 DB·Edge 후속 계획

📱 폰 가능: 이 문서 검토·앱 코드 작업. 후속 운영 조회는 💻 PC 로컬 필요. Edge 배포·DB 적용 준비는 Claude Code 로컬만, SQL 적용은 사용자 직접 실행.

기준: 2026-09-27, `main a754ab6a9d5b098714f8a992266e1685004cc66f`, roadmap 22·23. 규칙 원문은 [AGENTS.md](../AGENTS.md), 선행 조사는 [묶음A](web2-bundle-a-investigation.md)다.

## 1. 이번 PR의 경계와 증거

- 앱의 잔여 참석자 요청·프로젝트 멤버 조회/상태/권한 분기와 브라우저 테스트의 성공 모의 응답을 제거한다. 로그인·소유자 권한·프로젝트/일정/회의/자료 연결을 보존한다.
- DB·Edge 소스와 SQL 파일은 변경하지 않는다. SQL 실행, 운영 데이터 조회·변경, Edge 배포, migration 생성은 하지 않았다. 아래 SQL은 **후속 담당자가 검토할 문서 내 초안**이며 이번 PR에서 실행하지 않는다.
- 현재 소스·migration·기존 snapshot·테스트를 조사한 목록이다. 운영 DB의 모든 정책·트리거·함수 목록은 저장소에 완전하게 들어 있지 않다. **운영 전체 목록 확인 완료라는 뜻이 아니다.** 4절의 사전 감사 결과로 목록을 확정하기 전에는 삭제를 승인할 수 없다.
- 묶음A에 기록된 0행, 배포 버전, 과거 로그는 과거 관찰이다. 이번 작업에서 현재값으로 재확인하지 않았다. 빈 표여도 작성자 자동 생성 트리거가 새 행을 만들 수 있다.

## 2. 앱·Web1 참조 조사와 처리

| 위치 | 시작 시 사용처 | 이번 처리 |
| --- | --- | --- |
| `app/team.js`, `calendar-plus.js`, `calendar-interactions-v2.js`, `project-system-v3.js`, `index.html` | 활성 일정·프로젝트 경로. 대상 3표 및 초대 응답 RPC 호출 없음 | 기존 화면·저장 경로 유지. 실제 셸 회귀 테스트에서 금지 요청이 없는지 확인 |
| `app/calendar-move.js` | 비활성. 팀→개인 이동 및 Google 이동 전 `app_event_attendees` 삭제 | 참석자 삭제 2곳과 해당 분기에만 쓰는 상태 제거. 일정 이동 자체 유지 |
| `app/legacy/calendar-edit-actions.js` | 비활성. 일정 삭제 전에 참석자 삭제 | 참석자 삭제 제거. 일정 자체 삭제 유지 |
| `app/project-templates.js` | 비활성. 템플릿 편집 전에 `app_space_members` role 조회 | 조회 제거, 프로젝트 owner만 편집 |
| `app/project-suborganization-links.js` | 비활성. `app_space_members` 조회, 역할 Map/rank로 프로젝트 편집 허용 | 조회·상태·역할 분기 제거, 프로젝트 owner만 편집. 담당조직 권한과 연결 RPC는 유지 |
| `team-profile-view.js`, 프로젝트 초대 알림 UI | 현재 파일 없음. 앞선 PR에서 제거됨 | 되살리지 않음 |
| `calendar-move` fixture/spec, `project-suborganization-links` fixture/spec | 레거시 파일을 직접 불러오는 테스트 | 참석자 성공 응답·멤버 빈 응답 제거, 호출이 없어도 이동/연결 관리가 되는지 검증. 템플릿 소유자/비소유자 검증 포함 |
| `project-system-v3.spec.mjs`, `workspace.spec.mjs`, `workflow-ai-model.spec.mjs` | 참석자·멤버·초대 CRUD 모의 응답 및 상태 | 제거. 공용 request 감시 helper가 호출 재발을 실패로 처리 |
| `calendar-personalization.spec.mjs`, `project-v3-structure.spec.mjs` | 활성 경로의 참석자 부재·레거시 로더 부재 검사 | 유지 |
| `tests/security/document-edge-authz.test.mjs`, `task12b-edge-sole-owner.test.mjs`, `task12a-sole-owner-migration.test.mjs` | 보존하는 서버 권한/역사적 migration의 표 참조 | 유지. 앱 fixture와 구분 |
| `supabase/tests/authz_project_invitations.sql`, `authz_sole_owner.sql`, `authz_project_owner_only.sql`, `authz_membership_invites.sql` 및 `supabase/local-verify/*` | 남아 있는 DB 객체·권한 회귀, baseline 준비/지문 | 유지. 실행하지 않음. 표 제거 단계에서 별도 개정 |

`app_workspace_members`는 이번 대상 `app_space_members`와 다르다. 전자는 앱 부팅·소유자 확인에 여전히 필요하며 20-DB·28까지 유지한다. 회의의 `attendee_count`는 인원 수이며 일정 참석자 계정 관계와 다르므로 유지한다. 일정 댓글·사진·조직 연결도 유지한다.

**Web1:** 저장소 전체에서 대상 표 3개, `app_respond_project_invitation`, 일정 작성자 참석자 트리거 이름을 검색했다. 루트 공개 페이지·`p/`·`public-policy/` 및 Web1 Edge에서 직접 호출은 발견되지 않았다. Web1 때문에 남기는 해당 앱 호출은 없다. 다만 공개 RPC의 운영 정의·간접 의존성은 후속 감사 대상이다. `app_public_post(text)`·`public-page-edit`·`public-policy-drive`와 Web1 투영은 유지한다.

**캐시:** 변경 앱 파일 4개는 `app.js`·`loader-v2.js`·`view-loader.js`·HTML·CSS의 운영 로더에서 불러오지 않는다. 따라서 올릴 운영 `?v=`는 없으며 로더를 무의미하게 수정하지 않는다. 직접 불러오는 테스트는 `calendar-move.js?v=2`, `project-suborganization-links.js?fixture=2`로 갱신한다. 파일 전체 폐기는 기존 Task 31에 남긴다.

## 3. DB·RPC·정책·트리거·Edge 의존성 목록

### 3.1 표와 함수

| 객체 | 확인 근거·현재 소스 사용처 | 후속 판단 |
| --- | --- | --- |
| `public.app_event_attendees` | `team-ai` personal 문맥; `authz_sole_owner.sql`; Task 12a 정책; 묶음A의 작성자 자동 생성 트리거 | 삭제 후보. team-ai 대체 조회와 트리거 제거가 선행 |
| `public.app_space_members` | 회의 Edge의 미호출 helper `meeting-files.canEditProject`, `meeting-ai-draft.canEditMeeting`; 초대 수락 RPC; DB 권한 테스트 | 삭제 후보. 운영 배포 원문 대조 및 회의 Edge 잔여 참조와 초대 RPC 정리 선행 |
| `public.app_project_invitations` | 초대 응답 RPC·workspace 일관성 트리거·DB 초대 테스트 | 삭제 후보. RPC 및 정책/트리거 감사 선행 |
| `public.app_respond_project_invitation(uuid,boolean)` | `20260925060000_remove_web2_push_delivery.sql`: 초대 행 잠금, 수락 시 멤버 upsert, 상태 갱신. Task 12a가 authenticated 실행권한 회수 | 삭제 후보. service_role 포함 전체 호출자·ACL 확인. 권한 복원 금지 |
| 작성자 참석자 생성 함수 | 묶음A·원장에 존재/역할 기록. 저장소에 함수 원문 없음 | 삭제 후보. 아래 트리거의 `tgfoid`로 schema·이름·signature·다른 사용처 확정 |
| `private.app_enforce_workspace_links()` | `20260916030032_enforce_workspace_reference_consistency.sql`의 여러 표 공용 트리거 함수 | **함수 유지**. 초대 표에 붙은 트리거만 제거 가능. 함수 내 참조는 정의 확인 후 좁게 검토 |
| `private.app_can_view_space(uuid)`, `app_can_edit_space(uuid)`, `app_can_manage_space(uuid)` | `20260923074619_web2_project_owner_only.sql`: `owner_id=auth.uid()` | 유지. 옛 이름만으로 삭제하지 않음 |
| `private.app_is_owner_event(uuid)`, `app_is_workspace_owner(uuid)` | Task 12a 참석자/일정 및 인접 데이터 정책의 소유자 확인 | 유지 |
| `app_space_in_workspace`, `app_event_in_workspace`, `app_user_in_workspace`, `app_is_workspace_member/admin`, `app_workspace_role`, `app_role_rank` | 일관성·역할 정책 공용 helper | 26·28에서 전체 호출자 확인. 이번 대상 표가 사라져도 일괄 삭제 금지 |
| `app_events`, `app_spaces`, `app_project_suborganizations`, 일정 댓글·사진·조직 연결 표 | 일정·프로젝트 원본 및 개인 업무 연결 | 유지 |

### 3.2 RLS·트리거·제약과 역사적 객체

| 객체 | 저장소에서 확인한 상태 | 후속 조건 |
| --- | --- | --- |
| `app_event_attendees.task12a_owner_all` | Task 12a: authenticated ALL, USING/WITH CHECK 모두 `private.app_is_owner_event(event_id)` | 표 제거와 함께 소멸. 표를 남기는 동안 그대로 유지 |
| 참석자 옛 정책 `app_event_attendees_delete/insert/scoped_read/update` | Task 12a 사전 snapshot에 존재. Task 12a는 기존 정책을 제거하고 owner 정책을 만듦 | 옛 정책을 rollback 기준으로 사용하지 않음 |
| `app_space_members`·`app_project_invitations`의 정책 | 묶음A에 `app_can_manage_space`·`app_is_workspace_member` 의존 기록. **정책명·전체 정의가 현재 저장소에 없음** | `pg_policies` 전량 수집 필수. 누락 없이 목록 확정 후에만 표 제거 |
| `app_spaces.app_spaces_scoped_read` | 9/18 정의는 멤버 참조, 9/23 migration이 owner-only로 교체 | 과거 정의를 현재 의존성으로 세지 않음. 운영 정의 대조 |
| `app_spaces.app_spaces_create` | 묶음A에 역할 등급 기반 정책 기록 | 28의 별도 변경 후보. 프로젝트 생성의 sole-owner 제한 검증 필요 |
| `app_events.trg_app_add_event_creator_attendee` | 묶음A·원장: 일정 생성마다 참석자 행 작성. trigger/function 원문 없음 | 삭제 후보. team-ai의 참석자 의존 제거 및 백업 후 제거 |
| `app_project_invitations.app_project_invitations_workspace_consistency` | 9/16 migration: BEFORE INSERT OR UPDATE → `private.app_enforce_workspace_links()` | 삭제 후보. 초대 표와 함께 제거. 공용 함수 유지 |
| `trg_app_notify_event_invite`, `trg_app_notify_project_invitation`, `app_notify_event_invite()`, `app_notify_project_invitation()` | 9/25 push 제거 migration에서 삭제 | 추가 삭제 후보로 세지 않음. 운영에 남아 있으면 drift로 중단 |
| 대상 표 FK·unique·index·기타 트리거·view·publication·ACL | 초기 DDL과 운영 catalog 전체가 저장소에 없음 | 들어오는/나가는 FK 모두, 관련 인덱스/제약/정책/trigger 원문 수집. CASCADE로 우회하지 않음 |

**직접 삭제 후보는 7개 단위:** 표 3개 + RPC 1개 + 작성자 생성 트리거 1개 + 그 함수 1개 + 초대 일관성 트리거 1개. 표에 종속된 정책·인덱스·제약 수는 이 숫자에 포함하지 않았으며, 전체 수는 26의 catalog 감사 후 확정한다. 변경 후보는 아래 Edge 3개와 `app_spaces_create` 등 공용 역할 정책이며 이번 PR에서 수정하지 않는다.

### 3.3 Edge와 공통 권한 경계

| Edge/경로 | 현재 저장소 참조 | 선행 작업 |
| --- | --- | --- |
| `team-ai` | `buildContext` personal 범위에서 `app_event_attendees` → `app_events!inner` 조회. `app_workspace_members`로 구성원/역할 확인, `app_tasks`도 조회 | 25에서 개인 일정 원본 조회로 전환. workspace·owner·기간 범위와 정렬/제한 검증. 참석자 부재로 개인 일정 문맥이 없어지지 않게 회귀 |
| `meeting-files` | 미호출 `canEditProject` helper에 `app_space_members.role` edit/manage 조회가 남음. 현재 handler는 사용자 RLS 조회 후 `workspaceRole(...)==='owner'` 확인 | 운영 배포본에서도 미호출인지 대조. 23-DB·Edge에서 잔여 helper 제거 및 보관 프로젝트 쓰기 거부를 신뢰 계층에서 검증 |
| `meeting-ai-draft` | 미호출 `canEditMeeting` helper에 `app_space_members.role` 조회가 남음. 현재 handler는 사용자 RLS 조회와 `app_workspace_members.role==='owner'` 확인 | 운영 배포본 대조 후 잔여 helper 정리. 회의/프로젝트 소유자와 보관 상태의 권한 행렬을 먼저 확정 |
| `library-files` | **현재 소스에는 `app_space_members` 없음.** `workspaceFor`·`canEditProject`가 `app_workspace_members.role==='owner'` 확인. 보관 status 확인은 없음 | 묶음A의 멤버 표 조회 설명과 다름. 멤버 표 삭제의 직접 blocker는 아니며 23의 보관 프로젝트 서버 거부·28의 역할 제거 대상 |
| 회의 Edge의 owner 확인, `_shared/meeting-auth.mjs` | 함수별 workspace 소유자 확인과 공통 401/403 오류 응답 | 유지. 후속 정리 시 이 소유자 확인을 우회하지 않음 |

`team-ai`의 메시지 `usage` NOT NULL 오류는 묶음A 2.2절의 과거 조사 결과이며 이번에 재현하지 않았다. 25에서 사용자·AI 메시지 모두의 저장 성공/오류 전달/재조회까지 검증한다. 참석자 의존만 없애고 기록 저장 실패를 완료로 처리하지 않는다.

## 4. 적용 전 목록 확정과 백업

후속 담당자가 Claude Code 로컬에서 read-only로 수행할 단계다. **이번에는 실행하지 않는다.** 조회는 데이터 원문·계정 식별자를 공개 문서에 남기지 않고, 객체 정의·집계·검증 결과만 기록한다.

1. 최신 main, 운영 migration 이력, 대상 Edge별 버전·verify_jwt·시각을 대조한다. 저장소 파일과 운영 함수 원문 차이를 확인한다. 원본/복구본이 없으면 중단한다.
2. 아래 catalog 조회와 전체 schema-only dump로 정책·함수·트리거·FK·뷰·grant·publication을 확정한다. 함수 문자열 참조는 `pg_depend`에 잡히지 않을 수 있으므로 정의 검색과 저장소 전체 검색을 함께 한다.
3. 대상 3표의 현재 행 수 및 무결성, 자동 참석자 생성 상태를 기록한다. 과거 0행을 근거로 데이터 백업을 생략하지 않는다.
4. 운영 변경 직전 읽기 전용 자격으로 schema/ACL/역할과 대상 표 데이터의 일관된 백업을 만든다. 사용자 승인 없는 운영 쓰기를 피하고, 자격증명은 보호된 환경/패스파일에만 두며 인자·로그에 넣지 않는다. 백업은 공개 저장소 밖 접근 제한 경로에 저장하고 SHA-256·시각·복구 검증 결과만 기록한다.
5. 격리 DB에서 현재 schema → 데이터 → 제약·인덱스 → owner/RLS/ACL/trigger 복원을 연습한다. 기존 snapshot의 오래된 넓은 권한을 복원하지 않는다. Auth·`rtw_*`·Web1 데이터를 운영 전체 dump로 덮어쓰지 않는다.

[Supabase 공식 복구 문서](https://supabase.com/docs/guides/self-hosting/restore-from-platform)는 역할·schema·data를 나누어 백업하고, Edge·Storage 파일은 별도 복구 대상으로 다룬다. 여기서는 대상 객체만 복원하는 별도 절차를 만들며 전체 서비스 복원 명령을 그대로 실행하지 않는다.

### 사전 감사 조회 초안 — 실행하지 않음

```sql
-- 후속 read-only 감사용. 정의 출력에는 민감한 상수가 있을 수 있어 비공개 보관.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (tablename in ('app_event_attendees','app_space_members','app_project_invitations','app_events','app_spaces')
    or concat_ws(' ',qual,with_check) ~ 'app_event_attendees|app_space_members|app_project_invitations')
order by tablename, policyname;

select c.oid::regclass as relation, t.tgname, t.tgfoid::regprocedure as function,
       t.tgenabled, pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where not t.tgisinternal and
 (c.oid in (to_regclass('public.app_events'),to_regclass('public.app_event_attendees'),
            to_regclass('public.app_space_members'),to_regclass('public.app_project_invitations'))
  or pg_get_functiondef(t.tgfoid) ~ 'app_event_attendees|app_space_members|app_project_invitations');

select p.oid::regprocedure as signature, p.prosecdef, p.proconfig, p.proacl,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.prokind='f'
  and p.prosrc ~ 'app_event_attendees|app_space_members|app_project_invitations';

select conrelid::regclass as relation, confrelid::regclass as referenced_relation,
       conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (to_regclass('public.app_event_attendees'),to_regclass('public.app_space_members'),to_regclass('public.app_project_invitations'))
   or confrelid in (to_regclass('public.app_event_attendees'),to_regclass('public.app_space_members'),to_regclass('public.app_project_invitations'));

select pg_describe_object(classid,objid,objsubid) as dependent,
       pg_describe_object(refclassid,refobjid,refobjsubid) as referenced, deptype
from pg_depend
where refclassid='pg_class'::regclass
  and refobjid in (to_regclass('public.app_event_attendees'),to_regclass('public.app_space_members'),to_regclass('public.app_project_invitations'));

select schemaname, viewname, definition from pg_views
where definition ~ 'app_event_attendees|app_space_members|app_project_invitations';
select schemaname, matviewname, definition from pg_matviews
where definition ~ 'app_event_attendees|app_space_members|app_project_invitations';
select schemaname, tablename, indexname, indexdef from pg_indexes
where schemaname='public' and tablename in ('app_event_attendees','app_space_members','app_project_invitations');
select pubname, schemaname, tablename from pg_publication_tables
where schemaname='public' and tablename in ('app_event_attendees','app_space_members','app_project_invitations');
select c.oid::regclass as relation, c.relrowsecurity, c.relforcerowsecurity,
       c.relowner::regrole as owner, c.relacl
from pg_class c where c.oid in (to_regclass('public.app_event_attendees'),to_regclass('public.app_space_members'),to_regclass('public.app_project_invitations'));
```

추가로 함수 간 간접 호출을 `pg_depend`와 정의 검색으로 추적한다. `aclexplode`와 `has_function_privilege`로 PUBLIC·anon·authenticated·service_role의 실효 권한을 확정하고 기본 ACL도 보관한다.

## 5. 단계별 적용·사전 백업·복구·검증

| 단계 | 적용 전 백업/조건 | 적용과 확인 | 복구 경로 |
| --- | --- | --- | --- |
| A 앱 제거(이번 PR) | 기준 main SHA, 앱·테스트 Git 이력 | CI → 사용자 merge 승인 → 배포 후 일정/프로젝트 확인. DB·Edge는 유지 | 이 PR을 revert하는 별도 PR. 운영 로더에 새로 넣지 않음 |
| B 26 감사 확정 | 4절 schema/데이터/ACL 백업과 복구 연습 | 전체 객체·간접 Web1·RTW 의존 확정. 모르는 정책/트리거가 있으면 중단 | 조회만 하므로 적용 복구 없음 |
| C Edge 참조 전환 | 대상 함수의 현재 원본·버전·verify_jwt, 설정 항목명 목록, 이전 commit 확보. 데이터 생성 없이 사전 권한 검사 | 25의 team-ai 및 23의 회의 Edge 수정/테스트 후 사용자 승인. Claude Code 로컬에서 함수별 배포. owner 성공/비로그인 401/비소유자 거부, OPTIONS/CORS, 보관 프로젝트 쓰기 거부, AI 문맥 유지 | 표가 아직 있을 때 이전 commit을 동일 함수명·동일 verify_jwt로 재배포. 버전·거부 응답 재검증 |
| D 작성자 트리거 정지 | **변경 직전** 참석자 데이터와 트리거/함수 정의·소유자·ACL 재백업. 모든 Edge 참조 전환 확인 | 사용자 SQL Editor에서 승인된 main SQL 적용. 작성자 트리거 → 다른 참조 없는 생성 함수 순. 소유자 일정 저장은 성공하고 참석자 행은 늘지 않음을 격리 DB에서 먼저 검증 | 생성 함수 원문/owner/ACL → 트리거 순 복원. 정지 중 생성된 일정은 자동 소급되지 않으므로 백업 이후 차이를 별도 검토; 무승인 참석자 재생성 금지 |
| E 초대·관계 표 정리 | **변경 직전** 3표 데이터·제약·정책·인덱스·트리거·RPC/ACL 재백업, 외부 호출 없음 확인 | 초대 RPC → 초대 표 트리거 → 초대 표 → 멤버 표, 참석자 표는 D 뒤 제거. 의존성이 발견되면 중단하며 CASCADE 금지. 단계별 트랜잭션/검증 | 표 정의 → 데이터 → 제약/인덱스 → RLS/owner/ACL → RPC/트리거 복원. 표 복원 검증 이후에만 옛 Edge 복귀. 공유 함수/권한을 과거 상태로 일괄 복원하지 않음 |
| F 20-DB·27~29 연계 | 각 작업 별도 승인·snapshot·rollback; 공유 Auth/RTW 영향 확인 | 가입·초대 RPC/역할 및 할 일 배정 체계 별도 정리. 이번 3표 제거와 한 번에 묶지 않음 | 작업별 대상 객체만 복원; 운영 전체 DB 되감기 금지 |

DB 적용을 준비할 때는 AGENTS.md의 일상어 3줄·승인·SQL 끝 `commit;`·Success 확인 절차를 따른다. 실제 migration은 후속 승인 작업에서만 생성하며, 적용 SQL에 해당 파일명과 일치하는 이력 insert를 `commit;` 직전에 포함한다. `db push`·`migration repair`는 사용하지 않는다. 실패한 트랜잭션은 rollback하고 다음 단계로 진행하지 않는다.

### 삭제 SQL 검토 초안 — 실행 금지, 적용본 아님

```sql
-- C 완료 및 D 백업/복구 검증 뒤에만 별도 migration에서 검토할 단위.
drop trigger trg_app_add_event_creator_attendee on public.app_events;
-- 생성 함수 DROP은 tgfoid로 확인한 정확한 signature와 모든 호출자를 감사한 뒤 작성.

-- E 단계. 각 대상 존재/정의/의존성 일치가 확인되어야 함. CASCADE 금지.
drop function public.app_respond_project_invitation(uuid,boolean);
drop trigger app_project_invitations_workspace_consistency on public.app_project_invitations;
drop table public.app_project_invitations;
drop table public.app_space_members;
drop table public.app_event_attendees;
```

위 조각에는 실제 백업 대조·가드·이력 insert·트랜잭션이 없으므로 SQL Editor에 붙여 넣지 않는다. 객체가 이미 없거나 definition이 다르면 `IF EXISTS`로 숨기지 말고 감사 목록을 갱신한다.

### 적용 후 검증 조회 초안 — 이번에는 실행하지 않음

```sql
select to_regclass('public.app_event_attendees') as attendees,
       to_regclass('public.app_space_members') as members,
       to_regclass('public.app_project_invitations') as invitations,
       to_regprocedure('public.app_respond_project_invitation(uuid,boolean)') as invitation_rpc;
-- E 완료 시 모두 NULL. D만 완료한 단계에서는 표/RPC는 여전히 존재해야 함.
select tgname from pg_trigger
where tgrelid=to_regclass('public.app_events')
  and tgname='trg_app_add_event_creator_attendee'; -- D 이후 0행
select p.oid::regprocedure as stale_reference
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.prokind='f'
  and p.prosrc ~ 'app_event_attendees|app_space_members|app_project_invitations';
-- E 이후 0행 기대. 잔여는 정의를 검토하고 해결 전 완료로 보고하지 않음.
```

4절의 정책·view·의존성 검색도 반복한다. 부모 `app_events`·`app_spaces` 및 연결 데이터의 변경 전후 집계/무결성, 보호할 공용 함수·Web1 RPC의 signature와 ACL을 대조한다. SQL 조회만으로 완료하지 않고 격리 권한 행렬(anon·비소유자·owner·보관 프로젝트), 배포 자산과 소유자 브라우저 동작을 확인한다. 운영 검증 중 데이터를 만드는 테스트는 별도 사용자 승인 없이는 수행하지 않는다.

## 6. 연결 작업과 사용자 확인

- **20-DB·27:** 가입/초대/접근요청 RPC 및 표와 초대 응답 RPC 정리를 함께 설계하되 적용 단계와 rollback은 분리한다.
- **26:** 이 문서의 미확정 정책명·생성 함수 signature·전체 FK/트리거/ACL/간접 호출자를 확정하는 선행 게이트다.
- **28:** `app_workspace_members`·역할 정책/함수와 고정 계정 트리거 정리. RTW의 탈퇴 판정 및 공유 Auth 영향은 읽생기 저장소에서 먼저 확인한다.
- **29:** `app_tasks` 제거는 team-ai·meeting-ai-draft의 할 일 조회 및 연결 정보 전환과 별도 연계한다. 참석자 표 제거만으로 끝났다고 보지 않는다.
- **25:** team-ai 개인 일정 문맥 전환과 메시지 저장 오류를 함께 검증한다. 기록 데이터나 토큰을 이번 앱 PR에서 건드리지 않는다.
- **31:** 이번에 만진 비활성 파일 전체의 삭제는 별도 작업이다. 단지 멤버 호출이 남아 있다는 이유로 템플릿·조직 연결·일정 이동 파일을 통째로 삭제하지 않았다.

배포 후 PC·모바일에서 소유자 로그인 → 일정 목록/상세/생성/수정/삭제 및 Google 일정 선택 → 프로젝트 목록/상세/수정, 하위 프로젝트·일정·회의·자료 연결을 확인한다. 참석자/멤버/초대 컨트롤 및 관련 API 요청이 없어야 한다. 비로그인 접근은 로그인으로 이동해야 한다. 이번 변경 파일은 비활성이므로 활성 화면의 새 디자인 변화는 기대하지 않는다.
