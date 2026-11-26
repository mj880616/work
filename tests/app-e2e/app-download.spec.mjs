import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
// APP-앱내려받기버튼(사용자 11/15 00:11): 로그인 화면 [안드로이드 앱 내려받기], 로그인 뒤 계정 메뉴 '앱 내려받기'.
// 받는 주소는 배포 때 만든 같은 주소 app/phone-app.json(여기서는 흉내)에서 읽은 최신 폰 앱 APK. 없으면 폰 앱 릴리스 목록.
// BASKET-노조플러스업로드: 윈도우 PC 보조 프로그램(노조+ 파일 올리기)은 app/pc-app.json의 최신 Setup.exe — PC 브라우저에서 로그인 화면 맨 위·계정 메뉴.
// S63-09 PC도우미구분(사용자 11/16): PC 브라우저는 그 위에 "WORK ON+는 브라우저에서 씁니다" 한 줄 + [PC에 앱 설치](브라우저 앱 설치, 설치 창이 없으면 안내 한 줄).
// 사진: SHOT_DIR=docs/design/screens/s63-09 로 돌릴 때만.
// 화면 사진: SHOT_DIR=docs/design/screens/s62-09 로 돌릴 때만. 합성 값만 쓴다.
const ANDROID='Mozilla/5.0 (Linux; Android 14; SM-F956N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36';
const APP=`${ANDROID} KPTUAndroid/0.5.10`;
const PC='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const APK='https://github.com/mj880616/work/releases/download/phone-app-v0.5.10/web2-phone-0.5.10.apk';
const LIST='https://github.com/mj880616/work/releases?q=phone-app-v&expanded=true';
const SETUP='https://github.com/mj880616/work/releases/download/basket-pc-v0.6.0/BasketDropApp-win-Setup.exe';
const PC_LIST='https://github.com/mj880616/work/releases?q=basket-pc-v&expanded=true';
const PC_DESC='도우미는 WORK ON+ 자체가 아니에요. WORK ON+ [파일]에서 이 PC 폴더를 보고, 클라우드와 파일을 복사·옮기게 돕는 작은 프로그램이에요';
const PC_BROWSER="WORK ON+는 크롬·엣지 같은 인터넷 브라우저에서 씁니다. PC에서는 브라우저로 열거나 크롬 '앱 설치'로 바탕화면에 두세요.";
const INSTALL_FALLBACK='크롬·엣지 주소창 오른쪽의 설치 아이콘을 눌러 주세요(이미 설치했으면 바탕화면·시작 메뉴의 WORK ON+를 여세요)';
// 브라우저가 진짜 설치 창을 보내더라도 시험이 흔들리지 않게 막는다(설치 창이 있는 경우는 가짜 이벤트로 따로 본다).
const noRealPrompt=page=>page.addInitScript(()=>window.addEventListener('beforeinstallprompt',e=>e.stopImmediatePropagation(),true));
const PC_WARN="처음 실행 때 윈도우 경고가 뜨면 '추가 정보 → 실행'을 눌러 주세요";
async function pcAppJson(page,{missing=false}={}){
  const seen=[];
  await page.route('**/app/pc-app.json*',route=>{seen.push(route.request().url());return missing?route.fulfill({status:404,body:''}):route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({version:'0.6.0',url:SETUP,size:90000000})})});
  return seen;
}
const shot=async(page,name)=>{if(process.env.SHOT_DIR)await page.screenshot({path:`${process.env.SHOT_DIR}/${name}.png`})};
async function phoneAppJson(page,{missing=false}={}){
  const seen=[];
  await page.route('**/app/phone-app.json*',route=>{seen.push(route.request().url());return missing?route.fulfill({status:404,body:''}):route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({version:'0.5.10',url:APK,size:9000000})})});
  // 실제 GitHub로 나가지 않게: 받기 주소로 가는 길은 204(화면이 그대로 남음).
  await page.route('https://github.com/**',route=>route.fulfill({status:204,body:''}));
  return seen;
}
const login=page=>page.goto(`${testOrigin}/app/login/`);

test.describe('안드로이드 폰 브라우저',()=>{
  test.use({userAgent:ANDROID,viewport:{width:412,height:900}});
  test('로그인 화면: [안드로이드 앱 내려받기] = 최신 APK, 아래 설치 안내 한 줄',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const seen=await phoneAppJson(page);
    await login(page);
    const link=page.locator('[data-login-app-link]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href',APK);
    await expect(link).toHaveText('안드로이드 앱 내려받기 (0.5.10)');
    await expect(page.locator('[data-login-app-hint]')).toHaveText("받은 뒤 '알 수 없는 앱 설치 허용'을 한 번 켜야 해요");
    expect(seen.length).toBe(1);
    // BASKET-노조플러스업로드: 폰에서는 안드로이드 줄이 위, 그 아래 윈도우 PC 안내 한 줄(내려받기 버튼 없음).
    await expect(page.locator('[data-login-pc-hint]')).toHaveText('윈도우 PC에서 열면 PC 파일 올리기 도우미를 받을 수 있어요');
    await expect(page.locator('[data-login-pwa]')).toBeHidden(); // 폰에는 PC 앱 설치 없음
    await expect(page.locator('[data-login-pc-link]')).toHaveCount(0);
    const order=await page.locator('[data-login-pc],[data-login-app]').evaluateAll(list=>list.map(el=>el.hasAttribute('data-login-pc')?'pc':'android'));
    expect(order).toEqual(['android','pc']);
    await shot(page,'412-1-login');
    expect(errors).toEqual([]);
  });
  test('로그인 화면: 배포 파일이 없으면 폰 앱 릴리스 목록으로',async({page})=>{
    await phoneAppJson(page,{missing:true});
    await login(page);
    await expect(page.locator('[data-login-app-link]')).toHaveText('안드로이드 앱 내려받기');
    await expect(page.locator('[data-login-app-link]')).toHaveAttribute('href',LIST);
  });
  test('로그인 뒤 [메뉴] 창 아래 계정 줄: 앱 내려받기(판 번호), 누르면 설치 안내',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await phoneAppJson(page);
    await openHome(page);
    await page.locator('#mobileMenuTab').click();
    const row=page.locator('#mobileAccountGroup a[data-app-download="android"]');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('href',APK);
    await expect(row).toContainText('앱 내려받기');
    await expect(row.locator('[data-app-download-ver]')).toHaveText('0.5.10');
    // 계정 줄 순서(S68-36): 설정 링크 — 내 프로필 · 업데이트 소식 · 앱 정보 · 쓰는 법(S69-71) · 앱 내려받기 · 메뉴 수정 … / 운영 줄 — 업데이트 기록 … 로그아웃
    const names=await page.locator('#mobileAccountGroup .account-action').evaluateAll(list=>list.map(el=>(el.querySelector('.account-action-name')||el).textContent.trim()));
    expect(names.slice(0,6)).toEqual(['내 프로필','업데이트 소식','앱 정보','쓰는 법','앱 내려받기','메뉴 수정']);
    await page.waitForTimeout(400);
    await shot(page,'412-2-menu');
    await row.click();
    await expect(page.getByText("받은 뒤 '알 수 없는 앱 설치 허용'을 한 번 켜야 해요")).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('폰 앱 안',()=>{
  test.use({userAgent:APP,viewport:{width:412,height:900}});
  test('로그인 화면·메뉴 어디에도 내려받기가 없다(앱이 스스로 업데이트)',async({page})=>{
    await phoneAppJson(page);
    await login(page);
    await expect(page.locator('[data-login-app]')).toBeHidden();
    await expect(page.locator('[data-login-pc]')).toBeHidden();
    await openHome(page);
    await page.locator('#mobileMenuTab').click();
    await expect(page.locator('#mobileAccountGroup .account-action').first()).toBeVisible();
    await expect(page.locator('[data-app-download]')).toHaveCount(0);
    await expect(page.locator('[data-app-install]')).toHaveCount(0);
  });
});

for(const width of [840,1280])test.describe(`PC·폴드 펼침 ${width}`,()=>{
  test.use({userAgent:PC,viewport:{width,height:900}});
  test('로그인 화면: 맨 위 브라우저 안내 + [PC에 앱 설치], 그 아래 [PC 파일 올리기 도우미 내려받기] = 최신 Setup.exe + 설명·경고, 그 아래 안드로이드 안내',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await noRealPrompt(page);await phoneAppJson(page);const seen=await pcAppJson(page);
    await login(page);
    const pcLink=page.locator('[data-login-pc-link]');
    await expect(pcLink).toBeVisible();
    await expect(pcLink).toHaveAttribute('href',SETUP);
    await expect(pcLink).toHaveText('PC 파일 올리기 도우미 내려받기 (0.6.0)');
    await expect(page.locator('[data-login-pc-browser]')).toHaveText(PC_BROWSER);
    await expect(page.locator('[data-login-install]')).toHaveText('PC에 앱 설치');
    await expect(page.locator('[data-login-pc-hint]')).toHaveText(PC_DESC);
    await expect(page.locator('[data-login-pc-warn]')).toHaveText(PC_WARN);
    await expect(page.locator('[data-login-app-hint]')).toHaveText('안드로이드 폰에서 열면 앱을 받을 수 있어요');
    await expect(page.locator('[data-login-app-link]')).toHaveCount(0);
    const order=await page.locator('[data-login-pwa],[data-login-pc],[data-login-app]').evaluateAll(list=>list.map(el=>el.hasAttribute('data-login-pwa')?'pwa':el.hasAttribute('data-login-pc')?'pc':'android'));
    expect(order).toEqual(['pwa','pc','android']);
    expect(seen.length).toBe(1);
    await shot(page,`${width}-1-login`);
    // 설치 창이 없으면(이미 설치·지원 안 함) 주소창 설치 아이콘 안내 한 줄.
    await page.locator('[data-login-install]').click();
    await expect(page.locator('[data-login-install-hint]')).toHaveText(INSTALL_FALLBACK);
    expect(errors).toEqual([]);
  });
  test('로그인 화면: 브라우저가 설치 창을 보냈으면 [PC에 앱 설치]가 그 창을 연다',async({page})=>{
    await phoneAppJson(page);await pcAppJson(page);
    await login(page);
    await expect(page.locator('[data-login-install]')).toBeVisible();
    await page.evaluate(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{window.__installPrompted=(window.__installPrompted||0)+1};e.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(e)});
    await page.locator('[data-login-install]').click();
    await expect.poll(()=>page.evaluate(()=>window.__installPrompted||0)).toBe(1);
    await expect(page.locator('[data-login-install-hint]')).toBeHidden();
  });
  test('로그인 화면: 배포 파일이 없으면 PC 릴리스 목록으로',async({page})=>{
    await phoneAppJson(page);await pcAppJson(page,{missing:true});
    await login(page);
    await expect(page.locator('[data-login-pc-link]')).toHaveText('PC 파일 올리기 도우미 내려받기');
    await expect(page.locator('[data-login-pc-link]')).toHaveAttribute('href',PC_LIST);
  });
  test('계정 메뉴: [PC에 앱 설치] + 도우미 내려받기(최신 PC 설치 파일·판 번호), 누르면 브라우저 안내·설명·경고',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await noRealPrompt(page);await phoneAppJson(page);await pcAppJson(page);
    await openHome(page);
    await accountButton(page).click();
    const row=page.locator('#sidebarAccountPanel a[data-app-download="pc"]');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('href',SETUP);
    await expect(row.locator('[data-app-download-ver]')).toHaveText('0.6.0');
    await expect(row.locator('.account-action-name')).toHaveText('WORK ON+ 파일 올리기 도우미 내려받기');
    const install=page.locator('#sidebarAccountPanel [data-app-install]');
    await expect(install).toHaveText('PC에 앱 설치');
    await shot(page,`${width}-2-account`);
    await row.click();
    await expect(page.getByText(`${PC_BROWSER} ${PC_DESC}. ${PC_WARN}`)).toBeVisible();
    if(!await install.isVisible())await accountButton(page).click();
    await install.click();
    await expect(page.getByText(INSTALL_FALLBACK)).toBeVisible();
    expect(errors).toEqual([]);
  });
});
