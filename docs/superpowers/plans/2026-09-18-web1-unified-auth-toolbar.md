# Web1 Unified Auth and Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace legacy Web1 editing passwords with one Google-authenticated administrator, allow anonymous editing only on explicitly allowlisted collaborative pages, and standardize Back/Edit/Print/Logout above every Web1 project title.

**Architecture:** Add a central page-capability manifest plus shared toolbar/auth controller. Supabase Google OAuth provides identity; privileged writes are server-authorized for one admin user. Anonymous writes are separately constrained to allowlisted collaborative endpoints. Existing generated/custom page shells consume the shared toolbar rather than duplicating controls.

**Tech Stack:** Static GitHub Pages HTML/JS/CSS, Supabase Auth/REST/Edge Functions/RLS, Node browser/security tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-18-web1-unified-auth-toolbar-design.md`

## Global Constraints

- One Google/Supabase administrator account can edit all supported Web1 pages.
- Anonymous users are read-only except explicit public-edit allowlist.
- Initial public-edit pages: `/work/2in1/` and `/work/workforce/joint-struggle-0921/`.
- Legacy `0822` and per-page master passwords do not authorize editing after migration.
- Main `/work/` access gate remains independent.
- Common toolbar order is Back, Edit, Print, Logout and sits immediately above title.
- Server-side authorization, not UI state, is authoritative.
- Existing RLS stays enabled.
- Shared asset changes require caller cache-version bumps and propagation checks.
- Use failing tests before production changes; do not merge until replacement paths pass.

---

### Task 1: Capability manifest and toolbar contract

**Files:**
- Create: `app/web1-page-capabilities.js`
- Create: `app/web1-toolbar.js`
- Test: `tests/app-e2e/web1-toolbar-auth.spec.mjs`

**Interfaces:**
- Produces: `window.KPTUWeb1Capabilities.resolve(pathname)` returning `{ publicEdit:boolean, backHref:string }`.
- Produces: `window.KPTUWeb1Toolbar.mount(options)` rendering `#web1Toolbar` above the first page title/hero.

- [ ] Step 1: Add failing tests asserting toolbar placement/order and capability values for `/2in1/`, `/workforce/joint-struggle-0921/`, and a normal page.
- [ ] Step 2: Run the focused browser test and confirm RED because shared manifest/toolbar do not exist.
- [ ] Step 3: Implement the manifest with exact public-edit allowlist and parent/back mappings; implement accessible Back/Edit/Print/Logout controls with mobile-safe layout.
- [ ] Step 4: Run focused test and confirm GREEN.
- [ ] Step 5: Commit `feat: add Web1 page capabilities and toolbar`.

### Task 2: Google administrator authentication

**Files:**
- Create: `app/web1-admin-auth.js`
- Modify: `app/public-page-editor.js`
- Modify: `supabase/functions/public-page-edit/index.ts`
- Modify/Create: Supabase migration exposing an authenticated admin-check RPC/policy as required by existing schema
- Test: `tests/app-e2e/web1-toolbar-auth.spec.mjs`
- Test: `tests/security/document-edge-authz.test.mjs`

**Interfaces:**
- Produces: `window.KPTUWeb1AdminAuth.signInWithGoogle()`, `session()`, `isAdmin()`, `signOut()`.
- Server consumes Supabase JWT and verifies the configured admin user ID before privileged mutation.

- [ ] Step 1: Add failing tests: anonymous normal Edit invokes Google OAuth; configured admin can write; different authenticated user is denied; browser-side email alone cannot grant admin.
- [ ] Step 2: Run focused auth/security tests and confirm RED.
- [ ] Step 3: Implement Supabase Google OAuth (`signInWithOAuth` semantics) and server-side single-admin authorization using immutable user ID/config; keep service-role secrets out of browser.
- [ ] Step 4: Replace password-editor dependency in `public-page-editor.js` with the admin auth interface for normal pages.
- [ ] Step 5: Run focused auth/security tests and confirm GREEN.
- [ ] Step 6: Commit `feat: use Google admin auth for Web1 editing`.

### Task 3: Anonymous public-edit authorization

**Files:**
- Modify: `2in1/index.html`
- Modify: `workforce/joint-struggle-0921/index.html`
- Modify: their existing Edge Function/write endpoint(s) discovered from current page code
- Modify: `app/web1-page-capabilities.js`
- Test: `tests/app-e2e/web1-public-edit.spec.mjs`
- Test: relevant security test for each endpoint

**Interfaces:**
- Consumes: `resolve(pathname).publicEdit`.
- Server permits anonymous mutations only within each allowlisted page's existing data namespace and expected fields.

- [ ] Step 1: Add failing tests proving anonymous edits succeed on both allowlisted pages and fail against unrelated page/data keys.
- [ ] Step 2: Add failing tests proving `0822`/legacy master-password values do not create broader editing authority.
- [ ] Step 3: Run focused tests and confirm RED.
- [ ] Step 4: Remove master-password prompts/checks from only the two migrated public-edit flows; constrain anonymous server writes to their exact namespaces/fields.
- [ ] Step 5: Run focused browser/security tests and confirm GREEN.
- [ ] Step 6: Commit `feat: allow anonymous edits on designated Web1 pages`.

### Task 4: Apply common toolbar across Web1

**Files:**
- Modify: `p/index.html` and `scripts/public-page-meta.mjs` / generator paths
- Modify: representative/custom static `index.html` pages under `2in1/`, `press/`, `private-rail/`, `public-policy/`, `rail-council/`, `sanbyeol/`, `workforce/`, plus remaining Web1 project pages identified by inventory
- Test: `tests/app-e2e/web1-toolbar-auth.spec.mjs`
- Test: `scripts/public-page-meta.test.mjs`

**Interfaces:**
- All project pages load `web1-page-capabilities.js`, `web1-admin-auth.js`, and `web1-toolbar.js` with versioned URLs.
- Existing page-specific controls delegate to/remove duplicates in favor of shared toolbar.

- [ ] Step 1: Inventory all Web1 project `index.html` files, excluding Web2 app/login/privacy shells where the Web1 toolbar is not applicable, and encode the expected set in a failing coverage test.
- [ ] Step 2: Run coverage test and confirm RED for pages missing shared toolbar loader.
- [ ] Step 3: Update common generator/template first, then custom/static shells, preserving page bodies and existing functionality.
- [ ] Step 4: Remove duplicate local Back/Edit/Print/Logout controls after shared controls are present.
- [ ] Step 5: Run toolbar and metadata tests; confirm all expected pages GREEN and custom content unchanged.
- [ ] Step 6: Commit `feat: standardize Web1 project toolbar`.

### Task 5: Retire obsolete Web1 editing password paths

**Files:**
- Modify/Delete: `app/public-page-auth.js` references from Web1 editing flow
- Modify: pages/endpoints still containing editing-specific `0822`, `master_password`, or password prompts found by repository search
- Preserve: root `/work/` main access gate unless separately requested
- Test: `tests/app-e2e/web1-toolbar-auth.spec.mjs`
- Test: security tests

**Interfaces:**
- Web1 edit authority is only admin JWT or explicit public-edit endpoint capability.

- [ ] Step 1: Add a failing repository/security assertion that no Web1 editing path accepts legacy shared/master passwords, while the root main access gate remains present.
- [ ] Step 2: Run and confirm RED against remaining legacy editing code.
- [ ] Step 3: Remove obsolete editing password/recovery dependencies and prompts without removing the independent main-page gate.
- [ ] Step 4: Run focused tests and confirm GREEN.
- [ ] Step 5: Commit `refactor: retire legacy Web1 editing passwords`.

### Task 6: Cache propagation, regression verification, and deployment

**Files:**
- Modify: shared script version references in templates/static pages as required
- Test: existing browser/storage/security/smoke suites

**Interfaces:**
- Served pages must reference the final shared asset versions.

- [ ] Step 1: Add/update cache-version propagation assertions so template, generated pages, and custom shells reference the same final versions.
- [ ] Step 2: Run metadata/cache tests and confirm GREEN.
- [ ] Step 3: Run focused Web1 toolbar/auth/public-edit tests, storage audit, security tests, app smoke, and relevant existing browser E2E; record any pre-existing unrelated failure separately rather than masking it.
- [ ] Step 4: Inspect diff for accidental content loss and confirm no service-role key/admin secret entered browser code.
- [ ] Step 5: Merge only after required replacement-path tests pass.
- [ ] Step 6: Verify GitHub Pages deployment reports success and inspect live representative pages from normal generated, custom, 2in1 public-edit, workforce public-edit, and child-page categories.
- [ ] Step 7: Report exact deployed commit, test results, any unrelated residual failures, and live behavior.