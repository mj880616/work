import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');

test('document-ai-index gates requested document ids through user-scoped RLS before service-role reads', () => {
  const src = read('document-ai-index');
  assert.match(src, /SUPABASE_ANON_KEY/);
  assert.match(src, /userDb\.from\(['"]app_documents['"]\)/);
  assert.match(src, /allowedDocs/);
});

test('page-ai-draft reads selected documents and derived AI data through user-scoped RLS', () => {
  const src = read('page-ai-draft');
  assert.match(src, /SUPABASE_ANON_KEY/);
  assert.match(src, /userDb\.from\(['"]app_documents['"]\)/);
  assert.match(src, /userDb\.from\(['"]app_document_ai_index['"]\)/);
  assert.match(src, /userDb\.from\(['"]app_document_chunks['"]\)/);
});

test('team-ai context tables are loaded through user-scoped RLS', () => {
  const src = read('team-ai');
  assert.match(src, /SUPABASE_ANON_KEY/);
  for (const table of [
    'app_spaces',
    'app_project_updates',
    'app_project_checkitems',
    'app_documents',
    'app_events',
    'app_meetings',
    'app_tasks',
    'app_event_attendees',
  ]) {
    assert.match(src, new RegExp(`userDb\\.from\\(['\"]${table}['\"]\\)`), `${table} must use user-scoped RLS`);
  }
});
