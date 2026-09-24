import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const canonical='http://127.0.0.1:8123/tests/app-e2e/suborganization-filters-canonical-fixture.html';

async function openAssigned(page,suffix=''){
  await page.goto(canonical+suffix);
  await page.evaluate(()=>window.__KPTU_SUBORGANIZATIONS_READY__);
  await expect(page.locator('#soOrganizationList')).toBeVisible();
}
const visibleNames=page=>page.locator('.so-card h4').allTextContents();

test('담당조직 탭은 검색·협의회·유형 필터 없이 내 담당조직 목록부터 바로 표시한다',async({page})=>{
  await openAssigned(page);
  expect(await visibleNames(page)).toEqual(['전국철도노동조합']);
  await expect(page.locator('[data-so-org="org-consumer"]')).toHaveCount(0);
  await expect(page.locator('#sofToolbar,#sofSearch,#sofCouncil,#sofType,#sofReset')).toHaveCount(0);
  await expect(page.locator('#soOrgCount')).toHaveText('1개 담당조직');
  await expect(page.locator('#soTeamSection h3')).toHaveCount(0);
  const rail=page.locator('[data-so-org="org-rail"]');
  await expect(rail.locator('.sof-type')).toHaveText('철도·도시철도');
  await expect(rail.locator('.so-chevron')).toHaveText('›');
  await expect(rail).not.toContainText('김명진');
});

test('필터 모듈은 active asset graph에서 제거되고 담당조직 단일 렌더러만 사용한다',async()=>{
  const loader=readFileSync('app/loader-v2.js','utf8');
  const styles=readFileSync('app/styles.css','utf8');
  expect(loader).toContain("suborganizations.js?v=5");
  expect(loader).toContain("workplace-detail.js?v=5");
  expect(loader).not.toContain('suborganization-filters.js');
  expect(styles).toContain("suborganizations.css?v=5");
  expect(styles).toContain("workplace-detail.css?v=3");
  expect(styles).not.toContain('suborganization-filters.css');
});

test('담당조직 상세는 현재 상황 업데이트를 최상단 주 액션으로 두고 실무 순서대로 배치한다',async({page})=>{
  await openAssigned(page);
  await page.locator('[data-so-org="org-rail"]').click();
  await expect(page.locator('#wdModal')).toBeVisible();
  await expect(page.locator('#wdUpdateCurrent')).toBeVisible();
  await expect(page.locator('#wdDeleteOrg')).toHaveCount(0);
  const order=await page.locator('#wdModal .wd-card').evaluate(card=>[...card.querySelectorAll('.wd-sec')].map(sec=>sec.querySelector('h3')?.textContent?.trim()));
  expect(order).toEqual(['최근 상황/메모','기본 정보','협의회·사업단','연도별 타임라인']);
  const positions=await page.locator('#wdModal .wd-card').evaluate(card=>({
    action:card.querySelector('#wdUpdateCurrent').getBoundingClientRect().top,
    first:card.querySelector('#wdRecent').getBoundingClientRect().top
  }));
  expect(positions.action).toBeLessThan(positions.first);
  await expect(page.locator('#wdMonthSummary')).toContainText('9월 정책교섭과 인력대응 진행 중');
  await expect(page.locator('#wdItems')).toContainText('최근 교섭');
});

test('현재 상황 업데이트는 기존 요약 데이터를 재사용해 바로 저장한다',async({page})=>{
  await openAssigned(page);
  await page.locator('[data-so-org="org-rail"]').click();
  await page.locator('#wdUpdateCurrent').click();
  await expect(page.locator('#wdCurrentModal')).toBeVisible();
  await expect(page.locator('#wdMonth')).toHaveValue('9월 정책교섭과 인력대응 진행 중');
  await page.locator('#wdMonth').fill('청와대 면담 후 인력 요구 후속 대응 중');
  await page.locator('#wdCurrentSave').click();
  await expect(page.locator('#wdCurrentModal')).toBeHidden();
  await expect(page.locator('#wdMonthSummary')).toHaveText('청와대 면담 후 인력 요구 후속 대응 중');
  const patch=await page.evaluate(()=>window.__patches.find(x=>x.body?.recent_month_summary));
  expect(patch?.body?.recent_month_summary).toBe('청와대 면담 후 인력 요구 후속 대응 중');
});

test('기본정보는 읽기전용으로 시작하고 수정 버튼을 눌러야 입력 폼이 열린다',async({page})=>{
  await openAssigned(page);
  await page.locator('[data-so-org="org-rail"]').click();
  await expect(page.locator('#wdBasicView')).toBeVisible();
  await expect(page.locator('#wdBasicForm')).toBeHidden();
  await expect(page.locator('#wdBasicView')).toContainText('김철도');
  await expect(page.locator('#wdBasicView')).toContainText('12,000명');
  await page.locator('#wdEditBasic').click();
  await expect(page.locator('#wdBasicView')).toBeHidden();
  await expect(page.locator('#wdBasicForm')).toBeVisible();
  await expect(page.locator('#wdName')).toHaveValue('전국철도노동조합');
  await page.locator('#wdCancelBasic').click();
  await expect(page.locator('#wdBasicView')).toBeVisible();
  await expect(page.locator('#wdBasicForm')).toBeHidden();
});

test('일반 상세에서 조직 삭제 실행 경로가 제거되고 데이터 삭제는 수행하지 않는다',async()=>{
  const detail=readFileSync('app/workplace-detail.js','utf8');
  expect(detail).not.toContain('id="wdDeleteOrg"');
  expect(detail).not.toContain('function wdDeleteOrg');
  expect(detail).not.toContain("addEventListener('click',wdDeleteOrg)");
  expect(detail).toContain('id="wdUpdateCurrent"');
  expect(detail).toContain('id="wdBasicView"');
});

test('viewer에게 담당조직 추가 컨트롤이 노출되거나 탭되지 않는다',async({page})=>{
  await openAssigned(page,'?role=viewer');
  await expect(page.locator('#soAddOrg')).toBeHidden();
  await expect(page.locator('.so-card')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.locator('#soAddOrg')).not.toBeFocused();
});

test('360 390 412 430px에서 담당조직 목록과 상세가 가로 넘침 없이 표시된다',async({page})=>{
  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:844});
    await openAssigned(page);
    let overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow,`list overflow at ${width}px`).toBeLessThanOrEqual(1);
    await page.locator('[data-so-org="org-rail"]').click();
    await expect(page.locator('#wdModal')).toBeVisible();
    overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow,`detail overflow at ${width}px`).toBeLessThanOrEqual(1);
    const card=await page.locator('#wdModal .wd-card').evaluate(el=>el.getBoundingClientRect().width);
    expect(card,`detail width at ${width}px`).toBeLessThanOrEqual(width);
  }
});
