# Task 12A Web2 Sole-Owner DB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the Web2 sole-owner boundary in production PostgreSQL/RLS/RPC while preserving owner CRUD and the Web1 public projection.

**Architecture:** Reuse the unique existing workspace `owner` membership as the authorization source, add narrowly scoped private owner helpers, and atomically replace only production policies/grants proven broader than the target. Keep public delivery behind `app_public_post`, rehearse forward and rollback SQL on a disposable Supabase branch, then merge and apply the reviewed migration to production.

**Tech Stack:** PostgreSQL 17, Supabase RLS/RPC/Migrations, Supabase CLI 2.84.2, Node.js 24 static regressions, SQL rollback-only actor tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-25-task12a-sole-owner-db-design.md`

## Global Constraints

- Start SHA is `a0ed130b6069ed2cc383ce944693decbe9a230fe`; re-fetch and stop on drift before migration application and before merge.
- Never use or merge PR #273 or #276, and never modify `main` directly.
- Production target must match ref `xmlkxfjeagycwttklxjw` and name `kptu-shared-checklists` before every production call.
- Do not hard-code the owner UUID or add a new ownership table/column system.
- Do not modify Edge Functions, Storage, RTW, Google integrations, Auth users, membership rows, existing data, visibility values, collaboration schemas, or Task 13 paths.
- Keep `app_public_post` operational; do not drop or reconnect `app_public_workspace_index`.
- Every mutation test runs on a disposable branch or inside an explicit transaction that rolls back.
- Forward and rollback SQL must be derived from the same fresh production snapshot.

## Review Focus

- A row with `project_id IS NULL` must still be owner-readable/writable and invisible to the non-owner admin.
- A public/workspace document must be unavailable through direct base-table access while remaining available through the filtered public projection when eligible.
- An event child row must not be visible or writable when its parent event is not owner-accessible.
- Bootstrap self-membership/profile reads must not reopen the full member/profile directory.
- A security-definer function must not bypass owner checks through inherited `PUBLIC`, `anon`, or broad `authenticated` execute privileges.

---

### Task 1: Freeze the live production authorization snapshot

**Files:**
- Create: the `supabase migration new task12a_sole_owner_db` output path under `supabase/migrations/`
- Create: the same CLI-generated basename under `scripts/sql/snapshots/`
- Create: the same CLI-generated basename under `scripts/sql/rollback/`
- Create: `tests/security/task12a-sole-owner-migration.test.mjs`

**Interfaces:**
- Consumes: production catalog metadata from project `xmlkxfjeagycwttklxjw`.
- Produces: an exact pre-change inventory and executable rollback used by every later task.

- [ ] **Step 1: Re-fetch and re-verify immutable targets**

Run `git fetch origin --prune`, confirm `git rev-parse HEAD` equals the current `origin/main`, query the Supabase project metadata, and query production migration history. Stop if the project ref/name differs or a newer main/migration now exists.

- [ ] **Step 2: Generate the migration version with the repository CLI convention**

Run `npx --yes supabase@2.84.2 migration new task12a_sole_owner_db`. Use the generated filename stem for the snapshot and rollback files.

- [ ] **Step 3: Query the complete production catalog**

Capture `relrowsecurity`, `relforcerowsecurity`, every `pg_policies` row, effective `anon`/`authenticated`/`service_role` table privilege, every Web2 security-definer body, and effective function execution privilege. Include all work-order tables and active `app_*` RPCs; exclude `rtw_*`, Storage, Auth, and Google objects.

- [ ] **Step 4: Write the snapshot and exact rollback**

The snapshot SQL must be read-only catalog queries. The rollback must recreate each old policy with its exact command, role list, `USING`, and `WITH CHECK`, restore function bodies changed in Task 4, and restore previous grants. Wrap rollback DDL in `begin; ... commit;` and add `set local lock_timeout='5s';` plus `set local statement_timeout='60s';`.

- [ ] **Step 5: Add a failing static contract test**

Assert that migration, snapshot, and rollback share one generated stem; migration/rollback are transactional; excluded strings `rtw_`, `storage.`, `app_google_`, and the seven Edge Function directories are absent; and rollback contains every production policy/function name changed by the migration.

- [ ] **Step 6: Run the test and confirm RED**

Run `node --test tests/security/task12a-sole-owner-migration.test.mjs`. Expected result: failure because the forward migration and complete rollback contract do not yet exist.

- [ ] **Step 7: Commit snapshot/test scaffolding**

Commit only the spec, plan, snapshot query, rollback scaffold, and failing contract test with message `test: freeze task 12a production authz baseline`.

### Task 2: Add the rollback-only sole-owner actor matrix

**Files:**
- Create: `supabase/tests/authz_sole_owner.sql`
- Modify: `.github/workflows/authz-security-check.yml`
- Modify: `tests/security/task12a-sole-owner-migration.test.mjs`

**Interfaces:**
- Consumes: the production-like schema and two-or-more Auth users.
- Produces: four-actor SQL assertions for the migration and final production verification.

- [ ] **Step 1: Write fixtures without relying on production row counts**

Start `begin;`, select four distinct actor identities or create local-only Auth fixtures, create one workspace with owner/admin membership, and add representative projectless/project-linked meetings, public/workspace/private documents, projectless/team events with every child type, organization/profile/AI rows, and projectless/project tasks. Finish with `rollback;`.

- [ ] **Step 2: Assert anon and non-member denial**

Under `anon` and an authenticated non-member JWT claim, assert zero direct reads and zero successful inserts/updates/deletes for private base tables. Catch SQLSTATE `42501` for rejected writes and also fail when a write silently affects a row.

- [ ] **Step 3: Assert existing-admin isolation**

Under the non-owner admin identity, assert zero owner rows for the five mandatory P1 groups: projectless meetings, workspace-visible documents, projectless/team events, organization/profile/status/report data, and AI workspace settings. Repeat for representative write attempts.

- [ ] **Step 4: Assert owner CRUD and preserved project policy**

Under the owner identity, insert/read/update/delete representative projectless and linked records, meeting-derived tasks, and document/event children. Re-run `authz_project_owner_only.sql` expectations so correct project policies are not replaced.

- [ ] **Step 5: Assert Web1 projection isolation**

Under `anon`, assert `app_public_post(text)` returns only an eligible public page/document projection and an allowed unlisted slug, while direct `app_documents` and `app_pages` selects expose no private row or internal columns.

- [ ] **Step 6: Register the SQL test in existing CI**

Add `supabase/tests/authz_sole_owner.sql` to the existing required-file list in `authz-security-check.yml`; do not create a new test framework.

- [ ] **Step 7: Run static tests and confirm expected RED contract**

Run `node --test tests/security/*.test.mjs`. Existing tests must remain green; the Task 12A migration contract remains red until Task 3.

- [ ] **Step 8: Commit actor tests**

Commit with message `test: cover task 12a sole-owner actor matrix`.

### Task 3: Implement the minimal owner-only RLS migration

**Files:**
- Modify: the Task 1 CLI-generated `task12a_sole_owner_db.sql` path under `supabase/migrations/`
- Modify: its exact basename under `scripts/sql/rollback/`
- Modify: `tests/security/task12a-sole-owner-migration.test.mjs`

**Interfaces:**
- Consumes: exact production policies/grants from Task 1 and actor expectations from Task 2.
- Produces: transactional owner helpers and policy replacements used by direct PostgREST and RPC paths.

- [ ] **Step 1: Add one workspace-owner helper**

Create `private.app_is_workspace_owner(p_workspace uuid) returns boolean` as stable `security definer`, fixed `search_path=pg_catalog,public`, comparing `app_workspace_members.role='owner'` and `user_id=(select auth.uid())`. Revoke execution from `PUBLIC` and `anon`; grant only what authenticated RLS evaluation requires.

- [ ] **Step 2: Add only necessary parent helpers**

For tables without a safe `workspace_id`, add focused helpers that resolve the parent workspace by existing foreign key. Use fully qualified names and return false for missing parents. Do not add ownership columns or general-purpose authorization tables.

- [ ] **Step 3: Replace only broad policies**

Atomically replace workspace/member/admin/team/public broad policies for meetings; direct documents; events and children; organization tables; profile/status/report/direct-message tables; AI tables; and workspace-global task paths. Leave already owner-only project policies unchanged and preserve task workflows through the owner predicate.

- [ ] **Step 4: Preserve minimal bootstrap self access**

Restrict `app_workspace_members` and profile control rows to self-only reads required by startup. Prove the non-owner admin cannot enumerate or read the owner's row.

- [ ] **Step 5: Preserve the public projection**

Do not broaden base-table policies. Keep `app_public_post(text)` as the security-definer projection with its current filters and response shape; preserve its `anon` execution grant. Record but do not drop `app_public_workspace_index()`.

- [ ] **Step 6: Make the static migration contract GREEN**

Run `node --test tests/security/task12a-sole-owner-migration.test.mjs`. Expected: all assertions pass, including exact rollback coverage and scope exclusions.

- [ ] **Step 7: Run all trusted-layer static regressions**

Run `node --test tests/security/*.test.mjs` and `node --test tests/domain/*.test.mjs tests/meeting-draft-parser.test.mjs`. Expected: zero failures.

- [ ] **Step 8: Commit RLS migration**

Commit with message `fix: enforce task 12a sole-owner database boundary`.

### Task 4: Harden active Web2 RPC and security-definer grants

**Files:**
- Modify: the Task 1 CLI-generated `task12a_sole_owner_db.sql` path under `supabase/migrations/`
- Modify: its exact basename under `scripts/sql/rollback/`
- Modify: `supabase/tests/authz_sole_owner.sql`

**Interfaces:**
- Consumes: `private.app_is_workspace_owner(uuid)` and the live function inventory.
- Produces: owner-gated private RPCs while preserving the narrow Web1 public projection.

- [ ] **Step 1: Classify every live security-definer function**

Classify each as RLS helper, trigger, public projection, active owner CRUD, active bootstrap/control-plane, or inactive legacy. Record exact frontend dependency evidence for every active RPC.

- [ ] **Step 2: Gate private active RPCs internally**

For private-data RPCs still called by the app, preserve signatures and response shapes but reject callers who are not the unique owner with SQLSTATE `42501`. Keep `app_public_post` unchanged except for any necessary fixed-search-path/grant correction that does not alter its projection.

- [ ] **Step 3: Tighten effective execution grants**

Revoke accidental `PUBLIC` and `anon` execution from private helpers/triggers. Grant authenticated execution only to functions required by RLS or owner workflows. Do not touch `rtw_*` functions.

- [ ] **Step 4: Test RPC bypass attempts**

Extend `authz_sole_owner.sql` so anon, non-member, and non-owner admin cannot use invite/access/member-role/share/page/event RPCs to read or mutate owner-private data. Assert owner workflows and `app_public_post` still work.

- [ ] **Step 5: Run static suites**

Run both Node suites from Task 3 and confirm zero failures.

- [ ] **Step 6: Commit RPC hardening**

Commit with message `fix: gate task 12a database RPC paths to owner`.

### Task 5: Rehearse migration and rollback on a disposable Supabase branch

**Files:**
- Modify only if a test defect is found: migration, rollback, or existing Task 12A tests.

**Interfaces:**
- Consumes: reviewed forward/rollback SQL and project branch created from `xmlkxfjeagycwttklxjw`.
- Produces: database-executed evidence before production.

- [ ] **Step 1: Obtain explicit hourly-cost confirmation**

Confirm the displayed branch rate `$0.01344/hour`, call the cost-confirmation API, then create `task12a-sole-owner-db`. Do not create the branch without that confirmation.

- [ ] **Step 2: Verify branch lineage and migration history**

Wait until the branch is healthy; confirm it derives from production and its migration list matches production before the new version.

- [ ] **Step 3: Apply the forward migration**

Apply the exact migration SQL to the disposable branch. Run security and performance advisors; treat new security findings as failures.

- [ ] **Step 4: Run the SQL actor matrix and Web1 projection checks**

Execute `authz_sole_owner.sql` and the existing project/public snapshot SQL checks. Expected: unauthorized actors see/write zero owner-private rows; owner CRUD and public projection pass.

- [ ] **Step 5: Rehearse rollback and reapply**

Apply the exact rollback, compare policy/grant/function fingerprints with the Task 1 snapshot, then reapply the forward migration and rerun the actor matrix.

- [ ] **Step 6: Delete the disposable branch**

After capturing non-sensitive pass/fail evidence, delete the Supabase branch to stop hourly billing.

- [ ] **Step 7: Commit any evidence-driven corrections**

If the rehearsal required code changes, repeat Tasks 3-5 and commit with a specific fix message. Do not stack a second migration for a pre-merge defect.

### Task 6: PR, CI, merge, and production application

**Files:**
- No new files unless CI exposes a scoped defect.

**Interfaces:**
- Consumes: a green branch with rehearsed rollback.
- Produces: merged 12A migration and verified production boundary.

- [ ] **Step 1: Run final branch verification**

Re-run all Node security/domain tests, JavaScript syntax checks, relevant Playwright owner/public/anonymous-gate suites, migration/rollback fingerprint checks, and confirm `git diff origin/main...HEAD` contains no Edge/Storage/RTW/Google changes.

- [ ] **Step 2: Push and open the 12A PR**

Push `security/task12a-sole-owner-db`, open a PR against `main`, attach it to the task, and include start SHA, exact object list, rollback path, actor matrix, Web1 projection, exclusions, and the explicit remaining service-role P1.

- [ ] **Step 3: Wait for every required CI check**

Do not merge with pending/failing checks. Re-fetch `origin/main`; if it moved, rebase without using PR #273/#276, rerun all tests, and update the PR.

- [ ] **Step 4: Merge through the PR**

Merge only the reviewed 12A branch. Record merge commit and final `main` SHA, then verify main CI.

- [ ] **Step 5: Run the production preflight again**

Reconfirm project ref/name, production migration history, current policy fingerprint, main SHA, rollback file, excluded scopes, and actor identities. Stop on any drift.

- [ ] **Step 6: Apply the production migration**

Apply the exact merged migration once. Immediately confirm the new migration version appears in production history and run security/performance advisors.

- [ ] **Step 7: Verify production actors and regressions**

Run read-only or rollback-only checks for anon, non-member, existing non-owner admin, and owner. Verify the five mandatory P1 groups, owner CRUD smoke paths, project owner-only policies, `app_public_post`, Web1 `/p/`, Task 11 anonymous login gate, and unchanged Google behavior.

- [ ] **Step 8: Roll back on a failed production gate**

If a mandatory gate fails, apply the reviewed rollback, verify the pre-change fingerprint is restored, and report 12A incomplete. Do not create an unreviewed hotfix migration.

- [ ] **Step 9: Report 12A and hand off exact 12B dependencies**

Report every item in the uploaded 39-point completion format and explicitly state that service-role Edge Functions can still bypass RLS, so Web2 sole-owner conversion is not complete until Task 12B.

### Task 7: Start Task 12B only after 12A production verification

**Files:**
- Create on a new branch: `docs/superpowers/specs/2026-09-25-task12b-edge-owner-auth-design.md`
- Create on a new branch: `docs/superpowers/plans/2026-09-25-task12b-edge-owner-auth.md`

**Interfaces:**
- Consumes: merged 12A final main SHA and the exact service-role dependency report.
- Produces: a separate approved plan/branch for the seven deployed Edge Functions; no 12B source enters the 12A PR.

- [ ] **Step 1: Fetch final main and create a new branch/worktree**

Use the merged 12A `origin/main` as the only base. Do not reuse the 12A branch.

- [ ] **Step 2: Retrieve deployed source and compare repository coverage**

Retrieve `document-actions`, `workspace-drive`, `library-files`, `meeting-files`, `meeting-ai-draft`, `page-ai-draft`, and `event-media` from production, verify deployed hashes/versions, and identify which sources are missing or drifted from `main`.

- [ ] **Step 3: Write the Task 12B design and implementation plan**

Specify a shared owner-authorization contract, per-function resource lookup, denial response, tests, deploy order, rollback version, and production probes. Keep Storage policy, RTW, and Google changes out unless a separately authorized blocker is proven.

- [ ] **Step 4: Review before implementing 12B**

Self-review the design/plan against the uploaded constraints and proceed in the already selected native execution method.

### Task 8: Run Task 12C only after 12B production verification

**Files:**
- Create on a new branch only if durable test/report assets are required by repository convention.

**Interfaces:**
- Consumes: merged/production-verified 12A and 12B final main SHAs.
- Produces: final DB-direct and Edge/service-role four-actor matrix plus regression report.

- [ ] **Step 1: Fetch final main and create the 12C branch/worktree**

Use the merged 12B `origin/main` as the base; never reuse earlier phase branches.

- [ ] **Step 2: Execute the four actors through both paths**

Verify anon, authenticated non-member, existing non-owner admin, and sole owner against direct DB/PostgREST and every seven-function Edge path. Unauthorized actors must read/write zero owner-private data; owner must retain normal operations.

- [ ] **Step 3: Run full product regressions**

Verify Web1 public page/document/unlisted projection, Google Calendar/Tasks/OAuth and Android return, owner project/meeting/task/calendar/document/organization/AI CRUD, and Task 11 anonymous login gate.

- [ ] **Step 4: Merge only if no P1 remains**

Open a separate PR when 12C adds durable changes; otherwise record verified evidence without a no-op PR. Report any remaining P1 as incomplete rather than declaring the sole-owner conversion finished.
