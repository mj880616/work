import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {openHome} from './helpers/home-entry.mjs';

test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const noteId='10000000-0000-4000-8000-000000000001';
const orgId='20000000-0000-4000-8000-000000000002';
const stamp='2026-10-06T00:02:03.123456Z';
const measure=locator=>locator.evaluate(el=>{
  const b=el.getBoundingClientRect(),s=getComputedStyle(el),hit=getComputedStyle(el,'::after');
  return {height:b.height,width:b.width,x:b.x,y:b.y,fontSize:s.fontSize,borderRadius:s.borderRadius,
    borderWidth:s.borderWidth,background:s.backgroundColor,color:s.color,padding:s.padding,
    touchHeight:hit.content==='none'?b.height:Math.max(b.height,parseFloat(hit.height)||0)};
});
async function fixture(page){
  const errors=[],unexpected=[],confirmations=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  // Any request outside the local server must be handled by a fixture.
  await page.route('**/*',route=>{
    if(new URL(route.request().url()).hostname==='127.0.0.1')return route.fallback();
    unexpected.push(route.request().url());return route.abort();
  });
  await openHome(page);
  // Keep openHome's Oct 6 clock for the whole roundtrip. Advancing it after
  // rendering would retire the Oct 7 milestone and change the aside width.
  await page.waitForFunction(()=>window.KPTUHome?.metrics.readyAt>0);
  const notes=[{id:noteId,workspace_id:'w',raw_text:'합성 메모 · 담당조직에 연결할 내용',updated_at:stamp,occurred_at:stamp,ai_export_allowed:true,attachments:[]},
    {id:'archived',raw_text:'보관한 합성 메모',updated_at:stamp,occurred_at:stamp,archived_at:stamp,attachments:[]}];
  const links=[];
  await page.route(SB+'/rest/v1/app_notes?**',r=>r.fulfill({json:notes}));
  await page.route(SB+'/rest/v1/app_record_links?**',r=>r.fulfill({json:links}));
  await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:[{id:orgId,workspace_id:'w',name:'합성 담당조직'}]}));
  await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',r=>{
    confirmations.push(r.request().postDataJSON());
    links.push({note_id:noteId,status:'confirmed',organization_id:orgId,organization:{name:'합성 담당조직'}});
    return r.fulfill({json:{ok:true,created:1,existing:0}});
  });
  await page.evaluate(()=>{
    window.__compactCopies=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__compactCopies.push(text)}});
  });
  return {errors,unexpected,confirmations};
}
for(const width of [390,1280]){
  test(`basket controls match home pills with keyboard and expanded touch targets ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:1000});const f=await fixture(page);
    const quick=page.locator('#homeView .home-quick');
    const quickBounds=await quick.boundingBox();
    const homeMode=await measure(quick.locator('[data-quick-mode="basket"]'));
    const homeLink=await measure(quick.locator('[data-goto="basket"]'));
    const homePrimary=await measure(quick.locator('[data-quick-save]'));
    await page.screenshot({path:info.outputPath(`home-${width}.png`),fullPage:true});
    await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur());
    await quick.screenshot({path:info.outputPath(`quick-before-${width}.png`)});
    // Fractional card positions can rasterize outer rounded corners differently.
    // Compare the full control content exactly, and its bounds/styles separately.
    const quickContent=async()=>{
      const b=await quick.boundingBox();
      return page.screenshot({clip:{x:b.x+2,y:b.y+2,width:b.width-4,height:b.height-4}});
    };
    const quickBefore=await quickContent();
    await quick.locator('[data-goto="basket"]').click();
    await expect(page.locator('[data-basket-row]')).toHaveCount(1);
    await page.screenshot({path:info.outputPath(`basket-list-${width}.png`),fullPage:true});
    const controls=['[data-basket-filter="unclassified"]','[data-basket-filter="all"]','[data-basket-filter="archived"]','[data-handoff-copy]','[data-classification-open]'];
    const metrics={homeMode,homeLink,homePrimary,controls:{}};
    for(const selector of controls)metrics.controls[selector]=await measure(page.locator(selector));
    await expect(page.locator('#basketView [data-goto="home"]')).toHaveCount(0);
    await page.locator('[data-classification-open]').click();
    const proposal={schema_version:1,copied_at:stamp,items:[{note_id:noteId,note_updated_at:stamp,destinations:[{kind:'organization',target_id:orgId,reason:'담당조직 업무 근거'}]}]};
    await page.locator('[data-classification-input]').fill('```json\n'+JSON.stringify(proposal,null,2)+'\n```');
    await page.locator('[data-classification-preview]').click();
    await expect(page.locator('[data-classification-choice]:enabled')).toHaveCount(1);
    await page.locator('[data-classification-choice]').check();
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:info.outputPath(`basket-panel-${width}.png`),fullPage:true});
    for(const selector of ['[data-classification-close]','[data-classification-preview]','[data-classification-confirm]'])metrics.controls[selector]=await measure(page.locator(selector));
    await writeFile(info.outputPath(`metrics-${width}.json`),JSON.stringify(metrics,null,2));

    for(const metric of Object.values(metrics.controls)){
      expect(Math.abs(metric.height-homeMode.height)).toBeLessThanOrEqual(1);
      expect(metric.fontSize).toBe(homeMode.fontSize);
      expect(metric.borderRadius).toBe(homeMode.borderRadius);
      expect(metric.touchHeight).toBeGreaterThanOrEqual(44);
    }
    expect(Math.abs(metrics.controls['[data-handoff-copy]'].y-metrics.controls['[data-classification-open]'].y)).toBeLessThanOrEqual(1);

    await expect(page.locator('#basketView [data-goto="home"]')).toHaveCount(0);
    expect(metrics.controls['[data-classification-confirm]'].background).toBe(homePrimary.background);
    expect(metrics.controls['[data-classification-confirm]'].color).toBe(homePrimary.color);

    const close=page.locator('[data-classification-close]');
    await page.locator('[data-classification-input]').focus();await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    expect(await close.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');await expect(page.locator('[data-classification-open]')).toBeFocused();
    const all=page.locator('[data-basket-filter="all"]');await all.focus();await page.keyboard.press('Enter');
    await expect(all).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-basket-row]')).toHaveCount(1);
    await expect(page.locator(`[data-basket-row="${noteId}"]`)).toBeVisible();
    // Tap beyond the painted 30px pill, inside its 44px touch target.
    const archived=page.locator('[data-basket-filter="archived"]'),box=await archived.boundingBox();
    await page.touchscreen.tap(box.x+box.width/2,box.y-5);
    await expect(archived).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-basket-row="archived"]')).toBeVisible();
    await page.locator('[data-handoff-copy]').focus();await page.keyboard.press('Enter');
    await expect(page.locator('[data-handoff-status]')).toContainText('복사했어요');
    expect(await page.evaluate(()=>window.__compactCopies)).toHaveLength(1);
    await page.locator('[data-classification-open]').focus();await page.keyboard.press('Enter');
    await expect(page.locator('[data-classification-input]')).toBeFocused();
    const choice=page.locator('[data-classification-choice]');await choice.focus();await page.keyboard.press('Space');await expect(choice).not.toBeChecked();
    await expect(page.locator('[data-classification-confirm]')).toBeDisabled();await page.keyboard.press('Space');
    const connect=page.locator('[data-classification-confirm]');await connect.scrollIntoViewIfNeeded();const hit=await connect.boundingBox();
    await page.touchscreen.tap(hit.x+hit.width/2,hit.y-5);
    await expect(page.locator('[data-classification-status]')).toContainText('1개 연결했어요');
    expect(f.confirmations).toHaveLength(1);expect(f.confirmations[0].p_targets).toEqual([{kind:'organization',target_id:orgId,reason:'담당조직 업무 근거',summary:'담당조직 업무 근거'}]);
    await close.click();await all.click();await expect(page.locator(`[data-basket-row="${noteId}"]`)).toContainText('연결됨');
    await page.locator('.mobile-tabs [data-view="home"]:visible,.app-nav [data-view="home"]:visible').click();await expect(quick).toBeVisible();
    await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur());
    await quick.screenshot({path:info.outputPath(`quick-return-${width}.png`)});
    expect(await quick.boundingBox()).toEqual(quickBounds);
    expect(await quickContent()).toEqual(quickBefore);
    for(const [selector,original] of [['[data-quick-mode="basket"]',homeMode],['[data-goto="basket"]',homeLink]]){
      const returned=await measure(quick.locator(selector));
      for(const key of ['height','width','fontSize','borderRadius','borderWidth','background','color','padding'])expect(returned[key]).toBe(original[key]);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(f.errors).toEqual([]);expect(f.unexpected).toEqual([]);
  });
}
