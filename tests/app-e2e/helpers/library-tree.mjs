import {expect} from '@playwright/test';
// LIB-토글트리: 자료실 목록은 토글 안 토글이고 들어올 때 맨 위 단만 보인다(결정 D13). 줄을 보거나 누르는 시험은
// 먼저 [모두 펴기]로 모든 토글을 연다(연 토글은 다시 그려도 열린 채). 이미 모두 펼쳐져 있으면 그대로 둔다.
export async function expandLibraryTree(page){
  await page.waitForFunction(()=>window.__KPTU_LIBRARY_UPLOAD_READY__);
  await page.evaluate(()=>window.__KPTU_LIBRARY_UPLOAD_READY__);
  const button=page.locator('#libraryExpandAll');
  await expect(button).toBeVisible();
  await expect(page.locator('#documentList > *').first()).toBeAttached();
  if(await button.isEnabled()&&await button.getAttribute('data-lu-expand')!=='close')await button.click();
  await expect.poll(()=>page.locator('#documentList details[data-lu-node]:not([open])').count()).toBe(0);
}
// 한 자료 줄이 보이도록 그 자료가 든 토글만 연다(사용자가 토글 머리를 누르는 것과 같음).
export async function revealLibraryRow(page,id){
  const row=page.locator(`#documentList [data-lu-document="${id}"]`);
  await expect(row).toBeAttached();
  for(;;){
    const closed=await row.evaluate(el=>{const list=[];for(let d=el.closest('details');d;d=d.parentElement?.closest('details'))if(!d.open)list.push(d.dataset.luNode);return list.at(-1)||null});
    if(!closed)break;
    await page.locator(`#documentList details[data-lu-node="${closed}"] > summary`).click();
  }
  await expect(row).toBeVisible();
  return row;
}
// 토글 하나(data-lu-node 키, 예: 'p:top-a')와 그 머리 줄.
export const libraryNode=(page,key)=>page.locator(`#documentList details[data-lu-node="${key}"]`);
export const libraryNodeHead=(page,key)=>libraryNode(page,key).locator(':scope > summary');
// 다른 화면(프로젝트 상세의 자료 "전체 보기")이 자료실을 프로젝트 하나로 걸러 여는 길과 같다. 'all'이면 거르기를 푼다.
// 자료실 안에는 프로젝트를 고르는 칩 줄이 없고(트리가 대신함), 이 [프로젝트] 줄은 걸러 열렸을 때만 보인다.
export async function focusLibraryProject(page,id){
  if(id==='all'){const all=page.locator('#documentProject [data-filter-value="all"]');if(await all.isVisible())await all.click();await expect(page.locator('#documentProject')).toBeHidden();return}
  await page.evaluate(id=>{document.querySelector('#documentProject').value=id;window.KPTULibrary.render()},id);
  await expect(page.locator('#documentProject')).toBeVisible();
}
