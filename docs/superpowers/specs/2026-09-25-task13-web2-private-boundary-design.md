# Task 13 Web2 Private Boundary Design

## Goal

Remove Web2 public, unlisted, workspace, group, share-link, anonymous-workspace, and project-publication paths while preserving the existing Web1 public delivery boundary and every RTW path. Web2 remains a signed-in sole-owner personal work system.

## Approved baseline

- Git base: `origin/main` at `93f951b54dbf8d20d96cf6852afe923298a9e13e`, merged PR #285.
- Work branch: `chore/task13-remove-web2-public-sharing` in an isolated worktree.
- Excluded pull requests: #273 and #276; neither is a source or merge dependency.
- Production project: `xmlkxfjeagycwttklxjw`, `kptu-shared-checklists`, `ap-northeast-2`, `ACTIVE_HEALTHY`.
- Task 11 anonymous login gate and Task 12 sole-owner DB/RLS/Edge authorization are already deployed and must not be weakened.
- Current Web1 data is preserved in place: one public published page, seven published unlisted pages, fourteen public documents, and seven workspace documents. These counts are observations, not test constants.
- Share, group, group-member, page-permission, project-invitation, project-publication, and project-public-block row counts were zero at Gate 1.
- Production migration history records Task 12A as `20260925113810_task12a_sole_owner_db`, while the repository filename is `20260925084844_task12a_sole_owner_db.sql`.

## Gate 1 findings

### Active Web2 paths to remove

- `app/team.js` and `app/library-upload.js` expose document visibility selection and public toggles.
- Production `library-files` version 11 accepts `public`, `workspace`, and `private`; the public path creates a Google Drive `anyone` permission.
- `workspace-drive` and `meeting-files` create `workspace` documents.
- Authenticated direct writes to `app_pages` and `app_documents` are sole-owner gated but can still create or transition rows to legacy non-private visibility values.
- `project-system-v3.js` is loaded and still renders public page links. Its project-publication controls are present but currently unreachable because the detail loader no longer fetches publication state.

### Dormant Web2 paths to retire

- `public-workspace.js` and `public-workspace-extras.js` are deployed static assets but are disconnected from `loader-v2.js` and the authenticated runtime import graph.
- `public-page-links.js`, the legacy page editor, and older page/publication modules retain public and group-sharing code without a current user path.
- `app_public_workspace_index()` remains anonymously executable even though no active Web2 or Web1 runtime calls it.
- The workspace/project snapshot, project-publication, secure-share, and share-open RPCs have no repository frontend caller, no deployed Edge caller, and no view, policy, or trigger reference.
- The only function-to-function reference among the target RPCs is `app_public_workspace_snapshot()` calling `app_public_projects_snapshot()`.

### Preserved boundaries

- Web1 preserves `/p/`, `app_public_post(text)`, `public-policy/`, `public-page-edit`, `public-policy-drive`, static rail/statement/event/wedding paths, and their current public page and document rows.
- Web1 public documents continue through fixed `public-doc-xxxxxxxxxxxx` slugs and `app_public_post`; they do not depend on `app_public_workspace_index()`.
- Google Calendar, Google Tasks, Drive OAuth, and return URLs remain unchanged.
- All `rtw_*` tables, policies, functions, Auth behavior, and Edge Functions remain unchanged.

## Frontend design

Delete the anonymous-workspace assets and remove every active or reachable Web2 public/share control. The library registration and edit flows no longer render a visibility selector or public toggle. New documents are private by construction. Existing public/workspace documents remain listed and editable as records, but Web2 offers no publication, unpublication, sharing, public-link, or visibility control.

Remove the dormant page editor modal and its group-permission/public-link handlers from `team.js`, stop loading group/page data only needed by that editor, remove public links from project page rows, and stop loading `public-page-links.js`. Remove only proven-unreferenced legacy modules whose purpose is the retired Web2 public/share flow; do not remove Web1 board modules.

Update static CI from asserting that dormant public-workspace files contain an RPC name to asserting that Web2 assets and runtime imports contain no anonymous workspace, share-link, project-publication, public/unlisted/group visibility control, or public document toggle.

## Trusted-layer design

Production service-role Edge Functions must match the new product boundary:

- `library-files` accepts no visibility input and always creates private documents. Its visibility mutation action is retired. It must not add or remove Google Drive public permissions as part of a Web2 workflow.
- `workspace-drive` and `meeting-files` create private documents.
- No other deployed Edge Function may call the retired public/share/publication RPCs or publication tables.

Add a narrow database trigger for `app_pages` and `app_documents`. For the authenticated PostgREST role it rejects inserts with a non-private visibility and rejects transitions from one visibility value to a non-private value. It does not rewrite or delete existing rows and does not block metadata-only updates to an existing legacy public/workspace row. Service-role Web1 editing remains possible, and every service-role Web2 writer is separately audited and changed to private.

The dormant `app_save_page_v2` authenticated endpoint is closed instead of rewritten because its frontend caller is unreachable and the current Web2 pages view is the Web1 board.

## RPC and table disposition

`app_public_post(text)` and its existing `anon`, `authenticated`, and `service_role` execution remain unchanged.

Revoke all client/service execution from the proven-unused Web2 legacy RPC set while preserving definitions for rollback and audit:

- `app_public_workspace_index()`
- `app_public_workspace_snapshot()`
- `app_public_projects_snapshot()`
- `app_public_project(text)`
- `app_public_suborganization_facets()`
- `app_project_publication_state(uuid)`
- `app_set_project_publication(uuid,boolean,boolean,text)`
- `app_set_project_block_publication(uuid,boolean,boolean,integer)`
- `app_move_project_public_block(uuid,integer)`
- `app_create_share_link(uuid,timestamptz)`
- `app_open_share(text)`
- `app_save_page_v2(uuid,uuid,uuid,text,text,text,text,text,text)`

No function or table is dropped. `app_share_links`, group, permission, invitation, publication, and publication-block tables remain for the later collaboration-removal tasks. Their rows are not changed.

## Migration and rollback

Generate the migration basename with Supabase CLI 2.84.2. The forward migration is transactional, adds only the private-visibility guard, installs the two triggers, and revokes the reviewed RPC grants. The rollback uses the fresh Gate 3 production grant state, removes only the Task 13 triggers/helper, and restores the exact pre-application grants.

The branch stores a Gate 1 read-only snapshot and a rollback template. Before production DDL, Gate 3 refreshes the full catalog, share statistics, migration history, function definitions, grants, dependencies, deployed Edge sources, and deployed frontend assets. Any unexpected drift stops application.

## Verification

- Test-first static contracts reject all retired Web2 strings, imports, and controls while requiring `app_public_post` and Web1 assets.
- Edge tests prove every document creation path writes `private` and `library-files` has no Drive-public branch.
- SQL actor tests prove anon, non-member, and non-owner cannot access owner rows; the owner can create private rows but cannot create or transition a direct Web2 row to a legacy sharing visibility.
- Existing legacy public/workspace rows remain unchanged and metadata-only service-role/Web1 operations remain possible.
- Web2 anonymous access redirects to login and makes no anonymous workspace RPC call.
- Owner calendar, tasks, projects, meetings, library, pages, Google Calendar, Google Tasks, Drive, and OAuth return regressions remain green.
- Web1 `/p/`, `public-policy/`, public page, allowed unlisted page, and public document projections remain green.
- Mobile shell/login checks cover widths 360, 390, 412, and 430.

## Scope exclusions

Do not implement Tasks 14-16, 18, or 20-30. Do not alter signup/invite/member collaboration schemas, task assignment, event attendees, project members, canonical organization work, Auth users, RTW, Web1 publishing data, or existing visibility values. Do not create a paid Supabase branch, temporary project, temporary production user, or paid external workload.
