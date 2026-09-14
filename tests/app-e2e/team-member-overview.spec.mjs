import {test,expect} from '@playwright/test';
const url='http://127.0.0.1:8123/tests/app-e2e/team-member-overview-fixture.html';

test('team member overview shows role, title and workplaces and filters them',async({page})=>{
  await page.goto(url);
  await expect(page.locator('#tmoSummary')).toHaveText('전체 3명 · 표시 3명');
  const cards=page.locator('#memberList .tmo-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText('김담당');
  await expect(cards.first()).toContainText('나');
  await expect(cards.first()).toContainText('국장');
  await expect(cards.first()).toContainText('소유자');
  await expect(cards.first()).toContainText('철도노조');
  await expect(cards.first()).toContainText('+1');

  await page.fill('#tmoSearch','가스');
  await expect(page.locator('#tmoSummary')).toHaveText('전체 3명 · 표시 2명');
  await expect(page.locator('#memberList .tmo-card')).toHaveCount(2);
  await expect(page.locator('#memberList')).toContainText('김담당');
  await expect(page.locator('#memberList')).toContainText('이현장');

  await page.fill('#tmoSearch','');
  await page.selectOption('#tmoRole','author');
  await expect(page.locator('#tmoSummary')).toHaveText('전체 3명 · 표시 1명');
  await expect(page.locator('#memberList')).toContainText('박기획');
  await expect(page.locator('#memberList')).toContainText('담당사업장 없음');

  await page.selectOption('#tmoRole','all');
  await page.selectOption('#tmoAssigned','unassigned');
  await expect(page.locator('#tmoSummary')).toHaveText('전체 3명 · 표시 1명');
  await expect(page.locator('#memberList')).toContainText('박기획');
});

test('team member overview stays within mobile viewport and reloads assignments',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  await expect(page.locator('#tmoTools')).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  expect(overflow).toBeFalsy();
  await page.evaluate(()=>{window.__state.assignments.push({user_id:'u2',organization_id:'o1'});window.dispatchEvent(new Event('kptu:suborganization-updated'))});
  await page.selectOption('#tmoAssigned','unassigned');
  await expect(page.locator('#tmoSummary')).toHaveText('전체 3명 · 표시 0명');
});
