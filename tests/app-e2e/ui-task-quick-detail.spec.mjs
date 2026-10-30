import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-할일빠른추가상세: [할 일] 화면 입력 칸 안 오른쪽 끝 [+]는 새 창 없이 기존 [할 일 등록] 창(일정 등록 창의 할 일 모드)을 연다.
// 입력한 글은 창 제목에 미리 채우고(없으면 빈 창), [추가]의 저장 동작은 그대로다. 시계는 2026-10-06 KST(openHome).
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const go=async(page,view)=>{await page.evaluate(v=>window.KPTURouter.go(v),view);await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe(view);};

for(const width of [412,870,1280]){
 test(`[+]는 입력 칸 안 오른쪽 끝, 누르면 글을 채운 [할 일 등록] 창이 열림 ${width}`,async({page})=>{
  const errors=[],creates=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:844});
  await openHome(page);
  await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{creates.push(r.request().postDataJSON());return r.fallback();});
  await go(page,'tasks');
  const q=page.locator('#tasksView .home-quick[data-home-quick]'),input=q.locator('[data-quick-input]'),plus=q.locator('[data-quick-detail]');
  await expect(plus).toBeVisible();
  await expect(plus).toHaveAttribute('aria-label','상세 설정으로 추가');
  // Inside the input box at its right edge; touch area at least 44px; input and [추가] share one height
  // (46px; UI-PC버튼36: PC ≥1024 is the input height 36px and the touch area is the 44px ::after).
  const ib=await input.boundingBox(),pb=await plus.boundingBox(),ab=await q.locator('[data-quick-save]').boundingBox(),h=width>=761?36:46;
  // UI-버튼줄이기: [추가]는 폭과 상관없이 36px, 폰·중간 폭 [+]는 보이는 32px. 누르는 범위는 ::after 44px.
  expect(ib.height).toBe(h);expect(ab.height).toBe(36);expect(pb.height).toBe(width>=761?36:32);
  expect(pb.width).toBeGreaterThanOrEqual(44);
  expect(await plus.evaluate(el=>parseFloat(getComputedStyle(el,'::after').height))).toBe(44);
  expect(pb.x).toBeGreaterThanOrEqual(ib.x);
  expect(pb.x+pb.width).toBeLessThanOrEqual(ib.x+ib.width+0.5);
  expect(pb.x+pb.width).toBeGreaterThan(ib.x+ib.width-2);
  expect(pb.x+pb.width).toBeLessThanOrEqual(ab.x);
  // Keyboard reachable: Tab from the input lands on [+] before [추가].
  await input.focus();await page.keyboard.press('Tab');await expect(plus).toBeFocused();
  // With text: the registration window opens in task mode with that title; nothing is saved yet.
  await input.fill('분기 보고서 작성');
  await plus.click();
  const modal=page.locator('#eventModal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#eventModalTitle')).toHaveText('할 일 등록');
  await expect(page.locator('#eventTitle')).toHaveValue('분기 보고서 작성');
  await expect(page.locator('#eventTaskProject')).toBeVisible();
  expect(creates).toEqual([]);
  await page.locator('[data-close="eventModal"]').click();
  await expect(modal).toBeHidden();
  // Without text: an empty window.
  await input.fill('');
  await plus.click();
  await expect(modal).toBeVisible();
  await expect(page.locator('#eventModalTitle')).toHaveText('할 일 등록');
  await expect(page.locator('#eventTitle')).toHaveValue('');
  await page.locator('[data-close="eventModal"]').click();
  // [추가] still adds straight from the input (one create, due today).
  await input.fill('바로 추가');await q.locator('[data-quick-save]').click();
  await expect.poll(()=>creates.length).toBe(1);
  expect(creates[0]).toMatchObject({title:'바로 추가',due:'2026-10-06'});
  expect(errors).toEqual([]);
 });
}
