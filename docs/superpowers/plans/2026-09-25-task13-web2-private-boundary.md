# Task 13 Web2 Private Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Web2 public/share paths while preserving Web1 public delivery, RTW, Task 12 sole-owner authorization, existing data, and Google integrations.

**Architecture:** Remove reachable and dormant Web2 public/share frontend paths, force every Web2 document creation path to private at the Edge layer, add an authenticated direct-write visibility guard, and revoke execution from unused legacy RPCs without dropping functions or tables. Preserve Web1 solely through `app_public_post` and existing Web1 Edge/static routes.

**Tech Stack:** Static HTML/JavaScript, Node.js 24 tests, Playwright, Supabase Edge Functions, PostgreSQL 17, Supabase CLI 2.84.2, GitHub Actions/Pages.

**Spec:** `docs/superpowers/specs/2026-09-25-task13-web2-private-boundary-design.md`

## Global constraints

- Base SHA is `93f951b54dbf8d20d96cf6852afe923298a9e13e`; refresh `origin/main` before push, merge, and Gate 3.
- Never use or merge PR #273 or #276, and never modify `main` directly.
- Production must match project ref `xmlkxfjeagycwttklxjw` and name `kptu-shared-checklists` before every production action.
- Do not mutate existing public/unlisted/workspace rows, share rows, group rows, invitation rows, or publication rows.
- Do not drop functions or tables in Task 13.
- Preserve `app_public_post`, Web1 `/p/`, `public-policy/`, `public-page-edit`, `public-policy-drive`, all Google paths, and all RTW paths.
- Production DDL is allowed only after PR CI, merge, deployment verification, and fresh Gate 3 evidence.
- A pre-existing unrelated local baseline failure in `tests/private-rail-org-status.test.mjs` is recorded separately and must not be hidden or expanded into Task 13.

## Task 1: Add RED product-boundary tests

**Files:**
- Create: `tests/security/task13-web2-private-boundary.test.mjs`
- Modify: relevant Playwright fixtures/specs only when their current assertions require retired controls

- [ ] Assert the active import graph does not load anonymous workspace or public-page helper modules.
- [ ] Assert `team.js`, `library-upload.js`, `project-system-v3.js`, and `app/index.html` expose no public/unlisted/workspace/group/share-link/publication control.
- [ ] Assert Web2 Edge sources create only private documents and contain no Drive `anyone` permission branch.
- [ ] Assert the migration, snapshot, and rollback share a CLI-generated basename, preserve `app_public_post`, contain no DROP statement, and cover the reviewed RPC signatures.
- [ ] Assert Web1 public page/document callers and RTW paths remain present.
- [ ] Run the focused test and confirm RED before implementation.

## Task 2: Remove frontend public/share paths

**Files:**
- Modify: `app/index.html`
- Modify: `app/team.js`
- Modify: `app/library-upload.js`
- Modify: `app/view-loader.js`
- Modify: `app/project-system-v3.js`
- Delete when confirmed unreferenced: `app/public-workspace.js`, `app/public-workspace-extras.js`, their dedicated stylesheet, `app/public-page-links.js`, and page/public helper modules proved unreachable
- Modify: `.github/workflows/app-smoke-check.yml`

- [ ] Remove document visibility selectors, public toggles, public confirmations, and public badges/actions.
- [ ] Remove the dormant page editor modal, public link actions, group-permission synchronization, and group/page-only fetches.
- [ ] Remove project public links and publication mutation/render code.
- [ ] Replace positive legacy-file CI assertions with negative product-boundary assertions.
- [ ] Preserve Web1 board and public-post assets unchanged.
- [ ] Run the focused test and relevant static/browser tests until GREEN.

## Task 3: Make Edge document paths private-only

**Files:**
- Modify: `supabase/functions/library-files/index.ts`
- Modify: `supabase/functions/workspace-drive/index.ts`
- Modify: `supabase/functions/meeting-files/index.ts`
- Modify: Edge security tests as needed

- [ ] Remove `library-files` visibility input and set-visibility action.
- [ ] Remove its Google Drive public-permission mutation path.
- [ ] Store every new library, project, and meeting document with `visibility:'private'`.
- [ ] Keep exact sole-owner authorization, file limits, Drive OAuth, download, delete, classification, and AI behavior.
- [ ] Run focused Edge/security tests and TypeScript syntax/static checks.

## Task 4: Create migration, snapshot, rollback, and SQL tests

**Files:**
- Create with CLI: `supabase/migrations/<generated>_task13_web2_private_boundary.sql`
- Create: `scripts/sql/snapshots/<same basename>.sql`
- Create: `scripts/sql/rollback/<same basename>.sql`
- Create: `supabase/tests/authz_task13_private_boundary.sql`
- Modify: `.github/workflows/authz-security-check.yml`

- [ ] Generate the migration filename with `npx --yes supabase@2.84.2 migration new task13_web2_private_boundary`.
- [ ] Save the Gate 1 catalog/grant/dependency queries without sensitive rows or tokens.
- [ ] Add a private authenticated-visibility guard and triggers for `app_pages` and `app_documents`.
- [ ] Revoke exact reviewed grants from the twelve legacy RPC signatures; do not modify `app_public_post`.
- [ ] Write rollback SQL that restores current grants and removes only Task 13 objects; refresh it again at Gate 3.
- [ ] Add rollback-only actor fixtures covering private creation, rejected legacy visibility, unchanged existing legacy rows, owner CRUD, and Web1 public projection.
- [ ] Register the SQL test in existing authorization CI and make static contracts GREEN.

## Task 5: Complete local Gate 2 verification

- [ ] Run JavaScript syntax checks for every changed JavaScript file.
- [ ] Run focused Task 13, Task 11, Task 12, Web1, Edge authorization, and domain Node tests.
- [ ] Run relevant Playwright suites for anonymous login, owner pages/library/projects/meetings, public post, Google return, and mobile shell widths 360/390/412/430.
- [ ] Record the unrelated pre-existing private-rail baseline failure separately.
- [ ] Review `git diff --check`, deleted-file references, runtime import graph, Edge source diff, migration/rollback pairing, and excluded-scope strings.
- [ ] Confirm no RTW, Web1 public data, Google callback, secret, token, or unrelated feature changed.

## Task 6: Push, PR, CI, and merge

- [ ] Re-fetch `origin/main`; rebase and rerun Gate 2 tests if it moved.
- [ ] Commit the reviewed changes, push `chore/task13-remove-web2-public-sharing`, and open a PR against `main`.
- [ ] Attach the PR to the task and report Gate 1 classification, drift, migration, rollback, security boundary, and tests.
- [ ] Wait for every CI check; fix only scoped failures.
- [ ] Merge only when CI is fully green, then record merge SHA and verify main CI.

## Task 7: Gate 3 fresh production verification

- [ ] Reconfirm project ref/name, migration history, share statistics, target function signatures/definitions/owners/search paths/grants, inbound dependencies, other function/view/policy/trigger references, and related table RLS.
- [ ] Diff the Gate 3 snapshot against Gate 1 and stop on any unexpected change.
- [ ] Confirm the merged frontend and Edge sources are actually deployed.
- [ ] Confirm deployed assets contain no `app_create_share_link`, `app_open_share`, `app_public_workspace_index`, `secureShareBtn`, public document toggle, project-publication caller, or anonymous workspace import.
- [ ] Refresh rollback grants from the exact Gate 3 production state.

## Task 8: Production migration and post-apply verification

- [ ] Apply the exact merged migration once through the Supabase migration API.
- [ ] Verify migration history, function grants, trigger definitions, and unchanged row counts/visibility distributions.
- [ ] Run Supabase security/performance advisors and record only new Task 13-relevant findings.
- [ ] Verify anonymous Web2 redirects to login, owner Web2 core views work, and no anonymous workspace RPC is called.
- [ ] Verify Web1 `/p/`, `public-policy/`, public page, allowlisted unlisted page, public document, and `app_public_post` remain operational.
- [ ] Verify Google Calendar, Tasks, Drive, and OAuth return paths.
- [ ] Apply the reviewed rollback immediately if a mandatory gate fails; do not stack an unreviewed hotfix.
- [ ] Produce the requested 38-point completion report and record any dormant objects left for Tasks 20-28.
