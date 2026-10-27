import {testOrigin} from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
// UI-연결요약수정: organization and project detail both offer ⋯ → [요약 수정] on a linked record. Only the link's summary changes,
// through the existing compare-and-set RPC (app_basket_update_link_summary); the note (update or note) is never written.
// Enter is a new line, Ctrl+Enter saves, an Enter that ends a Korean IME composition is ignored. All names are synthetic.
test.use({hasTouch:true});
const fixture=testOrigin+'/tests/app-e2e/basket-link-detail-fixture.html';
async function ready(page,kind){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(fixture);await expect.poll(()=>page.evaluate(()=>window.__detailReady===true)).toBe(true);
 await page.evaluate(kind=>{const s=window.__detailState;if(kind==='project')for(const row of s.links){row.project_id=s.ids.project;row.organization_id=null}return kind==='organization'?window.KPTUWorkplace.open(s.ids.org):window.KPTUProjects.open(s.ids.project)},kind);
 const host=page.locator(kind==='organization'?'#wdUpdates':'#ps3-progress [data-ps3-records]'),ids=await page.evaluate(()=>window.__detailState.ids);
 await expect(host.locator('[data-basket-link]')).toHaveCount(2);
 return {errors,host,ids,menu:page.locator(kind==='organization'?'#basketLinkMenu':'#ps3RecordMenu')};
}
async function openEditor(page,row,menu,width){
 const more=row.getByRole('button',{name:'정리함 기록 메뉴'});
 if(width<761)await more.tap();else await more.click();
 // The menu opens at the ⋯ it came from (anchored menu, #773).
 await expect(menu).toBeVisible();const [a,m]=await Promise.all([more.boundingBox(),menu.boundingBox()]);expect(Math.min(Math.abs(m.y-(a.y+a.height)),Math.abs(m.y+m.height-a.y))).toBeLessThanOrEqual(12);expect(m.x+m.width).toBeGreaterThanOrEqual(a.x);
 const item=menu.getByRole('button',{name:'요약 수정',exact:true});if(width<761)await item.tap();else await item.click();
 const input=row.locator('[data-link-summary-input]');await expect(input).toBeFocused();return input;
}
const writes=page=>page.evaluate(()=>window.__detailState.calls.filter(c=>c.method!=='GET').map(c=>({table:new URL(c.path,'https://x.invalid').pathname.split('/').pop(),body:c.body})));
const noteText=page=>page.evaluate(()=>window.__detailState.notes.map(n=>n.raw_text));

for(const kind of ['organization','project'])for(const width of [390,1280])test(`${kind} ${width}: ⋯ → 요약 수정 saves only the summary with Ctrl+Enter; Enter is a new line`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const {errors,host,ids,menu}=await ready(page,kind),row=host.locator(`[data-basket-link="${ids.link}"]`),before=await noteText(page);
 const input=await openEditor(page,row,menu,width);await expect(input).toHaveValue('연결 요약');
 await expect(row.locator('[data-link-summary-save]')).toBeVisible();
 await input.fill('');await input.pressSequentially('첫 줄');await input.press('Enter');await input.pressSequentially('둘째 줄');
 await expect(input).toHaveValue('첫 줄\n둘째 줄');expect(await writes(page)).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);
 const box=await row.locator('[data-link-summary-form]').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
 await input.press('Control+Enter');
 await expect(row.locator('[data-link-summary-form]')).toHaveCount(0);
 await expect(host.locator(`[data-basket-link="${ids.link}"]`)).toContainText('첫 줄\n둘째 줄');
 expect(await writes(page)).toEqual([{table:'app_basket_update_link_summary',body:{p_link_id:ids.link,p_expected_summary:'연결 요약',p_summary:'첫 줄\n둘째 줄'}}]);
 expect(await noteText(page)).toEqual(before);
 // The other link of the same note keeps its own (empty) summary and its opening-text display.
 await expect(host.locator(`[data-basket-link="${ids.nullLink}"]`)).toContainText('보관 원문');
 expect(errors).toEqual([]);
});

for(const kind of ['organization','project'])test(`${kind}: the [저장] button saves too, from an empty summary (expected NULL)`,async({page})=>{
 const {host,ids,menu}=await ready(page,kind),row=host.locator(`[data-basket-link="${ids.nullLink}"]`);
 await expect(row).toContainText('보관 원문');
 const input=await openEditor(page,row,menu,1280);await expect(input).toHaveValue('');
 await input.fill('합성 직접 쓴 요약');await row.locator('[data-link-summary-save]').click();
 await expect(host.locator(`[data-basket-link="${ids.nullLink}"]`)).toContainText('합성 직접 쓴 요약');
 expect(await writes(page)).toEqual([{table:'app_basket_update_link_summary',body:{p_link_id:ids.nullLink,p_expected_summary:null,p_summary:'합성 직접 쓴 요약'}}]);
});

for(const kind of ['organization','project'])test(`${kind}: a summary changed elsewhere is never overwritten; the draft stays until the latest is confirmed`,async({page})=>{
 const {host,ids,menu}=await ready(page,kind),row=host.locator(`[data-basket-link="${ids.link}"]`);
 const input=await openEditor(page,row,menu,1280);await input.fill('내 초안');
 // Another tab saved a different summary after this editor opened.
 await page.evaluate(id=>{window.__detailState.links.find(x=>x.id===id).summary='다른 곳에서 고친 요약'},ids.link);
 await input.press('Control+Enter');
 await expect(row.locator('[data-link-summary-status]')).toContainText('다른 곳에서 요약이 바뀌었어요');
 await expect(row.locator('[data-link-summary-latest]')).toContainText('다른 곳에서 고친 요약');
 await expect(input).toHaveValue('내 초안');
 expect(await page.evaluate(id=>window.__detailState.links.find(x=>x.id===id).summary,ids.link)).toBe('다른 곳에서 고친 요약');
 // Saving again before confirming only re-reads; it never sends the draft over the newer summary.
 await row.locator('[data-link-summary-save]').click();
 expect((await writes(page)).filter(w=>w.table==='app_basket_update_link_summary')).toHaveLength(1);
 await row.locator('[data-link-summary-current]').click();await input.press('Control+Enter');
 await expect(host.locator(`[data-basket-link="${ids.link}"]`)).toContainText('내 초안');
 expect((await writes(page)).at(-1).body).toEqual({p_link_id:ids.link,p_expected_summary:'다른 곳에서 고친 요약',p_summary:'내 초안'});
});

for(const kind of ['organization','project'])test(`${kind}: an Enter that ends Korean composition is ignored, an empty summary is not sent`,async({page})=>{
 const {host,ids,menu}=await ready(page,kind),row=host.locator(`[data-basket-link="${ids.link}"]`);
 const input=await openEditor(page,row,menu,1280);
 // Ctrl+Enter while the IME is still composing (isComposing / keyCode 229) does not save.
 for(const init of [{isComposing:true},{keyCode:229}])await input.evaluate((el,init)=>{const e=new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true,isComposing:!!init.isComposing});if(init.keyCode)Object.defineProperty(e,'keyCode',{value:init.keyCode});el.dispatchEvent(e)},init);
 await expect(row.locator('[data-link-summary-form]')).toHaveCount(1);expect(await writes(page)).toEqual([]);
 await input.fill('  \n ');await input.press('Control+Enter');
 await expect(row.locator('[data-link-summary-status]')).toContainText('비워 저장하는 기능은 아직 준비 중');
 await expect(input).toBeFocused();expect(await writes(page)).toEqual([]);
 await row.locator('[data-link-summary-cancel]').click();await expect(row.locator('[data-link-summary-form]')).toHaveCount(0);
 await expect(host.locator(`[data-basket-link="${ids.link}"]`)).toContainText('연결 요약');
});

test('project: an open summary draft asks before closing, and disconnect waits for it',async({page})=>{
 const {host,ids,menu}=await ready(page,'project'),row=host.locator(`[data-basket-link="${ids.link}"]`);
 const input=await openEditor(page,row,menu,1280);await input.fill('닫기 전 초안');
 let asked=false;page.once('dialog',async d=>{asked=true;await d.dismiss()});
 await page.locator('[data-ps3-close="ps3DetailModal"]').first().click();expect(asked).toBe(true);
 await expect(input).toHaveValue('닫기 전 초안');
 // A refresh of the record list keeps the open draft.
 await page.evaluate(()=>window.dispatchEvent(new Event('kptu:basket-links-changed')));await expect(input).toHaveValue('닫기 전 초안');
 await row.getByRole('button',{name:'정리함 기록 메뉴'}).click();await menu.getByRole('button',{name:'연결 해제'}).click();
 expect((await writes(page)).filter(w=>w.table==='app_record_links')).toEqual([]);await expect(row).toHaveCount(1);
});
