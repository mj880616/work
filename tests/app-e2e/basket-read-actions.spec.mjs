import {showBasketRow} from './helpers/basket-more.mjs';
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-바구니버튼정리: the read view's actions. Common ones first and emphasized,
// 삭제 set apart as the risky one, and at 390 no scattered wrap.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00.123456+00:00';
const n='10000000-0000-4000-8000-000000000002';
async function openNote(page,width){
 await page.setViewportSize({width,height:width<761?844:900});
 await openHome(page);const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const note={id:n,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:'10/20 기자회견 자료',ai_export_allowed:true,archived_at:null,attachments:[{drive_file_id:'drive-a',file_name:'안내문.pdf',mime_type:'application/pdf',size_bytes:4096}],metadata:{}};
 for(const t of ['app_suborganizations','app_suborganization_assignees','app_spaces','app_record_links'])await page.route(SB+'/rest/v1/'+t+'?**',r=>r.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_notes?**',r=>{const q=new URL(r.request().url()).searchParams;if(r.request().method()!=='GET')return r.fulfill({status:500,json:{}});if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:[note].slice(Number(q.get('offset')||0))});});
 await page.evaluate(()=>window.KPTURouter.go('basket'));await showBasketRow(page,n);
 const row=page.locator(`[data-basket-row="${n}"]`);if(width<761)await row.tap();else await row.click();
 await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 return {errors,actions:page.locator('[data-basket-read-actions]')};
}
const box=locator=>locator.boundingBox();

// UI-디자인손질 6: the big buttons are only [연결하기](filled) and [할 일 만들기](task teal); 수정·원문 그대로 보기·보관·삭제
// moved into the note's own [⋯] at the top right, 삭제 last and red. The list's [⋯] (AI 분류 요청) is not shown on a note.
for(const width of [390,1280])test(`read actions: two big buttons, the rest in the note menu ${width}`,async({page},info)=>{
 const {errors,actions}=await openNote(page,width);
 await expect(actions.getByRole('button')).toHaveText(['연결하기','할 일 만들기']);
 const link=actions.locator('[data-basket-link-open]'),task=actions.locator('[data-basket-task-open]');
 await expect(link).toHaveClass(/\bprimary\b/);await expect(task).toHaveClass(/\bprimary\b/);
 const color=l=>l.evaluate(el=>getComputedStyle(el).backgroundColor);
 expect(await color(link)).not.toBe(await color(task));
 const [bl,bt]=await Promise.all([box(link),box(task)]);
 // UI-버튼작게 ①: one row, 32px to the eye, 44px press area, width by the label.
 for(const [b,l] of [[bl,link],[bt,task]]){expect(b.height).toBe(32);expect(await l.evaluate(el=>getComputedStyle(el,'::after').height)).toBe('44px');}
 expect(Math.round(bl.y)).toBe(Math.round(bt.y));expect(bt.x).toBeGreaterThan(bl.x+bl.width);
 const detail=page.locator('[data-basket-detail]'),more=detail.locator('[data-basket-note-more]'),menu=detail.locator('#basketNoteMenu');
 await expect(page.locator('#basketView [data-basket-more]')).toBeHidden();
 await expect(page.locator('#basketView').getByRole('button',{name:'AI 분류 요청',exact:true})).toHaveCount(0);
 await expect(page.locator('[data-basket-handoff-scope]')).toBeHidden();
 if(width===390)await more.tap();else await more.click();
 await expect(menu.getByRole('button')).toHaveText(['수정','노트로 옮기기','원문 그대로 보기','보관','삭제']);
 for(const b of await menu.getByRole('button').all())expect((await box(b)).height).toBeGreaterThanOrEqual(44);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`basket-read-actions-${width}.png`),fullPage:true});
 // Keyboard: the menu opens on its first item and Tab walks it in order, 삭제 last.
 const items=menu.getByRole('button');await expect(items.first()).toBeFocused();
 for(let i=1;i<4;i++){await page.keyboard.press('Tab');await expect(items.nth(i)).toBeFocused();}
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(more).toBeFocused();
 // Touch and keyboard still open the same panels as before.
 if(width===390)await task.tap();else{await task.focus();await page.keyboard.press('Enter');}
 await expect(actions).toBeHidden();await expect(page.locator('[data-basket-manual]')).toBeVisible();
 expect(errors).toEqual([]);
});
