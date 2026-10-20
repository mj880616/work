// SHARE-현장공유 PR 2: the old Web1 cards sit folded under "이전 페이지" below my share pages (S7).
// Open that fold before using a card; a no-op when it is already open.
export async function openLegacyBoard(page){
  await page.locator('#pagesView[data-web1-board-ready="1"]').waitFor({state:'attached'});
  await page.evaluate(()=>{const fold=document.querySelector('#web1BoardLegacy');if(fold)fold.open=true;});
}
