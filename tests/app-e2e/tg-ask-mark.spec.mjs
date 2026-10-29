// TG-요청강조(요청함 10/29 10:04): 텔레그램 소식 목록에서 나한테 온 요청이 있는 줄은 노란 띠 + '나한테 요청 · 무엇을' 꼬리표,
// 맨 위 [나한테 온 요청 n] 칸으로 거르기, 담당조직·일정 회색 꼬리표, 방 상세 소식 줄의 같은 꼬리표, 폰 홈 한 줄 요약의 '나한테 온 요청 n'.
// 요청 판정은 수집 서버가 챙길 것 후보로 남긴 것(app_todo_candidates, source_kind=telegram)을 그대로 쓴다. 서버는 흉내, 이름·내용은 지어낸 것.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {installTgServer,telegramRows,T} from './helpers/tg-room-day-server.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const A6='room-a|2026-10-06',B6='room-b|2026-10-06',C6='-1001234567|2026-10-06',A5='room-a|2026-10-05',B3='room-b|2026-10-03';
const cand=(n,item,day,summary,over={})=>({id:`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`,kind:'request',summary,due:null,source_kind:'telegram',source_id:item,source_day:day,evidence:'근거',project_id:null,organization_id:null,status:'open',task_id:null,task_due:null,created_at:'2026-10-06T01:00:00Z',decided_at:null,...over});
const CANDS=()=>[cand(1,T.a2,'2026-10-06','자료집 초안 공유'),cand(2,T.b1,'2026-10-06','원고 금요일까지 회신',{status:'dismissed',decided_at:'2026-10-06T02:00:00Z'})];

async function fixture(page,{width,cands=CANDS(),seen=null}){
 await page.setViewportSize({width,height:860});
 const items=telegramRows(),errors=[],asked=[],writes=[];let server;
 // 예시 간부방 10/06 소식은 내 담당조직(home-entry의 '테스트 조직')에 연결돼 있다.
 items.find(x=>x.id===T.b1).organization_id='o';
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource/.test(e.text()))errors.push(e.text());});
 // 폭마다 메뉴 모양이 달라(중간 폭은 위쪽 줄) 주소로 바로 연다.
 await openHome(page,{query:'?view=telegram',beforeLoad:async()=>{
  for(const path of ['app_tg_senders','app_tg_day_senders'])await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+path,r=>r.fulfill({json:[]}));
  server=await installTgServer(page,{items,writes,seen});
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_candidates',r=>{
   const q=new URL(r.request().url()).searchParams;asked.push(Object.fromEntries(q));
   let out=cands;if(q.get('status')==='eq.open')out=out.filter(c=>c.status==='open');if(q.get('source_kind')==='eq.telegram')out=out.filter(c=>c.source_kind==='telegram');
   return r.fulfill({json:out});
  });
 }});
 return {errors,asked,writes,server};
}
async function openTelegram(page){
 await expect(page.locator('#telegramView')).toBeVisible();
 await expect(page.locator('#telegramView [data-tg-rd]').first()).toBeVisible();
}
const keys=view=>view.locator('[data-tg-rd]').evaluateAll(els=>els.map(e=>e.dataset.tgRd));

for(const width of [412,884,1440]){
 test(`${width}: 요청 줄만 노란 띠·꼬리표, [나한테 온 요청 1]로 거르고 다시 누르면 전체, 담당조직·일정 회색 꼬리표`,async({page})=>{
  const f=await fixture(page,{width});
  await openTelegram(page,width);
  const view=page.locator('#telegramView'),row=view.locator(`[data-tg-rd="${A6}"]`);
  await expect(row).toHaveClass(/is-ask/);
  await expect(row.locator('[data-tg-ask]')).toHaveText('나한테 요청 · 자료집 초안 공유');
  // 처리한(무시한) 요청은 노란 줄이 아니다. 노란 띠는 요청 줄 하나뿐.
  await expect(view.locator('.feed-rd.is-ask')).toHaveCount(1);
  const band=await row.evaluate(e=>getComputedStyle(e).boxShadow);expect(band).toMatch(/inset/);
  const plain=await view.locator(`[data-tg-rd="${C6}"]`).evaluate(e=>getComputedStyle(e).boxShadow);expect(plain).not.toMatch(/inset 3px/);
  // 회색 꼬리표: 예시 간부방 10/06 = 담당조직 + 일정(금요일 18시 마감), 가상지부 10/06 = 일정(다음 주 화요일), 가상 채널 = 없음.
  await expect(view.locator(`[data-tg-rd="${B6}"] [data-tg-mark]`)).toHaveText('담당조직 · 일정');
  await expect(view.locator(`[data-tg-rd="${A6}"] [data-tg-mark]`)).toHaveText('일정');
  await expect(view.locator(`[data-tg-rd="${C6}"] [data-tg-mark]`)).toHaveCount(0);
  // 칸 줄: [전체][나한테 온 요청 1][폴더…]
  const chips=view.locator('.feed-chiprow');
  const ask=chips.locator('[data-tg-filter="ask"]');await expect(ask).toHaveText('나한테 온 요청 1');
  await expect(chips.locator('.feed-chip').nth(1)).toHaveText('나한테 온 요청 1');
  const all=await keys(view);expect([...all].sort()).toEqual([A6,B6,C6,A5,B3].sort());
  await ask.click();
  await expect(ask).toHaveAttribute('aria-pressed','true');await expect(chips.locator('[data-tg-folder=""]')).toHaveAttribute('aria-pressed','false');
  expect(await keys(view)).toEqual([A6]);
  await ask.click();
  await expect(ask).toHaveAttribute('aria-pressed','false');
  expect(await keys(view)).toEqual(all);
  // 요청 줄을 열면 방 상세의 그 소식에도 같은 꼬리표.
  await row.locator('.feed-rdb').click();
  const di=page.locator(`#tgDetail [data-tg-di="${T.a2}"]`);
  await expect(di).toHaveClass(/is-ask/);
  await expect(di.locator('[data-tg-ask]')).toHaveText('나한테 요청 · 자료집 초안 공유');
  await expect(page.locator(`#tgDetail [data-tg-di="${T.a1}"] [data-tg-ask]`)).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  // 요청 읽기는 열린 텔레그램 후보 한 번(새 AI 판정 없음).
  expect(f.asked.some(q=>q.source_kind==='eq.telegram'&&q.status==='eq.open')).toBe(true);
  expect(f.errors).toEqual([]);
 });
}

test('요청이 없으면 [나한테 온 요청] 칸도 노란 줄도 없다, 후보 표를 읽지 못해도 목록은 그대로',async({page})=>{
 const f=await fixture(page,{width:412,cands:[]});
 await openTelegram(page,412);
 const view=page.locator('#telegramView');
 await expect(view.locator('[data-tg-filter]')).toHaveCount(0);
 await expect(view.locator('.feed-rd.is-ask')).toHaveCount(0);
 await expect(view.locator('.feed-chiprow .feed-chip').first()).toHaveText('전체');
 // '봤음' 칸이 아직 없을 때(DB 적용 전): 점·흐림·[안 본 것]도 없다.
 await expect(view.locator('[data-tg-unseen]')).toHaveCount(0);
 await expect(view.locator('.feed-rd.is-seen')).toHaveCount(0);
 await view.locator(`[data-tg-rd="${A6}"] .feed-rdb`).click();
 await expect(page.locator('#tgDetail [data-tg-daybox]')).toBeVisible();
 expect(f.errors).toEqual([]);
});

test('폰 홈 한 줄 요약에 나한테 온 요청 수가 함께 보인다(정리함 숫자와 같은 읽기)',async({page})=>{
 await page.setViewportSize({width:412,height:900});
 await openHome(page,{beforeLoad:async()=>{
  await page.route('**/rest/v1/app_feed_days**',r=>r.fulfill({json:[{day:'2026-10-06',source:'telegram',total_count:30,kept_count:12,room_count:4,failed_count:0}]}));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_candidates',r=>r.fulfill({json:CANDS().filter(c=>c.status==='open')}));
 }});
 await expect(page.locator('[data-home-summary]')).toHaveText(/새 소식 12 · 나한테 온 요청 1$/);
});

// TG-안본것 3/3: 안 연 방·날은 이름 옆 작은 점, 연 것은 흐림, [안 본 것 n]. '봤음'은 서버 줄(seen_at)이라 다른 기기에서 연 것도 흐리게 보인다.
const SEEN=()=>[
 {room_key:'room-b',day:'2026-10-06',seen_at:'2026-10-07T00:00:00Z',updated_at:'2026-10-06T00:00:00Z'},
 {room_key:'room-a',day:'2026-10-05',seen_at:'2026-10-05T00:00:00Z',updated_at:'2026-10-05T00:00:00Z'},
];
for(const width of [412,884,1440]){
 test(`${width}: 안 본 것 점·본 것 흐림, [안 본 것 4]로 거르기, 열면 서버에 '봤음'이 남고 점이 사라진다`,async({page})=>{
  const f=await fixture(page,{width,seen:SEEN()});
  await openTelegram(page,width);
  const view=page.locator('#telegramView'),row=k=>view.locator(`[data-tg-rd="${k}"]`);
  // 다른 기기에서 연(서버에 봤음이 있는) 예시 간부방 10/06은 흐림·점 없음. 연 뒤 소식이 더 온 가상지부 10/05와 안 연 줄은 점.
  await expect(row(B6)).toHaveClass(/is-seen/);await expect(row(B6).locator('[data-tg-unseen]')).toHaveCount(0);
  for(const k of [A6,C6,A5,B3]){await expect(row(k).locator('[data-tg-unseen]')).toHaveCount(1);await expect(row(k)).not.toHaveClass(/is-seen/);}
  expect(Number(await row(B6).locator('.feed-rn').evaluate(e=>getComputedStyle(e).opacity))).toBeLessThan(1);
  const chip=view.locator('.feed-chiprow [data-tg-filter="unseen"]');await expect(chip).toHaveText('안 본 것 4');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed','true');
  expect((await keys(view)).sort()).toEqual([A6,C6,A5,B3].sort());
  await chip.click();
  // 줄을 열면 그 방·날만 '봤음'(DB 함수 한 번), 점이 사라지고 칸 숫자가 준다.
  await row(A6).locator('.feed-rdb').click();
  await expect.poll(()=>f.writes.filter(w=>w.rpc==='app_feed_room_day_seen').map(w=>w.body)).toEqual([{p_room_key:'room-a',p_day:'2026-10-06'}]);
  if(width<1024){await page.locator('#tgDetail [data-tg-back]').click();}
  await expect(row(A6).locator('[data-tg-unseen]')).toHaveCount(0);
  await expect(row(A6)).toHaveClass(/is-seen/);
  await expect(chip).toHaveText('안 본 것 3');
  // 서버 줄에 남았다(다른 기기도 같은 줄을 읽는다).
  expect(f.server.seen.find(x=>x.room_key==='room-a'&&x.day==='2026-10-06')?.seen_at).toBeTruthy();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
 });
}
