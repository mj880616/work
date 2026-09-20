import {readFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:8123';
const samples=JSON.parse(await readFile(new URL('../../docs/web1-migration-samples.json',import.meta.url),'utf8'));
const inventory=JSON.parse(await readFile(new URL('../../docs/web1-card-inventory.json',import.meta.url),'utf8'));

for(const index of [0,2]){
  test(`Web1 sample ${index+1} keeps its text and hierarchy in a native Web2 post`,async({page})=>{
    const item=samples[index];
    expect(item.safe_for_auto_import).toBe(true);
    await page.goto(`${BASE}/tests/app-e2e/page-management-fixture.html`);
    await page.addScriptTag({url:`${BASE}/app/page-design-core.js`});
    const rendered=await page.evaluate(post=>{
      document.body.innerHTML='<article class="pd-design"><h1></h1><p class="summary"></p><div class="pd-body"></div></article>';
      document.querySelector('h1').textContent=post.title;
      document.querySelector('.summary').textContent=post.summary;
      document.querySelector('.pd-body').innerHTML=window.KPTUPageDesign.renderMarkdown(post.body);
      const body=document.querySelector('.pd-body');
      return {
        text:document.body.textContent,
        headings:[...body.querySelectorAll('h2,h3,h4')].map(el=>el.textContent),
        lists:body.querySelectorAll('ul,ol').length,
        links:[...body.querySelectorAll('a')].map(el=>el.href),
        unsafe:body.querySelectorAll('script,iframe,[onload],[onerror]').length,
      };
    },item);
    expect(rendered.text).toContain(item.title);
    expect(rendered.unsafe).toBe(0);
    const source=inventory.content_units.find(unit=>unit.source===item.source_path&&(index===0?unit.classification==='content_card':unit.source_id.endsWith('#edu-rail-0225')));
    expect(source).toBeTruthy();
    expect(rendered.headings.length).toBeGreaterThanOrEqual(source.heading_levels.filter(level=>level!=='h1').length-(index===2?1:0));
    expect(rendered.lists).toBeGreaterThanOrEqual(source.lists);
    expect(item.missing_word_count).toBe(0);
    if(index===2)expect(rendered.headings).toContain('핵심 질문');
    if(process.env.KPTU_CAPTURE_MIGRATION_PREVIEW){
      await page.screenshot({path:`test-results/web2-migration-sample-${index+1}.png`,fullPage:true});
      await page.goto(`${BASE}/${item.source_path}`);
      await page.screenshot({path:`test-results/web1-migration-sample-${index+1}.png`,fullPage:true});
    }
  });
}

test('table and dynamic Web1 samples are held for manual conversion',()=>{
  expect(samples[1].safe_for_auto_import).toBe(false);
  expect(samples[1].unsupported_elements).toContain('table');
  expect(samples[3].safe_for_auto_import).toBe(false);
  expect(samples[3].unsupported_elements).toContain('dynamic_content');
});
