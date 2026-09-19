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

## Confirmed Web2 product structure

Web2 is the public-agency project team's shared operational database and status board, not a personal task application. Preserve the links among projects, owners, schedules, follow-up tasks, meetings, and documents, and keep handover and low administrative overhead in mind.

- A UI region has one state owner and one final renderer. Do not repair competing renderers with delayed overwrites, broad `MutationObserver` decorators, or `display:none` patches.
- Prefer the startup order session check → public or authenticated path selection → required data/modules → one final UI reveal.
- Anonymous users may receive only the minimum public dataset allowed by trusted DB/RLS/RPC/server policy. Standalone tasks, personal schedules, Google Calendar, and personal work are authenticated-only.
- The anonymous home contains projects, upcoming major schedules, board posts, and the library. The authenticated home contains projects, tasks, upcoming major schedules, and the library. The authenticated schedule panel continues to use project milestones until a separate product decision changes it.
- Child-project navigation stays in the hierarchy area above the title and separate from edit, visibility, archive, and delete actions. Preserve native keyboard-accessible disclosure behavior and keep child creation inside that navigation.
- Document visibility remains `public`, `workspace`, or `private`. Project-linked and meeting documents default to internal. Public publication requires explicit confirmation and successful Google Drive permission synchronization before Web2 exposes the item; unpublishing must also revoke Drive access.

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
