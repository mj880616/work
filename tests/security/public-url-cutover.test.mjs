import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';

const root = new URL('../../', import.meta.url);
const load = path => readFileSync(new URL(path, root), 'utf8');
const prepare = load('supabase/migrations/20260920120000_public_single_post_prepare.sql');
const cutover = load('supabase/migrations/20260920121000_public_single_post_cutover.sql');
const seed = load('supabase/local-verify/seed-before-cutover.sql');

const legacyUnlisted = [
  'bus-strike-publicness-internal-archive-202609',
  'gimpo-publicization',
  'gimpo-publicization-audit',
  'gimpo-publicization-press-1008',
  'line9-publicization',
  'line9-publicization-audit',
];

test('all seven existing public page URLs survive cutover', () => {
  for (const slug of legacyUnlisted) {
    assert.ok(prepare.includes(`'${slug}'`), `public RPC omits ${slug}`);
    assert.ok(cutover.includes(`'${slug}'`), `cutover preflight omits ${slug}`);
    assert.ok(seed.includes(`'${slug}'`), `local seed omits ${slug}`);
    assert.ok(existsSync(new URL(`p/${slug}/index.html`, root)), `URL shell missing for ${slug}`);
  }
  assert.ok(prepare.includes("p.visibility = 'public'"));
  assert.ok(cutover.includes("p.slug='private-rail-forum-0929-prep'"));
  assert.ok(seed.includes("('private-rail-forum-0929-prep','public')"));
  assert.ok(existsSync(new URL('p/private-rail-forum-0929-prep/index.html', root)));
  assert.doesNotMatch(cutover, /update\s+public\.app_pages\s+set\s+visibility\s*=/i);
});
