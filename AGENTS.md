# Web2 Production Development Rules

This repository is used for a real production service. All changes must be implemented and reviewed to production-ready standards.

## Non-negotiable rules

1. Do not weaken existing authentication, authorization, database policies, storage policies, or server-side validation to make a feature work.
2. Client-side UI restrictions are not sufficient access control. Sensitive permissions must be enforced in trusted server-side or database layers.
3. Do not trust ownership, organization, role, or user identifiers supplied only by the client when deciding permissions.
4. Do not expose privileged credentials or secrets in client code or committed source files.
5. Validate untrusted input in an appropriate trusted layer.
6. Do not leave temporary access shortcuts, debug permissions, mock authorization, placeholder checks, or test-only exceptions in production code.

## Before making changes

Inspect the relevant call path and data flow first. Search for related behavior across UI, routes, APIs/RPCs, database policies, storage rules, authentication/session handling, shared authorization logic, and related tests.

When a shared permission or data model changes, review all features that use the same model instead of patching only the visible screen.

## Implementation

- Prefer existing shared modules and architecture over duplicate implementations.
- Keep permission-sensitive logic centralized where practical.
- Fix root causes instead of bypassing symptoms.
- Minimize unrelated structural changes.
- Preserve existing security invariants while adding functionality.

## Confirmed product structure

Web2 (`app/`) is a private personal work system used only by its single signed-in owner (sole-owner). It is not a shared team database, a multi-user collaboration product, or a public site. Preserve the links among projects, schedules, follow-up tasks, meetings, and documents.

- Anonymous Web2 startup is blocked: the loader checks the session and redirects to login before routing or feature modules load (Task 11, #280; `tests/security/web2-anonymous-auth-gate.test.mjs`).
- Web2 data access is owner-only in the database and Edge Function layers (Task 12, #281–#284; `private.app_is_workspace_owner`).
- Web2 public and sharing paths have been removed: the anonymous workspace, public projects, project publication, share links, and publication/visibility controls are retired, and their RPCs no longer grant execution (Task 13, #286·#287; `supabase/migrations/20260925143746_task13_web2_private_boundary.sql`). Do not restore them.
- Web2 creates only `private` content. For the authenticated role, the database rejects inserts of non-private `app_pages`/`app_documents` rows and visibility changes to non-private values. Existing `public`/`workspace` rows are retained for Web1 and later cleanup.
- Web1 (repository root pages such as `/p/`, `public-policy/`, and the business pages) is the external public channel. `/p/` pages, `app_public_post(text)`, `public-page-edit`, and `public-policy-drive` are kept. When something must be shared externally, keep the original in Web2, publish only the needed content on Web1, and share the Web1 link. Never relax Web2 authentication, RLS, grants, or Edge Function checks for Web1 publication.
- RTW is a separate product that shares this Supabase project, including Auth, with Web2. Do not modify `rtw_*` tables, policies, functions, or related Edge Functions as part of Web2 or Web1 work.
- Collaboration structures (workspace members and roles, invites, project invitations, event attendees, task assignment) still exist in the database but are scheduled for removal in roadmap Tasks 19–31 (`docs/roadmap.md`). Do not build new features on them.
- Startup order: session check → authenticated path or redirect to login → required data/modules → one final UI reveal.
- A UI region has one state owner and one final renderer. Do not repair competing renderers with delayed overwrites, broad `MutationObserver` decorators, or `display:none` patches.
- Child-project navigation stays in the hierarchy area above the title and separate from edit, archive, and delete actions. Preserve native keyboard-accessible disclosure behavior and keep child creation inside that navigation.

Do not independently change Supabase schemas, RLS, existing data, visibility policy, URL structure, or Edge Function authentication boundaries. Record a proposal instead. Do not add product features or redesign the application as part of stabilization work.

## Verification

After each meaningful change, verify:

- requested behavior works for authorized users;
- existing related behavior still works;
- protected operations remain protected outside the allowed scope;
- shared permission and data paths have not regressed;
- relevant automated tests pass.

Prefer automated browser E2E and regression tests over manual-only checks whenever feasible.

## Completion criteria

A task is complete only when the requested functionality works, existing behavior has not regressed, trusted-layer permission checks remain intact, relevant tests pass, and temporary/debug code has been removed.

## Completion report

Briefly report:

1. what changed;
2. affected areas;
3. permission/security checks performed;
4. tests run and results;
5. remaining risks or follow-up work.

If a security or authorization issue remains unresolved, do not describe the task as fully complete.
