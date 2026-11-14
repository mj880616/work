import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
// APP-앱내려받기버튼(명진 11/15 00:11): 로그인 화면 [안드로이드 앱 내려받기], 로그인 뒤 계정 메뉴 '앱 내려받기'.
// 받는 주소는 배포 때 만든 같은 주소 app/phone-app.json(여기서는 흉내)에서 읽은 최신 폰 앱 APK. 없으면 폰 앱 릴리스 목록.
// 화면 사진: SHOT_DIR=docs/design/screens/s62-04b 로 돌릴 때만. 합성 값만 쓴다.
const ANDROID='Mozilla/5.0 (Linux; Android 14; SM-F956N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36';
const APP=`${ANDROID} KPTUAndroid/0.5.10`;
const PC='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const APK='https://github.com/mj880616/work/releases/download/phone-app-v0.5.10/web2-phone-0.5.10.apk';
const LIST='https://github.com/mj880616/work/releases?q=phone-app-v&expanded=true';
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
    // 계정 줄 순서: 내 프로필 · 업데이트 기록 · 앱 내려받기 · 메뉴 수정 · 화면 색 · 로그아웃
    const names=await page.locator('#mobileAccountGroup .account-action').evaluateAll(list=>list.map(el=>(el.querySelector('.account-action-name')||el).textContent.trim()));
    expect(names.slice(0,4)).toEqual(['내 프로필','업데이트 기록','앱 내려받기','메뉴 수정']);
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
    await openHome(page);
    await page.locator('#mobileMenuTab').click();
    await expect(page.locator('#mobileAccountGroup .account-action').first()).toBeVisible();
    await expect(page.locator('[data-app-download]')).toHaveCount(0);
  });
});

for(const width of [840,1280])test.describe(`PC·폴드 펼침 ${width}`,()=>{
  test.use({userAgent:PC,viewport:{width,height:900}});
  test('로그인 화면은 버튼 대신 안내 한 줄, 계정 메뉴 앱 내려받기는 누르면 같은 안내',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await phoneAppJson(page);
    await login(page);
    await expect(page.locator('[data-login-app-hint]')).toHaveText('안드로이드 폰에서 열면 앱을 받을 수 있어요');
    await expect(page.locator('[data-login-app-link]')).toHaveCount(0);
    await shot(page,`${width}-1-login`);
    await openHome(page);
    await accountButton(page).click();
    const row=page.locator('#sidebarAccountPanel [data-app-download="other"]');
    await expect(row).toBeVisible();
    await shot(page,`${width}-2-account`);
    await row.click();
    await expect(page.getByText('안드로이드 폰에서 열면 앱을 받을 수 있어요')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
