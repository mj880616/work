# 읽고 생각하고 쓰기 — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 별도 GitHub Pages 사이트 `mj880616/read-think-write`에 로그인, 읽기 자료, 날짜 아카이브, 자료별·독립 메모, 주제, 질문, 기본 검색까지 가능한 개인 사고 저장소의 1단계를 구축한다.

**Architecture:** Vite 기반 Vanilla JavaScript SPA로 구축한다. 기존 `work`에서 사용하는 동일 Supabase 프로젝트의 인증 계정은 재사용하되 데이터는 `rtw_*` 테이블로 분리한다. 개인 데이터는 RLS로 `auth.uid()` 소유자에게만 허용하고, 자료·메모·주제·질문 사이의 연결은 범용 `rtw_relations` 테이블로 관리한다. GitHub Pages는 정적 프런트엔드만 배포하며 History API + `404.html` 복귀 처리로 `/read-think-write/archive/2026/` 같은 깊은 링크를 유지한다.

**Tech Stack:** Vite, Vanilla JavaScript ES modules, `@supabase/supabase-js`, `marked`, `dompurify`, Vitest, Playwright, Supabase Postgres/Auth/RLS, GitHub Pages Actions

**Spec:** `docs/superpowers/specs/2026-09-17-read-think-write-design.md`

## Global Constraints

- 별도 저장소 이름은 `read-think-write`, 사이트 제목은 `읽고 생각하고 쓰기`로 한다.
- 기존 `work` 앱 코드를 통째로 복제하지 않는다.
- 기존 Supabase 프로젝트 인증 계정은 재사용하되 데이터 테이블은 `rtw_*` 접두사로 분리한다.
- 세션 저장 키는 새 사이트 전용으로 분리한다.
- 개인 메모·질문·번역문은 기본 비공개다.
- 외부 저작권 자료의 전체 번역문은 공개를 기본값으로 하지 않는다.
- 기록 시 분류는 선택사항이며 주제나 질문을 연결하지 않아도 저장 가능해야 한다.
- Phase 1 범위는 로그인, 읽기 자료, 날짜 아카이브, 자료별 메모, 독립 메모, 주제, 질문, 기본 검색, 홈 대시보드다.
- 학습 프로젝트, 글쓰기 프로젝트, AI 의미검색, 자동 태깅·추천은 Phase 1에서 제외한다.
- 모든 저장 동작은 `저장 중 / 저장 완료 / 저장 실패`를 구분하고 실패 시 입력 내용을 브라우저에 임시 보존한다.
- 코드에 `service_role` 키나 개인 인증정보를 넣지 않는다. 브라우저에는 Supabase publishable key만 사용한다.

---

## Prerequisite: 새 GitHub 저장소 생성

현재 연결된 GitHub 도구에는 저장소 생성 액션이 없으므로 구현 시작 전에 GitHub에서 다음 저장소를 한 번 생성한다.

- Owner: `mj880616`
- Repository: `read-think-write`
- Visibility: `Public`
- Initialize: README 포함
- Default branch: `main`

저장소 생성 후 `feature/phase1-foundation` 브랜치와 격리 worktree에서 구현한다.

---

## File Map

```text
read-think-write/
├─ .github/workflows/pages.yml
├─ public/404.html
├─ src/
│  ├─ app.js
│  ├─ config.js
│  ├─ router.js
│  ├─ styles.css
│  ├─ runtime/
│  │  ├─ supabase.js
│  │  ├─ auth.js
│  │  └─ draft-store.js
│  ├─ data/
│  │  ├─ resources.js
│  │  ├─ notes.js
│  │  ├─ topics.js
│  │  ├─ questions.js
│  │  ├─ relations.js
│  │  └─ search.js
│  ├─ domain/
│  │  └─ archive.js
│  ├─ ui/
│  │  ├─ shell.js
│  │  ├─ login-view.js
│  │  ├─ home-view.js
│  │  ├─ reading-view.js
│  │  ├─ resource-view.js
│  │  ├─ resource-editor.js
│  │  ├─ note-editor.js
│  │  ├─ notes-view.js
│  │  ├─ archive-view.js
│  │  ├─ topics-view.js
│  │  ├─ questions-view.js
│  │  └─ search-view.js
│  └─ utils/
│     ├─ slug.js
│     └─ safe-url.js
├─ supabase/migrations/202609170001_phase1.sql
├─ tests/unit/
│  ├─ archive.test.js
│  ├─ slug.test.js
│  ├─ safe-url.test.js
│  └─ draft-store.test.js
├─ tests/e2e/phase1.spec.js
├─ index.html
├─ package.json
├─ playwright.config.js
└─ vite.config.js
```

---

### Task 1: 프로젝트 셸과 단위테스트 기반

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `index.html`
- Create: `src/app.js`
- Create: `src/config.js`
- Create: `src/styles.css`
- Create: `src/ui/shell.js`
- Create: `src/utils/slug.js`
- Create: `src/utils/safe-url.js`
- Test: `tests/unit/slug.test.js`
- Test: `tests/unit/safe-url.test.js`

**Interfaces:**
- Produces: `slugifyTopic(name: string): string`
- Produces: `safeExternalUrl(value: string): string|null`
- Produces: `mountShell(root: HTMLElement): { main: HTMLElement, setActive(path: string): void }`

- [ ] **Step 1: 격리 작업공간 준비**

`superpowers:using-git-worktrees` 지침으로 `feature/phase1-foundation` worktree를 만든다.

- [ ] **Step 2: npm 프로젝트 정의**

`package.json`:

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

- [ ] **Step 3: slug와 URL 실패 테스트 작성**

`tests/unit/slug.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { slugifyTopic } from '../../src/utils/slug.js';

describe('slugifyTopic', () => {
  it('한글은 유지하고 공백은 하이픈으로 바꾼다', () => {
    expect(slugifyTopic('AI와 노동')).toBe('ai와-노동');
  });
  it('구분자를 정리한다', () => {
    expect(slugifyTopic(' 노동자 통제 / 산업민주주의 ')).toBe('노동자-통제-산업민주주의');
  });
});
```

`tests/unit/safe-url.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from '../../src/utils/safe-url.js';

describe('safeExternalUrl', () => {
  it('http/https만 허용한다', () => {
    expect(safeExternalUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `npm test`

Expected: 두 module을 찾지 못해 FAIL.

- [ ] **Step 5: 최소 구현**

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

`src/utils/safe-url.js`:

```js
export function safeExternalUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm test`

Expected: 3 tests PASS.

- [ ] **Step 7: Vite와 기본 셸 구현**

`vite.config.js`:

```js
import { defineConfig } from 'vite';
export default defineConfig({
  base: '/read-think-write/',
  test: { environment: 'jsdom' }
});
```

`src/config.js`:

```js
export const BASE_PATH = '/read-think-write/';
export const SESSION_KEY = 'rtw_session_v1';
export const SUPABASE_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
```

셸 내비게이션은 `홈 · 읽기 · 생각 · 주제 · 질문 · 아카이브 · 검색`으로 한다.

- [ ] **Step 8: 빌드 검증 및 커밋**

Run: `npm run build`

Expected: `dist/` 생성.

```bash
git add .
git commit -m "chore: scaffold read-think-write app"
```

---

### Task 2: Supabase 스키마·관계 모델·RLS

**Files:**
- Create: `supabase/migrations/202609170001_phase1.sql`

**Interfaces:**
- Produces tables: `rtw_resources`, `rtw_notes`, `rtw_topics`, `rtw_questions`, `rtw_relations`

- [ ] **Step 1: 마이그레이션 작성**

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

create table if not exists public.rtw_questions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null,
  current_thought text not null default '',
  status text not null default 'open' check (status in ('open','parked','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rtw_relations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('resource','note')),
  source_id uuid not null,
  target_type text not null check (target_type in ('topic','question')),
  target_id uuid not null,
  relation_type text not null default 'related',
  created_at timestamptz not null default now(),
  unique (owner_id, source_type, source_id, target_type, target_id, relation_type)
);

create or replace function public.rtw_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger rtw_resources_touch before update on public.rtw_resources
for each row execute function public.rtw_touch_updated_at();
create trigger rtw_notes_touch before update on public.rtw_notes
for each row execute function public.rtw_touch_updated_at();
create trigger rtw_topics_touch before update on public.rtw_topics
for each row execute function public.rtw_touch_updated_at();
create trigger rtw_questions_touch before update on public.rtw_questions
for each row execute function public.rtw_touch_updated_at();

create or replace function public.rtw_validate_relation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id <> auth.uid() then
    raise exception 'relation owner mismatch';
  end if;

  if new.source_type = 'resource' and not exists (
    select 1 from public.rtw_resources where id = new.source_id and owner_id = auth.uid()
  ) then raise exception 'invalid resource source'; end if;

  if new.source_type = 'note' and not exists (
    select 1 from public.rtw_notes where id = new.source_id and owner_id = auth.uid()
  ) then raise exception 'invalid note source'; end if;

  if new.target_type = 'topic' and not exists (
    select 1 from public.rtw_topics where id = new.target_id and owner_id = auth.uid()
  ) then raise exception 'invalid topic target'; end if;

  if new.target_type = 'question' and not exists (
    select 1 from public.rtw_questions where id = new.target_id and owner_id = auth.uid()
  ) then raise exception 'invalid question target'; end if;

  return new;
end;
$$;

create trigger rtw_relations_validate
before insert or update on public.rtw_relations
for each row execute function public.rtw_validate_relation();

create index if not exists rtw_resources_owner_date_idx on public.rtw_resources(owner_id, published_on desc nulls last);
create index if not exists rtw_notes_owner_updated_idx on public.rtw_notes(owner_id, updated_at desc);
create index if not exists rtw_notes_resource_idx on public.rtw_notes(resource_id, updated_at desc);
create index if not exists rtw_topics_owner_name_idx on public.rtw_topics(owner_id, name);
create index if not exists rtw_questions_owner_status_idx on public.rtw_questions(owner_id, status, updated_at desc);
create index if not exists rtw_relations_source_idx on public.rtw_relations(owner_id, source_type, source_id);
create index if not exists rtw_relations_target_idx on public.rtw_relations(owner_id, target_type, target_id);

alter table public.rtw_resources enable row level security;
alter table public.rtw_notes enable row level security;
alter table public.rtw_topics enable row level security;
alter table public.rtw_questions enable row level security;
alter table public.rtw_relations enable row level security;

create policy "rtw resources select owner or public" on public.rtw_resources
for select using (owner_id = auth.uid() or visibility = 'public');
create policy "rtw resources insert owner" on public.rtw_resources
for insert with check (owner_id = auth.uid());
create policy "rtw resources update owner" on public.rtw_resources
for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "rtw resources delete owner" on public.rtw_resources
for delete using (owner_id = auth.uid());

create policy "rtw notes owner all" on public.rtw_notes
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "rtw topics owner all" on public.rtw_topics
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "rtw questions owner all" on public.rtw_questions
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "rtw relations owner all" on public.rtw_relations
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
```

- [ ] **Step 2: Supabase에 SQL 적용**

Supabase SQL 실행 도구로 위 마이그레이션 전체를 적용한다.

검증 SQL:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename like 'rtw_%'
order by tablename;
```

Expected: 다섯 테이블 모두 `rowsecurity = true`.

- [ ] **Step 3: RLS 실검증**

인증 사용자 A의 JWT로 private resource와 note를 생성한다. 익명 REST 요청으로 같은 UUID를 select했을 때 resource는 `visibility='private'`이므로 0 rows, note도 0 rows여야 한다.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/202609170001_phase1.sql
git commit -m "feat: add phase1 knowledge schema"
```

---

### Task 3: 인증·세션·History 라우터

**Files:**
- Create: `src/runtime/supabase.js`
- Create: `src/runtime/auth.js`
- Create: `src/router.js`
- Create: `src/ui/login-view.js`
- Create: `public/404.html`
- Modify: `src/app.js`

**Interfaces:**
- Produces: `supabase`
- Produces: `getSession()`, `signIn(email,password)`, `signOut()`, `requireSession()`
- Produces: `router.start()`, `router.navigate(path)`, `router.on(pattern, handler)`

- [ ] **Step 1: Supabase client 구현**

```js
import { createClient } from '@supabase/supabase-js';
import { SESSION_KEY, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storageKey: SESSION_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
```

- [ ] **Step 2: 인증 서비스 구현**

`signInWithPassword`, `getSession`, `signOut`만 노출한다. 비로그인 보호 경로 접근 시 `/read-think-write/login/?return=<encoded path>`로 이동한다.

- [ ] **Step 3: 라우트 구현**

```text
/read-think-write/
/read-think-write/login/
/read-think-write/reading/
/read-think-write/reading/new/
/read-think-write/resource/:id/
/read-think-write/notes/
/read-think-write/topics/
/read-think-write/topics/:slug/
/read-think-write/questions/
/read-think-write/questions/:id/
/read-think-write/archive/
/read-think-write/archive/:year/
/read-think-write/search/
```

- [ ] **Step 4: GitHub Pages deep-link 복귀 구현**

`public/404.html`은 현재 URL을 `sessionStorage.rtw_redirect_after_404`에 저장하고 `/read-think-write/`로 이동한다. 앱 부트 직후 same-origin 및 base-path를 검증한 뒤 `history.replaceState()`로 복원한다.

- [ ] **Step 5: 수동 검증 및 커밋**

```text
[ ] 정상 로그인
[ ] 잘못된 로그인 오류
[ ] 새로고침 후 세션 유지
[ ] 로그아웃 후 보호 화면 미노출
[ ] 뒤로가기/앞으로가기 정상
```

```bash
git add src/runtime src/router.js src/ui/login-view.js src/app.js public/404.html
git commit -m "feat: add auth and routing"
```

---

### Task 4: 읽기 자료 CRUD와 안전한 본문 렌더링

**Files:**
- Create: `src/data/resources.js`
- Create: `src/ui/reading-view.js`
- Create: `src/ui/resource-editor.js`
- Create: `src/ui/resource-view.js`
- Modify: `src/app.js`

**Interfaces:**
- Produces: `listResources()`, `getResource(id)`, `createResource(input)`, `updateResource(id,input)`

- [ ] **Step 1: data API 구현**

생성 기본값은 반드시 `visibility: 'private'`다. 목록 정렬은 `published_on desc`, 그 다음 `created_at desc`다.

- [ ] **Step 2: 자료 신규/수정 화면 구현**

필드:

```text
제목* / 원제 / 저자 / 출처 / 발표일 / 원문 링크 / 본문·번역문 / 공개 여부
```

본문은 Markdown textarea. 공개 여부 기본값 `비공개`.

- [ ] **Step 3: 상세 화면 Markdown 렌더링**

```js
const dirty = marked.parse(resource.body_md ?? '');
bodyElement.innerHTML = DOMPurify.sanitize(dirty);
```

원문 링크는 `safeExternalUrl()`이 null이 아닐 때만 렌더한다.

- [ ] **Step 4: 저장 상태 UX 구현**

저장 버튼은 중복 클릭을 막고 `저장 중...`, 성공 시 `저장됨`, 실패 시 `저장 실패`를 표시한다.

- [ ] **Step 5: 검증 및 커밋**

```text
[ ] 새 자료 생성
[ ] private 기본값
[ ] 상세 Markdown 렌더
[ ] 수정 후 유지
[ ] javascript: URL 차단
```

```bash
git add src/data/resources.js src/ui/reading-view.js src/ui/resource-editor.js src/ui/resource-view.js src/app.js
git commit -m "feat: add reading resource workflow"
```

---

### Task 5: 자료별 메모 + 독립 메모 + 초안 복구

**Files:**
- Create: `src/data/notes.js`
- Create: `src/runtime/draft-store.js`
- Create: `src/ui/note-editor.js`
- Create: `src/ui/notes-view.js`
- Test: `tests/unit/draft-store.test.js`
- Modify: `src/ui/resource-view.js`
- Modify: `src/app.js`

**Interfaces:**
- Produces: `listNotes({resourceId?})`, `getNote(id)`, `createNote({resourceId?,body,noteType?})`, `updateNote(id,input)`
- Produces: `saveDraft(key,value)`, `readDraft(key)`, `clearDraft(key)`

- [ ] **Step 1: draft-store 테스트 작성**

```js
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, readDraft, saveDraft } from '../../src/runtime/draft-store.js';

beforeEach(() => localStorage.clear());

describe('draft store', () => {
  it('미저장 내용을 복구한다', () => {
    saveDraft('note:new', '아직 저장하지 않은 생각');
    expect(readDraft('note:new')).toBe('아직 저장하지 않은 생각');
  });
  it('저장 성공 후 지운다', () => {
    saveDraft('note:new', '내용');
    clearDraft('note:new');
    expect(readDraft('note:new')).toBe('');
  });
});
```

- [ ] **Step 2: 실패 → 구현 → 통과**

Run before implementation: `npm test -- tests/unit/draft-store.test.js` → FAIL.

키 prefix는 `rtw_draft:`로 구현한다.

Run after implementation: same command → PASS.

- [ ] **Step 3: 자료 상세의 `나의 메모` 구현**

한 자료에 여러 메모를 허용하고 최신순으로 표시한다. 입력 시 `note_type`은 선택사항이다.

- [ ] **Step 4: 독립 메모 화면 구현**

`/notes/`에서 resource_id가 null인 메모를 작성·수정하고, 최근 자료 연결 메모도 함께 필터로 볼 수 있게 한다.

- [ ] **Step 5: 저장 실패 복구 검증**

오프라인 상태에서 저장 실패 → `입력 내용은 이 브라우저에 임시 보관했습니다.` 표시 → 새로고침 후 draft 복구.

- [ ] **Step 6: 커밋**

```bash
git add src/data/notes.js src/runtime/draft-store.js src/ui/note-editor.js src/ui/notes-view.js src/ui/resource-view.js src/app.js tests/unit/draft-store.test.js
git commit -m "feat: add linked and standalone notes"
```

---

### Task 6: 날짜 아카이브

**Files:**
- Create: `src/domain/archive.js`
- Test: `tests/unit/archive.test.js`
- Create: `src/ui/archive-view.js`
- Modify: `src/app.js`

**Interfaces:**
- Produces: `groupResourcesByDate(resources): ArchiveYear[]`

- [ ] **Step 1: 그룹화 테스트 작성**

```js
import { describe, expect, it } from 'vitest';
import { groupResourcesByDate } from '../../src/domain/archive.js';

describe('groupResourcesByDate', () => {
  it('발표일 기준 최신 연-월-일 순으로 묶는다', () => {
    const result = groupResourcesByDate([
      { id: 'a', published_on: '2026-09-14' },
      { id: 'b', published_on: '2026-09-17' },
      { id: 'c', published_on: '2025-12-31' }
    ]);
    expect(result[0].year).toBe(2026);
    expect(result[0].months[0].days.map(d => d.day)).toEqual([17, 14]);
    expect(result[1].year).toBe(2025);
  });
  it('발표일 없는 자료는 제외한다', () => {
    expect(groupResourcesByDate([{ id: 'x', published_on: null }])).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 → 최소 구현 → 통과**

Run: `npm test -- tests/unit/archive.test.js`.

- [ ] **Step 3: 아카이브 UI 구현**

`<details><summary>` 구조로 `연도 → 월 → 날짜 → 제목`을 렌더한다. 제목을 펼치면 메타, 본문, 해당 자료 메모가 함께 보인다.

- [ ] **Step 4: `/archive/:year/` 필터 구현**

존재하지 않는 연도는 `해당 연도의 기록이 없습니다.` 표시.

- [ ] **Step 5: 커밋**

```bash
git add src/domain/archive.js src/ui/archive-view.js src/app.js tests/unit/archive.test.js
git commit -m "feat: add chronological archive"
```

---

### Task 7: 주제·질문·범용 연결

**Files:**
- Create: `src/data/topics.js`
- Create: `src/data/questions.js`
- Create: `src/data/relations.js`
- Create: `src/ui/topics-view.js`
- Create: `src/ui/questions-view.js`
- Modify: `src/ui/resource-view.js`
- Modify: `src/ui/notes-view.js`
- Modify: `src/app.js`

**Interfaces:**
- Produces: `listTopics()`, `createTopic(name)`, `updateTopic(id,input)`, `getTopicBySlug(slug)`
- Produces: `listQuestions()`, `createQuestion(body)`, `updateQuestion(id,input)`, `getQuestion(id)`
- Produces: `listRelationsForSource(sourceType,sourceId)`, `setSourceTargets(sourceType,sourceId,targetType,targetIds)`

- [ ] **Step 1: 주제 CRUD 구현**

주제 생성 시 `slugifyTopic(name)`을 사용한다. 중복 slug면 기존 주제를 반환한다.

- [ ] **Step 2: 질문 CRUD 구현**

질문은 `body`, `current_thought`, `status(open|parked|resolved)`를 가진다. 기본 status는 `open`.

- [ ] **Step 3: relation 교체 API 구현**

`setSourceTargets()`는 지정 source/target type 조합의 기존 연결을 읽고, 빠진 것은 delete, 새 것은 insert한다. 다른 source/target type 관계는 건드리지 않는다.

- [ ] **Step 4: 자료·메모 연결 UI 구현**

자료 상세와 메모 편집 화면에서 주제와 질문을 각각 0개 이상 연결 가능하게 한다.

초기 첫 자료 주제는 다음 두 개만 연결한다.

```text
기술노동
노동운동
```

질문은 사용자가 메모를 남기면서 추가할 수 있게 하고 사전 생성하지 않는다.

- [ ] **Step 5: 주제 상세 구현**

주제 상세에 `현재까지의 생각(summary)`, 관련 읽기, 관련 메모를 표시한다.

- [ ] **Step 6: 질문 상세 구현**

질문 상세에 `현재 나의 생각(current_thought)`, 상태, 관련 읽기, 관련 메모를 표시한다.

- [ ] **Step 7: 관계 소유권 보안 검증**

다른 사용자 소유 객체 UUID를 relation insert에 넣으면 DB trigger 또는 RLS에서 실패해야 한다.

- [ ] **Step 8: 커밋**

```bash
git add src/data/topics.js src/data/questions.js src/data/relations.js src/ui/topics-view.js src/ui/questions-view.js src/ui/resource-view.js src/ui/notes-view.js src/app.js
git commit -m "feat: connect notes and readings to topics and questions"
```

---

### Task 8: 설계 범위에 맞춘 기본 통합검색

**Files:**
- Create: `src/data/search.js`
- Create: `src/ui/search-view.js`
- Modify: `src/app.js`

**Interfaces:**
- Produces: `searchAll(query): Promise<{resources,notes,topics,questions}>`

- [ ] **Step 1: 검색 규칙 구현**

빈 문자열은 DB 호출 없이 빈 결과. 검색 범위는 승인된 1단계 설계대로 다음으로 제한한다.

```text
resources: title, original_title, author, source_name
notes: body
 topics: name, summary
questions: body, current_thought
```

`body_md` 전체 본문 검색은 Phase 2로 미룬다.

- [ ] **Step 2: Supabase `ilike` 검색 구현**

각 유형 최대 30건. 문자열을 SQL로 직접 조합하지 않고 Supabase query builder만 사용한다.

- [ ] **Step 3: 결과 UI 구현**

`읽기 / 메모 / 주제 / 질문` 네 구역으로 분리한다. 연결된 메모는 원자료 링크도 제공한다.

- [ ] **Step 4: 검색 검증**

```text
기술노동자
Boston Review
노동운동
```

이 세 검색어로 유형별 결과가 올바른지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add src/data/search.js src/ui/search-view.js src/app.js
git commit -m "feat: add phase1 knowledge search"
```

---

### Task 9: 홈 대시보드와 장문 읽기 UX

**Files:**
- Create: `src/ui/home-view.js`
- Modify: `src/styles.css`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: recent resources, recent notes, open questions, topics

- [ ] **Step 1: 홈 데이터 구성**

홈은 다음을 표시한다.

```text
최근 읽은 글 5개
최근 메모 5개
계속 붙들고 있는 open 질문 5개
주제 8개
연도별 아카이브 바로가기
```

학습·쓰기 카드는 아직 표시하지 않는다.

- [ ] **Step 2: 읽기 레이아웃 구현**

자료 본문 최대 폭 `760px`, 홈 최대 폭 `1080px`, 본문 `line-height: 1.8` 이상, 모바일 좌우 padding `20px` 이상.

- [ ] **Step 3: 390px 모바일 검증**

```text
[ ] 제목 잘림 없음
[ ] 가로 스크롤 없음
[ ] textarea 화면 밖으로 넘치지 않음
[ ] 메뉴 터치 가능
```

- [ ] **Step 4: 커밋**

```bash
git add src/ui/home-view.js src/styles.css src/app.js
git commit -m "feat: add thinking dashboard"
```

---

### Task 10: E2E 회귀검사

**Files:**
- Create: `playwright.config.js`
- Create: `tests/e2e/phase1.spec.js`

**Interfaces:**
- Mocks Supabase browser requests; production RLS is separately verified in Task 2.

- [ ] **Step 1: Playwright 설정**

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

- [ ] **Step 2: 핵심 사용자 흐름 E2E 작성**

한 테스트에서 다음을 검증한다.

```text
1. 로그인
2. 새 자료 생성: 발표일 2026-09-14
3. 상세 화면 열기
4. 자료별 메모 저장
5. 독립 메모 저장
6. 주제 `기술노동`, `노동운동` 생성·연결
7. 질문 하나 생성 후 자료와 메모에 연결
8. 아카이브 → 2026년 → 9월 → 9월 14일 확인
9. 제목 토글을 열어 본문과 메모 확인
10. 검색에서 자료·메모·주제·질문 각각 확인
11. 새로고침 후 저장 내용 유지
```

- [ ] **Step 3: 전체 검증**

```bash
npm test
npm run test:e2e
npm run build
```

Expected: 모두 PASS.

- [ ] **Step 4: 커밋**

```bash
git add playwright.config.js tests/e2e/phase1.spec.js
git commit -m "test: cover phase1 thinking workflow"
```

---

### Task 11: GitHub Pages CI/CD

**Files:**
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: CI + Pages workflow 작성**

PR과 main push에서 `npm ci`, `npm test`, `npm run build`; main push에서만 deploy.

Deploy 핵심:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write

steps:
  - uses: actions/configure-pages@v5
  - uses: actions/upload-pages-artifact@v3
    with:
      path: ./dist
  - uses: actions/deploy-pages@v4
```

- [ ] **Step 2: 로컬 최종 검증**

```bash
npm ci
npm test
npm run test:e2e
npm run build
```

- [ ] **Step 3: PR 생성**

```bash
git push -u origin feature/phase1-foundation
```

`feature/phase1-foundation` → `main` PR을 만들고 CI 통과 후 merge한다.

- [ ] **Step 4: Pages Source 설정**

GitHub Settings → Pages → Build and deployment → Source = `GitHub Actions`.

예상 주소: `https://mj880616.github.io/read-think-write/`

---

### Task 12: 첫 Boston Review 자료 등록과 운영 보안 검증

**Files:**
- No repository file changes.

- [ ] **Step 1: 운영 UI에서 첫 자료 등록**

```text
발표일: 2026-09-14
제목: 기술노동자 권력의 부상과 몰락
원제: The Rise and Fall of Tech Worker Power
저자: JS Tan, Clarissa Redwine
출처: Boston Review
원문: https://www.bostonreview.net/articles/the-rise-and-fall-of-tech-worker-power/
공개 여부: 비공개
```

본문에는 현재 대화에서 확정한 전체 한국어 번역문을 붙여넣는다. 번역문 자체는 public Git 저장소나 seed SQL에 넣지 않는다.

- [ ] **Step 2: 초기 주제 연결**

```text
기술노동
노동운동
```

- [ ] **Step 3: 메모·질문 실제 저장 확인**

자료 메모 하나와 독립 메모 하나를 저장한다. 질문 하나를 만든 뒤 자료 또는 메모에 연결한다. 새로고침 후 모두 유지되는지 확인한다.

- [ ] **Step 4: 날짜 아카이브 확인**

`/read-think-write/archive/2026/`에서 `9월 → 9월 14일 → 기술노동자 권력의 부상과 몰락` 순으로 펼쳐지는지 확인한다.

- [ ] **Step 5: 비공개 보호 확인**

로그아웃 상태에서 자료 UUID 직접 URL에 접근한다.

Expected: 로그인 화면으로 이동하고 번역문·메모·질문 연결 데이터가 노출되지 않는다.

---

## Phase 1 Acceptance Checklist

```text
[ ] 별도 GitHub Pages 사이트로 배포됨
[ ] 기존 work 앱과 저장소가 분리됨
[ ] 동일 Supabase Auth 계정으로 로그인 가능
[ ] rtw_* 데이터가 RLS로 사용자별 격리됨
[ ] 새 읽기 자료를 UI에서 추가·수정 가능
[ ] 자료 본문을 안전한 Markdown으로 열람 가능
[ ] 자료별 메모 저장·수정 가능
[ ] 독립 메모 저장·수정 가능
[ ] 저장 실패 시 draft가 브라우저에 유지됨
[ ] 연도 → 월 → 날짜 → 제목 아카이브 작동
[ ] 주제 생성 및 자료/메모 연결 가능
[ ] 질문 생성 및 자료/메모 연결 가능
[ ] 자료 제목·메모·주제·질문 기본 검색 가능
[ ] 홈에서 최근 읽기·메모·open 질문·주제를 이어갈 수 있음
[ ] 비로그인 사용자가 private 본문과 메모에 접근할 수 없음
[ ] npm test, Playwright E2E, npm run build 모두 통과
```

## Deferred to Phase 2+

```text
- 구조화된 학습 프로젝트와 목차
- 글쓰기 씨앗 → 문제의식 → 자료수집 → 개요 → 초안 → 완성 워크플로
- 전체 본문 검색과 학습·쓰기 검색
- 생각 변화 버전 히스토리
- AI 의미검색/임베딩
- 자동 태깅과 관계 추천
- 관련 글 자동 추천
- 외부 글 자동 수집
```

Phase 1을 실제 사용하면서 생긴 기록 패턴을 본 뒤 Phase 2의 데이터 모델과 UX를 확정한다.
