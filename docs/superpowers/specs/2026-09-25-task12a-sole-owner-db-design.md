# Task 12A Web2 Sole-Owner DB Boundary Design

## Goal

Make the production Web2 PostgreSQL/RLS/RPC boundary owner-only without changing Edge Functions, Storage, RTW, Google integration, collaboration schemas, existing rows, or the Web1 public projection.

## Approved source and current baseline

This design records the user-approved uploaded Task 12A work order. Live checks on 2026-09-25 confirmed:

- Git base: `origin/main` at `a0ed130b6069ed2cc383ce944693decbe9a230fe`, merged PR #280.
- Excluded open PRs: #273 and #276; neither is a source or merge dependency.
- Production project: `xmlkxfjeagycwttklxjw`, `kptu-shared-checklists`, PostgreSQL 17, `ACTIVE_HEALTHY`.
- Main workspace `kptu-work`: exactly one `owner` membership and one `admin` membership.
- P1 evidence still present: 6 projectless meetings, 7 workspace-visible documents, 14 public documents, 1 AI workspace settings row, and 57 projectless tasks. Counts are observations, not fixed test expectations.
- Repository and production migration histories drift. Production's latest recorded version is `20260925032810`; repository filenames must not be treated as the production authority.
- Seven Task 12B Edge Functions are active in production; four of them are not stored on `main`. They remain read-only observations during 12A.

## Authorization source of truth

The sole owner is derived from the existing `app_workspace_members` relationship whose role is `owner`; no user UUID is hard-coded and no ownership table or duplicate owner column is introduced. A private, security-definer helper with a fixed search path determines whether `auth.uid()` is the owner of a supplied workspace. Parent-scoped helpers derive the workspace from the existing document, event, meeting, project, suborganization, profile, or AI relationship.

Policies follow the existing object shape:

- Workspace-global private records require the caller to be the workspace owner.
- Project-linked records continue to rely on the already owner-only project boundary where that boundary is sufficient.
- Event, document, meeting, organization, profile, and AI child rows inherit the secured parent boundary and cannot be queried directly by a broader actor.
- `app_workspace_members` keeps only the minimum self-row read needed for bootstrap. It does not expose the member directory to another member or admin.
- Profile/control-plane rows may retain self-only access when needed for login/bootstrap, but must not reveal the owner's private row to the non-owner admin.
- Existing rows, memberships, roles, visibility values, collaboration columns, assignments, and schemas are preserved.

## Public and shared boundary

Direct `app_pages` and `app_documents` table access is owner-only for Web2. Web1 public content remains available only through `app_public_post(text)` with its existing public/unlisted filters and limited projection. `app_public_workspace_index()` is recorded but neither dropped nor reconnected to anonymous Web2 startup.

The migration must not alter public document visibility values, public page rows, Google connection/state tables, Storage policies, or Drive permissions.

## RPC and function boundary

All Web2-related security-definer functions are inventoried with effective `anon` and `authenticated` execute privileges and function bodies. Active RPCs are not blindly revoked. Public projection RPCs remain narrow exceptions; private CRUD and collaboration/control-plane RPCs either enforce the sole-owner predicate internally or lose client execution only when current Web2 code has no dependency.

Private helper and trigger functions must not retain accidental `PUBLIC`/`anon` execution. Authenticated execution is granted only where an RLS policy or active RPC requires it. RTW functions are excluded.

## Migration and rollback

Before DDL, save the exact production RLS flags, policies, table grants, function definitions, and function grants for every changed object. Generate the migration filename using the pinned Supabase CLI version used by the repository workflow; do not invent a timestamp. The forward migration is transactional and replaces policies atomically. The rollback file is generated from the live pre-change snapshot and restores the exact effective production policy/grant state.

The forward migration and rollback must both be rehearsed without a paid Supabase branch. The protected GitHub Actions workflow extracts the production schema read-only, verifies its reviewed hash, and loads it into a disposable local Supabase stack inside the runner. Production is changed only after this no-cost rehearsal, PR CI, review, merge, and a final drift check.

## Verification

The SQL actor matrix uses rollback-only fixtures and covers `anon`, authenticated non-member, existing non-owner admin, and sole owner. It proves read and write denial for unauthorized actors and normal owner CRUD for meetings, documents, events and children, organization/profile data, AI data, and tasks. Existing project owner-only checks remain green.

Web1 regression proves `app_public_post` still returns a public page, a public document projection, and an allowed unlisted page while direct `app_pages`/`app_documents` access remains blocked. Task 11 regression proves anonymous Web2 shows only login and makes no `app_public_workspace_index` call.

After merge, apply the migration to production, immediately run read-only/rollback-only actor checks, owner Web2 CRUD smoke checks, and Web1 public checks. If any gate fails, stop and use the reviewed rollback rather than stacking an unreviewed hotfix.

## Scope exclusions

No Task 12A change may touch Edge Function source/deployment, Storage policy, RTW objects, Google OAuth/Calendar/Tasks, Auth-user deletion, membership-row deletion, schema redesign, collaboration-column removal, Task assignment removal, `app_public_post` removal, `app_public_workspace_index` removal, PR #273, PR #276, or Task 13 work.

Task 12B and Task 12C are separate plans and branches created only after 12A is merged and production-verified.
