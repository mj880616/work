// TG-방별보기(요청함 10/30 11:28, 명진 결정 "OKAY"): 텔레그램 소식 위쪽 [날짜별 | 방별]. 방별은 방마다 한 줄(방 이름 · 마지막 날짜 · 소식 있는 날 수 / 최근 한 줄),
// 누르면 PC는 오른쪽 칸·폰은 다음 화면에 그 방의 날짜를 최근부터 이어서(날짜 머리·그날 요약·소식 줄, 원문은 접어 둠), 아래로 내리면 옛 날짜를 이어 불러온다.
// 고른 보기는 서버 화면 기억(view_prefs.tg_view), 새로고침 제자리는 주소(?by=room&room=…). 폴더·고정·방 메뉴가 방별에서도 같이 동작.
// 서버는 흉내(helpers/tg-room-day-server.mjs, view-prefs-server.mjs). 방·폴더 이름은 모두 지어낸 것. 시계는 2026-10-06 10:00(한국)으로 고정.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {installTgServer,telegramRows,F} from './helpers/tg-room-day-server.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const A6='room-a|2026-10-06',A5='room-a|2026-10-05',A0='room-a|2026-09-20';

async function fixture(page,{width=1440,prefs=null}={}){
 await page.setViewportSize({width,height:860});
 const items=telegramRows(),errors=[],writes=[];let server,saved;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource/.test(e.text()))errors.push(e.text());});
 const home=await openHome(page,{beforeLoad:async()=>{
  saved=await installViewPrefsServer(page,prefs);
  for(const path of ['app_tg_senders','app_tg_day_senders'])await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+path,r=>r.fulfill({json:[]}));
  server=await installTgServer(page,{items,writes,folders:[{id:F.work,name:'가상 업무'}],rooms:[{room_key:'room-b',room_label:'예시 간부방',folder_id:F.work}],roomPins:true});
 }});
 return {errors,writes,server,prefs:saved||home.prefs};
}
async function openTelegram(page,width){
 if(width>=761&&width!==884){const item=page.locator('#appView>.app-nav').getByRole('button',{name:'텔레그램 소식',exact:true});await expect(item).toBeVisible();await item.click();}
 else if(width<760){await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu nav').getByRole('button',{name:'텔레그램 소식',exact:true}).click();}
 else{await page.waitForFunction(()=>!!window.KPTURouter?.go);await page.evaluate(()=>window.KPTURouter.go('telegram'));}
 await expect(page.locator('#telegramView')).toBeVisible();
 await expect(page.locator('#telegramView [data-tg-rd]').first()).toBeVisible();
}
const press=async(page,locator,width)=>{await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();};
const roomKeys=view=>view.locator('#tgList [data-tg-roomrow]').evaluateAll(els=>els.map(e=>e.dataset.tgRoomrow));
const dayKeys=view=>view.locator('#tgDetail [data-tg-rday]').evaluateAll(els=>els.map(e=>e.dataset.tgRday));
// 아래로 내리기: 방 상세 끝의 [이전 날 더 보기]가 있으면 화면에 보이게 내린 뒤 그때의 날 목록.
const scrolledDayKeys=async(page,view)=>{await page.evaluate(()=>document.querySelector('#tgDetail [data-tg-rolder]')?.scrollIntoView({block:'end'}));return dayKeys(view);};

for(const width of [1440,884,412])test.describe(`방별 ${width}`,()=>{
 test.use({hasTouch:width<761});
 test(`[방별] → 방 한 줄 → 그 방의 날짜를 최근부터 이어서, 내리면 옛 날짜, [날짜별]은 그대로, 고른 보기는 서버에 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  await openTelegram(page,width);
  const view=page.locator('#telegramView'),sw=view.locator('[data-tg-bysw]');
  await expect(sw.locator('button')).toHaveText(['날짜별','방별']);
  await expect(sw.locator('[data-tg-by="day"]')).toHaveAttribute('aria-pressed','true');
  await expect(view.locator('[data-tg-day]').first()).toBeVisible();
  await press(page,sw.locator('[data-tg-by="room"]'),width);
  await expect(sw.locator('[data-tg-by="room"]')).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>f.prefs.value?.tg_view).toBe('room');
  await expect(page).toHaveURL(/[?&]by=room(?:&|$)/);
  // 방마다 한 줄, 최근 소식 순. 날짜 머리 없이 방 이름 · 마지막 날짜 · 날 수 / 최근 한 줄.
  await expect(view.locator('[data-tg-day]')).toHaveCount(0);
  expect(await roomKeys(view)).toEqual(['room-a','-1001234567','room-b']);
  const a=view.locator('[data-tg-roomrow="room-a"]');
  await expect(a.locator('.feed-rn')).toContainText('가상지부 단톡');
  await expect(a.locator('[data-tg-roomday]')).toHaveText('10.06 (화) · 2일');
  await expect(a.locator('.feed-rl')).toHaveText('교섭 일정 연기와 자료 요청');
  // 방을 누르면 그 방의 날짜가 최근부터: 날짜 머리 · 그날 요약 · 소식 줄(원문은 접힘). 끝이 보이면 옛 날짜(9/20)를 이어 불러온다.
  await press(page,a.locator('[data-tg-roomopen]'),width);
  const detail=view.locator('#tgDetail');
  await expect(detail.locator('.feed-detail-name')).toHaveText('가상지부 단톡');
  await expect.poll(()=>scrolledDayKeys(page,view),{timeout:15000}).toEqual([A6,A5,A0]);
  await expect.poll(async()=>{await scrolledDayKeys(page,view);return detail.locator('[data-tg-rolder]').count();},{timeout:15000}).toBe(0);
  const d6=detail.locator(`[data-tg-rday="${A6}"]`);
  await expect(d6.locator('.feed-rday-head')).toHaveText('10. 6. (화)');
  await expect(d6.locator('[data-tg-daybox]')).toContainText('교섭이 다음 주 화요일로 미뤄졌다.');
  await expect(d6.locator('[data-tg-di]')).toHaveCount(2);
  await expect(detail.locator(`[data-tg-rday="${A0}"] [data-tg-di]`)).toHaveCount(1);
  await expect(detail.locator('[data-tg-raw]')).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]room=room-a(?:&|$)/);
  // 원문은 소식 줄을 눌러야 펼쳐진다.
  await press(page,d6.locator('[data-tg-open]').first(),width);
  await expect(d6.locator('[data-tg-raw]')).toBeVisible();
  if(width>=761){
   // PC·폴드 펼침: 왼쪽 방 목록과 오른쪽 칸이 나란히(칸 폭 끌기 경계 있음).
   await expect(view.locator('#tgList')).toBeVisible();
   const lb=await view.locator('#tgList').boundingBox(),db=await detail.boundingBox();expect(db.x).toBeGreaterThan(lb.x+lb.width-2);
   await expect(view.locator('#tgSplit [role="separator"]')).toHaveCount(1);
   await expect(a).toHaveClass(/is-selected/);
  }else{
   // 폰: 다음 화면. 뒤로 가기는 방 목록으로.
   await expect(view.locator('#tgList')).toBeHidden();
   await page.goBack();
   await expect(view.locator('#tgList')).toBeVisible();await expect(detail).toBeHidden();
   await expect(page).not.toHaveURL(/[?&]room=/);
   expect(await roomKeys(view)).toEqual(['room-a','-1001234567','room-b']);
  }
  // [날짜별]로 돌아가면 날짜 아래 방 한 줄 그대로, 고른 보기는 서버에.
  await press(page,sw.locator('[data-tg-by="day"]'),width);
  await expect(view.locator('[data-tg-roomrow]')).toHaveCount(0);
  await expect(view.locator('[data-tg-day]').first()).toHaveText('10. 6. (화)');
  await expect(view.locator(`[data-tg-rd="${A6}"] [data-tg-rdopen]`)).toBeVisible();
  await expect.poll(()=>f.prefs.value?.tg_view).toBe('day');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
 });
});

test.describe('마우스 PC',()=>{test.use({hasTouch:false});
test('PC 1440: 서버에 방별이 기억돼 있으면 방별로 열리고, 폴더 거르기·방 메뉴(고정)·새로고침 제자리가 방별에서도 동작',async({page})=>{
 const f=await fixture(page,{width:1440,prefs:{tg_view:'room'}});
 await openTelegram(page,1440);
 const view=page.locator('#telegramView'),menu=page.locator('#tgRowMenu');
 await expect(view.locator('[data-tg-by="room"]')).toHaveAttribute('aria-pressed','true');
 expect(await roomKeys(view)).toEqual(['room-a','-1001234567','room-b']);
 // 폴더 칩: 그 폴더의 방만.
 await view.locator('.feed-chiprow').getByRole('button',{name:'가상 업무'}).click();
 expect(await roomKeys(view)).toEqual(['room-b']);
 await view.locator('.feed-chiprow [data-tg-folder=""]').click();
 // 방 줄 오른쪽 클릭: [고정][폴더로][보관](이 날 한 줄 삭제는 없음). 고정하면 맨 위 고정 칸에 📌.
 await view.locator('[data-tg-roomrow="room-b"] .feed-rl').click({button:'right'});
 await expect(menu.locator('button')).toHaveText(['고정','폴더로','보관']);
 await menu.getByRole('button',{name:'고정',exact:true}).click();
 await expect.poll(()=>f.writes.filter(w=>w.rpc==='app_feed_room_pin').map(w=>w.body)).toEqual([{p_room_key:'room-b',p_pinned:true}]);
 await expect(view.locator('[data-tg-pinrooms] [data-tg-roomrow="room-b"] [data-tg-pinned]')).toHaveText('📌');
 expect(await roomKeys(view)).toEqual(['room-b','room-a','-1001234567']);
 // 방을 열고 새로고침해도 방별·그 방 그대로(주소), 보기 고르기는 다시 저장하지 않는다.
 await view.locator('[data-tg-roomrow="room-b"] [data-tg-roomopen]').click();
 await expect.poll(()=>scrolledDayKeys(page,view),{timeout:15000}).toEqual(['room-b|2026-10-06','room-b|2026-10-03']);
 await expect(page).toHaveURL(/[?&]by=room&room=room-b(?:&|$)|[?&]room=room-b&by=room(?:&|$)/);
 const patches=f.prefs.patches.length;
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
 await expect(page.locator('#telegramView')).toBeVisible();
 await expect(view.locator('#tgDetail .feed-detail-name')).toHaveText('예시 간부방');
 await expect.poll(()=>scrolledDayKeys(page,view),{timeout:15000}).toEqual(['room-b|2026-10-06','room-b|2026-10-03']);
 await expect(view.locator('[data-tg-by="room"]')).toHaveAttribute('aria-pressed','true');
 expect(f.prefs.patches.slice(patches).filter(p=>p&&'tg_view' in p&&p.tg_view!=='room')).toEqual([]);
 expect(f.errors).toEqual([]);
});
});
