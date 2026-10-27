import {expect} from '@playwright/test';
// HWP-편집기 2단계: the editor runs in a sandboxed frame with an opaque origin, so the browser loads its files
// (module script, stylesheet, WASM, fonts) in CORS mode. GitHub Pages answers every file with
// `Access-Control-Allow-Origin: *` and the Cloudflare Worker passes upstream headers through; the local
// `python3 -m http.server` sends no such header, so the tests add the same header to the editor files only.
export async function servePagesCors(page){
  await page.route(url=>url.pathname.includes('/app/hwp-lab/'),async route=>{
    // A test may end while the editor is still loading files. A file that cannot be served is aborted: a real
    // load failure still fails the test through its "editor ready" check.
    try{
      const response=await route.fetch();
      await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':'*'}});
    }catch{await route.abort().catch(()=>{})}
  });
}

// HWP-화면가득: 폰·폴드 폭(1023px 이하)과 PC [전체 화면]에서는 파일·저장 버튼이 위 얇은 줄의 [파일 ▾]·[저장 ▾] 메뉴 안에 있다.
// 버튼이 보이면(PC 기본 화면) 그 버튼을, 아니면 그 메뉴를 열어 같은 이름의 항목을 누른다. 버튼의 켜짐·꺼짐은 같은 버튼이 정한다.
const MENU_OF={hwpLabPick:'file',hwpLabTemplate:'file',hwpLabConvert:'file',hwpLabSave:'save',hwpLabUpload:'save',hwpDriveNew:'save',hwpDriveOverwrite:'save',hwpDriveView:'save',hwpConvDownload:'save',hwpConvLibrary:'save'};
export const hwpMenuItem=(page,id)=>page.locator(`#hwpBarMenu [data-hwp-act="${id}"]`);
export async function openHwpMenu(page,id,{tap=false}={}){
  const trigger=page.locator(`#hwpLabBar [data-hwp-menu="${MENU_OF[id]}"]`);
  if(await trigger.getAttribute('aria-expanded')!=='true'){
    if(tap)await trigger.tap();else await trigger.click();
  }
  await expect(page.locator('#hwpBarMenu')).toBeVisible();
  return hwpMenuItem(page,id);
}
export async function hwpPress(page,id,{tap=false}={}){
  const button=page.locator('#'+id);
  const target=await button.isVisible()?button:await openHwpMenu(page,id,{tap});
  await expect(target).toBeVisible();
  if(tap)await target.tap();else await target.click();
}
