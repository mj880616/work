import {test,expect} from '@playwright/test';
const url='http://127.0.0.1:8123/tests/app-e2e/suborganization-filters-canonical-fixture.html?orgs=order&teamstats=1';
for(const width of [360,390,1280])test(`담당조직 머리줄·비동기 숫자·배치·상세 ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto(url);
  await expect(page.locator('#soOrgCount')).toHaveText('16개 담당조직');
  await expect(page.locator('.so-group-heading')).toHaveText(['철도 · 1','지하철 · 4','민자철도 · 4','민간도시철도 · 4','그 외 · 3']);
  await expect(page.locator('#soOrganizationList .sof-type')).toHaveCount(0);
  const rail=page.locator('[data-so-org="ord-5"]');
  await expect(rail.locator('.so-task-count')).toHaveCount(0);
  await page.evaluate(()=>window.__releaseTeamStats());
  await expect(rail.locator('.so-task-count')).toHaveText('2');
  await expect(rail.locator('.so-task-count')).toHaveAttribute('aria-label','미완료 할 일 2개, 기한 지남 포함');
  await expect(rail.locator('time')).toHaveText('10.8');
  await expect(rail.locator('.so-task-count svg path')).toHaveAttribute('d','m5 12 4 4L19 6');
  await expect(page.locator('[data-so-org="ord-7"] .so-task-count')).toHaveText('1');
  await expect(page.locator('[data-so-org="ord-3"] .so-task-count')).toHaveCount(0);
  await expect(page.locator('[data-so-org="ord-3"] time')).toHaveCount(0);
  const layout=await rail.evaluate(el=>({height:el.getBoundingClientRect().height,padding:getComputedStyle(el).paddingLeft,danger:getComputedStyle(el.querySelector('.so-task-count')).color,token:getComputedStyle(document.documentElement).getPropertyValue('--kptu-danger').trim()}));
  expect(layout.height).toBeGreaterThanOrEqual(44);expect(layout.padding).toBe('16px');
  expect(layout.danger).toBe(await page.evaluate(()=>{const e=document.createElement('span');e.style.color='var(--kptu-danger)';document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c}));
  const centers=await page.locator('.so-team-actions').evaluate(el=>[...el.children].map(e=>{const r=e.getBoundingClientRect();return r.y+r.height/2}));expect(Math.abs(centers[0]-centers[1])).toBeLessThan(1);
  await page.evaluate(()=>{document.querySelector('[data-so-org="ord-3"] h4').textContent='아주 긴 조직 이름 '.repeat(30)});
  const name=await page.locator('[data-so-org="ord-3"] h4').evaluate(e=>({overflow:e.scrollWidth>e.clientWidth,ellipsis:getComputedStyle(e).textOverflow,white:getComputedStyle(e).whiteSpace}));expect(name).toEqual({overflow:true,ellipsis:'ellipsis',white:'nowrap'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>window.__teamStatsCalls)).toEqual({tasks:1,links:1,updates:1});
  await rail.click();await expect(page.locator('#wdModal')).toBeVisible();await expect(page.locator('#wdTitle')).toHaveText('전국철도노동조합');
});
test('숫자 조회 실패해도 목록·상세 유지, 그 외 없는 경우 머리줄 숨김',async({page})=>{
  await page.goto(url+'&statsfail=1&knownonly=1');
  await expect(page.locator('#soOrgCount')).toHaveText('13개 담당조직');
  await page.evaluate(()=>window.__releaseTeamStats());
  await expect.poll(()=>page.evaluate(()=>window.__teamStatsCalls)).toEqual({tasks:1,links:0,updates:1});
  await expect(page.locator('.so-group-heading')).toHaveText(['철도 · 1','지하철 · 4','민자철도 · 4','민간도시철도 · 4']);
  await expect(page.locator('#soOrganizationList .so-card')).toHaveCount(13);
  await expect(page.locator('#soOrganizationList .so-task-count,#soOrganizationList time')).toHaveCount(0);
  await page.locator('[data-so-org="ord-5"]').click();await expect(page.locator('#wdModal')).toBeVisible();
});

test('과거 기록이 500행을 넘어도 마지막 페이지 조직 날짜를 찾는다',async({page})=>{
  await page.goto(url+'&historypages=1');await page.evaluate(()=>window.__releaseTeamStats());
  await expect(page.locator('[data-so-org="ord-7"] time')).toHaveText('1.1');
  expect((await page.evaluate(()=>window.__teamStatsCalls)).updates).toBe(2);
});
for(const failed of ['tasks','updates'])test(`${failed} 조회 실패는 다른 숫자 조회를 막지 않는다`,async({page})=>{
  await page.goto(url+'&statsfail='+failed);await page.evaluate(()=>window.__releaseTeamStats());
  const rail=page.locator('[data-so-org="ord-5"]');
  if(failed==='tasks'){await expect(rail.locator('time')).toHaveText('10.8');await expect(rail.locator('.so-task-count')).toHaveCount(0)}
  else {await expect(rail.locator('.so-task-count')).toHaveText('2');await expect(rail.locator('time')).toHaveCount(0)}
  await expect(page.locator('#soOrganizationList .so-card')).toHaveCount(16);
});
test('기기 캐시 개수는 Google 연결 해제가 확인되면 비운다',async({page})=>{
  await page.goto(url+'&cachedstats=1&disconnectedstats=1');
  const count=page.locator('[data-so-org="ord-5"] .so-task-count');await expect(count).toHaveText('2');
  await page.evaluate(()=>window.__releaseTeamStats());
  await expect(page.locator('[data-so-org="ord-5"] time')).toHaveText('10.8');
  await expect(count).toHaveCount(0);
});
