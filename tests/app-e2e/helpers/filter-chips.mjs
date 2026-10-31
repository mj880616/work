// Operate the visible chip UI, including opening a root before choosing its child.
export async function selectFilter(page,selector,option){
  const host=page.locator(selector),label=typeof option==='object'?option.label:null,value=typeof option==='string'?option:option.value;
  const matches=()=>label?host.getByRole('radio',{name:label,exact:true}):host.locator(`[data-filter-value="${value}"]`).first();
  if(selector==='#documentProject'&&!(await matches().isVisible().catch(()=>false))){
    const roots=await host.locator(':scope > .filter-chips').first().getByRole('radio').evaluateAll(bs=>bs.map(b=>b.dataset.filterValue));
    for(const root of roots){await host.locator(':scope > .filter-chips').first().locator(`[data-filter-value="${root}"]`).evaluate(b=>b.click());if(await matches().isVisible().catch(()=>false))break}
  }
  // UI-칩줄두줄: 칩 줄이 두 줄로 접혀 고를 칩이 숨어 있으면 [더보기 ▾]로 펼친 뒤 누른다.
  if(!(await matches().isVisible().catch(()=>false))){for(const more of await host.locator('[data-chip-rows-more][aria-expanded="false"]:visible').all())await more.click();}
  await matches().filter({visible:true}).click();
}
export async function filterOptions(page,selector){
  const host=page.locator(selector);
  if(await host.evaluate(e=>e.tagName==='SELECT'))return host.evaluate(s=>[...s.options].map(o=>({value:o.value,text:o.text,stale:o.dataset.luStaleProject==='1'})));
  const original=await host.evaluate(e=>e.value),out=[];
  const roots=await host.locator(':scope > .filter-chips').first().getByRole('radio',{includeHidden:true}).evaluateAll(bs=>bs.map(b=>({value:b.dataset.filterValue,text:b.textContent,stale:b.textContent.startsWith('[')})));
  for(const root of roots){out.push(root);await host.locator(':scope > .filter-chips').first().locator(`[data-filter-value="${root.value}"]`).evaluate(b=>b.click());const sub=host.locator('.filter-chips-small');if(await sub.count()&&await sub.evaluate(e=>!e.hidden&&e.children.length>0))out.push(...await sub.getByRole('radio',{includeHidden:true}).evaluateAll(bs=>bs.slice(1).map(b=>({value:b.dataset.filterValue,text:'　↳ '+b.textContent,stale:false}))))}
  if(!await host.locator(`[data-filter-value="${original}"]`).count()){
    for(const root of roots){await host.locator(':scope > .filter-chips').first().locator(`[data-filter-value="${root.value}"]`).evaluate(b=>b.click());if(await host.locator(`[data-filter-value="${original}"]`).count())break}
  }
  await host.locator(`[data-filter-value="${original}"]`).first().evaluate(b=>b.click());return out;
}
