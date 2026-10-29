// SHARE-보관함·HTML공유: the old Web1 cards sit in the one folded '보관함 n' under my share pages (#web1BoardLegacy is placed
// inside it by share-pages.js). Open that fold before using a card; a no-op when it is already open.
export async function openLegacyBoard(page){
  await page.locator('#pagesView[data-web1-board-ready="1"]').waitFor({state:'attached'});
  await page.locator('#sharePagesRoot details.sp-box #web1BoardLegacy').waitFor({state:'attached'});
  await page.evaluate(()=>{const fold=document.querySelector('#sharePagesRoot details.sp-box');if(fold)fold.open=true;});
}
