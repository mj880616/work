import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {openBasketMore} from './helpers/basket-more.mjs';
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
 await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('[data-basket-filter="all"]').click();
 const row=page.locator(`[data-basket-row="${n}"]`);if(width<761)await row.tap();else await row.click();
 await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 return {errors,actions:page.locator('[data-basket-read-actions]')};
}
const box=locator=>locator.boundingBox();

for(const width of [390,1280])test(`read actions: common first, 삭제 apart, tidy rows ${width}`,async({page},info)=>{
 const {errors,actions}=await openNote(page,width);
 await expect(actions.getByRole('button')).toHaveText(['연결하기','할 일 만들기','쓰기요청 후보','수정','보관','삭제']);
 const link=actions.locator('[data-basket-link-open]'),task=actions.locator('[data-basket-task-open]'),candidate=actions.locator('[data-basket-write-request-open]'),edit=actions.locator('[data-basket-edit]'),archive=actions.locator('[data-basket-archive]'),del=actions.locator('[data-basket-delete]');
 // Shared button styles: primary for the common two, danger for 삭제.
 await expect(link).toHaveClass(/\bprimary\b/);await expect(task).toHaveClass(/\bprimary\b/);await expect(del).toHaveClass(/\bdanger\b/);await expect(candidate).toHaveClass(/\bsecondary\b/);
 const color=l=>l.evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,fg:s.color,border:s.borderTopColor};});
 const [p,e,d]=await Promise.all([color(link),color(edit),color(del)]);
 expect(p.bg).not.toBe(e.bg);expect(d.fg).not.toBe(e.fg);expect(d.border).not.toBe(e.border);
 const [bl,bt,bc,be,ba,bd,area]=await Promise.all([box(link),box(task),box(candidate),box(edit),box(archive),box(del),box(actions)]);
 for(const b of [bl,bt,bc,be,ba,bd])expect(b.height).toBeGreaterThanOrEqual(44);
 const rows=new Set([bl,bt,bc,be,ba,bd].map(b=>Math.round(b.y)));
 if(width===390){
  // Two orderly rows: the common pair side by side across the width, then 쓰기요청 후보·수정·보관 with 삭제 at the far end (BASKET-4b-2).
  expect(rows.size).toBe(2);expect(Math.round(bl.y)).toBe(Math.round(bt.y));expect(Math.round(bc.y)).toBe(Math.round(bd.y));expect(Math.round(be.y)).toBe(Math.round(bd.y));
  expect(bl.width+bt.width).toBeGreaterThan(area.width*0.9);
 }else expect(rows.size).toBe(1);
 expect(Math.abs(bd.x+bd.width-(area.x+area.width))).toBeLessThanOrEqual(1);
 expect(bd.x-(ba.x+ba.width)).toBeGreaterThanOrEqual(width===390?40:200);
 // One AI handoff on the read view (the toolbar's [⋯ 더보기], scoped to this memo).
 await openBasketMore(page);
 await expect(page.locator('[data-basket-detail]').getByRole('button',{name:'분류 요청'})).toHaveCount(0);
 await expect(page.locator('#basketView').getByRole('button',{name:'분류 요청',exact:true})).toHaveCount(1);
 // 8-9e-2: 범위 안내는 [분류 요청]을 누른 뒤에만 보인다.
 await expect(page.locator('[data-basket-handoff-scope]')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`basket-read-actions-${width}.png`),fullPage:true});
 // Keyboard order follows what is seen; 삭제 is reached last.
 await link.focus();for(const next of [task,candidate,edit,archive,del]){await page.keyboard.press('Tab');await expect(next).toBeFocused();}
 // Touch and keyboard still open the same panels as before.
 if(width===390)await task.tap();else{await task.focus();await page.keyboard.press('Enter');}
 await expect(actions).toBeHidden();await expect(page.locator('[data-basket-manual]')).toBeVisible();
 expect(errors).toEqual([]);
});
