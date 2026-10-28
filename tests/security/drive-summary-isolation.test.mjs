import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const browser=new URL('../../app/project-catalog-model.mjs',import.meta.url);
const edge=new URL('../../supabase/functions/drive-summary/project-catalog-model.mjs',import.meta.url);
const banner='// Source of truth: app/project-catalog-model.mjs.\n// Deployment-local copy; the regression compares everything below this banner byte for byte.\n';

test('Edge catalog is an exact deployment-local copy of the unchanged browser source of truth',async()=>{
  const [original,copy]=await Promise.all([readFile(browser,'utf8'),readFile(edge,'utf8')]);
  assert.ok(copy.startsWith(banner));assert.equal(copy.slice(banner.length),original);
});

