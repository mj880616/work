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

test('all four committed synthetic Drive/handoff prompts remain byte for byte unchanged',async()=>{
  const f=JSON.parse(await readFile(new URL('../fixtures/basket-project-destinations.json',import.meta.url),'utf8'));
  const [{select,basketProjects},{renderBasket,selectBasketOrganizations},{buildHandoff},{kstWindow}]=await Promise.all([
    import('../../supabase/functions/drive-summary/project-catalog-model.mjs'),import('../../supabase/functions/drive-summary/basket.mjs'),import('../../app/basket-ai-handoff.js'),import('../../supabase/functions/drive-summary/core.mjs'),
  ]);
  const now=new Date(f.now),projects=select(f.spaces);
  const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
  for(const fallback of [false,true]){
    const selected=selectBasketOrganizations(f.organizations,fallback?[]:f.assignees);
    const copy=buildHandoff(f.notes,basketProjects(projects),selected.organizations,now,selected.fallback)+'\n';
    const html=renderBasket(f.notes,[],projects,selected.organizations,now,kstWindow(now),selected.fallback).html;
    const text=decode(html.replace(/<\/(?:h[23]|p|pre)>\n?/g,'\n\n').replace(/<[^>]*>/g,'')).trimEnd()+'\n';
    const name=fallback?'basket-org-mine-handoff-fallback.txt':'basket-ai-handoff-prompt-example.txt';
    const drive=fallback?'basket-org-mine-drive-fallback.txt':'basket-org-only-drive-example.txt';
    assert.equal(copy,await readFile(new URL('../../docs/'+name,import.meta.url),'utf8'));
    assert.equal(text,await readFile(new URL('../../docs/'+drive,import.meta.url),'utf8'));
  }
});
