// QUICK-입력정리(2026-11-28 사용자 결정 '홈 막대 통째로 없앰', '잊지 말기는 입력한 자체를 없애'):
// - 홈 아래 고정 막대(잊지 말기 ▾ | 입력칸 | [잊지 말기] 칩)가 없고, 홈 본문은 하단바 바로 위까지 온다(빈 띠 없음).
// - 잊지 말기 화면에는 손으로 적는 입력칸이 없고, 자동 추천 줄은 그대로 보인다.
// - [+ 추가] 목록에 '잊지 말기' 줄이 없다. [할 일] 화면·노트 목록 입력칸은 다른 시험(ui-task-quick-input·basket-notes 등)이 그대로 본다.
// 서버는 흉내, 글은 모두 지어낸 것.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const cand={id:'c0000000-0000-4000-8000-000000000001',kind:'request',summary:'가짜 자동 추천 하나',due:null,source_kind:'basket',source_id:'c0000000-0000-4000-8000-000000000091',source_day:'2026-10-06',evidence:'근거',project_id:null,organization_id:null,status:'open',task_id:null,task_due:null,created_at:'2026-10-06T00:01:00Z',decided_at:null};
const open=(page,width)=>openHome(page,{beforeLoad:async()=>{
  await page.setViewportSize({width,height:900});
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_candidates',r=>{const st=new URL(r.request().url()).searchParams.get('status');return r.fulfill({json:st==='eq.open'?[cand]:[]});});
}});
// 화면 칸 아래 여백(px)과 아래 전환 줄 몫(px).
const bottomRoom=(page,sel)=>page.evaluate(s=>{const v=n=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n))||0;return {pad:parseFloat(getComputedStyle(document.querySelector(s)).paddingBottom),dock:v('--kptu-switch-dock')};},sel);

for(const width of [412,884,1280])test(`${width}px: 홈에 입력 막대·잊지 말기 칩이 없고 아래 빈 띠가 없다`,async({page})=>{
  await open(page,width);
  await expect(page.locator('#homeView [data-journal-day]')).toBeVisible();
  await expect(page.locator('#homeView .home-quick,#homeView .home-quick-placeholder,#homeView [data-home-summary],#homeView [data-home-forget-open]')).toHaveCount(0);
  await expect(page.locator('#homeView [data-quick-input]')).toHaveCount(0);
  // 화면에 떠 있는 빠른 입력칸이 하나도 없다(다른 화면 것이 남아 덮지도 않음).
  expect(await page.evaluate(()=>[...document.querySelectorAll('#appView .home-quick')].filter(el=>el.getClientRects().length).length)).toBe(0);
  if(width<=760){
    // 아래 여백은 전환 줄 몫 + 22px뿐(옛 입력칸 높이 몫 없음).
    const {pad,dock}=await bottomRoom(page,'#homeView');
    expect(pad).toBeLessThanOrEqual(dock+22+1);
  }
});

for(const width of [412,1280])test(`${width}px: 잊지 말기 화면에 손 입력칸 없음, 자동 추천 줄은 보임`,async({page})=>{
  await open(page,width);
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-basket-list]')).toBeVisible();
  await expect(page.locator('#basketRows')).toContainText('가짜 자동 추천 하나');
  await expect(page.locator('#basketView [data-basket-list] .home-quick,#basketView [data-basket-list] .home-quick-placeholder,#basketView [data-basket-list] [data-quick-input]')).toHaveCount(0);
  if(width<=760){
    const {pad,dock}=await bottomRoom(page,'#basketView');
    expect(pad).toBeLessThanOrEqual(dock+16+1);
  }
});

test('1280px: [+ 추가] 목록에 잊지 말기 줄이 없다',async({page})=>{
  await open(page,1280);
  await page.locator('#appView>.app-topline [data-quick-add]').click();
  const menu=page.locator('#toplineAddMenu');
  await expect(menu.locator('[data-topline-add="task"]')).toBeVisible();
  await expect(menu.locator('[data-topline-add="update"]')).toHaveCount(0);
  await expect(menu).not.toContainText('잊지 말기');
});
