import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ED-통합편집기 ①b: screen model and the doc-block migration (separate DB PR) must agree.
const version = '20261022130000';
const name = 'share_pages_doc_block';
test('the screen and the DB agree on the seven block kinds and the doc limit fits the DB limit', async () => {
  const model = await import('../../app/share-pages-model.mjs');
  assert.deepEqual(model.ALL_TYPES, ['summary', 'stages', 'schedule', 'issues', 'links', 'updates', 'doc']);
  assert.ok(model.LIMITS.docBytes < model.LIMITS.bytes && model.LIMITS.bytes < 262144);
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  for (const type of model.ALL_TYPES) assert.ok(sql.includes(`@ == "${type}"`), type);
});
