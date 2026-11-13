import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
test('dbg',async({page})=>{
  await page.setViewportSize({width:900,height:900});await page.goto(`${appOrigin}/tests/app-e2e/suborganization-filters-canonical-fixture.html?orgs=order`);
  await expect(page.locator('.so-group-heading').first()).toBeVisible();
  console.log(JSON.stringify(await page.locator('.so-group-heading').first().evaluate(el=>({h:el.getBoundingClientRect().height,w:el.getBoundingClientRect().width,html:el.innerHTML.length}))));
  console.log(JSON.stringify(await page.locator('#soTeamMore').boundingBox()));
  await page.screenshot({path:'/tmp/claude-0/dbg.png'});
});
