// UI-앱안알림 3단계(docs/design/in-app-notices.md 5절, 명진 결정 A4·A5):
// - S52-20: '잊지 말기'(처리 안 한 것, 홈 한 줄과 같은 숫자)가 1건 이상이면 폰 하단바 '홈'에 작은 점(숫자 없음), 폴드 펼침·PC 왼쪽 메뉴 '홈' 옆에 옅은 숫자. 0이면 아무것도 없다.
// - 숫자는 홈 한 줄·정리함 한 목록이 이미 센 값(새 읽기 없음). 정리함에서 처리하면 다른 화면에서도 바로 사라진다.
// - 홈 '잊지 말기' 한 줄 오른쪽 '내일 약속 n'(원장 약속, 있을 때만). 서버는 흉내, 글은 지어낸 것.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const cand=(n,source_kind='telegram',status='open')=>({id:`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`,kind:'request',summary:`가짜 요청 ${n}`,due:null,source_kind,source_id:`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`,source_day:'2026-10-06',evidence:'근거',project_id:null,organization_id:null,status,task_id:null,task_due:null,created_at:'2026-10-06T00:00:00Z'});

async function fixture(page,{width,cands=[cand(1),cand(2),cand(3,'update')],promises=[]}={}){
  await page.setViewportSize({width,height:860});
  const ledgerAsked=[];
  await openHome(page,{beforeLoad:async()=>{
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_candidates',r=>{
      if(r.request().method()!=='GET')return r.fulfill({json:[]});
      const q=new URL(r.request().url()).searchParams;let out=cands;
      if(q.get('status')==='eq.open')out=out.filter(c=>c.status==='open');if(q.get('source_kind')==='eq.telegram')out=out.filter(c=>c.source_kind==='telegram');
      return r.fulfill({json:out});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:['telegram']}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_ledger_records'&&u.searchParams.get('kind')==='eq.commitment'&&u.searchParams.has('or'),r=>{
      ledgerAsked.push(Object.fromEntries(new URL(r.request().url()).searchParams));return r.fulfill({json:promises});
    });
  }});
  await expect(page.locator('#homeView [data-home-summary]')).toBeVisible();
  return {ledgerAsked};
}
const mark=page=>page.evaluate(()=>{
  const app=document.getElementById('appView'),phone=innerWidth<=760;
  const el=phone?document.querySelector('#appView>.mobile-tabs>button[data-view="home"]'):document.querySelector('#appView>.app-nav .sidebar-brand');
  const after=getComputedStyle(el,'::after');
  return {attr:app.dataset.homeAsks??null,content:after.content,w:after.width,bg:after.backgroundColor,color:after.color,
    redBadge:[...document.querySelectorAll('#appView .badge,#appView [class*="bell"]')].length,overflow:document.documentElement.scrollWidth>innerWidth};
});
const warning=page=>page.evaluate(()=>{const p=document.createElement('p');p.style.color='var(--kptu-warning)';document.getElementById('appView').append(p);const c=getComputedStyle(p).color;p.remove();return c});

test('phone (fold folded): a small dot on the bottom bar home, no number',async({page})=>{
  await fixture(page,{width:390});
  await expect(page.locator('#homeView [data-home-summary] [data-nbx-badge]')).toHaveText('2');
  await page.evaluate(()=>window.KPTURouter.go('calendar'));
  const m=await mark(page);
  expect(m).toMatchObject({attr:'2',content:'""',w:'6px',redBadge:0,overflow:false});
  expect(m.bg).toBe(await warning(page));
});
for(const width of [900,1280])test(`${width}px: a faint number beside the menu home`,async({page})=>{
  await fixture(page,{width});
  // 숫자는 홈 칩이 다 센 뒤에 붙는다(서버 읽기 여러 개). 그 숫자가 보인 다음 잰다 — 첫 그림 직후 재면 아직 셈 전이라 간헐로 비어 있었다.
  await expect(page.locator('#homeView [data-home-summary] [data-nbx-badge]')).toHaveText('2');
  await page.evaluate(()=>window.KPTURouter.go('calendar'));
  const m=await mark(page);
  expect(m).toMatchObject({attr:'2',content:'"2"',redBadge:0,overflow:false});
  expect(m.color).toBe(await warning(page));
  const box=await page.locator('#appView>.app-nav .sidebar-brand').boundingBox();
  expect(box.width).toBeLessThanOrEqual(width<1024?72:160); // UI-폴드메뉴이름: 좁은 칸 72px
});
for(const width of [390,1280])test(`${width}px: nothing to handle → no mark`,async({page})=>{
  await fixture(page,{width,cands:[cand(3,'update')]});
  await expect(page.locator('#homeView [data-home-summary] [data-home-forget-open]')).toHaveText('잊지 말기');
  const m=await mark(page);
  expect(m.attr).toBeNull();expect(['none','normal']).toContain(m.content);
});
test('handling a request in the 정리함 updates the mark without a new count read',async({page})=>{
  const cands=[cand(1)];
  await fixture(page,{width:1280,cands});
  await expect.poll(async()=>(await mark(page)).attr).toBe('1');
  // 서버 쪽에서 처리된 것처럼 바꾼 뒤 정리함을 연다(정리함 목록이 센 값으로 바로 맞춘다).
  cands[0]={...cands[0],status:'dismissed',decided_at:'2026-10-06T00:30:00Z'};
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await expect.poll(async()=>(await mark(page)).attr).toBeNull();
});
test('home summary line ends with tomorrow promises only when there are some',async({page})=>{
  const {ledgerAsked}=await fixture(page,{width:390,promises:[{id:'p1'},{id:'p2'}]});
  const btn=page.locator('#homeView [data-home-summary-promises]');
  await expect(btn).toHaveText('내일 약속 2 ›');
  // 폰 알림 '원장 약속 D-1'과 같은 기준: 대기 중·유효·후속확인일(없으면 끝난 날)이 내일(서울). 시험 시계는 10/06 → 내일 10/07.
  expect(ledgerAsked.at(-1)).toMatchObject({commitment_status:'eq.waiting',validity:'in.(current,needs_check)',or:'(follow_up_on.eq.2026-10-07,and(follow_up_on.is.null,date_end.eq.2026-10-07))',select:'id'});
  const line=await page.locator('#homeView [data-home-summary] [data-home-forget-open]').boundingBox(),end=await btn.boundingBox();expect(line.height).toBeLessThanOrEqual(40);expect(Math.abs((end.y+end.height/2)-(line.y+line.height/2))).toBeLessThanOrEqual(4); // S53-13: 칩 뒤 같은 줄
  await btn.click();
  await expect(page.locator('#ledgerView')).toBeVisible();
});
test('no tomorrow promise → nothing appended',async({page})=>{
  await fixture(page,{width:1280});
  await expect(page.locator('#homeView [data-home-summary] [data-home-forget-open]')).toBeVisible();
  await expect(page.locator('#homeView [data-home-summary-promises]')).toHaveCount(0);
  await expect(page.locator('#homeView [data-home-summary]')).not.toContainText('내일 약속');
});
