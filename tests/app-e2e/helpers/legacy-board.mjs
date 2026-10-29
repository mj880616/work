// SHARE-보관함·HTML공유: the old Web1 cards sit in the one folded '보관함 n' under my share pages (#web1BoardLegacy is placed
// inside it by share-pages.js). Open that fold before using a card; a no-op when it is already open.
// A page running an older app (the clean-main comparisons) has <details id="web1BoardLegacy"> or no fold at all: that one is
// opened instead, or nothing. share-pages.js (loaded before web1-board.js) has placed the cards in the 보관함 by the time they are drawn.
export async function openLegacyBoard(page){
  await page.locator('#pagesView[data-web1-board-ready="1"]').waitFor({state:'attached'});
  await page.evaluate(()=>{const fold=document.querySelector('#sharePagesRoot details.sp-box')||document.querySelector('details#web1BoardLegacy');if(fold)fold.open=true;});
}
