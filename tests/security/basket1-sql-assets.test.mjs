import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stem = '20261010120000_basket1_notes_links';
const read = path => readFile(new URL('../../' + path, import.meta.url), 'utf8');
const sqlCode = text => text.replace(/--[^\n]*/g, '').replace(/'(?:''|[^'])*'/g, "''");

test('BASKET-1 phone inspection assets contain SELECT only and no privileged commands', async () => {
  for (const suffix of ['precheck','postcheck','snapshot']) {
    const code = sqlCode(await read(`docs/${stem}.${suffix}.sql`));
    assert.match(code.trim(), /^(select|with)\b/i);
    assert.doesNotMatch(code, /\b(insert|update|delete|merge|create|alter|drop|grant|revoke|call|do|copy|execute|set|begin|commit)\b/i);
  }
});

test('BASKET-1 is one phone transaction with matching version/name and no ACL expansion or RTW/legacy writes', async () => {
  const migration = await read(`supabase/migrations/${stem}.sql`);
  const rollback = await read(`docs/${stem}.rollback.sql`);
  for (const sql of [migration,rollback]) {
    assert.equal(sql.split('\n')[0], 'begin;');
    assert.equal(sql.trim().split('\n').at(-1), 'commit;');
    assert.doesNotMatch(sqlCode(sql), /\b(grant|revoke)\b|rtw_|app_suborganization_updates|create\s+(?:or\s+replace\s+)?function/i);
  }
  assert.equal((migration.match(/insert into supabase_migrations\.schema_migrations/g) || []).length,1);
  assert.match(migration,/values \('20261010120000', 'basket1_notes_links',/);
  assert.ok(migration.trim().split('\n').length <= 150, 'split longer phone migrations');
  assert.doesNotMatch(sqlCode(rollback),/\bcascade\b/i, 'rollback must not cascade-drop unrelated objects');
});
