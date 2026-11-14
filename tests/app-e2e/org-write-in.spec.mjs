// S61-52·S62-01 (CALL-상대표시정리 ④ 같은 종류 전수): '기록할 곳' 창(여러 곳 고르기) 담당조직 맨 아래 [직접 쓰기].
// 비슷한 이름이 있으면 먼저 그 조직을 보여 주고(누르면 그 조직이 눌림), [새로 만들기]일 때만 담당조직 추가와 같은 표에 만든다.
// 새 조직은 창을 닫지 않고 눌린 채로 더해지고, [저장] 뒤 업데이트가 그 조직으로 저장된다.
import { test, expect } from '@playwright/test';
import { openHome, pickQuickMode } from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({timezoneId:'Asia/Seoul'});

for(const width of [412,1280])test(`'기록할 곳' 담당조직 [직접 쓰기]: 비슷한 이름 먼저, 새로 만들면 눌린 채로 ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await openHome(page);
  const made=[],assigned=[];
  await page.route(SB+'/rest/v1/app_suborganizations?select=**',r=>{
    if(r.request().method()!=='POST')return r.fallback();
    const body=r.request().postDataJSON();made.push(body);return r.fulfill({status:201,json:[{id:'new-org',name:body.name,aliases:[],active:true}]});});
  await page.route(SB+'/rest/v1/app_suborganization_assignees',r=>{
    if(r.request().method()!=='POST')return r.fallback();assigned.push(r.request().postDataJSON());return r.fulfill({status:201,json:[]});});
  const q=page.locator('#homeView [data-home-quick]');
  await pickQuickMode(page,'update');await q.locator('[data-quick-input]').fill('QA 직접 쓰기');
  await pickQuickMode(page,'org');const sheet=page.getByRole('dialog');await expect(sheet).toBeVisible();
  const box=sheet.locator('[data-aop-create-box]'),input=box.locator('[data-aop-create-input]');
  await expect(input).toHaveAttribute('placeholder','직접 쓰기 — 조직 이름');
  // 비슷한 이름: 새로 만들지 않고 그 조직 줄을 먼저 보여 준다. 누르면 창의 고르기와 같다(눌림).
  await input.fill('테스트조직');await box.getByRole('button',{name:'만들기',exact:true}).click();
  await expect(box).toContainText('비슷한 조직이 있어요');const like=box.locator('[data-aop-similar][data-sheet-value="o"]');
  await expect(like).toBeVisible();expect(made).toHaveLength(0);
  await like.click();await expect(sheet.locator('[data-sheet-all] [data-sheet-value="o"]')).toHaveAttribute('aria-pressed','true');
  // 비슷한 것이 없는 이름은 바로 만든다(창은 열린 채, 새 조직이 목록에 눌린 채로 더해짐).
  await input.fill('QA 새 지부');await input.press('Enter');
  const fresh=sheet.locator('[data-sheet-all] [data-sheet-value="new-org"]');await expect(fresh).toHaveAttribute('aria-pressed','true');
  await expect(box.locator('[data-aop-create-status]')).toContainText("'QA 새 지부'을(를) 만들었어요.");
  expect(made).toHaveLength(1);expect(made[0]).toMatchObject({name:'QA 새 지부',active:true,organization_type:'미분류'});
  expect(assigned).toEqual([expect.objectContaining({organization_id:'new-org'})]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`org-write-in-${width}.png`)});
  // 기존 조직은 다시 눌러 빼고 새 조직만 남긴다(새 조직 줄도 다른 줄과 같은 고르기).
  await sheet.locator('[data-sheet-all] [data-sheet-value="o"]').click();await expect(sheet.locator('[data-sheet-all] [data-sheet-value="o"]')).toHaveAttribute('aria-pressed','false');
  await sheet.getByRole('button',{name:'저장',exact:true}).click();await expect(sheet).toBeHidden();
  await expect(q.locator('[data-quick-org]')).toHaveAttribute('aria-label','기록할 곳 선택: QA 새 지부');
  // 저장: 새 조직에 업데이트가 들어간다(조직 기록과 같은 서버 경로).
  const updates=[];await page.route(SB+'/rest/v1/app_suborganization_updates**',r=>{if(r.request().method()!=='POST')return r.fallback();const b=r.request().postDataJSON();updates.push(...[].concat(b));return r.fulfill({status:201,json:[]});});
  await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
  expect(updates.map(u=>u.organization_id).sort()).toEqual(['new-org']);
});
