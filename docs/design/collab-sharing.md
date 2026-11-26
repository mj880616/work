# 묶인 사람끼리 공유 — 1단계 설계 (COLLAB-묶인사람끼리공유)

- 원장 행: COLLAB-묶인사람끼리공유 1단계 설계. 작업 세션 S62-38(Claude Code 웹).
- 기준: `main` `85fccbc98`(2026-11-15). 저장소만 읽었다. production은 조회하지 않았다(웹 세션, AGENTS.md 1절).
- 성격: **설계 문서만**. 코드·DB·Edge·AGENTS.md는 이 PR에서 바꾸지 않는다. AGENTS.md 5절 개정 문장은 2절에 안으로만 두고, 실제 반영은 1단계(묶기) 구현 PR에서 한다(규칙이 먼저 바뀌면 구현 전 세션이 새 공유 표 없이 옛 구조에 얹을 위험이 있음).
- 공개 저장소다. 예시의 노조·부서 이름은 모두 지어낸 것이고, 사람 이름·메일·id는 쓰지 않는다.

## 0. 이 문서와 앞 문서의 관계

| 문서 | 상태 | 이 문서와의 관계 |
| --- | --- | --- |
| `docs/design/collab-plan.md`(PR #2593, 열림) | 기획 초안. 공유 모양 A 보내기(복사본)·B 함께 보기·C 팀 공간. 11/15 11:23 사용자 확정 "추천대로" = D1을 A(사람이 눌러 보내는 복사본)로 좁힘, 첫 기능 주간보고 모으기 | **이어 쓴다(대체하지 않음).** A(주간보고 모으기)는 그대로 살아 있다. 이 문서는 11/15 23:04 이후 사용자 요청으로 **B(정한 묶음 안에서 함께 보기·쓰기)를 범위를 정해 연다.** C(팀 공간 = 한 작업공간에 여러 사람)는 계속 하지 않는다. #2593의 '조직 목록에서 고르기·명함 승인' 시안은 11/15 21:05 핫픽스로 버려졌고, 묶는 길은 이 문서 3절(초대 링크 + 같은 이름 수락 요청)로 정리한다 |
| `docs/design/multi-user-audit.md`(D1~D5, 2026-10-29) | 확정 | D1 '작업공간 사이 공유·열람 화면 없음'을 2절 문장으로 바꾼다. D2(운영자 전용 기능 서버 허용 표)·D3·D5는 그대로 |
| `docs/design/collab-structure-audit.md`·원장 Task 20-DB·22~31 | 옛 협업 구조 제거 진행 예정 | **옛 구조를 되살리지 않는다**(1절 판단). 제거 일정은 그대로 둔다 |

### 사용자 요청·결정 모음(요청함 'Web2 요청함 2')

| 시각 | 내용 |
| --- | --- |
| 11/15 21:05 | 조직 목록을 미리 만들지 않음(노조 정보 유출). 이름은 모두 직접 입력 — 핫픽스 |
| 11/15 21:11 | 묶는 길 ①: 처음 쓰는 사람이 만들고 초대 링크를 직접 보냄. 운영자 목록·찾기·명함 승인 없음 |
| 11/15 21:13 | 묶는 길 ②: 똑같은 이름이면 그 묶음 멤버에게 수락 요청 → 수락하면 묶임(있든 없든 같은 안내, 하루 횟수 제한) |
| 11/15 21:45 | 프로필 칸 노조명·부서명·이름·직책(모두 직접 입력). 같은 이름 비교 기준은 노조명+부서명 |
| 11/15 23:04~23:06 | 묶인 사람끼리 ① 캘린더 ② 사업 영역 ③ 담당조직 ④ 자료실 폴더 공유. 공유한 것마다 댓글, @멘션, 일정 초대·수락·거절 |
| 11/15 23:14 | 묶음은 두 단계 모두: 부서(노조명+부서명), 노조 전체(노조명). 한 사람이 둘 다 속할 수 있음. 묶음마다 관리자 |
| 11/15 23:21 | 관리자 = 지금 쓰는 Google 계정에 역할만 붙임(새 계정 없음). 공유는 개인 가입자도 씀 |
| 11/15 23:22 | '팀' → '부서'로 이름 바꿈 |
| 11/15 23:23 | 무료체험 기간에도 공유 기능 사용 가능 |
| 11/16 07:24 | 요금은 개인 요금제 하나. 부서·노조 요금제 폐기. 묶음 관리자 역할은 공유 기능용으로 유지(요금 내기 빠짐) |
| 11/16 08:29 | ① 담당조직 공유 = 조직 목록 + 그 조직 기록(조직 보고)까지 ② 권한은 공유마다 '보기만' 또는 '쓰기까지'(공유한 사람이 정함, 나중에 바꾸기 가능) |
| 지킬 것 | 공유는 항목마다 본인이 켬(기본 꺼짐)·언제든 끔 / 무리 밖으로 안 보임 / 운영자도 안 봄 / 텔레그램 수집·통화·가족 기록은 어떤 공유로도 안 열림 / 나가면 공유물 못 봄(자기가 올린 것은 자기 공간에 남음) |

## 1. 옛 협업 표를 되살릴까, 새로 만들까 — 새로 만든다

| 옛 구조 | 왜 쓰지 않나 |
| --- | --- |
| `app_workspace_members`의 owner 외 역할(편집자·보기 등) | 한 작업공간에 다른 사람을 넣는 구조(C 팀 공간)다. 넣는 순간 그 사람이 내 작업공간 **전체**(텔레그램 수집 포함)에 닿는 길이 생긴다. 이번 요청은 '항목마다 켜는 공유'라 모양부터 다르다. 또 소유자 판정 `private.app_is_workspace_owner`가 이 표의 owner 행에 기대므로, 같은 표에 공유 멤버를 섞으면 판정 뿌리가 흔들린다 |
| `app_invites`·접근 요청·역할 지정 RPC | 작업공간 초대용이고 Task 20-DB·27에서 지우기로 결정됨. 고정 계정 트리거 같은 알려진 문제가 있다 |
| 일정 참석자 표·트리거(Task 22) | 일정 원본은 Google Calendar다. 참석자는 구글 참석자 기능을 쓴다(9절) |
| 프로젝트 구성원·초대(Task 23) | 프로젝트(사업영역) 단위 구성원 표는 '묶음 단위 공유'와 맞지 않는다 |

- AGENTS.md 4절 "사용자가 폐기한 구조를 편의상 되살리지 않는다"를 지킨다. 새 표는 모두 `app_collab_` 접두어로 따로 만들고, 옛 구조 제거(Task 27·28)는 일정대로 간다. 서로 같은 표·함수를 쓰지 않으므로 순서 충돌이 없다.
- `app_workspace_members`의 owner 행(사람↔작업공간 연결)은 그대로 둔다. 공유 판정은 이 행을 **읽기만** 해서 "로그인한 사람의 작업공간"을 찾는다.

## 2. AGENTS.md 5절 개정안(1단계 구현 PR에서 반영)

바꾸는 곳 다섯 군데. 3절 보안 규칙(인증 우회·RLS 약화·anon/PUBLIC 확대 금지 등)은 한 글자도 바꾸지 않는다.

**① 5절 첫 문단** — 지금: "It is not a shared team database, a collaboration product, or a public site: there is no cross-workspace view."
→ 바꿈:

> It is not a shared team database or a public site. Each workspace stays owner-only. The only cross-workspace paths are (a) a copy that a person sends by pressing a button (COLLAB-함께쓰기, 2026-11-15 사용자 확정 "추천대로"), and (b) an item that its owner has turned on for sharing with a group they belong to (COLLAB-묶인사람끼리공유, 2026-11-15·11-16 사용자 결정). Sharing is off by default, chosen per item, can be turned off at any time, is visible only to current members of that group, and is enforced only by the server (`private.app_collab_*` functions); there is no other cross-workspace view.

**② D1 한국어 문단** — 지금: "한 사람에 작업공간 하나, 작업공간 사이 공유·열람 화면은 만들지 않는다."
→ 바꿈:

> 한 사람에 작업공간 하나는 그대로다. 작업공간 사이에는 **본인이 켠 공유만, 묶인 무리(부서·노조 묶음) 안에서만, 서버 권한으로** 보인다(2026-11-15 사용자 "팀원 혹은 같은 노조 사람들끼리 공유 캘린더 공유 / 같은 사업 영역 공유 / 같은 조직 공유 / 자료실 내 공유 폴더 공유", 11-16 사용자 결정 "담당조직은 조직 보고 기록까지, 권한은 공유마다 보기만/쓰기까지"). 공유는 항목마다 기본 꺼짐이고 언제든 끈다. 공유 종류는 캘린더·사업 영역·담당조직(조직 보고 포함)·자료실 폴더 네 가지뿐이며, 텔레그램 수집·통화·가족 기록은 어떤 공유로도 열리지 않는다(서버가 거절, 시험으로 지킴). 무리에서 나가면 그 무리 공유물을 못 본다. 운영자도 공유물 내용을 보지 않는다(3절 '남의 기록 안 보기').

**③ sign-up 문단 끝** — 지금: "never let one workspace read or write another workspace's data or Google Drive connection"
→ 바꿈: "never let one workspace read or write another workspace's data except through the group-share functions in `docs/design/collab-sharing.md`, and never let anyone use another person's Google Drive or Calendar connection to read on their behalf"

**④ owner-only 문단 뒤에 한 줄 추가**:

> Existing owner-only policies are never widened for sharing. Shared reads and writes go only through `security definer` functions that check, from `auth.uid()`, current group membership, an active share row, and the share's permission (`view`/`edit`); new `app_collab_*` tables have RLS on and no direct table privileges for API roles.

**⑤ Collaboration structures 문단 끝에 추가**:

> Group sharing (COLLAB-묶인사람끼리공유) does not use these structures: it uses separate `app_collab_*` tables. Do not add non-owner rows to `app_workspace_members`, and do not revive invites, attendees, or project members for it.

## 3. 묶음·멤버·초대·수락 (1단계)

### 3.1 표

| 표 | 칸(주요) | 비고 |
| --- | --- | --- |
| `app_collab_groups` | id, kind(`dept`·`union`), union_name, dept_name(노조 묶음은 null), name_key(비교용: 앞뒤 공백 제거·연속 공백 하나로·띄어쓰기 무시), created_by, created_at | 이름은 사용자가 친 글 그대로. 목록·찾기·자동완성 API 없음 |
| `app_collab_members` | group_id, user_id, workspace_id, role(`admin`·`member`), joined_at, display_name·title(멤버에게 보일 이름·직책 — 묶음에 들어갈 때(초대 수락·같은 이름 요청) 프로필의 이름·직책을 멤버에게 보여도 된다고 동의한 값. 가입 때는 받지 않음, PROFILE 11/15 확정) | (group_id,user_id) 하나. workspace_id는 서버가 owner 행에서 채움 |
| `app_collab_invites` | id, group_id, token_hash, created_by, expires_at(기본 7일), uses_left(기본 1), revoked_at | 링크 원문은 한 번만 보여 주고 저장하지 않음(해시만). 추측 불가 길이(128비트 이상) |
| `app_collab_join_requests` | id, group_id, requester_user_id, requester_display(이름·직책, 요청 전 동의), status(`pending`·`accepted`·`declined`·`expired`), decided_by, created_at, decided_at | 요청자는 이 표를 **읽지 못한다**(묶음이 있는지 새지 않게) |
| `app_collab_join_attempts` | user_id, created_at | 하루 횟수 제한용. 이름은 저장하지 않음 |
| `app_collab_member_log` | group_id, user_id, event(`join`·`leave`·`removed`·`admin_moved`), at | 누가 언제 들어오고 나갔는지만(내용 없음) |

- 모든 `app_collab_*` 표: RLS 켬, 정책 없음, `anon`·`authenticated`·`PUBLIC` 표 권한 없음(`app_operator_features`와 같은 방식). 읽기·쓰기는 아래 RPC로만.
- 묶음 이름(노조명·부서명)은 그 묶음 멤버에게만 돌려준다. 운영자 화면(가입자 현황)은 각자 프로필의 노조명·부서명을 이미 보여 주지만(11/15 23:17 확정 목록), **묶음 표 자체는 개수만** 본다.

### 3.2 RPC(모두 `security definer`, `set search_path = ''`, `auth.uid()` 없으면 거절, PUBLIC·anon 실행 회수, authenticated만 실행)

| 함수 | 하는 일 | 지키는 점 |
| --- | --- | --- |
| `app_collab_group_create(kind, union_name, dept_name)` | 묶음을 만들고 부른 사람을 admin으로 넣음. 같은 name_key 묶음이 이미 있으면 **새 묶음은 만들고** 그 묶음(들)의 관리자에게 수락 요청을 남김 | 돌려주는 말은 있든 없든 같음: "묶음을 만들었습니다. 같은 이름 묶음이 있으면 그 묶음 관리자가 수락할 때 합쳐집니다." 하루 3번 제한(초과도 같은 말 + 다음 날 안내). 비교는 서버에서만 |
| `app_collab_invite_create(group_id)` | 초대 링크 만들기 | 관리자만(결정 ⑦). 클라이언트가 보낸 group_id는 멤버·역할을 서버가 다시 확인 |
| `app_collab_invite_accept(token)` | 링크로 들어오기 | 해시 대조·기한·남은 횟수·회수 여부 확인. 실패 이유는 하나로("쓸 수 없는 링크입니다") |
| `app_collab_request_decide(request_id, accept)` | 같은 이름 요청 수락·거절 | 관리자만(결정 ⑥). 수락하면 요청자의 새 묶음을 기존 묶음으로 합침(요청자 혼자였으면 새 묶음 삭제). 거절 사실은 요청자에게 알리지 않음. 같은 사람 요청이 여러 묶음에 갔으면 첫 수락 하나만, 나머지는 자동 `expired` |
| `app_collab_my_groups()` | 내 묶음·멤버(이름·직책·역할)만 | 다른 묶음 정보 0 |
| `app_collab_leave(group_id)` | 나가기 | 7.1절 |
| `app_collab_member_remove(group_id, user_id)` | 관리자가 내보내기 | 관리자만, 자기 자신은 불가(나가기 사용) |
| `app_collab_admin_move(group_id, user_id)` | 관리자 넘기기 | 받는 사람은 현재 멤버여야 함 |

- 관리자는 멤버 관리만 한다. **다른 멤버의 개인 기록은 못 본다**(공유된 것만, 11/15 23:14).
- 묶음 수 상한(예: 한 사람 10개), 멤버 상한(예: 100명) — 남용·실수 막기용. 숫자는 구현 때 정함.

## 4. 공유 항목 (2단계 뼈대)

### 4.1 표 `app_collab_shares`

| 칸 | 뜻 |
| --- | --- |
| id | |
| group_id | 어느 묶음에 나눴나(공유할 때 고름) |
| owner_user_id, owner_workspace_id | 공유한 사람. 서버가 `auth.uid()`와 owner 행으로 채움 |
| kind | `calendar` · `biz_area` · `org` · `library_folder` **네 가지만**(check 제약). 텔레그램·통화·가족·노트·일기 등은 값으로 표현조차 안 됨 |
| target_id | 대상: 사업영역 id·조직 id(uuid) / 구글 캘린더 id·Drive 폴더 id(text) |
| permission | `view`(보기만) · `edit`(쓰기까지). 공유한 사람만 바꿈 |
| created_at, updated_at, off_at | 끄면 off_at 기록(행은 남겨 댓글 보존, 결정 ④) |

- 고유: (group_id, kind, target_id)에서 켜진 행 하나.
- 켜기 `app_collab_share_on(group_id, kind, target_id, permission)`: ① 부른 사람이 그 묶음 현재 멤버 ② 대상이 **부른 사람 작업공간 것**(`private.app_is_workspace_owner(대상의 workspace_id)`) ③ 대상이 제외 검사 통과(`private.app_collab_target_allowed` — 4.3절) — 하나라도 아니면 거절.
- 끄기 `app_collab_share_off(share_id)`·권한 바꾸기 `app_collab_share_permission(share_id, permission)`: 공유한 사람만. 관리자도 남의 공유를 끄지 못함(결정 ⑤ 추천안).

### 4.2 공유 읽기·쓰기 경로를 한곳에

**기존 owner 전용 정책은 한 줄도 바꾸지 않는다.** 표마다 "공유면 읽기 허용" 정책을 덧붙이면(① 표가 수십 개라 하나만 빠져도 새고 ② 승인형 DB workflow의 '권한을 넓히는 정책' 거절 규칙과도 부딪힘) 안전하게 지킬 수 없다. 대신:

```
private.app_collab_can(p_share uuid, p_need text) returns boolean   -- 판정은 여기 하나
  = share 켜짐(off_at is null)
    and auth.uid()가 그 share.group_id의 현재 멤버
    and (p_need = 'view' or (p_need = 'edit' and share.permission = 'edit'))
    and 공유한 사람도 여전히 그 묶음 멤버

public.app_collab_shared_list()                 -- 나에게 보이는 공유 목록(묶음·종류·이름·권한·공유한 사람 이름)
public.app_collab_read(p_share uuid, p_part text, p_cursor text)   -- 종류별 읽기를 한 함수에서 분기
public.app_collab_write(p_share uuid, p_op text, p_payload jsonb)  -- 종류별 허용된 쓰기만
```

- 세 공개 함수는 모두 맨 앞에서 `private.app_collab_can`을 부른다. 다른 곳에서 남의 작업공간을 읽는 함수를 만들지 않는다(보안 시험이 "`app_collab_read`·`app_collab_write` 밖에서 `owner_workspace_id`로 남의 표를 읽는 DEFINER 함수 0개"를 검사).
- 받는 값에 workspace_id·user_id를 두지 않는다. 대상은 share 행에서만 찾는다(AGENTS.md 3절 3).
- 돌려주는 칸은 종류별 **허용 칸 목록**으로 고정(`select *` 금지). 동적 SQL에 입력값을 넣지 않는다. 한 번에 최대 행 수 제한.
- 쓰기는 공유한 사람의 표에 그 사람 workspace_id로 쓰고, 누가 썼는지는 `app_collab_edits(share_id, table_name, row_id, author_user_id, op, at)`에 남긴다(기존 표에 칸을 더하지 않음 — 기존 표 정의를 흔들지 않기 위해). 화면은 이 기록으로 "○○님이 씀"을 보여 준다.
- `edit` 범위(결정 ⑧ 추천안): 기록 **더하기·고치기**까지. 지우기·대상 자체(조직·사업영역) 이름 바꾸기·지우기·옮기기는 공유한 사람만.
- 공유한 사람의 작업공간 owner 정책은 그대로라, 공유한 사람은 늘 자기 화면에서 모든 것을 보고 고친다.

### 4.3 제외 검사(텔레그램·통화·가족)

- 종류 네 가지만 허용(check 제약 + `app_collab_target_allowed`).
- `org`·`biz_area`의 읽기 허용 칸 목록에서 **텔레그램 수집·통화·가족에서 온 기록과 그 연결을 뺀다**: `app_feed_*`·`app_tg_*`·`app_call_*`·가족 기록 표는 읽기 분기에 아예 없음. 조직 보고·사업 보고 중 출처가 수집·통화인 행, `app_record_links`의 수집·통화 연결, 수집 내용으로 만든 AI 요약 칸은 돌려주지 않는다. 출처 칸 이름·값은 4단계 전에 운영 정의(구조만, 내용 아님)를 확인해 목록으로 고정한다.
- 운영자 전용 기능(`private.app_workspace_has_feature`)이 붙은 자료는 공유 대상이 아님.
- 남의 공유물은 **내 AI·원장 자동 기록·전체 검색에 들어가지 않는다**(결정 ⑨ 추천안). 공유한 사람 쪽에서는 자기 작업공간 자료이므로 지금처럼 쓰인다(멤버가 쓰기까지로 더한 기록 포함 — 공유 켤 때 안내 한 줄).

## 5. 캘린더 공유 (3단계) — 구글 권한으로

원본은 Google Calendar이고, 앱은 **다른 사람 대신 그 사람 캘린더를 열지 않는다.** 각자 자기 토큰으로 자기에게 보이는 캘린더만 읽는다(지금 `supabase/functions/google-calendar`의 `calendarList`와 같음).

| 단계 | 하는 일 | 쓰는 구글 권한(누구 토큰) |
| --- | --- | --- |
| 공유 캘린더 만들기 | 공유하는 사람의 구글 계정에 '노조+ · (묶음 이름)' 보조 캘린더를 새로 만든다. **개인·기본 캘린더는 절대 자동 공유하지 않는다**(결정 ⑩: 기존 캘린더를 고르게 할지) | 공유하는 사람 토큰, 새 권한 `calendar.app.created`(앱이 만든 캘린더만 다룸) |
| 멤버에게 열기 | 그 캘린더의 공유 설정(ACL)에 멤버 구글 메일을 `reader`(보기만) 또는 `writer`(쓰기까지)로 넣는다 | 공유하는 사람 토큰. 멤버 메일은 **서버가** 멤버의 캘린더 연결에서 가져옴(클라이언트 값 안 믿음) |
| 멤버 화면에 보이기 | 멤버의 캘린더 목록에 추가해 지금 화면에 섞어 보여 줌 | 멤버 자기 토큰. 지금 범위 `calendarlist.readonly`로는 목록 추가가 안 되므로 `calendar.calendarlist`(목록 쓰기)가 더 필요할 수 있음 **[확인 필요]** — 안 되면 구글이 보낸 공유 메일의 [추가]를 멤버가 한 번 누름 |
| 끄기·나가기·권한 바꾸기 | ACL에서 그 메일을 지우거나 역할을 바꿈 | 공유하는 사람 토큰(그 사람 자원을 닫는 일이라 허용). 토큰이 끊겼으면 서버가 다시 시도하고, 공유한 사람 화면에 "구글에서 직접 끄기" 안내 |

- `calendar.app.created`가 그 캘린더의 ACL 수정까지 포함하는지 **[확인 필요 — 구현 3단계 첫 작업]**. 안 되면 `calendar`(전체) 대신 사용자가 구글에서 직접 캘린더를 만들어 공유하고 앱은 읽기만 하는 안으로 물러난다(권한 범위를 함부로 넓히지 않음).
- 구글 권한 범위가 늘면 OAuth 동의 화면 범위 추가와 구글 앱 확인 갱신이 필요하다(`docs/design/google-brand-verification.md`) — 구글 콘솔 로그인은 사용자 일.
- 묶음 멤버 사이에는 구글 공유 때문에 **서로의 구글 메일이 구글 화면에 보인다.** 묶음에 들어갈 때 동의 문장으로 알린다(결정 ①).
- **공휴일**: 공유와 상관없이 구글의 공개 '대한민국 공휴일' 캘린더를 각자 켜는 버튼을 캘린더 설정에 둔다(추천, 결정 ⑪). 공휴일은 개인 정보가 아니므로 무리끼리 나눌 필요가 없고, 공유 캘린더에 공휴일 일정을 복사하면 원본이 둘이 된다. 공개 캘린더 일정을 지금 범위(`calendar.events`)로 읽을 수 있는지 **[확인 필요]**.

## 6. 자료실 폴더 공유 (3단계) — Drive 권한으로

- 공유하는 사람이 자기 자료실(자기 Drive) 폴더 하나를 고른다 → 서버가 **공유하는 사람 토큰**으로 Drive 권한(`permissions.create`)에 멤버 구글 메일을 `reader` 또는 `writer`로 넣는다(알림 메일은 보내지 않음).
- 멤버 자료실에는 '공유 폴더' 묶음이 생기고, 목록·내용은 **멤버 자기 Drive 연결 토큰**으로 읽는다. 구글이 권한을 판정하므로, 앱이 남의 Drive를 대신 열지 않는다. 멤버가 Drive를 연결하지 않았으면 "Drive를 연결하면 공유 폴더가 보여요" 한 줄.
- 멤버 메일은 서버가 멤버의 Drive 연결(`app_drive_connections`)에서 가져온다. 클라이언트가 보낸 메일 금지.
- 끄기·나가기: 공유한 사람 토큰으로 그 권한을 지운다. 실패하면 다시 시도 + 공유한 사람에게 안내(5절과 같음).
- 공유 폴더 안 파일은 자료실 AI 정리·분류·색인(`library-*`, `cloud-files`) 대상에서 뺀다(남의 원본을 내 AI가 읽지 않게, 결정 ⑨).
- 하위 폴더는 Drive 권한이 아래로 이어진다. 공유 폴더 안에 개인 파일을 넣으면 같이 보인다는 안내 한 줄.

## 7. 담당조직·사업 영역 공유 (4단계) — 앱 DB, 4.2절 경로로

| 종류 | 보기만 | 쓰기까지(추가) |
| --- | --- | --- |
| 담당조직(`org`) | 조직 이름·기본 정보·조직 보고 기록(11/16 결정 ①) | 조직 보고 기록 더하기·고치기 |
| 사업 영역(`biz_area`) | 사업영역 이름·진행 상황·그 영역의 사업 보고 | 사업 보고 더하기·고치기, 진행 상황 고치기 |

- 대상 표 목록(조직: `app_suborganizations`·`app_suborganization_updates` 등, 사업: `app_spaces`·`app_meetings`·`app_business_records`·`app_business_now` 등)과 허용 칸은 4단계 첫 작업에서 운영 정의(구조만)를 확인해 고정한다. 일부 기본 표는 정의가 저장소에 없다(`multi-user-audit.md` 0절).
- 담당자·핵심 인물·연락처처럼 사람 정보가 들어간 칸은 기본 제외(결정 ⑫).
- 화면 이름: 메뉴는 #2697(11/16) 뒤 이름인 '조직 관리'·'사업 관리'를 따른다(공유 창·알림 문구·ui-words 모두). 기록 종류를 뜻할 때만 '조직 보고 기록'·'사업 보고'를 쓴다.
- 멤버 화면: 조직 보고·사업 보고에 '공유받은 것' 묶음(공유한 사람 이름 표시)을 내 것과 섞지 않고 따로 보인다. 내 담당조직 목록(`app_suborganizations`)에 남의 조직을 복사해 넣지 않는다.

## 8. 댓글·@멘션·알림 (5·6단계)

- 표 `app_collab_comments`: id, share_id, target_ref(공유 안의 어느 기록인지 — 서버가 그 공유에 속하는지 확인), author_user_id, body(글자 수 상한), created_at, edited_at, deleted_at. 노트 댓글 `app_note_comments`(내 노트 전용)와 섞지 않는다.
- **개인 메모는 공유되지 않는다**(S69-95 NOTE-메모넓히기, 2026-11-25): 노트·읽을 거리·저장한 글·자료실 자료·사업 보고·담당조직 기록·텔레그램 소식 아래 메모(`app_memos`, migration `20261125030000`·`20261125060000`)는 늘 그 작업공간 주인만 읽고 쓴다(owner RLS 4정책, 넣을 때 원문이 같은 작업공간 것인지 서버가 확인). 공유 읽기 함수(`app_collab_*`)·4단계 읽기 허용 칸 목록에 `app_memos`를 넣지 않는다 — 원문을 공유해도 그 원문에 남긴 내 메모는 받는 사람에게 가지 않고, 받는 사람도 남의 원문에 메모를 남길 수 없다(공유물에 다는 글은 위 `app_collab_comments` 몫). 시험: `tests/auth-handoff/memos-more-targets-db.test.mjs`(원문을 볼 수 있는 다른 작업공간 사람에게도 메모 0줄, 모든 `app_collab_*` 함수 본문에 `app_memos` 없음).
- 읽기·쓰기: `private.app_collab_can(share,'view')`가 참인 사람(= 현재 멤버)만. **보기만 공유에도 댓글은 달 수 있다**(추천 — 댓글은 기록을 바꾸지 않음, 결정 ③). 내 댓글만 고치기·지우기. 공유한 사람은 자기 공유물의 댓글을 숨길 수 있음.
- 공유를 끄면 댓글은 숨김 보존, 다시 켜면 보임(결정 ④). 나간 사람 댓글은 '나간 멤버'로 남김(결정 ②).
- @멘션: `@`를 치면 **그 공유를 볼 수 있는 현재 멤버만** 뜬다(`app_collab_mention_candidates(share_id)`: 이름·직책만). 서버가 본문의 멘션을 다시 확인해 멤버 아닌 대상은 버린다. 표 `app_collab_mentions(comment_id, user_id, read_at)`.
- 알림: 앱 안 알림 줄 + 폰 알림(`phone-push` 새 종류 `collab_mention`, `collab_join_request`). **문구에 댓글 내용 전문을 넣지 않는다**: "○○님이 댓글에서 불렀어요"·"묶음 들어오기 요청이 있어요"까지. 누르면 앱에서 열고, 앱이 권한을 다시 확인한다. 종류별 끄기·조용한 시간은 지금 규칙 그대로. `app_push_log` 종류 check 제약 변경 = DB 변경.

## 9. 일정 초대·수락·거절 (7단계) — 구글 참석자 기능

- 일정 창 [초대]에서 고를 수 있는 사람은 **같은 묶음 현재 멤버뿐**(이름·직책). 메일 직접 입력은 이번에 하지 않는다(결정 ⑬).
- 서버가 고른 멤버의 구글 메일을 찾아, **초대하는 사람 토큰**으로 그 일정의 `attendees`에 넣고 `sendUpdates`로 구글 초대를 보낸다. 상대 구글 캘린더에 들어가고 수락/거절/미정은 구글이 관리한다.
- 노조+ 일정 화면: 지금 `google-calendar`는 참석자 정보를 복사하지 않는다(43줄 화이트리스트). 바꿔서 **같은 묶음 멤버인 참석자만** 이름과 응답(수락·거절·미정)으로 보여 주고, 그 밖의 참석자 메일·이름은 계속 버린다.
- 받은 사람은 노조+ 일정 화면에서 [수락]·[거절]·[미정] → 자기 토큰으로 자기 응답만 바꾼다.
- 옛 노조+ 참석자 표(Task 22 제거 예정)는 쓰지 않는다.

## 10. 백업·탈퇴·나가기

### 10.1 나가기(`app_collab_leave`)·내보내기

1. 내 멤버 행 삭제, `app_collab_member_log`에 기록.
2. 내가 그 묶음에 켠 공유는 모두 끔(`off_at`). 대상은 내 공간에 그대로 남는다.
3. 구글 권한 정리 작업을 줄에 넣음: ① 내가 공유한 캘린더·폴더에서 다른 멤버 권한 지우기(내 토큰) ② 남이 공유한 캘린더·폴더에서 내 메일 권한 지우기(각 공유자 토큰). 실패는 다시 시도하고 끝날 때까지 공유자 화면에 표시.
4. 관리자는 넘긴 뒤 나간다. 마지막 한 명이 나가면 묶음 삭제.
5. 나가도 내가 남의 공유물에 쓴 기록·댓글은 그 공유물에 남는다(결정 ②).

### 10.2 탈퇴(MULTI-스스로탈퇴)

- 탈퇴 순서 맨 앞에 "모든 묶음 나가기(10.1)"를 넣는다. 관리자면 넘길 사람을 자동으로 가장 오래된 멤버로(결정 ⑭).

### 10.3 백업(PRIVACY-백업안내)

- 내 백업에 들어가는 것: 내 묶음 목록(이름·내 역할), 내가 켠 공유 목록, **내가 쓴 댓글**(어느 공유물의 어느 기록인지 이름 포함).
- 들어가지 않는 것: 남이 공유한 대상의 내용(그 사람 백업에 있음). 내가 쓰기까지로 남의 조직 보고에 더한 기록은 공유한 사람의 자료다(공유한 사람 백업에 들어감).

### 10.4 운영자

- 운영자 화면·함수는 묶음 수·멤버 수 같은 **숫자만**. 묶음 이름·공유 목록·댓글을 보는 운영자 화면을 만들지 않는다(AGENTS.md 3절 '남의 기록 안 보기'). 장애가 나도 내용을 열지 않는다.

## 11. 위협 모델과 거절 시험

| 위협 | 막는 곳 | 시험(구현 단계에서 추가) |
| --- | --- | --- |
| 무리 밖 사람이 공유물을 봄 | `app_collab_can`(현재 멤버) | 멤버 아닌 계정 `app_collab_read` → 거절, 행 0 |
| 나간 사람이 계속 봄 | 멤버 행 삭제 + 구글 권한 정리 | 나간 뒤 read 거절, 캘린더·폴더 권한 정리 작업 생성 |
| 꺼진 공유를 봄 | `off_at` 검사 | 끈 뒤 read 거절 |
| 보기만 공유에 씀(권한 올리기) | `app_collab_can(...,'edit')` | view 공유에 `app_collab_write` → 거절 |
| 멤버가 스스로 관리자·권한을 바꿈 | 역할은 서버 행에서만 판정, 공유 권한은 공유한 사람만 | member가 invite_create·request_decide·member_remove·share_permission → 거절 |
| 클라이언트가 남의 workspace_id·user_id·group_id를 보냄 | 함수가 workspace·user를 받지 않음, group은 멤버 재확인 | 남의 group_id로 share_on·invite_create → 거절 |
| 내 것 아닌 대상을 공유(남의 조직 id 넣기) | `app_is_workspace_owner(대상 workspace)` | 남의 조직 id로 share_on → 거절 |
| 텔레그램·통화·가족 열기 | kind check 4종 + 읽기 허용 칸 목록 | kind=`feed` 등 share_on → 거절 / org read 결과에 수집·통화 출처 행·연결 0 / 운영자 계정이 org 공유해도 수집 행 0 |
| 같은 이름 요청으로 노조 쓰는지 알아내기 | 같은 안내·하루 제한·요청자는 요청 표 못 읽음 | 있는 이름/없는 이름 응답이 바이트까지 같음, 4번째 시도 같은 응답 + 요청 안 생김 |
| 초대 링크 추측·재사용 | 128비트 이상, 해시 저장, 기한·횟수 | 틀린 토큰·만료·다 쓴 토큰 → 같은 거절 문구 |
| 기존 owner 정책이 넓어짐 | 기존 정책 무변경 | 정책 지문 시험(기존 `task12a` 지문)이 그대로 통과, 새 정책은 `app_collab_*`에만 |
| 다른 DEFINER 함수가 몰래 남의 표를 읽음 | 공유 경로 한곳 | 정적 시험: `owner_workspace_id`로 남의 표를 읽는 함수는 `app_collab_read`·`app_collab_write`뿐 |
| anon·PUBLIC 실행 | 실행 권한 회수 | 모든 `app_collab_*` 함수 anon·PUBLIC 실행 불가 정적 시험 |
| 폰 알림으로 내용 새기 | 문구 고정 | `collab_mention` 알림 본문에 댓글 글자 0 |
| @멘션으로 무리 밖 이름 알아내기 | 후보 = 공유 볼 수 있는 멤버만 | 다른 묶음 사람 후보 0, 본문에 넣어도 알림 0 |
| 일정 초대로 무리 밖 메일 얻기 | 고르기 = 멤버만, 응답 표시 = 멤버 참석자만 | 무리 밖 참석자 이름·메일이 응답에 0 |
| 남의 공유물이 내 AI로 감 | ai-assist·원장 자동 기록·검색 입력에서 공유물 제외 | 공유받은 조직 보고가 ai-assist 입력·원장 후보에 0 |
| 앱이 남의 구글 토큰으로 대신 읽음 | 읽기는 늘 본인 토큰, 공유자 토큰은 ACL·권한 정리에만 | Edge 정적 시험: 공유자 연결 토큰을 읽기 요청에 쓰는 경로 0 |
| 운영자가 내용을 봄 | 운영자 함수는 숫자만 | 운영자 함수 응답에 이름·내용 칸 0 |

## 12. PR 단계와 정지 지점

| 단계 | 내용 | DB 정지 지점 | Edge 정지 지점 | 그 밖 |
| --- | --- | --- | --- | --- |
| 0 | 운영 정의 확인: 4·7절 대상 표의 칸·정책 구조(내용 아님), `app_push_log` 종류 제약 | 읽기 전용 확인만 | — | 결과는 문서 PR |
| 1 묶기 | 3절 표·RPC, 프로필 노조명·부서명 칸(PROFILE 항목과 줄 세움), 묶음 화면(만들기·초대 링크·같은 이름 요청·멤버·나가기·관리자 넘기기), AGENTS.md 5절 개정(2절), ui-words '부서 묶음·노조 묶음'(메뉴 이름은 '조직 관리'·'사업 관리' 기준) | 새 표 6개·함수(승인형 workflow, 시험 적용 먼저) | 들어오기 요청 폰 알림은 6단계로 미룸(1단계는 앱 안 알림만) | COLLAB-주간보고모으기의 '같은 조직 사람'도 이 묶음을 씀 |
| 2 공유 표·규칙 | `app_collab_shares`·`app_collab_edits`·`app_collab_can`·share_on/off/permission·`shared_list`·read/write 뼈대(종류 분기는 빈 채), 제외·정적 보안 시험 | 새 표 2개·함수 | — | 화면: 항목 ⋯ [공유] 창(묶음 고르기·보기만/쓰기까지) |
| 3 캘린더·자료실 | 5·6절, 공휴일 켜기 | — | `google-calendar`·자료실 Drive 함수 배포(하나씩, 되돌리기 ref 기록) | 구글 OAuth 범위 추가·앱 확인 갱신(사용자 구글 콘솔 로그인) |
| 4 조직·사업 | 7절, read/write의 `org`·`biz_area` 분기, 허용 칸 목록 | 함수 교체 | — | 0단계 결과 필요 |
| 5 댓글 | `app_collab_comments`·RPC·화면 | 새 표·함수 | — | 백업에 내 댓글 |
| 6 멘션 알림 | `app_collab_mentions`, 알림 종류 2개(멘션·들어오기 요청) | 표 + `app_push_log` 제약 | `phone-push` 배포 | 폰 앱 변경 없으면 릴리스 없음 |
| 7 일정 초대 | 9절 | — | `google-calendar` 배포 | |

- 단계마다 PR 하나, 앞 단계 merge 뒤 시작(같은 파일을 만지므로 줄 세움). DB는 늘 시험 적용 → 적용 → 사후 확인, 실패하면 멈춤. `supabase db push`·`migration repair` 금지(AGENTS.md 7절).
- 새 정책·함수는 확장 규칙 기준으로 짝 파일(rollback·snapshot 등)을 갖춘다. anon·PUBLIC 권한, RLS 끄기, DEFINER + anon/PUBLIC 실행은 만들지 않는다.
- 화면이 생기는 단계(1·2·3·5·7)는 요청함 방 시안(폰·폴드 펼침·PC)을 사용자가 먼저 보고 정한다.

## 13. 사용자 결정 — 확정(2026-11-16 09:28 "추천대로")

결정 ①~⑭는 모두 추천안(가)으로 확정했다. 시안은 함께쓰기 3차·쓰는 법 1차(#2702) 그대로 확정.

| 번호 | 확정 |
| --- | --- |
| ① | 구글 메일이 서로 보임 — 묶음에 들어갈 때 알리고 동의받음 |
| ② | 나간 사람의 기록·댓글은 '나간 멤버'로 남김 |
| ③ | '보기만' 공유에도 댓글 가능 |
| ④ | 공유를 끄면 댓글은 숨겨서 보존 |
| ⑤ | 관리자는 남의 공유를 끌 수 없음 |
| ⑥ | 같은 이름 들어오기 요청 수락은 **관리자만** |
| ⑦ | 초대 링크는 **관리자만** |
| ⑧ | '쓰기까지' = 더하기·고치기. 지우기·이름 바꾸기는 올린 사람만 |
| ⑨ | 남의 공유물은 내 AI·원장 자동 기록·전체 검색에 넣지 않음 |
| ⑩ | 캘린더는 앱이 만든 묶음 전용 새 캘린더만 공유 |
| ⑪ | 공휴일은 각자 [대한민국 공휴일 켜기] |
| ⑫ | 담당조직 공유에서 사람 정보(담당자·연락처) 빼기 |
| ⑬ | 일정 초대는 묶음 사람만 |
| ⑭ | 관리자가 탈퇴하면 가장 오래된 멤버에게 자동으로 넘김 |

요청함 방(V31) 대조 차이 3건 반영: 3.1 이름·직책 동의 시점, 7·12절 화면 이름('조직 관리'·'사업 관리'), 결정 ⑥(관리자만).
