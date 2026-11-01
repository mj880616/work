import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {leftoverDeviceKeys} from './helpers/view-prefs-server.mjs';
// UI-앱안알림 4·5단계(docs/design/in-app-notices.md 4절 3·6절 A6): 맨 위 알림 줄의 '뒤에서 끝난 일'(app/notice-done.js)과
// 내 프로필 '폰 알림' 아래 '최근 알림 7일'(app/phone-push-settings.js). 서버 phone-push는 흉내 낸다. 폰(폴드 접음)·폴드 펼침·PC 세 폭.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const ITEM={kind:'next_week',ref_key:'w2026-10-12',open:'/work/app/?view=home&mode=week&notice=next_week.w2026-10-12'};
const line=page=>page.locator('#noticeBar [data-notice="done"]');

async function fixture(page,{width=1280,items=[ITEM],recent=[],query='?view=calendar'}={}){
  await page.setViewportSize({width,height:844});
  const push={calls:[],items:items.map(i=>({...i})),recent};
  await openHome(page,{query,beforeLoad:async()=>{
    await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/phone-push',route=>{
      const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204});
      const action=new URL(req.url()).searchParams.get('action'),body=req.postDataJSON()||{};
      push.calls.push({action,body});
      if(action==='notices')return route.fulfill({json:{ok:true,items:push.items}});
      if(action==='opened'){push.items=push.items.filter(i=>!(i.kind===body.kind&&i.ref_key===body.ref_key));return route.fulfill({json:{ok:true,opened:1}});}
      if(action==='recent')return route.fulfill({json:{ok:true,items:push.recent}});
      if(action==='devices')return route.fulfill({json:{ok:true,devices:[]}});
      return route.fulfill({status:400,json:{ok:false,error:'UNKNOWN_ACTION'}});
    });
  }});
  return push;
}
const geometry=page=>page.evaluate(()=>{
  const bar=document.getElementById('noticeBar'),r=bar.getBoundingClientRect(),shown=[...bar.children].find(el=>!el.hidden);
  const text=shown.querySelector('[role="status"]');
  return {top:r.top,height:r.height,pad:parseFloat(getComputedStyle(document.body).paddingTop),bg:getComputedStyle(shown).backgroundColor,
    lines:Math.round(text.getBoundingClientRect().height/parseFloat(getComputedStyle(text).lineHeight)),overflow:document.documentElement.scrollWidth>innerWidth};
});

for(const width of [390,900,1280])test(`done line: one toned-down line, [열기] marks opened on the server and goes to the weekly view (${width}px)`,async({page})=>{
  const push=await fixture(page,{width});
  await expect(line(page)).toBeVisible({timeout:15000});
  await expect(line(page).getByRole('status')).toHaveText('다음 주 준비 한 장을 볼 때예요');
  const g=await geometry(page);
  expect(g).toMatchObject({top:0,lines:1,overflow:false});
  expect(g.height).toBeLessThanOrEqual(34);expect(g.pad).toBe(g.height);
  // 옅은 테마색(경고 주황 아님), 빨간 배지·종 모양 없음.
  expect(g.bg).not.toBe(await page.evaluate(()=>{const p=document.createElement('p');p.style.background='var(--kptu-warning-soft)';document.body.append(p);const c=getComputedStyle(p).backgroundColor;p.remove();return c}));
  await expect(page.locator('#noticeBar svg.bell, #noticeBar .badge')).toHaveCount(0);
  expect(push.calls.filter(c=>c.action==='notices')).toHaveLength(1);
  await line(page).getByRole('button',{name:'열기'}).click();
  await expect(page.locator('#noticeBar')).toHaveCount(0);
  await expect.poll(()=>push.calls.filter(c=>c.action==='opened').map(c=>c.body)).toEqual([{kind:'next_week',ref_key:'w2026-10-12'}]);
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#homeView button[data-journal-mode="week"]')).toHaveAttribute('aria-pressed','true',{timeout:15000});
  await expect(page.locator('#homeView [data-journal-weekly-root]')).toBeVisible();
  expect(await leftoverDeviceKeys(page)).toEqual([]);
});

test('done line ✕ also counts as seen on the server; a reload does not bring it back',async({page})=>{
  const push=await fixture(page);
  await expect(line(page)).toBeVisible({timeout:15000});
  await line(page).getByRole('button',{name:'닫기'}).click();
  await expect(page.locator('#noticeBar')).toHaveCount(0);
  await expect.poll(()=>push.calls.filter(c=>c.action==='opened').length).toBe(1);
  await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect.poll(()=>push.calls.filter(c=>c.action==='notices').length).toBe(2);
  await page.waitForTimeout(300);
  await expect(page.locator('#noticeBar')).toHaveCount(0);
});

test('opening from a phone push address (notice=…) marks it opened first and drops only that mark from the address',async({page})=>{
  const push=await fixture(page,{query:'?view=home&mode=week&notice=next_week.w2026-10-12'});
  await expect.poll(()=>push.calls.map(c=>c.action)).toEqual(['opened','notices']);
  expect(push.calls[0].body).toEqual({kind:'next_week',ref_key:'w2026-10-12'});
  await expect.poll(()=>new URL(page.url()).searchParams.get('notice')).toBe(null);
  expect(new URL(page.url()).searchParams.get('mode')).toBe('week');
  await expect(page.locator('#homeView button[data-journal-mode="week"]')).toHaveAttribute('aria-pressed','true',{timeout:15000});
  await page.waitForTimeout(300);
  await expect(page.locator('#noticeBar [data-notice="done"]')).toHaveCount(0);
});

test('a broken or unknown notice mark is ignored (no call), and an unknown item kind is not shown',async({page})=>{
  const push=await fixture(page,{query:'?view=calendar&notice=calendar.x%20y',items:[{kind:'calendar',ref_key:'x',open:'/work/app/'},{kind:'next_week',ref_key:'w1',open:'https://evil.example/'}]});
  await expect.poll(()=>push.calls.filter(c=>c.action==='notices').length).toBe(1);
  await page.waitForTimeout(300);
  expect(push.calls.filter(c=>c.action==='opened')).toHaveLength(0);
  await expect(page.locator('#noticeBar [data-notice="done"]')).toHaveCount(0);
});

for(const width of [390,900,1280])test(`profile '최근 알림 7일': one line '시각 · 무엇', opened ones muted, tap goes to the place (${width}px)`,async({page})=>{
  const recent=[
    {kind:'next_week',ref_key:'w2026-10-12',at:'2026-10-05T07:00:00.000Z',opened:false,pushed:false,open:ITEM.open},
    {kind:'test',ref_key:'t1',at:'2026-10-04T01:20:00.000Z',opened:true,pushed:true,open:'/work/app/?view=profile&notice=test.t1'},
  ];
  const push=await fixture(page,{width,items:[],recent,query:'?view=profile'});
  const list=page.locator('#psPushPanel .ps-push-recent');
  await expect(list).toHaveCount(2,{timeout:15000});
  await expect(page.locator('#psPushPanel [data-ps-push-recent="2"]')).toHaveText('최근 알림 7일');
  await expect(list.nth(0)).toHaveText('10/05 16:00 · 다음 주 준비 한 장');
  await expect(list.nth(1)).toHaveText('10/04 10:20 · 시험 알림');
  await expect(list.nth(1)).toHaveAttribute('data-opened','');
  const box=await list.nth(0).boundingBox();expect(box.height).toBeLessThanOrEqual(32);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await list.nth(0).click();
  await expect.poll(()=>push.calls.filter(c=>c.action==='opened').map(c=>c.body)).toEqual([{kind:'next_week',ref_key:'w2026-10-12'}]);
  await expect(page.locator('#homeView button[data-journal-mode="week"]')).toHaveAttribute('aria-pressed','true',{timeout:15000});
});

test("profile recent list: empty and failed reads are one short line",async({page})=>{
  await fixture(page,{items:[],recent:[],query:'?view=profile'});
  await expect(page.locator('#psPushPanel [data-ps-push-recent="0"]')).toHaveText('최근 7일 알림 없음',{timeout:15000});
});
