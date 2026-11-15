# Web1 Unified Toolbar and Editing Authorization Design

Date: 2026-09-18

## Goal

Unify Web1 project-page navigation and editing controls while replacing legacy shared-password editing with one Google-authenticated administrator plus explicitly designated anonymous-edit pages.

## Authorization model

1. One administrator Google account is the sole authenticated Web1 editor.
2. An authenticated administrator can edit every Web1 project page that supports editing.
3. Anonymous visitors are read-only by default.
4. Anonymous editing is allowed only on pages explicitly marked public-edit by configuration. Initial targets are /work/2in1/ and /work/workforce/joint-struggle-0921/.
5. Legacy editing passwords, including 0822 and per-page master-password prompts, must not grant Web1 editing authority after migration.
6. The existing main /work/ access gate remains independent: Back may navigate there, and a visitor without main-page access sees that page's existing gate.
7. Public-edit permission applies only to the designated page and grants no access to the protected main page or other pages.

## Google authentication

Use Supabase Auth Google OAuth as the Web1 administrator identity mechanism. The browser must not decide admin authority from Google login alone. Server-side authorization verifies the authenticated Supabase user against the single configured administrator identity. Prefer immutable Supabase user ID for final authorization; email is bootstrap/config only. Retire the existing Web1 password-based editor auth/recovery flow from editing once Google auth is live.

## Shared toolbar

All Web1 project pages use one shared toolbar immediately above the page title/hero heading, ordered Back, Edit, Print, Logout.

- Back: top-level projects go to /work/; child pages may return to their project hub when that matches existing information architecture.
- Edit: admin can edit any supported page; anonymous users can edit only allowlisted public-edit pages; otherwise Edit starts Google login.
- Print: public browser print.
- Logout: visible only for an administrator session and signs out the Web1 Supabase auth session.
- Mobile: toolbar remains readable and does not collapse into narrow wrapped columns.

Share-only pages receive the common toolbar, but Back never bypasses the protected main-page gate.

## Public-edit pages

Public editing is an explicit capability, not a general weakening of RLS. A central manifest identifies page IDs/canonical paths with anonymous edit enabled. Server-side write endpoints enforce the same policy; UI visibility is not security.

For legacy collaborative pages that currently write through password-protected Edge Functions, remove the master-password requirement only for explicitly migrated public-edit pages. Endpoints must constrain writes to the page's expected namespace/schema and reject unrelated mutations.

Initial public-edit targets:
- /work/2in1/
- /work/workforce/joint-struggle-0921/

Other pages remain non-public-edit until explicitly added.

## Existing generated and custom pages

Inject the common toolbar/auth loader through shared templates/generators where available. Inventory and migrate custom/static pages without overwriting body content or page-specific functionality. Metadata regeneration must preserve custom shells and synchronize shared asset versions.

## Cache invalidation

Every shared JS/CSS change bumps the caller asset version. Template/generator propagation updates generated/custom pages consistently. Deployment verification checks served HTML/JS versions so mobile browsers do not remain on stale editor/auth code.

## Security boundaries

- No service-role key, shared editing password, or administrator email is trusted as a browser-side authorization secret.
- Privileged writes require valid Supabase JWT plus server-side admin authorization.
- Anonymous public-edit writes are accepted only for allowlisted pages/endpoints and constrained fields.
- Existing RLS remains enabled.
- Main-page access password and Web1 editing authorization are separate concerns.
- Logout clears Web1 administrator auth without altering anonymous public-edit capability.

## Migration

1. Add central Web1 page capability manifest and shared toolbar/auth controller.
2. Add Google OAuth login and server-side single-admin check.
3. Migrate existing p/* live editor from password editor auth to Google admin/public-edit capability.
4. Migrate 2in1 and workforce joint-struggle legacy editing controls away from master-password authorization.
5. Apply toolbar to all Web1 project pages and remove duplicate local Back/Edit/Print/Logout controls.
6. Remove obsolete 0822/master-password editing paths only after replacement tests pass.
7. Regenerate metadata/pages and bump shared asset versions.

## Testing and acceptance

Use TDD: each changed behavior gets a failing test first, then minimal implementation.

Required coverage: common toolbar and order; toolbar above title; anonymous normal-page Edit starts Google login and cannot write; configured admin can edit; another Google user cannot edit; anonymous can edit each allowlisted public-edit page; public-edit cannot mutate another page/unrelated fields; legacy 0822/master password no longer authorizes editing; Back preserves /work/ gate; Print public; Logout clears admin session; mobile toolbar usable; generated/custom metadata refresh preserves content; cache versions propagate; no new storage/security/browser smoke regression.

## Rollout

Implement on an isolated branch/worktree, preserve production until replacement tests pass, then merge. After merge verify GitHub Pages deployment and representative live pages: normal generated page, custom page, public-edit 2in1, public-edit workforce page, and a child page.