import {testOrigin} from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
// S71-57 RECORD-잊지말기연결표시삭제(사용자 결정 2026-11-26 "기록이 되버렸으면 걍 이젠 기록인거임" / "모든 기존 기록에 소급 적용"):
// 잊지 말기에서 옮겨 기록이 된 줄은 담당조직 기록·사업 관리 기록 어디서도 출처 표시(말풍선 아이콘·'잊지 말기 연결')가 없고,
// 눌러도 잊지 말기 원문으로 가지 않는다(폰 기록 창도 열리지 않음). ⋯는 '기록 메뉴'이고 [업데이트 열기]가 없다.
// 지난 연결(만든 곳 'basket'·표시 없는 null) 모두 같다. 자료는 모두 가짜(basket-link-detail-fixture.html).
test.use({hasTouch:true});
const fixture=testOrigin+'/tests/app-e2e/basket-link-detail-fixture.html';

async function ready(page,kind,width){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(fixture);await expect.poll(()=>page.evaluate(()=>window.__detailReady===true)).toBe(true);
 await page.evaluate(kind=>{const s=window.__detailState;s.notes[0].archived_at=null;s.links[0].origin='basket';s.links[1].origin=null;
  window.__went=[];window.KPTURouter.go=(...a)=>window.__went.push(a);
  if(kind==='project')for(const row of s.links){row.project_id=s.ids.project;row.organization_id=null}},kind);
 await page.evaluate(kind=>{const s=window.__detailState;return kind==='organization'?window.KPTUWorkplace.open(s.ids.org):window.KPTUProjects.open(s.ids.project)},kind);
 const host=page.locator(kind==='organization'?'#wdUpdates':'#ps3-progress [data-ps3-records]');
 await expect(host.locator('[data-basket-link]')).toHaveCount(2);
 return {errors,host,modal:page.locator(kind==='organization'?'#wdModal':'#ps3DetailModal'),menu:page.locator(kind==='organization'?'#basketLinkMenu':'#ps3RecordMenu')};
}

for(const kind of ['organization','project'])for(const width of [390,1280])test(`${kind==='organization'?'담당조직 기록':'사업 관리 기록'}: 잊지 말기에서 온 기록은 출처 표시·원문 이동 없이 기록으로만 ${width}`,async({page})=>{
 const {errors,host,modal,menu}=await ready(page,kind,width),rows=host.locator('[data-basket-link]');
 await expect(host).not.toContainText('잊지 말기');
 await expect(host.locator('[data-record-mark]')).toHaveCount(0);
 await expect(host.locator('[data-basket-link] a')).toHaveCount(0); // 잊지 말기 원문으로 가는 링크 없음
 await expect(host).toContainText('연결 요약'); // 글은 그대로
 for(let i=0;i<2;i++){
  const row=rows.nth(i);
  await expect(row.getByRole('button',{name:'기록 메뉴',exact:true})).toHaveCount(1);
  // 줄을 눌러도 아무 데도 가지 않는다(창 그대로, 폰 기록 창 없음).
  const text=kind==='organization'?row.locator('[data-link-summary-text]'):row.locator('.ps3-rec-text');
  if(width<761)await text.tap();else await text.click();
  await expect(modal).toBeVisible();await expect(page.locator('#kptuRecordSheet:not(.hidden)')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__went)).toEqual([]);
 }
 await rows.first().getByRole('button',{name:'기록 메뉴',exact:true}).click();await expect(menu).toBeVisible();
 const items=await menu.locator('button').allTextContents();
 expect(items).not.toContain('업데이트 열기');expect(items).toContain('연결 해제');expect(items).toContain('요약 수정');
 expect(await page.evaluate(()=>window.__detailState.calls.filter(x=>x.method!=='GET'))).toEqual([]); // 연결 데이터는 그대로
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});
