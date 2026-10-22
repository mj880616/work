import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// TEST-홈빠른입력안정화: 홈 [할 일] 빠른 입력은 할 일 첨부 표 확인이 늦게 와도 처음 그린 자리 그대로다.
// 표가 있으면 [📎 첨부] 자리를 미리 잡아 두고(보이지 않게), 이 기기에서 지난번에 표가 없다(404)고 들었으면 자리를 잡지 않는다.
// 답이 오기 전과 뒤의 입력 칸·[+] 위치가 같아야 한다(CI 간헐 실패: 답 뒤 입력 칸이 86px 좁아짐).
const box=page=>page.locator('#homeView .home-quick[data-home-quick]');
const place=async page=>box(page).evaluate(el=>{const r=s=>{const b=el.querySelector(s).getBoundingClientRect();return [Math.round(b.x),Math.round(b.width)]};return {input:r('[data-quick-input]'),plus:r('[data-quick-detail]')}});
for(const [name,status,memo] of [['표 있음',200,null],['표 없음(지난번 404)',404,'0']]){
 for(const width of [390,1440]){
  test(`홈 [할 일] 첨부 확인이 늦어도 입력 칸이 밀리지 않는다: ${name} ${width}`,async({page})=>{
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   let release;const held=new Promise(r=>{release=r});
   await page.setViewportSize({width,height:width<761?844:900});
   await page.addInitScript(memo=>{try{localStorage.setItem('kptu-home-quick-mode','task');if(memo)localStorage.setItem('kptu_owner_cache:task-files-v1:home-test',memo)}catch{}},memo);
   const asked=page.waitForRequest(/\/rest\/v1\/app_task_attachments/);
   await openHome(page,{beforeLoad:()=>page.route('**/rest/v1/app_task_attachments**',async r=>{await held;return status===200?r.fulfill({json:[]}):r.fulfill({status:404,json:{code:'PGRST205',message:'Could not find the table'}})})});
   const q=box(page),picker=q.locator('[data-quick-file-picker]');
   await expect(q.locator('[data-quick-detail]')).toBeVisible();
   await asked;
   const before=await place(page);
   if(status===200){await expect(picker).toHaveAttribute('data-quick-files-wait','');await expect(q.locator('[data-basket-clip]')).toBeDisabled();}
   else await expect(picker).toBeHidden();
   release();
   if(status===200){await expect(picker).not.toHaveAttribute('data-quick-files-wait','');await expect(q.locator('[data-basket-clip]')).toBeVisible();await expect(q.locator('[data-basket-clip]')).toBeEnabled();}
   else{await expect.poll(()=>page.evaluate(()=>localStorage.getItem('kptu_owner_cache:task-files-v1:home-test'))).toBe('0');await expect(picker).toBeHidden();}
   expect(await place(page)).toEqual(before);
   if(status===200)expect(await page.evaluate(()=>localStorage.getItem('kptu_owner_cache:task-files-v1:home-test'))).toBe('1');
   expect(errors).toEqual([]);
  });
 }
}
