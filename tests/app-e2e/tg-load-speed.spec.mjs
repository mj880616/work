// TG-불러오기속도(S70-31, 요청 원문 2026-11-24 "텔레그램 소식 불러오는 속도가 너무 느림 한 15초"): 텔레그램 소식 첫 화면의 요청 차례.
// 첫 목록(방·날 줄)은 방·날 줄·방 상태·폴더·고친 요약만 기다려 그리고, 요청·꼬리표·안 본 것·제목·고정·휴지통·조직·보낸 사람은 늦게 와도 목록을 막지 않는다.
// 서버는 흉내(helpers/tg-room-day-server.mjs). 방·사람·내용은 모두 지어낸 것이다. 시계는 2026-10-06 10:00(한국)으로 고정.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {installTgServer,telegramRows} from './helpers/tg-room-day-server.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// 첫 목록이 기다려도 되는 읽기(이것 밖은 모두 붙잡아 둔다).
const FIRST=new Set(['/rest/v1/rpc/app_feed_room_day_lines','/rest/v1/app_feed_rooms','/rest/v1/app_feed_folders','/rest/v1/app_feed_summary_edits']);
// 텔레그램 소식 화면이 부르는 표·함수(첫 화면 앞 홈 화면이 늦게 끝내는 요청은 세지 않는다).
const TG=/^\/rest\/v1\/(rpc\/app_feed_|app_feed_|app_tg_|app_todo_candidates$|app_suborganization)/;
// 상한: 첫 목록까지 끝난 요청 수·받은 바이트(가짜 자료 기준), 화면을 열 때 부르는 전체 요청 수.
const FIRST_MAX_REQUESTS=5,FIRST_MAX_BYTES=3000,OPEN_MAX_REQUESTS=17;

async function fixture(page,{width=390,height=860,items=telegramRows(),hold=false}={}){
 await page.setViewportSize({width,height});
 const errors=[],calls=[],held=[],log=[];let releasing=!hold,armed=false;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource/.test(e.text()))errors.push(e.text());});
 page.on('requestfinished',async req=>{
  const u=new URL(req.url());if(u.origin!==SB||!armed||!TG.test(u.pathname))return;
  const res=await req.response();let size=0;try{size=(await res.body()).length;}catch{}
  log.push({path:u.pathname,size,at:Date.now()});
 });
 await openHome(page,{beforeLoad:async()=>{
  for(const path of ['app_tg_senders','app_tg_day_senders'])await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+path,r=>r.fulfill({json:[]}));
  await installTgServer(page,{items,calls,roomPins:true});
  // 나중에 건 길이 먼저 받는다: 첫 목록 밖 읽기는 풀어 줄 때까지 붙잡는다.
  await page.route(u=>u.origin===SB&&u.pathname.startsWith('/rest/v1/'),r=>{
   const path=new URL(r.request().url()).pathname;
   if(releasing||!armed||FIRST.has(path)||r.request().method()!=='GET'&&!path.startsWith('/rest/v1/rpc/'))return r.fallback();
   held.push(r);
  });
 }});
 return {errors,calls,log,held,arm(){armed=true;},release(){releasing=true;for(const r of held.splice(0))r.fallback();}};
}
async function openMenu(page){await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu nav').getByRole('button',{name:'텔레그램 소식',exact:true}).click();}
const rd=(view,key)=>view.locator(`[data-tg-rd="${key}"]`);

test('텔레그램 첫 목록: 늦는 재료(요청·꼬리표·안 본 것·제목·고정·휴지통·조직·보낸 사람)를 기다리지 않고 그린 뒤, 오면 채운다',async({page})=>{
 const f=await fixture(page,{hold:true});
 f.arm();const t0=Date.now();
 await openMenu(page);
 const view=page.locator('#telegramView');
 // 붙잡아 둔 읽기가 있어도 방·날 줄 5개가 보인다(그 읽기들을 기다리면 끝내 그려지지 않는다). 걸린 시간은 기록만(기계 부하에 따라 달라 판정하지 않음).
 await expect(view.locator('[data-tg-rd]')).toHaveCount(5);
 const firstMs=Date.now()-t0,before=f.log.filter(x=>x.at<=Date.now());
 expect(f.held.length).toBeGreaterThan(0);
 expect(before.every(x=>FIRST.has(x.path))).toBe(true);
 expect(before.length).toBeLessThanOrEqual(FIRST_MAX_REQUESTS);
 expect(before.reduce((n,x)=>n+x.size,0)).toBeLessThanOrEqual(FIRST_MAX_BYTES);
 console.log('첫 목록',before.length,'요청',before.reduce((n,x)=>n+x.size,0),'바이트',firstMs,'ms');
 await expect(rd(view,'room-a|2026-10-06').locator('.feed-rl')).toHaveText('교섭 일정 연기와 자료 요청');
 await expect(view.locator('.feed-pinbar')).toHaveCount(0);
 // 풀어 주면 한 번 더 그려 꼬리표·고정 띠·오늘 머리줄·요약 없는 날의 제목이 채워진다.
 f.release();
 await expect(rd(view,'room-a|2026-10-06').locator('.feed-ft [data-tg-mark]')).toHaveText('일정');
 await expect(view.locator('.feed-pinbar')).toContainText('고정 1');
 await expect(view.locator('[data-tg-today]')).toHaveText('오늘 412개 중 중요한 5개 · 방 3곳');
 await expect(rd(view,'room-b|2026-10-03').locator('.feed-rl')).toHaveText('옛 안건 정리 · 옛 일정 확인');
 await expect(view.locator('[data-tg-rd]')).toHaveCount(5);
 expect(f.errors).toEqual([]);
});

test('텔레그램 화면을 열 때 부르는 요청 수 상한, 같은 표를 차례로 여러 번 부르지 않음',async({page})=>{
 const f=await fixture(page);
 f.arm();
 await openMenu(page);
 const view=page.locator('#telegramView');
 await expect(view.locator('.feed-pinbar')).toContainText('고정 1');
 await expect(rd(view,'room-a|2026-10-06').locator('.feed-ft [data-tg-mark]')).toHaveText('일정');
 await page.waitForTimeout(500);
 const counts={};for(const x of f.log)counts[x.path]=(counts[x.path]||0)+1;
 console.log('텔레그램 열기 요청',f.log.length,JSON.stringify(counts),'바이트',f.log.reduce((n,x)=>n+x.size,0));
 expect(f.log.length).toBeLessThanOrEqual(OPEN_MAX_REQUESTS);
 // 방 상태는 한 번에(두 번 차례로 읽지 않음), 방·날 줄은 7일씩 두 번.
 expect(counts['/rest/v1/app_feed_rooms']).toBe(1);
 expect(counts['/rest/v1/rpc/app_feed_room_day_lines']).toBe(2);
 expect(f.errors).toEqual([]);
});

test('텔레그램 390: 날짜별 목록을 아래 끝까지 내리면 [이전 날 더 보기]를 누르지 않아도 이전 날을 이어 읽는다',async({page})=>{
 const extra=Array.from({length:14},(_,i)=>({...telegramRows()[0],id:`71000000-0000-4000-8000-${String(i).padStart(12,'0')}`,room_key:`room-x${i}`,room_label:`가상 방 ${i}`,pinned_at:null}));
 const f=await fixture(page,{height:640,items:[...telegramRows(),...extra]});
 await openMenu(page);
 const view=page.locator('#telegramView');
 await expect(view.locator('[data-tg-rd]')).toHaveCount(19);
 // 처음 그린 채로는 더 읽지 않는다.
 await page.waitForTimeout(300);
 expect(f.calls.length).toBe(2);
 await page.mouse.move(195,400);
 for(let i=0;i<8&&f.calls.length<4;i++){await page.mouse.wheel(0,1500);await page.waitForTimeout(150);}
 await expect.poll(()=>f.calls.map(c=>c.p_from).sort()[0]).toBe('2026-09-09');
 await expect(view.locator('[data-tg-day]').last()).toHaveText('9. 20. (일)');
 expect(f.errors).toEqual([]);
});
