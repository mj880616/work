// S52-01 ② UI-사업영역조직고르기창 전수 ②a-2: 업데이트 '기록할 곳'(홈 [업데이트 ▾]·큰 쓰기 창 ▾)과 사업 보고 '연결할 곳'은
// 같은 접는 목록(area-org-picker.js areaListHtml·orgListHtml)을 쓴다: 담당조직은 묶음만, 사업영역은 상위만 보이고 꺾쇠로 펼침,
// 고른 것이 든 묶음은 처음부터 펼침, 찾기 칸(폰도)은 접힌 하위도 찾음. 여러 곳 고르기·[저장]·저장 값은 그대로.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const NAMES=['전국철도노동조합','서울교통공사노동조합','서해선지부'];
const quick=page=>page.locator('#homeView [data-home-quick]');
async function setup(page,width){
  await page.setViewportSize({width,height:844});await openHome(page);
  await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:NAMES.map((name,i)=>({id:'o'+i,name,active:true}))}));
  await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:NAMES.map((_,i)=>({organization_id:'o'+i}))}));
  await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>r.fulfill({json:[]}));
  await page.reload();const q=quick(page);await q.locator('[data-quick-mode="update"]').click();await q.locator('[data-quick-input]').fill('합성 기록');
  return q;
}
for(const width of [390,1280])test(`기록할 곳: 담당조직 묶음·사업영역 상위만, 꺾쇠로 펼침, 찾기(폰도), 고른 묶음은 다시 열면 펼침 ${width}`,async({page})=>{
  const q=await setup(page,width);await q.locator('[data-quick-org]').click();
  const sheet=page.getByRole('dialog');await expect(sheet).toBeVisible();
  const orgs=sheet.locator('[data-sheet-all]'),projects=sheet.locator('[data-sheet-projects]');
  await expect(orgs.locator('.aop-group-label')).toHaveText(['철도','지하철','민자철도']);
  await expect(orgs.locator('[data-sheet-value]').filter({visible:true})).toHaveCount(0);
  await expect(projects.locator('[data-sheet-value]').filter({visible:true})).toHaveText(['테스트 프로젝트']);
  await expect(sheet.getByRole('searchbox',{name:'조직·사업영역 이름 검색'})).toBeVisible();
  // 찾기는 접힌 하위·묶음 안도 찾는다.
  const search=sheet.getByRole('searchbox',{name:'조직·사업영역 이름 검색'});
  await search.fill('서해');await expect(orgs.locator('[data-sheet-value]').filter({visible:true})).toHaveText(['서해선지부']);
  await search.fill('자식');await expect(projects.locator('[data-sheet-value]').filter({visible:true}).locator('.home-choice-name')).toHaveText(['자식 프로젝트']);
  await search.fill('');
  // 꺾쇠로 펼쳐 여러 곳 고르기 → [저장].
  await orgs.getByRole('button',{name:/민자철도/}).click();await orgs.locator('[data-sheet-value="o2"]').click();
  await projects.getByRole('button',{name:'테스트 프로젝트 하위 1개 펼치기'}).click();await projects.locator('[data-sheet-value="project:child"]').click();
  await expect(sheet.locator('[data-sheet-count]')).toHaveText('2곳 선택됨');
  await sheet.getByRole('button',{name:'저장',exact:true}).click();await expect(sheet).toBeHidden();
  await expect(q.locator('[data-quick-org]')).toHaveAccessibleName(/기록할 곳 선택: 서해선지부 외 1/);
  // 다시 열면 고른 것이 든 묶음만 펼쳐져 있다.
  await q.locator('[data-quick-org]').click();await expect(sheet).toBeVisible();
  await expect(orgs.locator('[data-sheet-value="o2"]')).toBeVisible();await expect(orgs.locator('[data-sheet-value="o2"]')).toHaveAttribute('aria-pressed','true');
  await expect(orgs.locator('[data-sheet-value="o0"]')).toBeHidden();
  await expect(projects.locator('[data-sheet-value="project:child"]')).toBeVisible();await expect(projects.locator('[data-sheet-value="project:child"]')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');await expect(sheet).toBeHidden();
});
