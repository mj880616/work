import {test,expect} from '@playwright/test';
const url='http://127.0.0.1:8123/tests/app-e2e/suborganization-filters-canonical-fixture.html?orgs=order&teamstats=1';
// UI-디자인기준 3/3(2026-10-16 사용자 결정): one line per organization — the colored dot before the name shows how long ago the last
// record was (KST days from this fixed now), and the row's accessible name says it in words. No second line and no task count.
const now=new Date('2026-10-16T03:00:00Z');
test.beforeEach(async({page})=>{await page.clock.setFixedTime(now)});
const recency=(page,id)=>page.locator(`[data-so-org="${id}"] [data-so-dot]`);
const expectRecency=async(page,id,level,words,at)=>{
  await expect(recency(page,id)).toHaveAttribute('data-so-recency',level);
  if(at)await expect(recency(page,id)).toHaveAttribute('data-so-at',at);else await expect(recency(page,id)).not.toHaveAttribute('data-so-at',/./);
  await expect(page.locator(`[data-so-org="${id}"]`)).toHaveAttribute('aria-label',new RegExp(`, ${words}, 상세 열기$`));
};
for(const width of [360,390,1280])test(`담당조직 머리줄·한 줄 목록·기록 점·배치·상세 ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto(url);
  await expect(page.locator('#soOrgCount')).toHaveText('16개 담당조직');
  await expect(page.locator('.so-group-heading')).toHaveText(['철도1곳','지하철4곳','민자철도4곳','민간도시철도4곳','그 외3곳']);
  await expect(page.locator('#soOrganizationList .sof-type')).toHaveCount(0);
  const rail=page.locator('[data-so-org="ord-5"]');
  // Before the read answers the dot stays empty and the name is the whole accessible label.
  await expect(recency(page,'ord-5')).not.toHaveAttribute('data-so-recency',/./);
  await expect(rail).toHaveAttribute('aria-label','전국철도노동조합 상세 열기');
  await page.evaluate(()=>window.__releaseTeamStats());
  await expectRecency(page,'ord-5','warn','8일 전 기록','2026-10-08T09:00:00Z');
  await expectRecency(page,'ord-3','stale','기록 없음');
  // One line: name, dot and › only. No second line, no date, no task count.
  await expect(page.locator('#soOrganizationList .so-task-count,#soOrganizationList time,#soOrganizationList .so-sub,#soOrganizationList [data-so-summary]')).toHaveCount(0);
  expect(await rail.locator('.kptu-list-row-main > *').evaluateAll(xs=>xs.map(x=>x.className))).toEqual(['so-dot','kptu-list-name','so-chevron kptu-list-chevron']);
  const layout=await rail.evaluate(el=>({height:el.getBoundingClientRect().height,padding:getComputedStyle(el).paddingLeft}));
  expect(layout.height).toBe(44);expect(layout.padding).toBe('16px');
  const centers=await page.locator('.so-team-actions').evaluate(el=>[...el.children].map(e=>{const r=e.getBoundingClientRect();return r.y+r.height/2}));expect(Math.abs(centers[0]-centers[1])).toBeLessThan(1);
  await page.evaluate(()=>{document.querySelector('[data-so-org="ord-3"] h4').textContent='아주 긴 조직 이름 '.repeat(30)});
  const name=await page.locator('[data-so-org="ord-3"] h4').evaluate(e=>({overflow:e.scrollWidth>e.clientWidth,ellipsis:getComputedStyle(e).textOverflow,white:getComputedStyle(e).whiteSpace}));expect(name).toEqual({overflow:true,ellipsis:'ellipsis',white:'nowrap'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  // The list reads only the record dates, once. It no longer reads Google tasks or their links.
  expect(await page.evaluate(()=>window.__teamStatsCalls)).toEqual({tasks:0,links:0,updates:1});
  await rail.click();await expect(page.locator('#wdModal')).toBeVisible();await expect(page.locator('#wdTitle')).toHaveText('전국철도노동조합');
});
test('기록 조회 실패해도 목록·상세 유지, 그 외 없는 경우 머리줄 숨김',async({page})=>{
  await page.goto(url+'&statsfail=1&knownonly=1');
  await expect(page.locator('#soOrgCount')).toHaveText('13개 담당조직');
  await page.evaluate(()=>window.__releaseTeamStats());
  await expect.poll(()=>page.evaluate(()=>window.__teamStatsCalls)).toEqual({tasks:0,links:0,updates:1});
  await expect(page.locator('.so-group-heading')).toHaveText(['철도1곳','지하철4곳','민자철도4곳','민간도시철도4곳']);
  await expect(page.locator('#soOrganizationList .so-card')).toHaveCount(13);
  // A failed read paints nothing (no false red dot) and keeps the plain labels.
  await expect(page.locator('#soOrganizationList [data-so-recency]')).toHaveCount(0);
  await expect(page.locator('[data-so-org="ord-5"]')).toHaveAttribute('aria-label','전국철도노동조합 상세 열기');
  await page.locator('[data-so-org="ord-5"]').click();await expect(page.locator('#wdModal')).toBeVisible();
});

test('과거 기록이 500행을 넘어도 마지막 페이지 조직 날짜를 찾는다',async({page})=>{
  await page.goto(url+'&historypages=1');await page.evaluate(()=>window.__releaseTeamStats());
  await expectRecency(page,'ord-7','stale','653일 전 기록','2025-01-01T00:00:00Z');
  expect((await page.evaluate(()=>window.__teamStatsCalls)).updates).toBe(2);
});
test('기기에 할 일 캐시가 있어도 목록은 할 일을 읽지 않고 기록 점만 칠한다',async({page})=>{
  await page.goto(url+'&cachedstats=1&statsfail=tasks');
  await page.evaluate(()=>window.__releaseTeamStats());
  await expectRecency(page,'ord-5','warn','8일 전 기록','2026-10-08T09:00:00Z');
  await expect(page.locator('#soOrganizationList .so-task-count')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__teamStatsCalls)).toEqual({tasks:0,links:0,updates:1});
  await expect(page.locator('#soOrganizationList .so-card')).toHaveCount(16);
});
