import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:8123';
const EDGE='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/auth-handoff';
const SESSION='kptu_collab_session_v1';

for(const transport of ['hash','query']){
  test(`native callback ${transport}: failed seal scrubs immediately and has no raw app link`,async({page})=>{
    let calls=0;
    await page.route(EDGE,async route=>{
      calls++;
      expect(page.url()).not.toMatch(/synthetic-|access_token|refresh_token|provider_token/);
      expect(route.request().headers().referer).toBeUndefined();
      await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'synthetic-private-upstream'})});
    });
    const tokens='access_token=synthetic-access&refresh_token=synthetic-refresh&provider_token=synthetic-provider';
    await page.goto(`${BASE}/app/native-callback.html?native=android${transport==='hash'?'#':'&'}${tokens}`,{waitUntil:'domcontentloaded'});
    await expect(page.locator('#handoffStatus')).toContainText('새 로그인을');
    expect(calls).toBe(1);
    expect(page.url()).not.toMatch(/synthetic-|access_token|refresh_token/);
    await expect(page.locator('#backToApp')).not.toHaveAttribute('href',/.+/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content','no-referrer');
    await expect(page.locator('body')).not.toContainText('synthetic-private');
  });
}

test('Android callback success emits only sealed handoff on the existing query transport',async({page})=>{
  await page.route(EDGE,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({token:'opaque-sealed-handoff'})}));
  await page.goto(`${BASE}/app/native-callback.html?native=android#access_token=synthetic-access&refresh_token=synthetic-refresh`,{waitUntil:'domcontentloaded'});
  await expect(page.locator('#backToApp')).toHaveAttribute('href','intent://auth?handoff=opaque-sealed-handoff#Intent;scheme=kptuwork;package=kr.or.kptu.work;end');
  expect(await page.locator('#backToApp').getAttribute('href')).not.toMatch(/payload|synthetic-|access_token|refresh_token/);
});

test('actual loader scrubs mixed handoff/OAuth on failure before bootstrap and cannot replay after reload',async({page})=>{
  let consumes=0,refreshes=0;
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/functions/v1/auth-handoff'){
      consumes++;
      expect(page.url()).not.toMatch(/handoff|synthetic-/);
      return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'handoff_unavailable'})});
    }
    if(url.pathname==='/auth/v1/token')refreshes++;
    return route.fulfill({status:401,contentType:'application/json',body:'{}'});
  });
  await page.goto(`${BASE}/app/?handoff=opaque#access_token=synthetic-access&refresh_token=synthetic-refresh`,{waitUntil:'domcontentloaded'});
  await expect(page).toHaveURL(/\/app\/login\//);
  expect(await page.evaluate(key=>localStorage.getItem(key),SESSION)).toBeNull();
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('#googleLoginBtn')).toBeVisible();
  expect(consumes).toBe(1);
  expect(refreshes).toBe(0);
  expect(page.url()).not.toMatch(/handoff|synthetic-/);
});
