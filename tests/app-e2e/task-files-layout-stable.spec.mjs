import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// TEST-홈빠른입력안정화: 홈 [할 일] 빠른 입력은 할 일 첨부 표 확인 답이 늦게 와도 처음 그린 자리 그대로다.
// 답 전에는 [📎 첨부] 자리를 보이지 않게(누를 수 없게) 잡아 두고, 답이 '있음'이면 그 자리에 나타난다.
// (CI 간헐 실패: 답 뒤 PC 입력 칸이 86px 좁아져 칸 안 [+] 위치가 바뀜.) 답이 '없음'(404)이면 자리를 비운다.
const box=page=>page.locator('#homeView .home-quick[data-home-quick]');
const place=page=>box(page).evaluate(el=>{const r=s=>{const b=el.querySelector(s).getBoundingClientRect();return [Math.round(b.x),Math.round(b.width)]};return {input:r('[data-quick-input]'),plus:r('[data-quick-detail]')}});
for(const status of [200,404]){
 for(const width of [390,1440]){
  test(`홈 [할 일] 첨부 확인 답이 늦어도 첨부 자리를 미리 잡는다: 답 ${status} ${width}`,async({page})=>{
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   let release;const held=new Promise(r=>{release=r});
   await page.setViewportSize({width,height:width<761?844:900});
   const asked=page.waitForRequest(/\/rest\/v1\/app_task_attachments/);
   await openHome(page,{beforeLoad:()=>page.route('**/rest/v1/app_task_attachments**',async r=>{await held;return status===200?r.fulfill({json:[]}):r.fulfill({status:404,json:{code:'PGRST205',message:'Could not find the table'}})})});
   const q=box(page),picker=q.locator('[data-quick-file-picker]'),clip=q.locator('[data-basket-clip]');
   // [할 일]을 누르면 확인을 묻는다(답은 위에서 붙잡아 둔다).
   await q.locator('[data-quick-mode="task"]').click();
   await expect(q.locator('[data-quick-detail]')).toBeVisible();
   await asked;
   // 답 전: 자리는 있고 보이지 않으며 누를 수 없다.
   await expect(picker).toHaveAttribute('data-quick-files-wait','');
   await expect(clip).toBeHidden();await expect(clip).toBeDisabled();
   const before=await place(page);
   release();
   await expect(picker).not.toHaveAttribute('data-quick-files-wait','');
   if(status===200){
    await expect(clip).toBeVisible();await expect(clip).toBeEnabled();
    expect(await place(page)).toEqual(before);
   }else await expect(picker).toBeHidden();
   expect(errors).toEqual([]);
  });
 }
}
