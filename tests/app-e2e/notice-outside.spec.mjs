import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// S48-18 저녁 '새 성명 n건'(app/notice-outside.js): 맨 위 알림 줄 손님 하나. 서울 18:10 뒤, 사회운동 Now를 마지막으로 본 시각 뒤 받은 글이 있으면.
// [보기] → 사회운동 Now [새로 온 것], ✕ → 본 시각을 서버에 지금으로(기기 저장 없음). 서버는 흉내 낸다. 글은 가상.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const line=page=>page.locator('#noticeBar [data-notice="outside-new"]');

async function fixture(page,{width=1280,at='2026-10-06T10:00:00Z',seen='2026-10-06T00:00:00Z',fresh=3}={}){
  await page.setViewportSize({width,height:844});
  const s={calls:[],seen};
  await openHome(page,{query:'?view=calendar',beforeLoad:async()=>{
    await page.clock.setFixedTime(new Date(at)); // 서울 19:00(기본) — 저녁 예약 수집 뒤
    await page.route(u=>u.origin===SB&&/^\/rest\/v1\/app_outside_(seen|posts|sources)$/.test(u.pathname),route=>{
      const req=route.request(),u=new URL(req.url()),p=u.pathname.slice('/rest/v1/'.length),method=req.method(),body=req.postDataJSON?.()??null;
      s.calls.push({p,method,query:decodeURIComponent(u.search),body});
      if(p==='app_outside_seen'){
        if(method==='PATCH'){s.seen=body.seen_at;return route.fulfill({json:[{seen_at:s.seen}]});}
        return route.fulfill({json:s.seen?[{seen_at:s.seen}]:[]});
      }
      if(p==='app_outside_posts'){
        const gt=(u.searchParams.get('fetched_at')||'').replace(/^gt\./,'');
        const n=gt&&gt>=s.seen&&s.seen>'2026-10-06T05:00:00Z'?0:fresh;
        return route.fulfill({json:Array.from({length:n},(_,i)=>({id:`f0000000-0000-4000-8000-00000000000${i}`}))});
      }
      return route.fulfill({json:[]});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/outside-feed',route=>route.fulfill({json:{ok:true,sources:[]}}));
  }});
  return s;
}

for(const width of [390,1280])test(`새 성명 줄 ${width}: 저녁에 본 시각 뒤 글 수, [보기]는 사회운동 Now로 가서 줄이 사라짐`,async({page})=>{
  const s=await fixture(page,{width});
  await expect(line(page)).toBeVisible({timeout:15000});
  await expect(line(page).getByRole('status')).toHaveText('새 성명 3건');
  const q=s.calls.find(c=>c.p==='app_outside_posts').query;
  expect(q).toContain('workspace_id=eq.w');expect(q).toContain('fetched_at=gt.2026-10-06T00:00:00Z');expect(q).toContain('limit=100');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await line(page).getByRole('button',{name:'보기'}).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await expect(page.locator('#outsideRoot').getByRole('tab',{name:'사회운동'})).toHaveAttribute('aria-selected','true');
  await expect(line(page)).toHaveCount(0);
  // 사회운동 Now가 본 시각을 지금으로 바꾼다 → 다른 화면으로 가도 줄이 다시 뜨지 않는다.
  await expect.poll(()=>s.calls.some(c=>c.p==='app_outside_seen'&&c.method==='PATCH')).toBe(true);
});

test('새 성명 줄 ✕: 본 시각을 서버에 지금으로, 새로 고쳐도 다시 안 뜸',async({page})=>{
  const s=await fixture(page);
  await expect(line(page)).toBeVisible({timeout:15000});
  await line(page).getByRole('button',{name:'닫기'}).click();
  await expect(line(page)).toHaveCount(0);
  await expect.poll(()=>s.calls.filter(c=>c.p==='app_outside_seen'&&c.method==='PATCH').map(c=>Object.keys(c.body).sort())).toEqual([['seen_at','updated_at']]);
  await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await page.waitForTimeout(500);
  await expect(line(page)).toHaveCount(0);
});

test('새 성명 줄: 낮(18:10 전)에는 묻지도 띄우지도 않음',async({page})=>{
  const s=await fixture(page,{at:'2026-10-06T08:00:00Z'}); // 서울 17:00
  await page.waitForTimeout(800);
  await expect(line(page)).toHaveCount(0);
  expect(s.calls.filter(c=>c.p==='app_outside_posts')).toHaveLength(0);
});
test('새 성명 줄: 한 번도 본 적 없으면 띄우지 않음(옛 글이 새 글로 쏟아지지 않게)',async({page})=>{
  const s=await fixture(page,{seen:null});
  await expect.poll(()=>s.calls.filter(c=>c.p==='app_outside_seen').length).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await expect(line(page)).toHaveCount(0);
  expect(s.calls.filter(c=>c.p==='app_outside_posts')).toHaveLength(0);
});
