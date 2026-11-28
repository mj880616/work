import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
// S67-53 ORG-여러개삭제(명진 11/20 22:48·22:54): 조직 관리 화면 ⋯ [여러 개 선택해 삭제] → 줄을 눌러 선택 → [삭제] 한 번 확인 →
// 한 개 [삭제]와 같은 휴지통 길(DELETE 한 곳씩 + app_trash_list 확인) → 되돌리기. 확인 창에는 조직 수와 연결된 조직 보고 수.
// 가짜 서버(suborganization-filters-canonical-fixture.html ?orgs=order&bulkdel): 공항철도지부 조직 보고 2건, 용인경전철지부 1건. 이름은 모두 합성 값.
const base=`${appOrigin}/tests/app-e2e/suborganization-filters-canonical-fixture.html?orgs=order&bulkdel`;
const rowOf=(page,name)=>page.locator('#soOrganizationList .so-row').filter({has:page.locator('.kptu-list-name',{hasText:new RegExp(`^${name}$`)})});
const names=page=>page.locator('#soOrganizationList .kptu-list-name').allTextContents();
async function startPick(page){
  await page.locator('#soTeamMore').click();
  const item=page.locator('#soTeamMenu [data-so-pick-start]');await expect(item).toHaveText('여러 개 선택해 삭제');await item.click();
  await expect(page.locator('#soOrganizationList .so-pick-bar')).toBeVisible();
}

for(const width of [412,1280])test(`여러 곳 선택 → 확인 창 개수 → 휴지통 → 되돌리기 ${width}px`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:900});await page.goto(base);
  await expect(rowOf(page,'공항철도지부')).toHaveCount(1);
  const before=await names(page);
  await startPick(page);
  // 선택 중: 참고 묶음 입구는 없고(S71-22에서 지움), 줄마다 선택 칸. 선택 0곳이면 [삭제]는 꺼짐. (줄 ⋯는 S71-08부터 늘 없다.)
  await expect(page.locator('#soOrganizationList .so-reference-entry')).toHaveCount(0);
  await expect(page.locator('#soOrganizationList .so-pick-count')).toHaveText('0곳 선택됨');
  await expect(page.locator('#soOrganizationList [data-so-pick-delete]')).toBeDisabled();
  // 줄을 누르면 상세가 열리지 않고 선택된다(칸을 눌러도 같음).
  await rowOf(page,'공항철도지부').locator('[data-so-org]').click();
  await rowOf(page,'용인경전철지부').locator('[data-so-pick]').click();
  await rowOf(page,'서해선지부').locator('[data-so-org]').click();
  await expect(page.locator('#soOrganizationList .so-pick-count')).toHaveText('3곳 선택됨');
  await expect(rowOf(page,'공항철도지부').locator('[data-so-pick]')).toBeChecked();
  // 다시 누르면 풀린다.
  await rowOf(page,'서해선지부').locator('[data-so-org]').click();
  await expect(page.locator('#soOrganizationList .so-pick-count')).toHaveText('2곳 선택됨');
  await rowOf(page,'서해선지부').locator('[data-so-org]').click();
  await expect(page.locator('#wdModal:not(.hidden) #wdTitle')).toHaveCount(0);
  // [삭제] → 확인 창: 조직 3곳, 연결된 조직 보고 3건(2+1+0).
  await page.locator('#soOrganizationList [data-so-pick-delete]').click();
  await expect(page.getByText('담당조직 3곳을 휴지통으로 옮길까요?')).toBeVisible();
  await expect(page.getByText('연결된 조직 보고 3건과 담당자는 그대로 남고, 휴지통에서 되돌릴 수 있어요.')).toBeVisible();
  expect(await page.evaluate(()=>window.__orgDeletes.length)).toBe(0);
  await page.locator('.kptu-ask-actions').getByRole('button',{name:'삭제',exact:true}).click();
  // 한 곳씩 DELETE, 휴지통 목록으로 확인한 뒤 목록에서 빠지고 선택이 끝난다.
  await expect.poll(()=>page.evaluate(()=>window.__orgDeletes.slice().sort())).toEqual(['ord-0','ord-1','ord-9']);
  await expect(page.locator('#soOrganizationList .so-pick-bar')).toHaveCount(0);
  await expect(rowOf(page,'공항철도지부')).toHaveCount(0);await expect(rowOf(page,'서해선지부')).toHaveCount(0);
  const notice=page.locator('[data-undo-notice]');await expect(notice).toContainText('담당조직 3곳을 휴지통으로 옮겼어요.');
  await notice.getByRole('button',{name:'되돌리기'}).click();
  await expect(notice).toContainText('담당조직 3곳을 되돌렸어요.');
  expect((await page.evaluate(()=>window.__orgRestores)).sort()).toEqual(['ord-0','ord-1','ord-9']);
  await expect(rowOf(page,'공항철도지부')).toHaveCount(1);
  expect((await names(page)).sort()).toEqual(before.slice().sort());
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('취소·Esc는 지우지 않고 선택만 끝냄, 모두 선택은 전부',async({page})=>{
  await page.goto(base);await expect(rowOf(page,'공항철도지부')).toHaveCount(1);
  const total=await page.locator('#soOrganizationList [data-so-org]').count();
  await startPick(page);
  await page.locator('#soOrganizationList [data-so-pick-all]').click();
  await expect(page.locator('#soOrganizationList .so-pick-count')).toHaveText(`${total}곳 선택됨`);
  await expect(page.locator('#soOrganizationList [data-so-pick-all]')).toHaveAttribute('aria-pressed','true');
  await page.locator('#soOrganizationList [data-so-pick-all]').click();
  await expect(page.locator('#soOrganizationList .so-pick-count')).toHaveText('0곳 선택됨');
  // 확인 창에서 취소하면 요청 없음, 선택은 남는다.
  await rowOf(page,'서해선지부').locator('[data-so-org]').click();
  await page.locator('#soOrganizationList [data-so-pick-delete]').click();
  await expect(page.getByText('담당조직 1곳을 휴지통으로 옮길까요?')).toBeVisible();
  await expect(page.getByText('연결된 조직 보고는 없고, 휴지통에서 되돌릴 수 있어요.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('담당조직 1곳을 휴지통으로 옮길까요?')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__orgDeletes.length)).toBe(0);
  await expect(page.locator('#soOrganizationList .so-pick-count')).toHaveText('1곳 선택됨');
  await page.locator('#soOrganizationList [data-so-pick-stop]').click();
  await expect(page.locator('#soOrganizationList .so-pick-bar')).toHaveCount(0);
  await expect(page.locator('#soOrganizationList [data-so-pick]')).toHaveCount(0);
  // Esc로도 끝난다.
  await startPick(page);await rowOf(page,'서해선지부').locator('[data-so-org]').focus();await page.keyboard.press('Escape');
  await expect(page.locator('#soOrganizationList .so-pick-bar')).toHaveCount(0);
});

test('일부가 실패하면 옮긴 것만 알리고 실패한 곳은 선택해 둠, 휴지통 준비 전에는 요청하지 않음',async({page})=>{
  await page.goto(base);await expect(rowOf(page,'공항철도지부')).toHaveCount(1);
  await page.evaluate(()=>{window.__failOrgDelete=['ord-9'];});
  await startPick(page);
  await rowOf(page,'공항철도지부').locator('[data-so-org]').click();await rowOf(page,'서해선지부').locator('[data-so-org]').click();
  await page.locator('#soOrganizationList [data-so-pick-delete]').click();
  await page.locator('.kptu-ask-actions').getByRole('button',{name:'삭제',exact:true}).click();
  await expect(page.locator('[data-undo-notice]')).toContainText('담당조직 1곳을 휴지통으로 옮겼고 1곳은 옮기지 못했어요.');
  await expect(rowOf(page,'공항철도지부')).toHaveCount(0);
  await expect(page.locator('#soOrganizationList .so-pick-count')).toHaveText('1곳 선택됨');
  await expect(rowOf(page,'서해선지부').locator('[data-so-pick]')).toBeChecked();
  // 휴지통 함수가 없으면(DB 적용 전) 확인 창도 삭제 요청도 없다.
  await page.evaluate(()=>{window.__trashMissing=true;window.__orgDeletes=[];});
  await page.locator('#soOrganizationList [data-so-pick-delete]').click();
  await expect(page.getByText('담당조직 휴지통은 준비 중입니다.',{exact:false})).toBeVisible();
  expect(await page.evaluate(()=>window.__orgDeletes.length)).toBe(0);
});

test('열람자에게는 메뉴가 없음',async({page})=>{
  await page.goto(`${appOrigin}/tests/app-e2e/suborganization-filters-canonical-fixture.html?role=viewer`);
  await page.locator('#soTeamMore').click();await expect(page.locator('#soTeamMenu')).toBeVisible();
  await expect(page.locator('#soTeamMenu [data-so-pick-start]')).toHaveCount(0);
});
