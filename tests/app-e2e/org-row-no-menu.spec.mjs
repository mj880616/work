import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
// C9 ORG-목록줄메뉴없음(S71-08, 2026-11-26 14:22 명진 "담당조직에서 이 메뉴들 거의 쓸일 없어서 ... 이거는 안보여도돼 / 필요하면 각 조직 눌러서 들어가서 수정 삭제 등 할게"):
// 조직 관리 [목록] 줄 오른쪽 ⋯를 지웠다. 줄을 누르면 상세가 열리고, 상세에서 이름 바꾸기·쟁의 단계·담당 조직에서 제외·삭제를 모두 한다
// (쟁의 단계 = 상세 맨 위 단계 줄, 나머지 셋 = 그 줄 오른쪽 ⋯). 묶음 머리줄 ⋯는 이번 범위가 아니라 그대로.
// 가짜 서버: suborganization-filters-canonical-fixture.html ?orgs=order&bulkdel(휴지통 길 포함). 이름은 모두 합성 값.
const base=`${appOrigin}/tests/app-e2e/suborganization-filters-canonical-fixture.html?orgs=order&bulkdel`;
const rowOf=(page,name)=>page.locator('#soOrganizationList .so-row').filter({has:page.locator('.kptu-list-name',{hasText:new RegExp(`^${name.replace(/[()]/g,'\\$&')}$`)})});
const menuLabels=page=>page.locator('#soTeamMenu button').allTextContents().then(xs=>xs.map(x=>x.trim()));
async function openDetailMenu(page,name){
  await expect(page.locator('#wdTitle')).toHaveText(name);
  const more=page.locator('#wdOrgMore');await expect(more).toBeVisible();await expect(more).toHaveAttribute('aria-label',`${name} 메뉴`);
  await more.click();const menu=page.locator('#soTeamMenu');await expect(menu).toBeVisible();return menu;
}

for(const width of [412,1280])test(`C9 조직 관리 목록 줄에는 ⋯가 없고, 상세에서 이름 바꾸기·쟁의 단계·제외·삭제 ${width}px`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:900});await page.goto(base);
  await expect(rowOf(page,'서해선지부')).toHaveCount(1);
  const id=await rowOf(page,'서해선지부').locator('[data-so-org]').getAttribute('data-so-org');
  // 목록 줄: ⋯ 단추가 없다(숨김이 아니라 없음 — 줄 안 단추는 끌기 손잡이뿐). 묶음 머리줄 ⋯는 그대로.
  expect(await page.locator('#soOrganizationList .so-row').count()).toBeGreaterThan(5);
  // S71-35: 보관한 조직 줄 끝 [꺼내기](.so-unarchive)는 ⋯가 아니라 그 줄의 되돌리기 단추라 뺀다.
  await expect(page.locator('#soOrganizationList .so-row button:not(.so-grip):not(.so-unarchive),#soOrganizationList .so-row .more-dots,[data-so-row-more]')).toHaveCount(0);
  expect(await page.locator('#soOrganizationList .so-group-more').count()).toBeGreaterThan(0);
  // 줄을 누르면 상세(그대로).
  await rowOf(page,'서해선지부').locator('[data-so-org]').click();
  await expect(page.locator('#wdModal')).toBeVisible();
  // 쟁의 단계: 상세 맨 위 단계 줄에서 바로 고친다(단계·날짜 칸).
  await expect(page.locator('#wdStage [data-stage-select]')).toBeVisible();await expect(page.locator('#wdStage [data-stage-date]')).toBeVisible();
  // ⋯는 단계 줄과 같은 줄 오른쪽 끝.
  const place=await page.evaluate(()=>{const r=el=>el.getBoundingClientRect(),more=r(document.querySelector('#wdOrgMore')),stage=r(document.querySelector('#wdStage')),card=r(document.querySelector('#wdModal .wd-card'));return {top:Math.abs(more.top-stage.top),right:card.right-more.right,afterStage:more.left>=stage.right-1}});
  expect(place.top).toBeLessThanOrEqual(8);expect(place.afterStage).toBe(true);expect(place.right).toBeLessThanOrEqual(40);
  // 이름 바꾸기 → 상세 제목·목록 줄이 새 이름.
  let menu=await openDetailMenu(page,'서해선지부');
  expect(await menuLabels(page)).toEqual(['이름 바꾸기','보관','삭제']);
  await menu.getByRole('button',{name:'이름 바꾸기'}).click();
  const edit=page.locator('#soEditModal');await expect(edit).toBeVisible();await expect(page.locator('#soEditName')).toHaveValue('서해선지부');
  await page.locator('#soEditName').fill('서해선지부(새)');await page.locator('#soSaveOrg').click();await expect(edit).toBeHidden();
  expect((await page.evaluate(()=>window.__patches)).at(-1).body.name).toBe('서해선지부(새)');
  await expect(rowOf(page,'서해선지부(새)')).toHaveCount(1);await expect(page.locator('#wdTitle')).toHaveText('서해선지부(새)');
  // [보관](옛 담당 조직에서 제외) → 목록 맨 아래 접힌 '보관한 조직'에 흐리게, 상세 메뉴는 [꺼내기]로.
  menu=await openDetailMenu(page,'서해선지부(새)');await menu.getByRole('button',{name:'보관'}).click();
  await expect(rowOf(page,'서해선지부(새)')).toHaveClass(/is-excluded/);
  expect((await page.evaluate(()=>window.__orgOrderPrefs.org_order)).hidden).toContain('서해선지부(새)');
  menu=await openDetailMenu(page,'서해선지부(새)');
  expect(await menuLabels(page)).toEqual(['이름 바꾸기','꺼내기','삭제']);
  // 삭제 → 한 번 확인 → 휴지통, 지운 조직의 상세는 닫힌다(PC는 목록 첫 조직이 오른쪽에).
  await menu.getByRole('button',{name:'삭제'}).click();
  await page.getByRole('button',{name:'휴지통으로'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__orgDeletes.length)).toBe(1);
  await expect(rowOf(page,'서해선지부(새)')).toHaveCount(0);
  await expect(page.locator(`#wdModal:not(.hidden)[data-org-id="${id}"]`)).toHaveCount(0);
  if(width<600)await expect(page.locator('#wdModal')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

// PC 줄 우클릭(고른 줄·고르지 않은 줄 모두 그 조직 메뉴)은 공용 우클릭이 있는 가짜 서버라 org-dispute-stage.spec.mjs 'C9 조직 줄 우클릭 …'에서 본다.
