import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, ROOT), 'utf8');
const exists = path => existsSync(fileURLToPath(new URL(path, ROOT)));

test('Web2 ships no anonymous workspace assets or runtime imports', () => {
  for (const path of [
    'app/public-workspace.js',
    'app/public-workspace-extras.js',
    'app/public-workspace.css',
    'app/public-page-links.js',
    'app/media-workflow.js',
    'app/page-list-controller.js',
    'app/page-save-controller.js',
    'app/page-builder.js',
    'app/page-shortcut.js',
    'app/page-management.js',
    'app/page-inline-viewer-v2.js',
    'app/project-access.js',
    'app/project-v2.js',
    'app/project-system-v2.js',
    'app/legacy/page-preview-tools.js',
    'app/legacy/project-create-submit.js'
  ]) assert.equal(exists(path), false, `${path} must be retired`);

  const runtime = [read('app/app.js'), read('app/loader-v2.js'), read('app/view-loader.js')].join('\n');
  assert.doesNotMatch(runtime, /public-workspace|public-page-links|app_public_workspace_index/);
});

test('active Web2 UI has no publication, visibility, group-share, or public-link control', () => {
  const html = read('app/index.html');
  const team = read('app/team.js');
  const library = read('app/library-upload.js');
  const projects = read('app/project-system-v3.js');

  assert.doesNotMatch(html, /docVisibility|pageVisibility|publicOpenBtn|editorModal/);
  assert.doesNotMatch(team, /app_page_permissions|app_groups|pageGroupChecks|publicOpenBtn|visibility:'public'|app_create_share_link|app_open_share/);
  assert.doesNotMatch(library, /set-visibility|data-lu-toggle-public|libraryEditVisibility|외부 공개|팀 내부|나만 보기/);
  assert.doesNotMatch(projects, /app_set_project_publication|app_set_project_block_publication|app_move_project_public_block|data-ps3-publish|data-ps3-copy-public|\.\.\/p\/\?slug=/);
});

test('every active Web2 document creation path writes private visibility', () => {
  const photoRoom = read('app/photo-room.js');
  const library = read('supabase/functions/library-files/index.ts');
  const projectFiles = read('supabase/functions/workspace-drive/index.ts');
  const meetingFiles = read('supabase/functions/meeting-files/index.ts');

  assert.doesNotMatch(library, /setDrivePublic|set-visibility|\['public','workspace','private'\]|visibility==='public'/);
  assert.match(photoRoom, /app_documents[\s\S]*?visibility:'private'/);
  assert.doesNotMatch(photoRoom, /visibility:'workspace'/);
  assert.match(library, /visibility:'private'/);
  assert.match(projectFiles, /visibility:'private'/);
  assert.match(meetingFiles, /visibility:'private'/);
});

test('Task 13 migration is paired, non-destructive, and preserves Web1 and RTW', () => {
  const migrations = readdirSync(fileURLToPath(new URL('supabase/migrations/', ROOT))).filter(name => name.endsWith('_task13_web2_private_boundary.sql'));
  assert.equal(migrations.length, 1, 'one CLI-generated Task 13 migration is required');
  const basename = migrations[0];
  const snapshotPath = `scripts/sql/snapshots/${basename}`;
  const rollbackPath = `scripts/sql/rollback/${basename}`;
  assert.equal(exists(snapshotPath), true, 'matching production snapshot is required');
  assert.equal(exists(rollbackPath), true, 'matching rollback is required');

  const forward = read(`supabase/migrations/${basename}`);
  const rollback = read(rollbackPath);
  const combined = `${forward}\n${rollback}`;
  assert.doesNotMatch(forward, /\bdrop\s+(?:table|function)\b/i);
  assert.doesNotMatch(combined, /\brtw_/i);
  assert.doesNotMatch(forward, /\b(?:revoke|drop|alter)\b[^;]*app_public_post/i);
  assert.match(forward, /app_public_workspace_index\(\)/);
  assert.match(forward, /app_create_share_link\(uuid,timestamptz\)/);
  assert.match(forward, /app_open_share\(text\)/);
  assert.match(forward, /app_save_page_v2\(uuid,uuid,uuid,text,text,text,text,text,text\)/);
  assert.match(forward, /app_pages/);
  assert.match(forward, /app_documents/);
  assert.match(forward, /auth\.jwt\(\)->>'role'/, 'trusted boundary must read the current JWT role');
  assert.doesNotMatch(forward, /request\.jwt\.claim\.role/,
    'legacy per-claim GUC must not guard production writes');
  assert.match(read('supabase/tests/authz_task13_private_boundary.sql'), /request\.jwt\.claims/,
    'SQL actor regression must simulate PostgREST JSON claims');
  assert.match(rollback, /grant execute on function public\.app_public_workspace_index\(\) to anon, service_role/i);
  assert.match(rollback, /grant execute on function public\.app_open_share\(text\) to authenticated, service_role/i);
});

test('Web1 public delivery remains present', () => {
  assert.match(read('p/public-post.js'), /rpc\/app_public_post/);
  assert.match(read('public-policy/index.html'), /app_public_post/);
  assert.equal(exists('supabase/functions/public-page-edit/index.ts'), true);
  assert.equal(exists('supabase/functions/public-policy-drive/index.ts'), true);
});

test('Task 13 disposable DB mode rehearses forward, actor checks, rollback, and reapply', () => {
  const workflow = read('.github/workflows/web2-one-shot-schema-authz.yml');
  const harness = read('supabase/local-verify/bootstrap-ci.sh');
  for (const token of [
    'WEB2_TASK13',
    '20260925143746_task13_web2_private_boundary.sql',
    'authz_sole_owner.sql',
    'authz_task13_private_boundary.sql',
    'task13-fingerprint.sql',
    'TASK13_ROLLBACK_PASSED',
    'TASK13_REAPPLY_PASSED'
  ]) assert.match(`${workflow}\n${harness}`, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `Task 13 database rehearsal is missing ${token}`);
  assert.match(workflow, /chore\/task13-remove-web2-public-sharing/);
});
