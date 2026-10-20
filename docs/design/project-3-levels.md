# PRJ-3단 — 프로젝트를 최대 3단(상위 → 하위 → 그 아래)으로

- 원장 행: `PRJ-3단` (2026-10-21 요청함 01:04, 01:10 승인: 최대 3단). 이어지는 행: `PRJ-순서바꾸기`, `JOURNAL-주간보고허브` 2단계.
- 이 문서는 설계만 한다. 코드·DB 변경 없음. 아래 migration 초안은 **문서 안 코드 블록일 뿐**이며 `supabase/migrations/`에 넣지 않았다(적용 경로 혼동 방지).
- 기준: main `0046922`. 조사 방법: 저장소 코드·migration 읽기. 운영 DB는 보지 않았다 — 운영에 관한 말은 "추정"으로 적고 확인 SQL(5절)을 붙였다.

## 1. 결론

| 질문 | 답 |
| --- | --- |
| 지금 2단 제한은 어디에 있나 | **화면 규칙(사실).** `app/project-system-v3.js`가 상위 고르기 목록에 큰 프로젝트만 넣고, 하위 프로젝트 화면에서는 하위 칸을 그리지 않는다. 저장소 migration에는 단계 수를 막는 검사·트리거·RLS·RPC가 없다. |
| DB 변경이 필요한가 | **3단을 쓰는 데는 필요 없다.** 저장은 `app_spaces.parent_id` 한 칸이고 깊이 제한 칸이 없다. 다만 3단이 되면 "자기 아래로 옮기기(순환)"가 화면에서 가능해지므로, DB 안전망 트리거를 따로 두는 안(4절)을 추천한다. 이 안을 고르면 적용 직전 정지. |
| 순서 저장 칸 | `app_spaces.sort_order`(정수)가 이미 있고 앱이 정렬에 쓴다. `PRJ-순서바꾸기`도 새 칸 없이 된다. |

## 2. 지금 구조

### 2.1 저장 (사실, 저장소 기준)

- 프로젝트 = `public.app_spaces` 행. 위아래 관계는 `parent_id`(자기 참조) 한 칸. 앱이 프로젝트로 보는 행은 `metadata.project_system='v2'` 또는 `management_version=2`인 행과 그 아래 전부(`app/project-catalog-model.mjs` `select`).
- 새 프로젝트 저장(`saveProject`): `app_spaces` 1행(`parent_id`, `slug`, `name`, `sort_order = 지금 최댓값 + 10`, `owner_id`, `status='active'`, `visibility='private'`, `metadata`) + `app_project_modules` 4행.
- `parent_id`를 다루는 DB 코드(저장소 migration 전부 확인):

| 위치 | 하는 일 | 깊이 제한 |
| --- | --- | --- |
| `20260916030032` `private.app_enforce_space_workspace` (트리거) | 상위가 같은 작업공간인지만 검사 | 없음 |
| `20260921231000` `private.app_unlink_retained_project_records` (삭제 직전 트리거) | `with recursive`로 아래 전부를 찾아 자료·회의·할 일·일정·페이지 연결을 빈칸으로 | 없음(몇 단이든 따라감) |
| `20261011180000`·`20261012100000` 바구니 확정·연결 보기 RPC | 대상에서 위로 `parent_id`를 거슬러 올라가며 v2·보관 여부 확인 | 없음(반복) |
| `20260920121000` 등 공개 프로젝트 보기 | 퇴역 경로(Task 13) | 해당 없음 |

- 저장소에는 기준 스키마(baseline) 파일이 없다(`supabase/local-verify/bootstrap-ci.sh`가 CI에서 따로 받음). 그래서 **운영에 저장소 밖 검사·트리거가 있는지는 저장소로 확인할 수 없다.** 추정: 없다. 근거 — 편집 창으로 이미 3단을 만들 수 있는 경로(2.2 ⑨)가 있는데 이를 막는 코드가 어디에도 없고, `parent_id` 외래키는 앱 삭제 안내("하위 프로젝트도 함께 삭제")로 보아 `on delete cascade`다. 5절 확인 SQL로 대조한다.

### 2.2 화면에서 2단을 가정하는 곳 (사실, 코드)

`app/project-system-v3.js` (#831 `ui/pc-projects-split`이 같은 파일을 고치는 중):

| # | 코드 | 지금 동작 | 3단에 필요한 것 |
| --- | --- | --- | --- |
| ① | `projectParentOptions` → `tops()` | 상위 고르기 목록에 큰 프로젝트만 | 1·2단을 넣고 들여쓰기. 3단·자기 자신·자기 아래는 뺌 |
| ② | `childrenHtml`: `if(d.p.parent_id) return ''` | 하위 프로젝트 화면엔 "하위 프로젝트" 칸·[+] 없음 | 2단까지 칸을 그리고 3단에서만 숨김 |
| ③ | `renderDetail`: `ch = par ? [] : kids(p)` | 하위 프로젝트의 자식은 비움 | 단계로 판단(`depth < 2`) |
| ④ | `headSummary`: `d.p.parent_id ? '' : '하위 n'` | 하위 개수는 큰 프로젝트만 | 2단에도 표시 |
| ⑤ | `renderGrid`: `rows.flatMap(p=>[p,...kids(p)])`, `listRowHtml(p,kids(p))` | 목록·요약 읽기가 2단까지 | `catalog.tree` 기준으로 3단까지 |
| ⑥ | `colorDot`: 바로 위 상위 색 | 3단은 색 없는 2단을 따라 회색 | 맨 위(1단) 색의 연한 톤 |
| ⑦ | `openDelete`·`archiveProject`: `kids(current).length` | 안내 문구가 자식만 셈(손자 빠짐) | 아래 전부 개수. 실제 기록 보존은 DB 트리거가 몇 단이든 처리(사실) |
| ⑧ | `renderArchiveList`: `under(p)` 1단 | 보관 목록에서 손자 안 보임 | 트리로 |
| ⑨ | `openEdit`: 상위 목록에서 자기만 뺌 | **지금도** 자식이 있는 큰 프로젝트를 다른 큰 프로젝트 아래로 옮기면 3단이 생긴다(막는 코드 없음) | 3단 상한·자기 아래 금지 검사 |

다른 파일:

| 파일 | 지금 | 판단 |
| --- | --- | --- |
| `app/project-catalog-model.mjs` `tree`·`basketProjects` | 몇 단이든 깊이와 경로(`A › B › C`)를 만든다 | 그대로 씀 |
| `app/choice-sheet.js` `projectRow` (기록할 곳·바구니 연결 고르기) | `--home-choice-depth`로 단계마다 들여씀(폰 12px, PC 16px), PC에선 2단 이하 흐리게 | 그대로 됨 |
| `app/update-places.js`, `app/basket-manual-link.js`, `app/google-tasks.js`, `app/share-pages.js`, `app/library-upload.js` 업로드 고르기 | `catalog.tree`·`catalog.options`·`label(depth)` | 그대로 됨 |
| `app/library-upload.js` `luRenderProjectFilter` (자료실 거르기 줄) | `depth===0`은 "프로젝트" 줄, 나머지는 모두 "세부" 줄에 평평하게. 거르기는 고른 프로젝트와 **정확히 같은** 자료만(`d.project_id===pid`) | 3절 C |
| `app/task-layout.js` 할 일 프로젝트 고르기 | `↳` 하나, `sort_order` 평면 순서(트리 순서 아님) | `catalog.options`로 바꾸기 |
| `app/journal-data.js` 프로젝트 소식 | 프로젝트 이름별 평면 묶음, 위아래 관계 안 씀 | 3절 D |
| `app/home-dashboard-v2.js` | 큰 프로젝트(`!parent_id`)만 | 영향 없음 |
| `app/workflow-ai-v3.js` `childOptions` | `상위 › 이름` 1단 | 앱이 불러오지 않음(테스트만 참조, 추정: 퇴역). 손대지 않음 |

## 3. 깊어진 단계를 보이는 법 (추천안)

공통 원칙: 이름 경로는 `catalog.tree`/`basketProjects`의 `A › B › C` 한 가지만 쓴다. 들여쓰기는 단계당 같은 값. 새 상태 저장소·새 렌더러 없음(`app/ARCHITECTURE.md` 한 영역 한 렌더러).

### A. 프로젝트 화면 (PC 좌우 #831 위, 폰 목록)

- **추천: 왼쪽 목록을 트리 들여쓰기로.** 1단 굵게, 2단 16px, 3단 32px + 글자 한 단계 작게. 기본은 모두 펼침(사업영역 6개 규모라 접을 필요가 적음). 접기는 나중에 필요하면 `<details>`로.
- 오른쪽 상세 제목 위 계층 줄: 1단 `—`, 2단 `상위`, 3단 `1단 › 2단`(각각 누르면 이동). 지금 규칙(상위 링크는 제목 위, 하위 이동은 본문 "하위 프로젝트" 목록, ⋯ 메뉴와 분리)을 그대로 따른다.
- "하위 프로젝트" 칸과 [+]: 1·2단에 보이고 3단엔 없음. 3단에서 하위를 만들려 하면 안 보이므로 안내도 필요 없음.
- 색: 3단도 맨 위 사업영역 색의 연한 톤(2단과 같은 톤).
- 폰: 같은 트리 들여쓰기(단계당 12px). 배치는 지금 그대로.
- 다른 안: 3단을 목록에서 빼고 2단 상세 안에서만 보이기 — 목록에서 바로 못 가서 비추천.

### B. 기록할 곳 선택 팝업 (B3 목록)

- **추천: 지금 그대로(이미 단계 들여쓰기).** 더할 것은 둘: ① 검색으로 걸러질 때는 들여쓰기만으로 위치가 안 보이므로 3단 줄에 `1단 › 2단` 작은 회색 글자를 덧붙임 ② "최근" 칩은 이름만(지금처럼).
- 다른 안: 모든 줄에 전체 경로 — 줄이 길어져 폰에서 잘림. 비추천.

### C. 자료실 거르기 줄 (프로젝트 → 세부)

- **추천: 줄은 2개 그대로.** "프로젝트" 줄 = 1단. "세부" 줄 = 고른 1단 아래 2·3단 전부, 3단 칩은 `2단 › 3단`으로 이름을 붙여 구분.
- **거르기 범위(명진 결정 필요, 추천: 하위 포함).** 지금은 큰 프로젝트를 고르면 그 프로젝트에 직접 붙은 자료만 보이고, "전체(이 프로젝트)" 칩도 같은 뜻이다(사실). 사업영역 → 세부과제 구조에서는 사업영역을 고르면 아래 자료가 모두 보이는 편이 자연스럽다. 2단을 고르면 그 아래 3단 자료도 포함.
- 다른 안: 세 번째 "사안" 줄 — 줄이 늘고 폰에서 길어져 비추천.

### D. 업무일지 프로젝트 소식·주간보고 초안 묶음

- **추천: 사업영역(1단) 머리 아래에 2·3단 기록을 묶기.** 1단에 직접 쓴 기록은 머리 바로 아래, 2단은 `세부과제: 내용`, 3단은 `세부과제 › 사안: 내용` 한 줄(보고서 양식에 사안 칸이 없으므로 세부과제 줄에 붙임). 머리 순서는 프로젝트 순서(`sort_order`)를 따른다(`PRJ-순서바꾸기`와 같은 순서).
- 이 묶음은 `JOURNAL-주간보고허브` 2단계([주간 정리]) 범위다(`docs/design/weekly-report-hub.md` 3.3: 묶는 기준 = 큰 프로젝트). PRJ-3단에서는 업무일지 하루 카드를 바꾸지 않고, 이름 경로를 얻는 공용 함수(`catalog.describe`에 `path`를 더하는 정도)만 준비하는 것을 추천.
- 다른 안: 지금처럼 이름별 평면 — 3단이 늘면 사업영역 단위 보고와 맞지 않아 비추천.

## 4. DB 안전망 (선택, 추천)

3단을 화면에서 열면 편집 창에서 "큰 프로젝트를 자기 손자 아래로" 같은 이동이 가능해진다. 화면에서 막지만(2.2 ⑨), 순환이 저장되면 삭제 트리거의 `with recursive`가 끝나지 않고, 4단 이상은 화면이 감당하지 못한다. sole-owner 앱이라 권한 문제가 아니라 데이터 모양 문제이므로, 화면 검사 + DB 트리거 1개를 추천한다. 권한·RLS·grant 변경 없음. 화면 작업과 별도 PR, **적용 직전 정지**(AGENTS.md §6·§7).

일상어 3줄: 무엇이 바뀌나 — 프로젝트를 4단 이상으로 두거나 자기 아래로 옮기는 저장을 DB가 거절한다. / 잘못되면 — 정상적인 프로젝트 저장·이동이 거절될 수 있다(기존 데이터는 그대로). / 되돌리는 방법 — 짝 rollback으로 트리거와 함수만 지운다.

초안(파일 이름 예: `2026MMDDhhmmss_prj_depth_guard.sql`, 실제 작성 시 precheck·postcheck·snapshot·summary 짝을 `docs/`에 함께 둔다):

```sql
begin;
-- PRJ-3단 DB 안전망: app_spaces를 3단까지만, 순환 금지. 새 칸·RLS·정책·grant 변경 없음. 데이터 변경 없음.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_spaces in share row exclusive mode;
do $$
begin
  if exists (select 1 from pg_trigger where tgrelid = 'public.app_spaces'::regclass and tgname = 'app_spaces_depth_guard')
     or to_regprocedure('private.app_enforce_space_depth()') is not null then
    raise exception 'PRJ-3단 prerequisite differs (already applied); stop';
  end if;
  -- 이미 4단 이상이거나 맨 위에서 닿지 않는 행(순환)이 있으면 멈춤
  if exists (
    with recursive t(id, lvl, path) as (
      select id, 1, array[id] from public.app_spaces where parent_id is null
      union all
      select s.id, t.lvl + 1, t.path || s.id from public.app_spaces s join t on s.parent_id = t.id where not s.id = any(t.path)
    )
    select 1 from t where lvl > 3
    union all
    select 1 from public.app_spaces s where not exists (select 1 from t where t.id = s.id)
  ) then
    raise exception 'PRJ-3단 prerequisite differs (depth>3 or cycle exists); stop';
  end if;
end
$$;

create function private.app_enforce_space_depth()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_cursor uuid := new.parent_id;
  v_above int := 0;
  v_below int := 1;
begin
  if new.parent_id is null or (tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id) then
    return new;
  end if;
  -- 위로: 상위 단계 수(자기 자신을 만나면 순환)
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception using errcode = '23514', message = 'project cannot be moved under itself';
    end if;
    v_above := v_above + 1;
    if v_above >= 3 then
      raise exception using errcode = '23514', message = 'projects are limited to 3 levels';
    end if;
    select parent_id into v_cursor from public.app_spaces where id = v_cursor;
  end loop;
  -- 아래로: 옮기는 프로젝트 밑 단계 수(새로 만들 때는 1)
  if tg_op = 'UPDATE' then
    with recursive d(id, lvl, path) as (
      select new.id, 1, array[new.id]
      union all
      select s.id, d.lvl + 1, d.path || s.id from public.app_spaces s join d on s.parent_id = d.id
      where not s.id = any(d.path) and d.lvl < 4
    )
    select max(lvl) into v_below from d;
  end if;
  if v_above + v_below > 3 then
    raise exception using errcode = '23514', message = 'projects are limited to 3 levels';
  end if;
  return new;
end
$$;
revoke all on function private.app_enforce_space_depth() from public, anon, authenticated;

create trigger app_spaces_depth_guard
before insert or update of parent_id on public.app_spaces
for each row execute function private.app_enforce_space_depth();

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('2026MMDDhhmmss', 'prj_depth_guard', array['PRJ-3단: app_spaces depth<=3 and no cycle trigger']);
commit;
```

되돌리기 초안:

```sql
begin;
set local lock_timeout = '5s';
drop trigger if exists app_spaces_depth_guard on public.app_spaces;
drop function if exists private.app_enforce_space_depth();
delete from supabase_migrations.schema_migrations where version = '2026MMDDhhmmss' and name = 'prj_depth_guard';
commit;
```

주의(추정, 적용 PR에서 확인): `security invoker`이므로 위로 올라가는 조회는 저장하는 사람의 RLS(`owner_id = auth.uid()`) 안에서만 보인다. sole-owner 구조라 상위는 모두 본인 행이므로 문제없다고 본다. 이 초안은 로컬 PostgreSQL 16의 최소 표(저장소 migration·코드로 추정한 `app_spaces`와 두 기존 트리거)에서 시험했다: 적용 성공, 재적용 거부, 3단 저장 허용, 4단 저장 거절, 순환 이동 거절, 자식 딸린 프로젝트를 옮겨 4단이 되는 경우 거절, 실행 권한을 거둔 `authenticated` 역할로도 트리거 동작, rollback 뒤 제한 해제. 운영 구조와 다를 수 있으므로 적용 PR에서 5절 결과와 대조해 다시 시험한다.

## 5. 운영 대조용 확인 SQL (읽기 전용)

적용 PR 착수 전에 SQL Editor에서 실행해 캡처한다(select만).

```sql
with recursive t(id, lvl, path) as (
  select id, 1, array[id] from public.app_spaces where parent_id is null
  union all
  select s.id, t.lvl + 1, t.path || s.id from public.app_spaces s join t on s.parent_id = t.id where not s.id = any(t.path)
)
select 'max_depth' as item, max(lvl)::text as value from t
union all select 'rows_with_depth_3', count(*)::text from t where lvl = 3
union all select 'unreachable_or_cycle', count(*)::text from public.app_spaces s where not exists (select 1 from t where t.id = s.id)
union all select 'constraint ' || conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.app_spaces'::regclass
union all select 'trigger ' || tgname, tgfoid::regprocedure::text from pg_trigger where tgrelid = 'public.app_spaces'::regclass and not tgisinternal
union all select 'policy ' || polname, polcmd::text from pg_policy where polrelid = 'public.app_spaces'::regclass;
```

판정: `max_depth`가 3이면 2.2 ⑨ 경로로 이미 3단이 있는 것. 검사·트리거 목록에 단계 수를 막는 항목이 없으면 1절 결론(화면 규칙) 그대로.

## 6. PRJ-순서바꾸기와의 관계

- **저장 칸: `app_spaces.sort_order`(정수, 이미 있음, 사실).** 새 프로젝트는 `최댓값 + 10`. 번호는 작업공간 전체에서 하나지만 화면은 형제끼리만 비교하면 되므로(트리는 부모별로 자식을 `sort_order` 순으로 놓음) 새 칸이 필요 없다. 바꾸기는 기존 소유자 PATCH 경로(`/rest/v1/app_spaces?id=eq…`, 지금 상태·이름 수정이 쓰는 길)로 형제들의 번호를 다시 매긴다. DB 변경 없음.
- **지금 순서가 화면마다 다르다(사실).** 같게 하려면 순서바꾸기 PR에서 함께 맞춰야 한다.

| 화면 | 지금 순서 |
| --- | --- |
| 프로젝트 화면·기록할 곳·자료실·공유 페이지·Google 할 일 연결 (`project-catalog.js` `load`) | `sort_order`, 만든 날짜 → 트리 |
| 할 일 화면 프로젝트 고르기 (`task-layout.js`) | `sort_order` 평면(트리 아님) |
| 바구니 분류 안내 (`basket-classification.js`) | `id` 순 → 트리(형제 순서가 id 순) |
| 업무일지 프로젝트 소식 (`journal-data.js`) | 기록 날짜 순으로 이름 묶음(프로젝트 순서 안 씀) |
| 홈 대시보드 (`home-dashboard-v2.js`) | 순서 지정 없음 |

- 3단과 함께 쓰는 규칙(추천): 끌어다 놓기·⋯ 위로/아래로는 **같은 부모 아래 형제 사이에서만**. 부모 바꾸기는 편집 창(상위 고르기)에서만. 그래야 4절 안전망과 겹치지 않는다.
- 순서: `UI-PC프로젝트좌우`(#831) → PRJ-3단 화면 → (선택) 4절 DB 안전망 → PRJ-순서바꾸기 → JOURNAL-주간보고허브 2단계. 앞의 셋이 모두 `app/project-system-v3.js`를 고치므로 줄 세우기(AGENTS.md 2절)로 진행.

## 7. 화면 작업 범위 (PRJ-3단 구현 PR용 파일 목록)

| 파일 | 바꿀 것 |
| --- | --- |
| `app/project-system-v3.js` | 2.2 ①~⑨: 상위 고르기를 1·2단 트리로(자기·자기 아래·3단 제외), 하위 칸·요약을 단계 기준으로, 목록·보관 목록을 `catalog.tree`로, 색은 맨 위 기준, 삭제·보관 안내 개수는 아래 전부, 저장 전 3단 상한·순환 검사 |
| `app/project-system-v3.css` | 목록 3단 들여쓰기·글자 크기 |
| `app/project-catalog-model.mjs` / `app/project-catalog.js` | 필요하면 `depthOf`·경로 도우미(이미 있는 `tree`·`basketProjects` 재사용) |
| `app/library-upload.js` | 세부 줄 3단 이름, (결정 시) 하위 포함 거르기 |
| `app/update-places.js` / `app/choice-sheet.js` | 검색 중 3단 경로 작은 글자(3절 B) |
| `app/task-layout.js` | 프로젝트 고르기를 `catalog.options`로 |
| `tests/app-e2e/` | 3단 만들기·이동 거절·목록 들여쓰기·자료실 거르기 회귀 |

DB 변경 없음(4절을 고르지 않는 한). 업무일지 묶음(3절 D)은 JOURNAL-주간보고허브 2단계에서.

## 8. 명진이 정할 것 (추천과 함께)

1. **DB 안전망 트리거(4절)를 둘까** — 추천: 둔다. 화면 PR 뒤 별도 PR, 적용 직전 정지. 안 두면 화면 검사만으로 막는다.
2. **자료실에서 사업영역(1단)을 고르면 아래 세부 자료도 함께 보일까** — 추천: 함께 보임(2단을 고르면 3단 포함).
3. **프로젝트 목록에서 3단 기본 상태** — 추천: 모두 펼침.
4. **주간보고 초안에서 3단(사안) 기록 표시** — 추천: 세부과제 줄에 `세부과제 › 사안: 내용`으로 붙임(JOURNAL-주간보고허브 2단계에서 구현).
5. **3단 색** — 추천: 맨 위 사업영역 색의 연한 톤.
6. **자식 있는 프로젝트를 옮겨 4단이 되는 경우** — 추천: 저장을 막고 "3단까지만 둘 수 있어요" 안내.

## 9. 범위 밖 발견사항 (고치지 않음)

- 2.2 ⑨: 지금도 편집 창으로 3단이 만들어질 수 있다. 운영에 이미 있는지는 5절 SQL로 확인.
- 2.2 ⑦: 삭제 안내 문구가 손자 수를 세지 않는다(기록 보존은 DB 트리거가 몇 단이든 처리하므로 데이터 위험은 아님).
- 6절 표: 화면마다 프로젝트 순서 기준이 다르다(순서바꾸기에서 함께 정리).
