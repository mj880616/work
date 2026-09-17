# 읽고 생각하고 쓰기 — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 별도 GitHub Pages 사이트 `mj880616/read-think-write`에 로그인, 읽기 자료 등록·열람, 날짜별 아카이브, 개인 메모 저장, 주제 연결, 기본 통합검색까지 가능한 개인 사고 저장소의 1단계를 구축한다.

**Architecture:** Vite 기반의 작은 Vanilla JavaScript SPA로 구축하고, 기존 `work`에서 사용 중인 동일 Supabase 프로젝트의 인증을 재사용하되 데이터는 `rtw_*` 테이블로 완전히 분리한다. 모든 개인 데이터는 RLS로 `auth.uid()` 소유자만 읽고 쓰게 하며, GitHub Pages는 정적 프런트엔드만 배포한다. 깊은 링크는 History API 라우터와 `404.html` 복귀 처리로 `/read-think-write/archive/2026/` 같은 경로를 유지한다.

**Tech Stack:** Vite, Vanilla JavaScript ES modules, `@supabase/supabase-js`, `marked`, `dompurify`, Vitest, Playwright, Supabase Postgres/Auth/RLS, GitHub Pages Actions

**Spec:** `docs/superpowers/specs/2026-09-17-read-think-write-design.md`

## Global Constraints

- 별도 저장소 이름은 `read-think-write`, 사이트 제목은 `읽고 생각하고 쓰기`로 한다.
- 기존 `work` 앱 코드를 통째로 복제하지 않는다.
- 기존 Supabase 프로젝트의 인증 계정은 재사용하되 데이터 테이블은 `rtw_*` 접두사로 분리한다.
- 세션 저장 키는 새 사이트 전용으로 분리한다.
- 개인 메모, 질문, 초안 계열 데이터는 기본 비공개다.
- 외부 저작권 자료의 전체 번역문은 공개를 기본값으로 하지 않는다.
- 기록 시 분류는 선택사항이어야 하며, 분류를 하지 않아도 자료와 메모를 저장할 수 있어야 한다.
- Phase 1 범위는 로그인, 읽기 자료, 날짜 아카이브, 개인 메모, 주제 연결, 기본 검색, 홈 대시보드다.
- 학습 프로젝트, 글쓰기 프로젝트, 독립 질문 페이지, AI 의미검색, 자동 태깅·추천은 Phase 1에서 제외한다.
- 모든 저장 동작은 `저장 중 / 저장 완료 / 저장 실패`를 구분하며 실패 시 입력 내용을 잃지 않는다.
- 코드에 `service_role` 키나 개인 인증정보를 넣지 않는다. 브라우저에는 Supabase publishable key만 사용한다.

---

## Prerequisite: 새 GitHub 저장소 생성

현재 연결된 GitHub 도구에는 저장소 생성 액션이 없으므로 구현 시작 전에 GitHub에서 다음 저장소를 한 번 생성한다.

- Owner: `mj880616`
- Repository: `read-think-write`
- Visibility: `Public` (GitHub Pages 사용 목적; 개인 데이터는 Supabase에만 저장)
- Initialize: README 포함
- Default branch: `main`

저장소 생성 후 구현 작업은 `feature/phase1-foundation` 브랜치와 격리된 worktree에서 진행한다.

---

## File Map

구현 저장소 `mj880616/read-think-write`의 Phase 1 파일 구조를 아래처럼 고정한다.

```text
read-think-write/
├─ .github/
│  └─ workflows/
│     └─ pages.yml                  # 테스트 + 빌드 + GitHub Pages 배포
├─ public/
│  └─ 404.html                     # GitHub Pages deep-link 복귀
├─ src/
│  ├─ app.js                       # 앱 부트스트랩
│  ├─ config.js                    # Supabase 공개 설정, base path
│  ├─ styles.css                   # 공통 레이아웃과 읽기 화면 스타일
│  ├─ router.js                    # History API 라우터
│  ├─ runtime/
│  │  ├─ supabase.js               # Supabase client 생성
│  │  ├─ auth.js                   # 로그인/로그아웃/세션 가드
│  │  └─ draft-store.js            # 저장 실패 대비 브라우저 임시 초안
│  ├─ data/
│  │  ├─ resources.js              # rtw_resources CRUD
│  │  ├─ notes.js                  # rtw_notes CRUD
│  │  ├─ topics.js                 # rtw_topics 및 연결 CRUD
│  │  └─ search.js                 # 통합 검색
│  ├─ domain/
│  │  └─ archive.js                # 연/월/일 그룹화 순수 함수
│  ├─ ui/
│  │  ├─ shell.js                  # 헤더·내비게이션·공통 상태
│  │  ├─ login-view.js             # 이메일/비밀번호 로그인
│  │  ├─ home-view.js              # 최근 읽기·최근 메모·주제 요약
│  │  ├─ reading-view.js           # 읽기 목록
│  │  ├─ resource-view.js          # 자료 상세 + Markdown 본문
│  │  ├─ resource-editor.js        # 자료 신규/수정
│  │  ├─ note-editor.js            # 자료별 내 메모
│  │  ├─ archive-view.js           # 연도→월→날짜→자료 토글
│  │  ├─ topics-view.js            # 주제 목록·상세·자료 연결
│  │  └─ search-view.js            # 검색 입력과 통합 결과
│  └─ utils/
│     ├─ escape.js                 # DOM 출력 보조
│     └─ slug.js                   # 주제 slug 생성
├─ supabase/
│  └─ migrations/
│     └─ 202609170001_phase1.sql   # 스키마, RLS, 인덱스, trigger
├─ tests/
│  ├─ unit/
│  │  ├─ archive.test.js
│  │  ├─ slug.test.js
│  │  └─ draft-store.test.js
│  └─ e2e/
│     └─ phase1.spec.js
├─ index.html
├─ package.json
├─ playwright.config.js
└─ vite.config.js
```

---

### Task 1: 프로젝트 셸과 테스트 기반 구축

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `index.html`
- Create: `src/app.js`
- Create: `src/config.js`
- Create: `src/styles.css`
- Create: `src/ui/shell.js`
- Create: `tests/unit/slug.test.js`
- Create: `src/utils/slug.js`

**Interfaces:**
- Produces: `slugifyTopic(name: string): string`
- Produces: `mountShell(root: HTMLElement): { main: HTMLElement, setActive(path: string): void }`
- Produces: `BASE_PATH = '/read-think-write/'`

- [ ] **Step 1: 저장소와 격리 작업공간 준비**

`mj880616/read-think-write`를 clone하고 `feature/phase1-foundation` 브랜치의 worktree를 만든다. worktree 생성은 `superpowers:using-git-worktrees` 지침을 따른다.

- [ ] **Step 2: npm 프로젝트와 의존성 정의**

`package.json`을 다음 핵심 스크립트와 의존성으로 만든다.

```json
{
  "name": "read-think-write",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.57.0",
    "dompurify": "^3.2.6",
    "marked": "^16.2.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "jsdom": "^26.1.0",
    "vite": "^7.1.0",
    "vitest": "^3.2.4"
  }
}
```

Run: `npm install`

Expected: `package-lock.json` 생성, 설치 오류 없음.

- [ ] **Step 3: slug 테스트를 먼저 작성**

`tests/unit/slug.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { slugifyTopic } from '../../src/utils/slug.js';

describe('slugifyTopic', () => {
  it('한글은 유지하고 공백은 하이픈으로 바꾼다', () => {
    expect(slugifyTopic('AI와 노동')).toBe('ai와-노동');
  });

  it('연속 구분자와 앞뒤 하이픈을 제거한다', () => {
    expect(slugifyTopic('  노동자  통제 / 산업민주주의  ')).toBe('노동자-통제-산업민주주의');
  });
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `npm test -- tests/unit/slug.test.js`

Expected: `../../src/utils/slug.js`를 찾지 못해 FAIL.

- [ ] **Step 5: 최소 slug 구현**

`src/utils/slug.js`:

```js
export function slugifyTopic(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm test -- tests/unit/slug.test.js`

Expected: 2 tests PASS.

- [ ] **Step 7: Vite base path와 앱 셸 구현**

`vite.config.js`:

```js
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/read-think-write/',
  test: { environment: 'jsdom' }
});
```

`src/config.js`에서 다음 상수를 export한다.

```js
export const BASE_PATH = '/read-think-write/';
export const SESSION_KEY = 'rtw_session_v1';
export const SUPABASE_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
```

`index.html`은 `#app` 하나와 `/src/app.js` 진입점만 가진다. `shell.js`는 상단 제목 `읽고 생각하고 쓰기`와 `홈 · 읽기 · 생각 · 주제 · 아카이브 · 검색` 내비게이션을 만든다. Phase 1의 `생각` 메뉴는 자료와 연결되지 않은 독립 메모 작성 화면이 아니라 최근 메모 목록으로만 제공하고, 신규 독립 메모 기능은 Phase 2로 미룬다.

- [ ] **Step 8: 기본 빌드 검증**

Run: `npm run build`

Expected: `dist/` 생성, Vite build 성공.

- [ ] **Step 9: 커밋**

```bash
git add package.json package-lock.json vite.config.js index.html src tests/unit/slug.test.js
git commit -m "chore: scaffold read-think-write app"
```

---

### Task 2: Supabase Phase 1 스키마와 RLS

**Files:**
- Create: `supabase/migrations/202609170001_phase1.sql`

**Interfaces:**
- Produces tables: `public.rtw_resources`, `public.rtw_notes`, `public.rtw_topics`, `public.rtw_resource_topics`
- All owner-scoped rows use `owner_id uuid not null default auth.uid()`

- [ ] **Step 1: 마이그레이션 SQL 작성**

`supabase/migrations/202609170001_phase1.sql`에 아래 구조를 작성한다.

```sql
create extension if not exists pgcrypto;

create table if not exists public.rtw_resources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  original_title text,
  author text,
  source_name text,
  published_on date,
  original_url text,
  body_md text not null default '',
  visibility text not null default 'private' check (visibility in ('private','public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rtw_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  resource_id uuid references public.rtw_resources(id) on delete cascade,
  body text not null,
  note_type text check (note_type is null or note_type in ('생각','질문','좋은 문장','반론','글감','업무 연결')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rtw_topics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table if not exists public.rtw_resource_topics (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  resource_id uuid not null references public.rtw_resources(id) on delete cascade,
  topic_id uuid not null references public.rtw_topics(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (resource_id, topic_id)
);

create or replace function public.rtw_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger rtw_resources_touch_updated_at
before update on public.rtw_resources
for each row execute function public.rtw_touch_updated_at();

create trigger rtw_notes_touch_updated_at
before update on public.rtw_notes
for each row execute function public.rtw_touch_updated_at();

create trigger rtw_topics_touch_updated_at
before update on public.rtw_topics
for each row execute function public.rtw_touch_updated_at();

create index if not exists rtw_resources_owner_published_idx
  on public.rtw_resources(owner_id, published_on desc nulls last);
create index if not exists rtw_notes_owner_updated_idx
  on public.rtw_notes(owner_id, updated_at desc);
create index if not exists rtw_notes_resource_idx
  on public.rtw_notes(resource_id, updated_at desc);
create index if not exists rtw_topics_owner_name_idx
  on public.rtw_topics(owner_id, name);

alter table public.rtw_resources enable row level security;
alter table public.rtw_notes enable row level security;
alter table public.rtw_topics enable row level security;
alter table public.rtw_resource_topics enable row level security;

create policy "rtw resources select owner or public"
on public.rtw_resources for select
using (owner_id = auth.uid() or visibility = 'public');

create policy "rtw resources insert owner"
on public.rtw_resources for insert
with check (owner_id = auth.uid());

create policy "rtw resources update owner"
on public.rtw_resources for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "rtw resources delete owner"
on public.rtw_resources for delete
using (owner_id = auth.uid());

create policy "rtw notes owner all"
on public.rtw_notes for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "rtw topics owner all"
on public.rtw_topics for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "rtw resource topics owner all"
on public.rtw_resource_topics for all
using (owner_id = auth.uid())
with check (
  owner_id = auth.uid()
  and exists (select 1 from public.rtw_resources r where r.id = resource_id and r.owner_id = auth.uid())
  and exists (select 1 from public.rtw_topics t where t.id = topic_id and t.owner_id = auth.uid())
);
```

- [ ] **Step 2: SQL 정적 검토**

다음 항목을 수동 확인한다.

```text
[ ] 모든 개인 테이블 RLS enabled
[ ] notes는 public select 정책 없음
[ ] topics는 public select 정책 없음
[ ] resource_topics 연결 시 양쪽 소유권 검증
[ ] resources의 기본 visibility = private
[ ] service_role key 불필요
```

- [ ] **Step 3: Supabase 프로젝트에 마이그레이션 적용**

연결된 Supabase 도구를 사용할 수 있으면 SQL을 그대로 실행한다. 사용할 수 없으면 Supabase SQL Editor에서 파일 전체를 1회 실행한다.

검증 SQL:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename like 'rtw_%'
order by tablename;
```

Expected: 네 테이블 모두 `rowsecurity = true`.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/202609170001_phase1.sql
git commit -m "feat: add read-think-write phase1 schema"
```

---

### Task 3: 인증·세션·라우터 기반

**Files:**
- Create: `src/runtime/supabase.js`
- Create: `src/runtime/auth.js`
- Create: `src/router.js`
- Create: `src/ui/login-view.js`
- Modify: `src/app.js`
- Create: `public/404.html`

**Interfaces:**
- Produces: `supabase`
- Produces: `getSession(): Promise<Session|null>`
- Produces: `signIn(email: string, password: string): Promise<void>`
- Produces: `signOut(): Promise<void>`
- Produces: `requireSession(): Promise<Session>`
- Produces: `router.start()`, `router.navigate(path)`, `router.on(pattern, handler)`

- [ ] **Step 1: Supabase client 구성**

`src/runtime/supabase.js`:

```js
import { createClient } from '@supabase/supabase-js';
import { SESSION_KEY, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storageKey: SESSION_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
```

- [ ] **Step 2: 인증 서비스 구현**

`auth.js`는 `supabase.auth.getSession`, `signInWithPassword`, `signOut`만 감싼다. 오류 메시지는 한국어 UI에서 처리할 수 있도록 원래 `error.message`를 보존한다.

- [ ] **Step 3: History API 라우터 구현**

라우트는 최소 다음 경로를 지원한다.

```text
/read-think-write/
/read-think-write/login/
/read-think-write/reading/
/read-think-write/reading/new/
/read-think-write/resource/:id/
/read-think-write/archive/
/read-think-write/archive/:year/
/read-think-write/topics/
/read-think-write/topics/:slug/
/read-think-write/search/
```

라우터는 앱 내부 `<a data-route>` 클릭을 가로채 `history.pushState()` 후 렌더하고, `popstate`를 처리한다.

- [ ] **Step 4: GitHub Pages deep-link 복귀 구현**

`public/404.html`은 현재 URL의 path/query/hash를 `sessionStorage` 키 `rtw_redirect_after_404`에 저장한 뒤 `/read-think-write/`로 이동한다.

`src/app.js` 부팅 직후 해당 값이 있으면 같은 origin이고 `/read-think-write/` 아래인지 검증한 뒤 `history.replaceState()`로 원래 경로를 복원한다.

- [ ] **Step 5: 로그인 화면과 세션 가드 연결**

비로그인 상태에서 `/login/` 외 경로로 들어오면 `/login/?return=<encoded path>`로 이동한다. 로그인 성공 후 `return` 경로로 복귀한다.

- [ ] **Step 6: 로컬 수동 검증**

Run: `npm run dev`

검증:

```text
[ ] 잘못된 계정 로그인 실패 메시지 표시
[ ] 정상 계정 로그인 후 홈 이동
[ ] 새로고침 후 로그인 유지
[ ] 로그아웃 후 로그인 화면 이동
[ ] history 뒤로가기/앞으로가기 정상
```

- [ ] **Step 7: 커밋**

```bash
git add src/runtime src/router.js src/ui/login-view.js src/app.js public/404.html
git commit -m "feat: add auth and client routing"
```

---

### Task 4: 자료 데이터 계층과 읽기 CRUD

**Files:**
- Create: `src/data/resources.js`
- Create: `src/ui/reading-view.js`
- Create: `src/ui/resource-editor.js`
- Create: `src/ui/resource-view.js`
- Modify: `src/app.js`

**Interfaces:**
- Produces: `listResources(): Promise<Resource[]>`
- Produces: `getResource(id: string): Promise<Resource>`
- Produces: `createResource(input: ResourceInput): Promise<Resource>`
- Produces: `updateResource(id: string, input: Partial<ResourceInput>): Promise<Resource>`
- `ResourceInput = { title, original_title, author, source_name, published_on, original_url, body_md, visibility }`

- [ ] **Step 1: 데이터 함수 구현 전에 호출 계약을 테스트 가능한 형태로 고정**

`resources.js`는 Supabase query builder 외부로 노출하지 않고 위 네 함수만 export한다. 생성 시 `visibility`가 없으면 명시적으로 `private`를 넣는다.

- [ ] **Step 2: 읽기 목록 구현**

`reading-view.js`는 `published_on desc nulls last`, `created_at desc` 순으로 자료를 보여주며 `+ 새 글` 버튼을 제공한다.

각 항목은 다음 메타만 노출한다.

```text
2026.09.14
기술노동자 권력의 부상과 몰락
JS Tan · Clarissa Redwine · Boston Review
```

- [ ] **Step 3: 자료 편집기 구현**

필드:

```text
제목* / 원제 / 저자 / 출처 / 발표일 / 원문 링크 / 본문·번역문 / 공개 여부
```

공개 여부 기본값은 `private`다. 본문은 Markdown textarea로 입력한다. 저장 버튼은 중복 클릭을 막고 상태를 `저장 중... → 저장됨`으로 전환한다.

- [ ] **Step 4: Markdown 안전 렌더링 구현**

`resource-view.js`에서는 반드시 아래 순서로 렌더한다.

```js
const dirty = marked.parse(resource.body_md ?? '');
const safe = DOMPurify.sanitize(dirty);
bodyElement.innerHTML = safe;
```

원문 링크는 `http:` 또는 `https:`인 경우만 외부 링크로 렌더한다.

- [ ] **Step 5: 읽기 CRUD 수동 검증**

```text
[ ] 새 자료 등록
[ ] private가 기본 선택
[ ] 등록 후 읽기 목록에 표시
[ ] 상세 화면 Markdown 렌더
[ ] 수정 후 새로고침해도 변경 유지
[ ] 잘못된 URL은 외부 링크로 렌더하지 않음
```

- [ ] **Step 6: 커밋**

```bash
git add src/data/resources.js src/ui/reading-view.js src/ui/resource-editor.js src/ui/resource-view.js src/app.js
git commit -m "feat: add reading resource workflow"
```

---

### Task 5: 메모 저장과 실패 복구

**Files:**
- Create: `src/data/notes.js`
- Create: `src/runtime/draft-store.js`
- Create: `src/ui/note-editor.js`
- Create: `tests/unit/draft-store.test.js`
- Modify: `src/ui/resource-view.js`

**Interfaces:**
- Produces: `listNotesForResource(resourceId: string): Promise<Note[]>`
- Produces: `createNote(resourceId: string, body: string, noteType?: string|null): Promise<Note>`
- Produces: `updateNote(id: string, body: string, noteType?: string|null): Promise<Note>`
- Produces: `saveDraft(key: string, value: string)`, `readDraft(key: string): string`, `clearDraft(key: string)`

- [ ] **Step 1: draft-store 실패 테스트 작성**

`tests/unit/draft-store.test.js`:

```js
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, readDraft, saveDraft } from '../../src/runtime/draft-store.js';

beforeEach(() => localStorage.clear());

describe('draft store', () => {
  it('입력 중 메모를 복구한다', () => {
    saveDraft('note:abc', '아직 저장하지 않은 생각');
    expect(readDraft('note:abc')).toBe('아직 저장하지 않은 생각');
  });

  it('저장 성공 후 초안을 지운다', () => {
    saveDraft('note:abc', '내용');
    clearDraft('note:abc');
    expect(readDraft('note:abc')).toBe('');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- tests/unit/draft-store.test.js`

Expected: module not found FAIL.

- [ ] **Step 3: draft-store 구현 후 테스트 통과**

키는 반드시 `rtw_draft:<logical-key>`로 namespace한다.

Run: `npm test -- tests/unit/draft-store.test.js`

Expected: PASS.

- [ ] **Step 4: 자료별 메모 편집기 구현**

자료 상세 하단에 `나의 메모` 영역을 둔다. Phase 1에서는 한 자료에 여러 메모를 허용하되 가장 최근 메모를 먼저 보여준다. 새 메모 입력창에는 선택형 `note_type`과 자유 텍스트가 있다.

입력 이벤트마다 localStorage 초안을 갱신하고, DB 저장 성공 시에만 초안을 삭제한다.

- [ ] **Step 5: 저장 오류 UX 검증**

브라우저 devtools에서 네트워크를 offline으로 전환해 저장을 시도한다.

Expected:

```text
저장 실패. 입력 내용은 이 브라우저에 임시 보관했습니다.
```

온라인 복귀 후 페이지를 새로고침하면 입력 내용이 복구되어야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/data/notes.js src/runtime/draft-store.js src/ui/note-editor.js src/ui/resource-view.js tests/unit/draft-store.test.js
git commit -m "feat: add private notes with draft recovery"
```

---

### Task 6: 날짜 아카이브

**Files:**
- Create: `src/domain/archive.js`
- Create: `tests/unit/archive.test.js`
- Create: `src/ui/archive-view.js`
- Modify: `src/app.js`

**Interfaces:**
- Produces: `groupResourcesByDate(resources: Resource[]): ArchiveYear[]`
- `ArchiveYear = { year: number, months: [{ month: number, days: [{ day: number, resources: Resource[] }] }] }`

- [ ] **Step 1: 그룹화 테스트 작성**

`tests/unit/archive.test.js`에서 최소 다음을 검증한다.

```js
import { describe, expect, it } from 'vitest';
import { groupResourcesByDate } from '../../src/domain/archive.js';

describe('groupResourcesByDate', () => {
  it('발표일 기준 연-월-일로 묶고 최신 날짜부터 정렬한다', () => {
    const result = groupResourcesByDate([
      { id: 'a', title: 'A', published_on: '2026-09-14' },
      { id: 'b', title: 'B', published_on: '2026-09-17' },
      { id: 'c', title: 'C', published_on: '2025-12-31' }
    ]);
    expect(result[0].year).toBe(2026);
    expect(result[0].months[0].month).toBe(9);
    expect(result[0].months[0].days.map(d => d.day)).toEqual([17, 14]);
    expect(result[1].year).toBe(2025);
  });

  it('발표일 없는 자료는 날짜 아카이브에서 제외한다', () => {
    const result = groupResourcesByDate([{ id: 'x', title: 'X', published_on: null }]);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인 후 최소 구현**

Run: `npm test -- tests/unit/archive.test.js`

Expected: first FAIL, implementation 후 PASS.

- [ ] **Step 3: 아카이브 UI 구현**

`archive-view.js`는 다음 계층을 그대로 렌더한다.

```text
2026년
  9월 ▼
    9월 17일
      제목 A ▸
    9월 14일
      기술노동자 권력의 부상과 몰락 ▸
```

월과 자료 본문은 `<details><summary>`를 사용한다. 제목을 펼치면 메타정보, Markdown 본문, 해당 자료의 메모 목록을 함께 표시한다.

- [ ] **Step 4: 연도 경로 필터 구현**

`/archive/2026/`에서는 2026년만 보인다. `/archive/`에서는 모든 연도를 보인다. 존재하지 않는 연도는 `해당 연도의 기록이 없습니다.`를 표시한다.

- [ ] **Step 5: 커밋**

```bash
git add src/domain/archive.js src/ui/archive-view.js src/app.js tests/unit/archive.test.js
git commit -m "feat: add chronological reading archive"
```

---

### Task 7: 주제 생성과 자료 연결

**Files:**
- Create: `src/data/topics.js`
- Create: `src/ui/topics-view.js`
- Modify: `src/ui/resource-view.js`
- Modify: `src/ui/resource-editor.js`
- Modify: `src/app.js`

**Interfaces:**
- Produces: `listTopics(): Promise<Topic[]>`
- Produces: `createTopic(name: string): Promise<Topic>`
- Produces: `getTopicBySlug(slug: string): Promise<Topic|null>`
- Produces: `listResourceTopics(resourceId: string): Promise<Topic[]>`
- Produces: `setResourceTopics(resourceId: string, topicIds: string[]): Promise<void>`

- [ ] **Step 1: 주제 목록·생성 구현**

주제 생성 시 `slugifyTopic(name)`을 사용한다. 같은 사용자의 같은 slug가 이미 있으면 새 row를 만들지 않고 기존 주제를 사용한다.

- [ ] **Step 2: 자료 편집기에서 주제 연결 구현**

자료 저장 후 주제 다중 선택을 저장한다. 주제가 하나도 없어도 정상 저장되어야 한다.

첫 자료에 사용할 초기 주제는 다음 두 개만 생성한다.

```text
기술노동
노동운동
```

- [ ] **Step 3: 주제 상세 화면 구현**

`/topics/<slug>/`에서 아래를 보여준다.

```text
주제 이름
현재까지의 생각(summary)
관련 읽기
관련 최근 메모
```

Phase 1에서는 `summary`를 짧은 자유 텍스트로 직접 편집할 수 있게 한다.

- [ ] **Step 4: 소유권 오류 검증**

다른 사용자의 topic id를 임의로 연결하려는 요청은 RLS에서 실패해야 한다.

- [ ] **Step 5: 커밋**

```bash
git add src/data/topics.js src/ui/topics-view.js src/ui/resource-view.js src/ui/resource-editor.js src/app.js
git commit -m "feat: connect reading resources to topics"
```

---

### Task 8: 기본 통합검색

**Files:**
- Create: `src/data/search.js`
- Create: `src/ui/search-view.js`
- Modify: `src/app.js`

**Interfaces:**
- Produces: `searchAll(query: string): Promise<{ resources: Resource[], notes: Note[], topics: Topic[] }>`

- [ ] **Step 1: 검색 문자열 정규화**

앞뒤 공백을 제거한 뒤 빈 문자열이면 DB 호출 없이 빈 결과를 반환한다. 사용자 입력을 SQL 문자열로 직접 조합하지 않고 Supabase query builder의 `ilike` 필터를 사용한다.

- [ ] **Step 2: 3종 검색 구현**

검색 대상:

```text
resources: title, original_title, author, source_name, body_md
notes: body
 topics: name, summary
```

각 유형 최대 30건, 최근 수정 순으로 제한한다.

- [ ] **Step 3: 검색 UI 구현**

검색 결과는 `읽기 / 메모 / 주제` 세 구역으로 나눈다. 메모 결과에는 연결된 resource id가 있으면 해당 자료로 이동하는 링크를 제공한다.

- [ ] **Step 4: 검색 검증**

초기 자료 등록 후 다음 검색어로 확인한다.

```text
기술노동자
계급
Boston Review
```

각 결과가 제목·본문·메모 위치에 따라 적절히 나타나는지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add src/data/search.js src/ui/search-view.js src/app.js
git commit -m "feat: add basic archive search"
```

---

### Task 9: 홈 대시보드와 최근 생각 흐름

**Files:**
- Create: `src/ui/home-view.js`
- Modify: `src/app.js`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `listResources`, recent notes query, `listTopics`

- [ ] **Step 1: 홈 데이터 집계 구현**

홈은 다음만 보여준다.

```text
최근 읽은 글 5개
최근 메모 5개
주제 8개
연도별 아카이브 바로가기
```

아직 구현하지 않은 학습·쓰기·질문 카드는 표시하지 않는다.

- [ ] **Step 2: 읽기 중심 레이아웃 구현**

본문 최대 폭은 `760px`, 홈 카드 영역 최대 폭은 `1080px`로 한다. 자료 본문은 한글 장문 읽기에 맞춰 `line-height: 1.8` 이상을 사용하고 모바일에서는 좌우 padding을 `20px` 이상 확보한다.

- [ ] **Step 3: 모바일 검증**

Playwright 또는 브라우저 responsive mode에서 390px 폭을 확인한다.

```text
[ ] 제목 잘림 없음
[ ] 본문 가로 스크롤 없음
[ ] textarea 화면 밖으로 넘치지 않음
[ ] 내비게이션 터치 가능
```

- [ ] **Step 4: 커밋**

```bash
git add src/ui/home-view.js src/app.js src/styles.css
git commit -m "feat: add personal thinking dashboard"
```

---

### Task 10: Playwright E2E와 회귀검사

**Files:**
- Create: `playwright.config.js`
- Create: `tests/e2e/phase1.spec.js`

**Interfaces:**
- Tests the built app with mocked Supabase HTTP responses; production RLS is verified separately in Task 2.

- [ ] **Step 1: Playwright 설정**

`playwright.config.js`는 Vite dev server를 자동 실행한다.

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/read-think-write/',
    reuseExistingServer: !process.env.CI
  }
});
```

- [ ] **Step 2: 핵심 E2E 작성**

`tests/e2e/phase1.spec.js`에서 Supabase API를 route mock하고 다음 사용자 흐름을 한 테스트로 검증한다.

```text
1. 로그인
2. 새 자료 작성
3. 발표일 2026-09-14 저장
4. 상세 화면 열기
5. 메모 작성 및 저장
6. 주제 `기술노동`, `노동운동` 연결
7. 아카이브 → 2026년 → 9월 → 9월 14일 확인
8. 제목 토글 열어 본문과 메모 확인
9. 검색에서 `기술노동자` 검색
10. 검색 결과에서 자료 재진입
```

- [ ] **Step 3: 전체 테스트 실행**

Run:

```bash
npm test
npm run test:e2e
npm run build
```

Expected: 모두 PASS.

- [ ] **Step 4: 커밋**

```bash
git add playwright.config.js tests/e2e/phase1.spec.js
git commit -m "test: cover phase1 reading workflow"
```

---

### Task 11: GitHub Pages CI/CD

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Produces production artifact: `dist/`

- [ ] **Step 1: Pages workflow 작성**

Workflow는 `main` push와 pull request에서 `npm ci`, `npm test`, `npm run build`를 수행한다. `main` push일 때만 Pages deploy job을 실행한다.

핵심 deploy 단계:

```yaml
- uses: actions/configure-pages@v5
- uses: actions/upload-pages-artifact@v3
  with:
    path: ./dist
- uses: actions/deploy-pages@v4
```

Permissions:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

- [ ] **Step 2: 로컬 검증**

Run:

```bash
npm ci
npm test
npm run build
```

Expected: 모두 성공.

- [ ] **Step 3: 커밋 및 PR 생성**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: deploy read-think-write to github pages"
git push -u origin feature/phase1-foundation
```

`feature/phase1-foundation` → `main` PR을 만들고 CI가 통과한 뒤 merge한다.

- [ ] **Step 4: GitHub Pages source를 Actions로 설정**

저장소 Settings → Pages → Build and deployment → Source를 `GitHub Actions`로 지정한다.

예상 배포 주소:

`https://mj880616.github.io/read-think-write/`

---

### Task 12: 첫 자료 입력 및 운영 검증

**Files:**
- No repository file changes required.

**Interfaces:**
- Uses production UI only; copyrighted translation text is not committed to public Git.

- [ ] **Step 1: 첫 자료를 운영 UI에서 등록**

메타데이터:

```text
발표일: 2026-09-14
제목: 기술노동자 권력의 부상과 몰락
원제: The Rise and Fall of Tech Worker Power
저자: JS Tan, Clarissa Redwine
출처: Boston Review
원문: https://www.bostonreview.net/articles/the-rise-and-fall-of-tech-worker-power/
공개 여부: 비공개
```

본문에는 현재 대화에서 확정한 전체 한국어 번역문을 붙여넣는다. 번역문 자체는 GitHub 저장소 파일이나 seed SQL에 넣지 않는다.

- [ ] **Step 2: 초기 주제 연결**

```text
기술노동
노동운동
```

- [ ] **Step 3: 운영 환경 메모 저장 확인**

자료 하단 `나의 메모`에 짧은 테스트 문장을 저장한 뒤 새로고침한다. 그대로 유지되는지 확인한다.

- [ ] **Step 4: 날짜 아카이브 확인**

`/read-think-write/archive/2026/`에서 `9월 → 9월 14일 → 기술노동자 권력의 부상과 몰락` 순으로 열리는지 확인한다.

- [ ] **Step 5: 비공개 보호 확인**

로그아웃한 브라우저에서 해당 resource UUID의 직접 URL로 접근한다.

Expected: 로그인 화면으로 이동하며 번역문과 개인 메모가 노출되지 않는다.

---

## Phase 1 Acceptance Checklist

```text
[ ] 별도 GitHub Pages 사이트로 배포됨
[ ] 기존 work 앱과 코드·저장소가 분리됨
[ ] 동일 Supabase Auth 계정으로 로그인 가능
[ ] rtw_* 데이터는 RLS로 사용자별 격리됨
[ ] 새 읽기 자료를 UI에서 계속 추가·수정할 수 있음
[ ] 자료 본문은 안전한 Markdown으로 읽을 수 있음
[ ] 자료별 나의 메모를 저장하고 새로고침 후 다시 볼 수 있음
[ ] 저장 실패 시 입력이 localStorage 초안으로 남음
[ ] 연도 → 월 → 날짜 → 제목 구조의 아카이브가 작동함
[ ] 2026-09-14 첫 자료가 올바른 날짜에 표시됨
[ ] 주제를 만들고 자료와 연결할 수 있음
[ ] 자료·메모·주제를 검색할 수 있음
[ ] 모바일 화면에서 장문 읽기와 메모 작성이 가능함
[ ] 비로그인 사용자가 private 본문·메모를 볼 수 없음
[ ] npm test, Playwright E2E, npm run build 모두 통과함
```

## Deferred to Phase 2+

다음은 의도적으로 이번 계획에서 제외한다.

```text
- 구조화된 학습 프로젝트와 목차
- 글쓰기 씨앗 → 문제의식 → 자료수집 → 개요 → 초안 → 완성 워크플로
- 질문을 독립 객체로 관리하는 화면
- 독립 메모 전용 작성 화면
- 생각의 버전 히스토리와 변화 타임라인
- AI 의미검색/임베딩
- 자동 태깅과 관계 추천
- 관련 글 자동 추천
- 외부 글 자동 수집
```

Phase 1을 실제로 사용하면서 생긴 기록 패턴을 본 뒤 Phase 2의 데이터 모델과 UX를 확정한다.
