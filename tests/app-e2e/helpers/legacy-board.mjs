// SHARE-보관함·HTML공유: the old Web1 cards sit in the one folded '보관함 n' under my share pages (#web1BoardLegacy is placed
// inside it by share-pages.js). Open that fold before using a card; a no-op when it is already open.
// A page running an older app (the clean-main comparisons) still has <details id="web1BoardLegacy">: that one is opened instead.
export async function openLegacyBoard(page){
  await page.locator('#pagesView[data-web1-board-ready="1"]').waitFor({state:'attached'});
  await page.waitForFunction(()=>!!(document.querySelector('#sharePagesRoot details.sp-box #web1BoardLegacy')||document.querySelector('details#web1BoardLegacy')));
  await page.evaluate(()=>{const fold=document.querySelector('#sharePagesRoot details.sp-box')||document.querySelector('details#web1BoardLegacy');if(fold)fold.open=true;});
}
