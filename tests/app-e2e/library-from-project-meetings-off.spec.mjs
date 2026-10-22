import { appOrigin } from './helpers/test-origin.mjs';
// 프로젝트 상세 → 자료 "전체 보기" → 자료실: 다른 화면에서 들어올 때와 같이 [회의] 칩만 꺼진 채 열리고, 그 프로젝트 거르기는 적용된다.
import {test,expect} from '@playwright/test';
import {expectProjectDetail} from './helpers/project-detail.mjs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
// LIB-토글트리: 자료실에 그냥 들어오면 토글이 접혀 있고, 프로젝트에서 걸러 열면 맞는 토글이 펼쳐져 그 자료가 보인다.

const chip=(page,name)=>page.locator(`#libraryCategoryFilter [data-lu-category="${name}"]`);
const offChips=page=>page.locator('#libraryCategoryFilter [aria-pressed="false"]');
const ids=page=>page.locator('#documentList [data-lu-document]').evaluateAll(els=>els.map(el=>el.dataset.luDocument));

for(const width of [390,1280])test(`프로젝트 상세 → 자료 전체 보기: [회의]만 꺼짐, 다른 칩 켜짐, 프로젝트 거르기 적용, 다시 들어와도 같음 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const s=baseState();s.docs.push({id:'meeting-doc',workspace_id:s.workspace.id,project_id:'child-a1',title:'회의 연결 자료',meeting_id:'meeting-0',category:'회의자료'});await mockApp(page,s);await signIn(page,`${appOrigin}/app/?view=library`);
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));await expect(page.locator('#documentList .lu-row').first()).toBeAttached();
  // 자료실에서 [전체]로 모든 칩을 켜 둔 채 나간다(고른 상태가 남아 있어도 프로젝트에서 들어오면 같은 기본 상태).
  await chip(page,'all').click();await expect(offChips(page)).toHaveCount(0);
  await page.evaluate(()=>window.KPTURouter.go('projects'));await expect(page.locator('#projectsView')).toBeVisible();
  await page.locator('[data-ps3-project="child-a1"]').first().click();await expectProjectDetail(page,'child-a1');
  await page.locator('[data-ps3-library]').click();
  await expect(page.locator('#libraryView')).toBeVisible();await expect(page.locator('#documentProject')).toHaveJSProperty('value','child-a1');
  await expect(offChips(page)).toHaveText(['전체','회의']);await expect(chip(page,'회의')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#libraryCategoryFilter [aria-pressed="true"]')).not.toHaveCount(0);
  await expect(page.locator('[data-lu-document="doc-a1"]')).toBeVisible();expect(await ids(page)).not.toContain('meeting-doc');
  expect(await ids(page)).toEqual(['doc-a1']);
  // 같은 화면을 다시 그려도(고른 상태 유지) 그대로, [회의]를 켜면 그 프로젝트의 회의 자료가 함께 보인다.
  await chip(page,'회의').click();await expect(page.locator('[data-lu-document="meeting-doc"]')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('library',{source:'session',updateUrl:false}));await expect(chip(page,'회의')).toHaveAttribute('aria-pressed','true');
  expect(errors).toEqual([]);
});
