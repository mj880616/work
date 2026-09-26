import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, ROOT), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = '20260926004103_web1_4_drop_app_delete_pages.sql';
const migration = read(`supabase/migrations/${MIGRATION}`);
const rollback = read(`scripts/sql/rollback/${MIGRATION}`);
const body = sql => sql.match(/\$function\$([\s\S]*?)\$function\$|as \$\$([\s\S]*?)\$\$;/i)?.slice(1).find(Boolean);
const statements = sql => sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);

test('migration only drops app_delete_pages, without CASCADE', () => {
  assert.deepEqual(statements(migration), [
    'begin',
    "set local lock_timeout = '5s'",
    "set local statement_timeout = '60s'",
    'drop function public.app_delete_pages(uuid[])',
    'commit'
  ]);
});

test('rollback restores the Task 12A definition and the production grants', () => {
  const task12a = read('supabase/migrations/20260925084844_task12a_sole_owner_db.sql');
  const original = task12a.slice(task12a.indexOf('create or replace function public.app_delete_pages'));
  assert.equal(body(rollback), body(original));
  assert.match(rollback, /security definer\s+set search_path = pg_catalog, public, private/);
  assert.match(rollback, /revoke all on function public\.app_delete_pages\(uuid\[\]\) from PUBLIC, anon;/);
  assert.match(rollback, /grant execute on function public\.app_delete_pages\(uuid\[\]\) to authenticated, service_role;/);
  assert.equal(statements(rollback).some(s => /^grant\b[^;]*\banon\b/i.test(s)), false);
});

test('no runtime code calls app_delete_pages', () => {
  const walk = dir => readdirSync(new URL(dir, ROOT)).flatMap(name => {
    const path = `${dir}/${name}`;
    return statSync(fileURLToPath(new URL(path, ROOT))).isDirectory() ? walk(path) : [path];
  });
  for (const path of [...walk('app'), ...walk('p'), ...walk('supabase/functions')]) {
    if (!/\.(js|mjs|ts|html)$/.test(path)) continue;
    assert.doesNotMatch(read(path), /app_delete_pages/, `${path} must not call app_delete_pages`);
  }
});

test('sole-owner actor matrix tolerates the dropped RPC', () => {
  const soleOwner = read('supabase/tests/authz_sole_owner.sql');
  assert.match(soleOwner, /if to_regprocedure\('public\.app_delete_pages\(uuid\[\]\)'\) is not null then/);
  assert.match(read('supabase/tests/authz_web1_4_delete_pages_removed.sql'), /^rollback;$/m);
});
