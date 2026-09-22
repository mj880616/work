import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const url='http://127.0.0.1:8123/tests/app-e2e/suborganization-filters-fixture.html';
const canonical='http://127.0.0.1:8123/tests/app-e2e/suborganization-filters-canonical-fixture.html';

async function open(page,suffix=''){
  await page.goto(url+suffix);
  await expect(page.locator('#sofToolbar')).toBeVisible();
  await expect(page.locator('#sofMine,#sofAssignee,#sofUnassigned')).toHaveCount(0);
  await expect(page.locator('#sofCount')).toHaveText('1개 담당조직');
}
const visibleNames=page=>page.locator('.so-card:not(.sof-hidden) h4').allTextContents();

test('담당조직 화면은 내 담당조직만 표시하고 검색·유형 필터가 동작한다',async({page})=>{
  await open(page);
  expect(await visibleNames(page)).toEqual(['전국철도노동조합']);
  await page.locator('#sofSearch').fill('소비자원');
  expect(await visibleNames(page)).toEqual([]);
  await expect(page.locator('#sofNoResults')).toContainText('조건에 맞는 담당조직이 없습니다.');
  await page.locator('#sofReset').click();
  await page.locator('#sofType').selectOption({label:'철도·도시철도'});
  expect(await visibleNames(page)).toEqual(['전국철도노동조합']);
});

test('협의회 필터도 내 담당조직 범위 안에서만 동작한다',async({page})=>{
  await open(page);
  await page.locator('#sofCouncil').selectOption({label:'철도지하철협의회'});
  expect(await visibleNames(page)).toEqual(['전국철도노동조합']);
  await page.locator('#sofCouncil').selectOption({label:'경제사회단체협의회'});
  expect(await visibleNames(page)).toEqual([]);
});

test('원 렌더러는 내 담당조직만 콤팩트 행으로 출력하고 담당자명·행 액션을 제거한다',async({page})=>{
  await page.goto(canonical);
  await page.evaluate(()=>window.__KPTU_SUBORGANIZATIONS_READY__);
  const rail=page.locator('[data-so-org="org-rail"]');
  await expect(rail).toHaveCount(1);
  await expect(page.locator('[data-so-org="org-consumer"]')).toHaveCount(0);
  await expect(rail).toHaveAttribute('data-ps-workplace-org','org-rail');
  await expect(rail).toHaveAttribute('role','button');
  await expect(rail).toContainText('전국철도노동조합');
  await expect(rail.locator('.sof-type')).toHaveText('철도·도시철도');
  await expect(rail.locator('.so-chevron')).toHaveText('›');
  await expect(rail).not.toContainText('김명진');
  await expect(rail.locator('[data-so-edit],[data-so-delete],[data-so-assign]')).toHaveCount(0);
  const height=await rail.evaluate(el=>el.getBoundingClientRect().height);
  expect(height).toBeLessThanOrEqual(60);
});

test('담당조직 명칭과 상세 편집·삭제 기능은 상세창에 모인다',async()=>{
  const sub=readFileSync('app/suborganizations.js','utf8');
  const detail=readFileSync('app/workplace-detail.js','utf8');
  expect(sub).toContain('<h3>담당조직</h3>');
  expect(sub).toContain('내가 담당하는 조직만 표시합니다.');
  expect(sub).toContain('const mine=myOrganizations()');
  expect(detail).toContain('id="wdType"');
  expect(detail).toContain('id="wdAliases"');
  expect(detail).toContain('id="wdDescription"');
  expect(detail).toContain('id="wdDeleteOrg"');
  expect(detail).toContain('async function wdDeleteOrg()');
  expect(detail).toContain("wdToast('담당조직을 삭제했습니다.')");
});

test('관련 일정 선택도 담당조직 명칭을 사용하고 내 조직만 사용한다',async()=>{
  const sub=readFileSync('app/suborganizations.js','utf8');
  expect(sub).toContain('관련 담당조직');
  expect(sub).toContain("checks('event',selected,myOrganizations())");
});

test('viewer에게 담당조직 관리자 전용 추가 컨트롤이 노출되거나 탭되지 않는다',async({page})=>{
  await page.goto(canonical+'?role=viewer');
  await page.evaluate(()=>window.__KPTU_SUBORGANIZATIONS_READY__);
  await expect(page.locator('#soAddOrg')).toBeHidden();
  await expect(page.locator('[data-so-edit],[data-so-assign],[data-so-delete]')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.locator('#soAddOrg')).not.toBeFocused();
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

test('모바일에서 담당조직 목록과 필터가 가로 넘침 없이 표시된다',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await open(page);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});