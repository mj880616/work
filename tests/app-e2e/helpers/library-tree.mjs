import {expect} from '@playwright/test';
// LIB-토글트리: 자료실 목록은 토글 안 토글이고 들어올 때 맨 위 단만 보인다(결정 D13). 줄을 보거나 누르는 시험은
// 먼저 [모두 펴기]로 모든 토글을 연다. 이미 모두 펼쳐져 있으면 그대로 둔다.
export async function expandLibraryTree(page){
  const button=page.locator('#libraryExpandAll');
  await expect(button).toBeVisible();
  await expect(page.locator('#documentList')).not.toBeEmpty();
  if(await button.isEnabled()&&await button.getAttribute('data-lu-expand')!=='close')await button.click();
  await expect.poll(()=>page.locator('#documentList details[data-lu-node]:not([open])').count()).toBe(0);
}
// 토글 하나(data-lu-node 키, 예: 'p:top-a')의 머리 줄.
export const libraryNode=(page,key)=>page.locator(`#documentList details[data-lu-node="${key}"]`);
export const libraryNodeHead=(page,key)=>libraryNode(page,key).locator(':scope > summary');
