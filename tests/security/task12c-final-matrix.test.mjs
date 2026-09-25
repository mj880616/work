import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const edge = (name) => read(`supabase/functions/${name}/index.ts`);

const ACTORS = ['anon', 'non_member', 'admin', 'owner'];
const SERVICE_ROLE_EDGES = [
  'document-actions',
  'workspace-drive',
  'library-files',
  'meeting-files',
  'meeting-ai-draft',
  'page-ai-draft',
  'event-media',
];

test('Task 12C keeps the four-actor DB matrix transactional and complete', () => {
  const matrix = read('supabase/tests/authz_sole_owner.sql');

  assert.match(matrix, /^begin\s*;/im);
  assert.match(matrix, /^rollback\s*;/im);
  for (const actor of ACTORS) {
    assert.match(matrix, new RegExp(`['\"]${actor}['\"]`), `missing DB actor ${actor}`);
  }
  assert.match(matrix, /select id::text from public\.app_workspaces where slug='kptu-work'/i);
  assert.match(matrix, /insert into public\.app_workspaces[\s\S]*?on conflict \(slug\) do nothing/i,
    'the rollback-only fixture must reuse, not collide with, the production workspace');
  assert.match(matrix, /insert into public\.app_pages[\s\S]*?on conflict \(workspace_id, slug\) do nothing/i,
    'the public projection fixture must coexist with the production unlisted page');
  assert.equal((matrix.match(/12a00000-0000-4000-8000-000000000001/g) || []).length, 1,
    'the fixed workspace UUID may only be the empty-baseline fallback');
  assert.match(matrix, /app_public_post\('task12a-public'\)/i);
  assert.match(matrix, /OWNER CRUD UPDATED/i);
});

test('Task 12C keeps every audited service-role Edge path behind exact owner membership', () => {
  for (const name of SERVICE_ROLE_EDGES) {
    const source = edge(name);
    assert.match(source, /auth\.getUser\(|\/auth\/v1\/user/, `${name} must authenticate the bearer`);
    assert.match(source, /app_workspace_members/, `${name} must resolve server-side workspace membership`);
    assert.match(source, /role\s*!==\s*['\"]owner['\"]/, `${name} must reject every non-owner role`);
  }
});

test('Task 12C preserves Web1 public projections while Web2 anonymous access stays login-gated', () => {
  const loader = read('app/loader-v2.js');
  const migration = read('supabase/migrations/20260925084844_task12a_sole_owner_db.sql');
  const publicPost = read('p/public-post.js');

  assert.equal(existsSync(new URL('app/public-workspace.js', ROOT)), false);
  assert.match(publicPost, /rpc\/app_public_post/);
  assert.doesNotMatch(migration, /revoke\s+execute\s+on\s+function\s+public\.app_public_(?:post|workspace_index)/i);
  assert.match(loader, /if\(!authenticated\)\s*\{[\s\S]*?redirectToLogin\(\);[\s\S]*?return;/);
  assert.ok(loader.indexOf("import('./app-router.js") > loader.indexOf('if(!authenticated)'));
});

test('Task 12C leaves Google Calendar, Tasks, and Drive return paths intact', () => {
  const calendar = edge('google-calendar');
  const tasks = edge('google-tasks');
  const callback = edge('public-policy-drive');

  assert.match(calendar, /const raw='calendar\.'\+platform/);
  assert.match(tasks, /const raw='tasks\.'\+platform/);
  assert.match(calendar, /redirect_uri:CALLBACK/);
  assert.match(callback, /calendarRedirect\('connected', state\)/);
  assert.match(callback, /const DRIVE_APP_URL = 'https:\/\/desk\.bokdoong\.com\/work\/app\/\?view=library';/);
});

test('Task 12C final matrix remains mandatory in authorization CI', () => {
  const workflow = read('.github/workflows/authz-security-check.yml');

  assert.match(workflow, /node --test tests\/security\/\*\.test\.mjs/);
  assert.match(workflow, /supabase\/tests\/authz_sole_owner\.sql/);
});
