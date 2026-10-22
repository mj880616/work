import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {openHome} from './helpers/home-entry.mjs';
import {openBasketMore,requestClassification,handoffLine} from './helpers/basket-more.mjs';

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
    const homeMode=await measure(quick.locator('[data-quick-mode="update"]'));
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
    // 8-9e-2: 폰은 "바구니 전체 보기" 대신 하단 [바구니] 탭으로 간다(PC는 링크 그대로).
    if(width<=760){await expect(quick.locator('[data-goto="basket"]')).toBeHidden();await page.locator('.mobile-tabs [data-view="basket"]').click();}
    else await quick.locator('[data-goto="basket"]').click();
    await expect(page.locator('[data-basket-row]')).toHaveCount(1);
    await page.screenshot({path:info.outputPath(`basket-list-${width}.png`),fullPage:true});
    // 8-9e-2: the AI actions sit in the small [⋯] menu as 44px menu rows (not buttons); the filters match the home pills.
    await openBasketMore(page);
    const controls=['[data-basket-filter="unclassified"]','[data-basket-filter="classified"]','[data-basket-filter="archived"]'];
    const metrics={homeMode,homeLink,homePrimary,controls:{},menu:{}};
    for(const selector of controls)metrics.controls[selector]=await measure(page.locator(selector));
    for(const selector of ['[data-basket-more]','#basketMoreMenu [data-handoff-copy]','#basketMoreMenu [data-chatgpt-request-copy]'])metrics.menu[selector]=await measure(page.locator(selector));
    for(const metric of Object.values(metrics.menu))expect(metric.touchHeight).toBeGreaterThanOrEqual(44);
    await expect(page.locator('#basketMoreMenu [data-classification-open]')).toHaveCount(0);
    await expect(page.locator('#basketView [data-goto="home"]')).toHaveCount(0);
    await requestClassification(page);await expect(page.locator('[data-classification-input]')).toBeFocused();
    const proposal={schema_version:1,copied_at:stamp,items:[{note_id:noteId,note_updated_at:stamp,destinations:[{kind:'organization',target_id:orgId,reason:'담당조직 업무 근거'}]}]};
    await page.locator('[data-classification-input]').fill('```json\n'+JSON.stringify(proposal,null,2)+'\n```');
    await page.locator('[data-classification-preview]').click();
    await expect(page.locator('[data-classification-choice]:enabled')).toHaveCount(1);
    await page.locator('[data-classification-choice]').check();
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:info.outputPath(`basket-panel-${width}.png`),fullPage:true});
    for(const selector of ['[data-classification-close]','[data-classification-preview]','[data-classification-confirm]'])metrics.controls[selector]=await measure(page.locator(selector));
    await writeFile(info.outputPath(`metrics-${width}.json`),JSON.stringify(metrics,null,2));

    // UI-버튼크기: 필터는 알약 칩(보이는 높이 32px·13px, 누르는 범위 44px), 분류 창 버튼은 공용 큰 버튼(--ds-control-height).
    // UI-PC버튼36: PC(≥1024) 홈 [추가]만 입력칸 높이(36px)라, 분류 창 버튼은 [추가]가 아니라 공용 기준값과 비교한다.
    const bigHeight=parseFloat(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ds-control-height')));
    expect(homePrimary.height).toBe(36); // UI-버튼줄이기: 폰도 홈 [추가]는 36px(누르는 범위 44px).
    for(const [selector,metric] of Object.entries(metrics.controls)){
      const filter=selector.startsWith('[data-basket-filter');
      expect(Math.abs(metric.height-(filter?32:bigHeight)),selector).toBeLessThanOrEqual(1);
      expect(metric.fontSize).toBe('13px');
      expect(metric.borderRadius,selector).toBe(filter?'999px':'8px');
      expect(metric.touchHeight).toBeGreaterThanOrEqual(44);
    }

    await expect(page.locator('#basketView [data-goto="home"]')).toHaveCount(0);
    expect(metrics.controls['[data-classification-confirm]'].background).toBe(homePrimary.background);
    expect(metrics.controls['[data-classification-confirm]'].color).toBe(homePrimary.color);

    const close=page.locator('[data-classification-close]');
    await page.locator('[data-classification-input]').focus();await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    expect(await close.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');await expect(page.locator('[data-basket-more]')).toBeFocused();
    // UI-바구니거르기: [분류] holds no memo here (the one memo is unclassified); [미분류] still holds it.
    const classified=page.locator('[data-basket-filter="classified"]');await classified.focus();await page.keyboard.press('Enter');
    await expect(classified).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-basket-row]')).toHaveCount(0);
    const unclassified=page.locator('[data-basket-filter="unclassified"]');await unclassified.focus();await page.keyboard.press('Enter');
    await expect(page.locator(`[data-basket-row="${noteId}"]`)).toBeVisible();
    // UI-버튼크기: the 32px chip keeps a 44px touch target; tap just above its painted top edge.
    const archived=page.locator('[data-basket-filter="archived"]'),box=await archived.boundingBox();
    await page.touchscreen.tap(box.x+box.width/2,box.y-4);
    await expect(archived).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-basket-row="archived"]')).toBeVisible();
    // #577: [분류 요청] copies again and opens the same result sheet.
    await requestClassification(page,{keyboard:true});
    await expect(handoffLine(page)).toContainText('복사했어요');
    expect(await page.evaluate(()=>window.__compactCopies)).toHaveLength(2);
    await expect(page.locator('[data-classification-input]')).toBeFocused();
    const choice=page.locator('[data-classification-choice]');await choice.focus();await page.keyboard.press('Space');await expect(choice).not.toBeChecked();
    await expect(page.locator('[data-classification-confirm]')).toBeDisabled();await page.keyboard.press('Space');
    const connect=page.locator('[data-classification-confirm]');await connect.scrollIntoViewIfNeeded();const hit=await connect.boundingBox();
    await page.touchscreen.tap(hit.x+hit.width/2,hit.y+3);
    await expect(page.locator('[data-classification-status]')).toContainText('1개 연결했어요');
    expect(f.confirmations).toHaveLength(1);expect(f.confirmations[0].p_targets).toEqual([{kind:'organization',target_id:orgId,reason:'담당조직 업무 근거',summary:'담당조직 업무 근거'}]);
    await close.click();await classified.click();await expect(page.locator(`[data-basket-row="${noteId}"]`)).toContainText('분류 완료');
    await page.locator('.mobile-tabs [data-view="home"]:visible,.app-nav [data-view="home"]:visible,.app-nav .sidebar-brand:visible').click();await expect(quick).toBeVisible();
    await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur());
    await quick.screenshot({path:info.outputPath(`quick-return-${width}.png`)});
    expect(await quick.boundingBox()).toEqual(quickBounds);
    expect(await quickContent()).toEqual(quickBefore);
    for(const [selector,original] of [['[data-quick-mode="update"]',homeMode],['[data-goto="basket"]',homeLink]]){
      const returned=await measure(quick.locator(selector));
      for(const key of ['height','width','fontSize','borderRadius','borderWidth','background','color','padding'])expect(returned[key]).toBe(original[key]);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(f.errors).toEqual([]);expect(f.unexpected).toEqual([]);
  });
}
