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

// UI-디자인손질 6 → UI-바구니상세개편: the card's last row is [연결하기](filled)·[할 일 만들기](task teal)·[노트로 옮기기](plain),
// one row at the read-screen button height (UI-버튼작게 ①: 32px to the eye, 44px press area), width by the label. 수정·보관·삭제 stay in the note's own [⋯] at the top right,
// 삭제 last and red ([노트로 옮기기] and [원문 그대로 보기] left the menu). The list's [⋯] (AI 분류 요청) is not shown on a note.
for(const width of [390,1280])test(`read actions: three buttons in one row, the rest in the note menu ${width}`,async({page},info)=>{
 const {errors,actions}=await openNote(page,width);
 await expect(actions.getByRole('button')).toHaveText(['연결하기','할 일 만들기','노트로 옮기기']);
 const link=actions.locator('[data-basket-link-open]'),task=actions.locator('[data-basket-task-open]'),move=actions.locator('[data-basket-to-note]');
 // UI-바구니상세버튼색: same background, border and text color on all three (same on 390 and 1280).
 const paint=l=>l.evaluate(el=>{const s=getComputedStyle(el);return [s.backgroundColor,s.color,s.borderTopColor,s.borderTopWidth,s.borderTopStyle,s.fontWeight,s.fontSize,s.borderRadius];});
 const plain=await paint(move);
 expect(await paint(link)).toEqual(plain);expect(await paint(task)).toEqual(plain);
 for(const b of [link,task,move])await expect(b).not.toHaveClass(/\bprimary\b/);
 const [bl,bt,bm]=await Promise.all([box(link),box(task),box(move)]);
 for(const [b,l] of [[bl,link],[bt,task],[bm,move]]){expect(b.height).toBe(32);expect(await l.evaluate(el=>getComputedStyle(el,'::after').height)).toBe('44px');expect(Math.round(b.y)).toBe(Math.round(bl.y));}
 expect(bt.x).toBeGreaterThan(bl.x+bl.width);expect(bm.x).toBeGreaterThan(bt.x+bt.width);
 // The row sits inside the update card, at its bottom.
 const card=await box(page.locator('[data-basket-card]'));expect(bl.y+bl.height).toBeLessThanOrEqual(card.y+card.height);
 const detail=page.locator('[data-basket-detail]'),more=detail.locator('[data-basket-note-more]'),menu=detail.locator('#basketNoteMenu');
 await expect(page.locator('#basketView [data-basket-more]')).toBeHidden();
 await expect(page.locator('#basketView').getByRole('button',{name:'AI 분류 요청',exact:true})).toHaveCount(0);
 await expect(page.locator('[data-basket-handoff-scope]')).toHaveCount(0);
 if(width===390)await more.tap();else await more.click();
 await expect(menu.getByRole('button')).toHaveText(['수정','보류로','업무일지에 남기기','삭제']);
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
