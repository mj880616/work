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

test('committed synthetic handoff prompts remain byte for byte unchanged (the Drive copy no longer carries a prompt)',async()=>{
  const f=JSON.parse(await readFile(new URL('../fixtures/basket-project-destinations.json',import.meta.url),'utf8'));
  const [{select,basketProjects},{selectBasketOrganizations},{buildHandoff}]=await Promise.all([
    import('../../supabase/functions/drive-summary/project-catalog-model.mjs'),import('../../supabase/functions/drive-summary/basket.mjs'),import('../../app/basket-ai-handoff.js'),
  ]);
  const now=new Date(f.now),projects=select(f.spaces);
  for(const fallback of [false,true]){
    const selected=selectBasketOrganizations(f.organizations,fallback?[]:f.assignees);
    const copy=buildHandoff(f.notes,basketProjects(projects),selected.organizations,now,selected.fallback)+'\n';
    const name=fallback?'basket-org-mine-handoff-fallback.txt':'basket-ai-handoff-prompt-example.txt';
    assert.equal(copy,await readFile(new URL('../../docs/'+name,import.meta.url),'utf8'));
  }
});
