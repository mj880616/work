import {test,expect} from '@playwright/test';
import {openHome,createdTaskReply} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const q=page=>page.locator('#homeView [data-home-quick]');
const sheet=page=>page.getByRole('dialog');
const names=['전국철도노동조합','서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','인천교통공사노동조합','서해선지부','신분당선지부','지티엑스에이운영지부','공항철도지부','메트로9호선노동조합','서울교통공사9호선지부','김포도시철도지부','용인경전철지부'];
async function orgs(page){
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:names.map((name,i)=>({id:String(i),name,active:true}))}));
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:names.map((_,i)=>({organization_id:String(i)}))}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>r.fulfill({json:[5,1,0].map(i=>({organization_id:String(i),occurred_at:'2026-10-06'}))}));
 await page.reload();await q(page).locator('[data-quick-mode="update"]').click();await q(page).locator('[data-quick-input]').fill('QA');
 await q(page).locator('[data-quick-org]').click();await expect(sheet(page)).toBeVisible();
}
for(const width of [390,1440])test(`organization rows fit, preserve order and non-overlapping targets at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await openHome(page);await q(page).locator('[data-quick-mode="task"]').click();await orgs(page);
 await sheet(page).evaluate(async dialog=>{await Promise.all(dialog.getAnimations().map(animation=>animation.finished));});
 const recent=sheet(page).locator('[data-sheet-recent] button'),all=sheet(page).locator('[data-sheet-all] button');
 await expect(recent).toHaveCount(3);await expect(all).toHaveCount(13);
 expect(await all.allTextContents()).toEqual(names);
 // UPD-여러곳고르기 ①: organizations are one per line under their group heading, each with a check box (phone and PC). The list
 // scrolls inside the sheet; the [취소] [저장] line stays at the bottom of the sheet.
 const content=sheet(page).locator('[data-sheet-content]'),foot=sheet(page).locator('[data-sheet-foot]');
 await expect(foot).toBeVisible();
 const d=await sheet(page).boundingBox(),f=await foot.boundingBox();
 expect(d.y).toBeGreaterThanOrEqual(0);expect(d.y+d.height).toBeLessThanOrEqual(844);expect(f.y+f.height).toBeLessThanOrEqual(d.y+d.height+.5);
 if(width>=761){await expect(sheet(page)).toHaveClass(/home-choice-split/);expect(await sheet(page).locator('[data-sheet-all]').evaluate(el=>getComputedStyle(el).overflowY)).toBe('auto');expect(await content.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1);}
 else expect(await content.evaluate(el=>getComputedStyle(el).overflowY)).toBe('auto');
 expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight||getComputedStyle(document.body).overflow==='hidden')).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // Rows: phones keep the 44px touch line; the PC list uses 32px lines. Every row shows a check box; rows never overlap.
 if(width<761)await expect(all.first()).toHaveCSS('min-height','44px');else expect((await all.first().boundingBox()).height).toBeLessThanOrEqual(34);
 await expect(all.first().locator('.home-choice-check')).toBeVisible();
 const rows=await all.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left};}));
 // Within a group the rows share one left edge and never overlap (a wide PC flows the groups into two columns, UI-기록할곳창PC).
 const byGroup=await sheet(page).locator('[data-sheet-all] .home-choice-org-items').evaluateAll(gs=>gs.map(g=>[...g.querySelectorAll('[data-sheet-value]')].map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left};})));
 for(const g of byGroup)for(let i=1;i<g.length;i++){expect(g[i].top).toBeGreaterThanOrEqual(g[i-1].bottom-.5);expect(g[i].left).toBe(g[0].left);}
 expect(rows.length).toBe(13);
 await expect(sheet(page).locator('[data-sheet-all] .home-choice-group-name')).toHaveText(['철도','지하철','민자철도','민간도시철도']);
 // The 최근 chips keep separate pressing ranges.
 const targets=await sheet(page).locator('.home-choice-chip').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el,'::after'),h=parseFloat(s.height),w=parseFloat(s.width);return {left:r.left+1+parseFloat(s.left),right:r.left+1+parseFloat(s.left)+w,top:r.top+r.height/2-h/2,bottom:r.top+r.height/2+h/2};}));
 for(let i=0;i<targets.length;i++)for(let j=i+1;j<targets.length;j++){const a=targets[i],b=targets[j];expect(Math.max(a.left,b.left)>=Math.min(a.right,b.right)-.1||Math.max(a.top,b.top)>=Math.min(a.bottom,b.bottom)-.1).toBe(true);}
 await page.screenshot({path:info.outputPath(`org-sheet-${width}.png`),fullPage:false});
 // A press marks the row and keeps the sheet open; [저장] closes it and the input takes the place.
 await all.filter({hasText:'서해선지부'}).scrollIntoViewIfNeeded();await all.filter({hasText:'서해선지부'}).click();
 await expect(sheet(page)).toBeVisible();await expect(all.filter({hasText:'서해선지부'})).toHaveAttribute('aria-pressed','true');
 await expect(sheet(page).locator('[data-sheet-count]')).toHaveText('1곳 선택됨');
 await sheet(page).getByRole('button',{name:'저장',exact:true}).click();
 await expect(sheet(page)).toBeHidden();await expect(q(page).locator('[data-quick-org]')).toHaveText('▾');await expect(q(page).locator('[data-quick-mode="update"]')).toHaveText('업데이트');await expect(q(page).locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택: 서해선지부');await expect(q(page).locator('[data-quick-input]')).toHaveAttribute('placeholder','서해선지부 기록을 입력하세요');await expect(q(page).locator('[data-quick-org]')).toBeFocused();
 await q(page).locator('[data-quick-org]').click();await expect(sheet(page).locator('[aria-pressed="true"]').first()).toBeFocused();
 await page.keyboard.press('Escape');await expect(sheet(page)).toBeHidden();
});
test('close paths consume one history entry, focus is contained and project none clears selection',async({page})=>{
 await openHome(page);await q(page).locator('[data-quick-mode="task"]').click();await q(page).locator('[data-quick-input]').fill('QA');
 const trigger=q(page).locator('[data-quick-project]');
 const before=await page.evaluate(()=>history.state);
 await trigger.click();await expect(sheet(page)).toBeVisible();await expect(sheet(page).getByRole('button',{name:'사업영역 없음',exact:true})).toBeFocused();
 await page.keyboard.press('Shift+Tab');await expect(sheet(page).getByRole('searchbox',{name:'사업영역 이름 검색'})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(sheet(page).getByRole('button',{name:'선택판 닫기'})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(sheet(page).getByRole('button',{name:'자식 프로젝트',exact:true})).toBeFocused();
 await sheet(page).getByRole('button',{name:'자식 프로젝트',exact:true}).click();await expect(sheet(page)).toBeHidden();await expect(trigger).toHaveText('자식 프로젝트 ▾');await expect(trigger).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>history.state)).toEqual(before);
 await trigger.click();await expect(sheet(page).getByRole('button',{name:'자식 프로젝트',exact:true})).toBeFocused();
 await page.goBack();await expect(sheet(page)).toBeHidden();await expect(trigger).toBeFocused();await expect(page).toHaveURL(/\/app\//);
 await trigger.click();await sheet(page).getByRole('button',{name:'선택판 닫기'}).click();await expect(trigger).toBeFocused();
 await trigger.click();await page.mouse.click(10,10);await expect(trigger).toBeFocused();
 await trigger.click();await sheet(page).getByRole('button',{name:'사업영역 없음',exact:true}).click();await expect(trigger).toHaveText('사업영역 ▾');
 const bodies=[];await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({json:createdTaskReply(r.request().postDataJSON())});});
 await q(page).locator('[data-quick-save]').click();await expect(q(page).locator('[data-quick-input]')).toHaveValue('');expect(bodies[0].links).toEqual([]);
});

test('long projects scroll only inside the sheet and remain one-line with child indentation',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await openHome(page);await q(page).locator('[data-quick-mode="task"]').click();
 await page.evaluate(()=>{const c=KPTUProjectCatalog,s=c.snapshot();c.publish({workspaceId:s.workspaceId,userId:s.userId,spaces:[{...s.spaces[0],name:'QA 긴 프로젝트 이름 '.repeat(15)},...Array.from({length:30},(_,i)=>({id:'child-'+i,name:'QA 자식 '+i,parent_id:'p',owner_id:s.userId,status:'active'}))]});});
 await q(page).locator('[data-quick-input]').fill('QA');await q(page).locator('[data-quick-project]').click();
 const content=sheet(page).locator('[data-sheet-content]'),parent=sheet(page).locator('[data-sheet-value="p"]'),child=sheet(page).locator('[data-sheet-value="child-0"]');
 expect(await content.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await expect(parent).toHaveCSS('height','44px');/* 8-9e-3: 고르기 시트 줄 44px */await expect(parent).toHaveCSS('text-overflow','ellipsis');await expect(parent).toHaveCSS('white-space','nowrap');
 expect(await child.evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft))).toBe(22);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('project-sheet-390.png'),fullPage:false});
 await child.click();await expect(sheet(page)).toBeHidden();
});

test('routing while a sheet is open closes it without undoing navigation',async({page})=>{
 await openHome(page);await q(page).locator('[data-quick-mode="task"]').click();await q(page).locator('[data-quick-input]').fill('QA');await q(page).locator('[data-quick-project]').click();await expect(sheet(page)).toBeVisible();
 await page.evaluate(async()=>{await KPTUViewLoader.load('calendar');KPTURouter.go('calendar',{source:'delegated'});});
 await expect(sheet(page)).toBeHidden();await expect(page.locator('#calendarView')).toBeVisible();await expect(page).toHaveURL(/view=calendar/);
 expect(await page.evaluate(()=>history.state?.kptuHomeChoice)).toBeUndefined();
});
