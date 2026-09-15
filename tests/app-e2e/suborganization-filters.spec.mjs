import { test, expect } from '@playwright/test';

const url='http://127.0.0.1:8123/tests/app-e2e/suborganization-filters-fixture.html';
const canonical='http://127.0.0.1:8123/tests/app-e2e/suborganization-filters-canonical-fixture.html';

async function open(page,suffix=''){await page.goto(url+suffix);await expect(page.locator('#sofToolbar')).toBeVisible();await expect(page.locator('#sofCount')).toHaveText('3 / 3개 조직')}
const visibleNames=page=>page.locator('.so-card:not(.sof-hidden) h4').allTextContents();

test('산하조직은 가나다순이고 검색·담당자·유형 필터가 동작한다',async({page})=>{
 await open(page);
 expect(await visibleNames(page)).toEqual(['미지정조직미분류','전국철도노동조합철도·도시철도','한국소비자원지부중앙공공기관']);
 await page.locator('#sofSearch').fill('철도노조');
 expect(await visibleNames(page)).toEqual(['전국철도노동조합철도·도시철도']);
 await page.locator('#sofReset').click();
 await page.locator('#sofAssignee').selectOption({label:'한소영'});
 expect(await visibleNames(page)).toEqual(['한국소비자원지부중앙공공기관']);
 await page.locator('#sofReset').click();
 await page.locator('#sofType').selectOption({label:'철도·도시철도'});
 expect(await visibleNames(page)).toEqual(['전국철도노동조합철도·도시철도']);
});

test('협의회별 필터가 기존 협의회 태그 기준으로 동작한다',async({page})=>{
 await open(page);
 await page.locator('#sofCouncil').selectOption({label:'철도지하철협의회'});
 expect(await visibleNames(page)).toEqual(['전국철도노동조합철도·도시철도']);
 await page.locator('#sofReset').click();
 await page.locator('#sofCouncil').selectOption({label:'경제사회단체협의회'});
 expect(await visibleNames(page)).toEqual(['한국소비자원지부중앙공공기관']);
});

test('내 담당·미지정·30일 미업데이트 필터가 동작한다',async({page})=>{
 await open(page);
 await page.locator('#sofMine').check();
 expect(await visibleNames(page)).toEqual(['전국철도노동조합철도·도시철도']);
 await page.locator('#sofReset').click();
 await page.locator('#sofUnassigned').check();
 expect(await visibleNames(page)).toEqual(['미지정조직미분류']);
 await page.locator('#sofReset').click();
 await page.locator('#sofStale').check();
 expect(await visibleNames(page)).toEqual(['미지정조직미분류','한국소비자원지부중앙공공기관']);
});

test('원 렌더러가 예정담당자와 실제담당자를 처음부터 구분해 표시한다',async({page})=>{
 await page.goto(canonical);
 await page.evaluate(()=>window.__KPTU_SUBORGANIZATIONS_READY__);
 const rail=page.locator('[data-so-org="org-rail"]');
 await expect(rail).toContainText('김명진');
 await expect(rail).toContainText('계정 연결 전');
 const consumer=page.locator('[data-so-org="org-consumer"]');
 await expect(consumer).toContainText('한소영');
 await expect(consumer).not.toContainText('계정 연결 전');
 await expect(page.locator('#soStyle')).toHaveCount(0);
});

test('조직유형은 원 산하조직 편집 화면에서 직접 저장된다',async({page})=>{
 await page.goto(canonical);
 await page.evaluate(()=>window.__KPTU_SUBORGANIZATIONS_READY__);
 await page.locator('[data-so-edit="org-rail"]').click();
 await expect(page.locator('#sofEditType')).toHaveValue('철도·도시철도');
 await page.locator('#sofEditType').fill('철도산업');
 await page.locator('#soSaveOrg').click();
 await expect.poll(()=>page.evaluate(()=>window.__patches.length)).toBe(1);
 const patch=await page.evaluate(()=>window.__patches[0]);
 expect(patch.path).toContain('org-rail');
 expect(patch.body.organization_type).toBe('철도산업');
});

test('내 공간은 김명진 계정에서만 노출된다',async({page})=>{
 await open(page);
 await expect(page.locator('#myspaceGateStyle')).toHaveCount(0);
 await expect(page.locator('[data-view="myspace"]')).toBeVisible();
 await expect(page.locator('#mySpaceLinks a')).toHaveAttribute('href','./my-work.html');
});

test('다른 계정은 내 공간이 숨겨지고 직접 진입도 홈으로 돌아간다',async({page})=>{
 await open(page,'?other=1');
 await expect(page.locator('#myspaceGateStyle')).toHaveCount(1);
 await expect(page.locator('[data-view="myspace"]')).toBeHidden();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:view-changed',{detail:{view:'myspace'}})));
 await expect.poll(()=>page.evaluate(()=>window.__routed)).toBe('home');
});

test('모바일에서 필터가 가로 넘침 없이 표시된다',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await open(page);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
 expect(overflow).toBe(false);
});
