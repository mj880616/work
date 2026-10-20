import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-홈빠른입력상세: 홈 빠른 입력 [할 일] 모드에서만 입력 칸 안 오른쪽 끝 [+](상세 설정으로 추가)가 보이고, 누르면 새 창 없이
// 기존 [할 일 등록] 창(UI-할일빠른추가상세 #728과 같은 창)을 연다. 입력 글은 제목, 위 칩(프로젝트·오늘·내일·날짜)은 창의 같은 칸에 채운다.
// 창에서 바꾼 값이 저장되고, 저장되면 입력 칸은 비고 프로젝트 칩은 풀린다. [업데이트] 모드와 바구니 화면에는 [+]가 없다. 시계는 2026-10-06 KST(openHome).
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const quick=page=>page.locator('#homeView .home-quick[data-home-quick]');
const go=async(page,view)=>{await page.evaluate(v=>window.KPTURouter.go(v),view);await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe(view);};

for(const width of [390,1440]){
 test(`홈 [+]: [할 일] 모드에서만 보임, 제목·칩 값을 채운 [할 일 등록] 창 ${width}`,async({page})=>{
  const errors=[],creates=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:width<761?844:900});
  await openHome(page);
  await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{creates.push(r.request().postDataJSON());return r.fallback();});
  const q=quick(page),input=q.locator('[data-quick-input]'),plus=q.locator('[data-quick-detail]'),big=q.locator('[data-quick-big]');
  // [업데이트] 모드: [+]는 숨고 [크게]만 보인다.
  await q.locator('[data-quick-mode="update"]').click();
  await expect(plus).toBeHidden();await expect(big).toBeVisible();
  // [할 일] 모드: [+]가 입력 칸 안 오른쪽 끝(누르는 범위 44px 이상), [크게]는 숨는다.
  await q.locator('[data-quick-mode="task"]').click();
  await expect(plus).toBeVisible();await expect(big).toBeHidden();
  await expect(plus).toHaveAttribute('aria-label','상세 설정으로 추가');
  const ib=await input.boundingBox(),pb=await plus.boundingBox(),ab=await q.locator('[data-quick-save]').boundingBox();
  expect(pb.width).toBeGreaterThanOrEqual(44);
  if(width>=1024)expect(await plus.evaluate(el=>parseFloat(getComputedStyle(el,'::after').height))).toBe(44);else expect(pb.height).toBeGreaterThanOrEqual(44);
  expect(pb.x).toBeGreaterThanOrEqual(ib.x);
  expect(pb.x+pb.width).toBeLessThanOrEqual(ib.x+ib.width+0.5);
  expect(pb.x+pb.width).toBeGreaterThan(ib.x+ib.width-2);
  expect(pb.x+pb.width).toBeLessThanOrEqual(ab.x);
  await input.focus();await page.keyboard.press('Tab');await expect(plus).toBeFocused();
  // 칩 없이: 제목만 채우고 날짜·프로젝트는 창 기본값.
  await input.fill('분기 보고서 작성');
  await plus.click();
  const modal=page.locator('#eventModal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#eventModalTitle')).toHaveText('할 일 등록');
  await expect(page.locator('#eventTitle')).toHaveValue('분기 보고서 작성');
  await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-06');
  await expect(page.locator('#eventTaskProject')).toContainText('선택 안 함');
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('home');
  await page.locator('[data-close="eventModal"]').click();await expect(modal).toBeHidden();
  await expect(input).toHaveValue('분기 보고서 작성');
  // 칩(프로젝트·내일)을 고른 뒤: 창의 날짜·프로젝트 칸에 그 값.
  await q.locator('[data-quick-project]').click();
  await page.locator('#homeChoiceSheet').getByRole('button',{name:'자식 프로젝트',exact:true}).click();
  await q.getByRole('button',{name:'내일',exact:true}).click();
  await plus.click();
  await expect(modal).toBeVisible();
  await expect(page.locator('#eventTitle')).toHaveValue('분기 보고서 작성');
  await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-07');
  await expect(page.locator('#eventTaskProject')).toContainText('자식 프로젝트');
  expect(creates).toEqual([]);
  // 창에서 바꾼 값(날짜)이 저장된다.
  await page.locator('#eventStartDate').fill('2026-10-09');
  await page.locator('#saveEventBtn').click();
  await expect.poll(()=>creates.length).toBe(1);
  expect(creates[0]).toMatchObject({title:'분기 보고서 작성',due:'2026-10-09',links:[{project_id:'child'}]});
  // 저장 뒤 입력 칸은 비고, 프로젝트 칩은 풀린다(날짜 칩은 [추가]와 같이 그대로).
  await expect(input).toHaveValue('');
  await expect(q.locator('[data-quick-project]')).toHaveText('프로젝트 ▾');
  await expect(q.getByRole('button',{name:'내일',exact:true})).toHaveAttribute('aria-pressed','true');
  // 날짜 칩만 고른 채로 [+]: 프로젝트는 비어 있다.
  if(await modal.isVisible())await page.locator('[data-close="eventModal"]').click();
  await expect(modal).toBeHidden();
  await input.fill('후속 연락');await plus.click();
  await expect(modal).toBeVisible();
  await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-07');
  await expect(page.locator('#eventTaskProject')).toContainText('선택 안 함');
  await page.locator('[data-close="eventModal"]').click();
  // 바구니 화면 입력에는 [+]가 없다.
  await go(page,'basket');
  await expect(page.locator('#basketView .home-quick[data-home-quick] [data-quick-input]')).toBeVisible();
  await expect(page.locator('#basketView .home-quick [data-quick-detail]')).toHaveCount(0);
  expect(errors).toEqual([]);
 });
}
