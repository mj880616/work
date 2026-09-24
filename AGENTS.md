# Production Development Rules (Web1 and Web2)

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

## Confirmed product boundary

The user's latest explicit product decision overrides older documents, code comments, and legacy behavior. See `CLAUDE.md` for the full current-versus-target description.

- **Web2 (`app/`, `desk.bokdoong.com`) is a fully private, personal work system used only by the signed-in user.** Projects, tasks, schedules, meetings, library documents, and Google Calendar/Tasks integration are all authenticated-only. It is not a shared team database or a multi-user collaboration product.
- **Web1 (repository root pages, `work.bokdoong.com`) is the public channel** for content that must be published or shared by link: statements and press releases, public posts, public policy and project materials, and pages sent to outside readers.
- Anonymous visitors must not receive Web2 work data or Web2 work screens. The target unauthenticated Web2 experience is a route to login only. Public projects, a public work home, and anonymous Web2 datasets are not product concepts.
- Existing anonymous Web2 paths (for example `app/public-workspace.js`, `app/public-workspace-extras.js`, and the `app_public_workspace_index` RPC) are leftovers of the previous structure. They are not requirements to preserve or extend; remove them only in a scoped change that follows the rules below.
- Solve external-sharing needs through Web1. Never relax Web2 authentication, RLS, grants, or Edge Function checks to share content externally.
- Keep simplifying Web2 toward a single-user, owner-only structure while preserving the links among projects, schedules, follow-up tasks, meetings, and documents. Removing a legacy public path must narrow access; it must never widen it.

## Web2 implementation invariants

- A UI region has one state owner and one final renderer. Do not repair competing renderers with delayed overwrites, broad `MutationObserver` decorators, or `display:none` patches.
- Prefer the startup order session check → authenticated path (or redirect to login) → required data/modules → one final UI reveal.
- Child-project navigation stays in the hierarchy area above the title and separate from edit, visibility, archive, and delete actions. Preserve native keyboard-accessible disclosure behavior and keep child creation inside that navigation.
- Stored document visibility values are currently `public`, `workspace`, and `private`. Project-linked and meeting documents default to internal (non-public). Until a reviewed change retires Web2 public documents, any public publication still requires explicit confirmation and successful Google Drive permission synchronization before the item is exposed, and unpublishing must also revoke Drive access. New external publication belongs in Web1.

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
