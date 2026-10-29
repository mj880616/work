// TG-방고정(시안 A): 방 줄 메뉴(PC ⋯·오른쪽 클릭, 폰 꾹 누르기) 맨 위 [고정]/[고정 풀기], 고정한 방은 날짜 줄 위 맨 위 칸에 📌와 함께,
// 아래 날짜 묶음에는 다시 나오지 않음, 고정 순서·폴더·보관·새로고침, DB 적용 전에는 [고정]이 없음.
// 서버는 흉내(helpers/tg-room-day-server.mjs). 방·폴더 이름은 모두 지어낸 것. 시계는 2026-10-06 10:00(한국)으로 고정.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {installTgServer,telegramRows,F} from './helpers/tg-room-day-server.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const A6='room-a|2026-10-06',B6='room-b|2026-10-06',A5='room-a|2026-10-05',B3='room-b|2026-10-03',Z='room-z|2026-09-15';
const oldRoom={workspace_id:'w',drive_url:null,pinned_at:null,hidden_at:null,archived_at:null,project_id:null,organization_id:null,counterpart:null,speaker_split:false,points:[],updated_at:'2026-09-15T00:00:00Z',
 id:'70000000-0000-4000-8000-000000000099',source:'telegram',day:'2026-09-15',occurred_at:'2026-09-15T03:00:00Z',room_key:'room-z',room_label:'가상 옛 모임',title:'옛 모임 공지',summary:'옛 모임 공지 내용.',raw_count:1,raw_text:'12:00 A: 옛 공지'};

async function fixture(page,{width=1440,roomPins=true,rooms=[{room_key:'room-b',room_label:'예시 간부방',folder_id:F.work},{room_key:'-1001234567',room_label:'가상 채널',archived_at:'2026-10-01T00:00:00Z'}],extra=[]}={}){
 await page.setViewportSize({width,height:860});
 const items=[...telegramRows(),...extra],errors=[],writes=[];let server;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource/.test(e.text()))errors.push(e.text());});
 const shared={items,writes,folders:[{id:F.work,name:'가상 업무'}],rooms:rooms.map(r=>({...r})),roomPins};
 await openHome(page,{beforeLoad:async()=>{
  for(const path of ['app_tg_senders','app_tg_day_senders'])await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+path,r=>r.fulfill({json:[]}));
  server=await installTgServer(page,shared);
 }});
 return {items,errors,writes,server,shared};
}
async function openTelegram(page,width){
 if(width>=1024){const item=page.locator('#appView>.app-nav').getByRole('button',{name:'텔레그램 소식',exact:true});await expect(item).toBeVisible();await item.click();}
 else{await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu nav').getByRole('button',{name:'텔레그램 소식',exact:true}).click();}
 await expect(page.locator('#telegramView')).toBeVisible();
 await expect(page.locator('#telegramView [data-tg-rd]').first()).toBeVisible();
}
const rd=(view,key)=>view.locator(`[data-tg-rd="${key}"]`);
const keys=view=>view.locator('[data-tg-rd]').evaluateAll(els=>els.map(e=>e.dataset.tgRd));
const pinKeys=view=>view.locator('[data-tg-pinrooms] [data-tg-rd]').evaluateAll(els=>els.map(e=>e.dataset.tgRd));
const rpc=(f,name)=>f.writes.filter(w=>w.rpc===name).map(w=>w.body);
// 폰 꾹 누르기: 터치 포인터를 누른 채 0.6초(feed-hold.js 0.5초) 기다렸다 뗀다.
async function hold(page,locator){
 const box=await locator.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 await page.evaluate(async({x,y})=>{
  const el=document.elementFromPoint(x,y),o={bubbles:true,cancelable:true,clientX:x,clientY:y,pointerType:'touch',pointerId:21,isPrimary:true};
  el.dispatchEvent(new PointerEvent('pointerdown',o));await new Promise(r=>setTimeout(r,650));el.dispatchEvent(new PointerEvent('pointerup',o));
 },{x,y});
}

test.describe('마우스 PC',()=>{test.use({hasTouch:false});
test('PC 1440: 오른쪽 클릭 메뉴 맨 위 [고정] → 날짜 줄 위 맨 위 칸에 📌, 아래 날짜 묶음에서 빠지고, 새로고침 뒤에도 그대로, [고정 풀기]로 원래 자리',async({page})=>{
 const f=await fixture(page);
 await openTelegram(page,1440);
 const view=page.locator('#telegramView'),menu=page.locator('#tgRowMenu');
 expect(await keys(view)).toEqual([A6,B6,A5,B3]);
 await rd(view,B6).locator('.feed-rl').click({button:'right'});
 await expect(menu.locator('button')).toHaveText(['고정','폴더로','보관','삭제 이 날 한 줄만']);
 await menu.getByRole('button',{name:'고정',exact:true}).click();
 await expect.poll(()=>rpc(f,'app_feed_room_pin')).toEqual([{p_room_key:'room-b',p_pinned:true}]);
 await expect.poll(()=>pinKeys(view)).toEqual([B6]);
 // 맨 위 칸이 첫 날짜 줄보다 위, 고정 방의 다른 날(10/3)은 아래 날짜 묶음에 다시 나오지 않는다.
 expect(await keys(view)).toEqual([B6,A6,A5]);
 const pinBox=await view.locator('[data-tg-pinrooms]').boundingBox(),dayBox=await view.locator('[data-tg-day]').first().boundingBox();
 expect(pinBox.y+pinBox.height).toBeLessThanOrEqual(dayBox.y+1);
 const prow=rd(view,B6);
 await expect(prow.locator('[data-tg-pinned]')).toHaveText('📌');
 await expect(prow.locator('[data-tg-pinday]')).toHaveText('10. 6.');
 await expect(view.locator('[data-tg-undobar]')).toContainText('고정했어요');
 // 두 번째로 고정한 방은 그 아래(고정한 순서).
 await rd(view,A6).locator('.feed-rl').click({button:'right'});
 await menu.getByRole('button',{name:'고정',exact:true}).click();
 await expect.poll(()=>pinKeys(view)).toEqual([B6,A6]);
 // 새로고침해도 서버에서 그대로 읽는다.
 await page.reload();await page.waitForFunction(()=>!!window.KPTURouter?.go);await page.evaluate(()=>window.KPTURouter.go('telegram'));
 await expect(page.locator('#telegramView [data-tg-rd]').first()).toBeVisible();
 await expect.poll(()=>pinKeys(view)).toEqual([B6,A6]);
 expect(await keys(view)).toEqual([B6,A6]);
 await rd(view,B6).locator('.feed-rl').click({button:'right'});
 await expect(menu.locator('button').first()).toHaveText('고정 풀기');
 await menu.getByRole('button',{name:'고정 풀기'}).click();
 await expect.poll(()=>pinKeys(view)).toEqual([A6]);
 expect(await keys(view)).toEqual([A6,B6,B3]);
 // 되돌리기 줄로 다시 고정된다.
 await view.locator('[data-tg-undobar] [data-tg-undo]').click();
 await expect.poll(()=>pinKeys(view)).toEqual([A6,B6]);
 expect(f.errors).toEqual([]);
});

test('PC: 불러온 기간 밖의 고정 방은 그 방의 가장 최근 날 한 줄로 맨 위에, 보관하면 고정에서 빠진다',async({page})=>{
 const f=await fixture(page,{extra:[oldRoom],rooms:[{room_key:'room-z',room_label:'가상 옛 모임',pinned_at:'2026-10-01T00:00:00Z'},{room_key:'room-a',room_label:'가상지부 단톡',pinned_at:'2026-10-02T00:00:00Z'}]});
 await openTelegram(page,1440);
 const view=page.locator('#telegramView'),menu=page.locator('#tgRowMenu');
 await expect.poll(()=>pinKeys(view)).toEqual([Z,A6]);
 await expect(rd(view,Z).locator('[data-tg-pinday]')).toHaveText('9. 15.');
 await rd(view,A6).locator('.feed-rl').click({button:'right'});
 await menu.getByRole('button',{name:'보관',exact:true}).click();
 await expect.poll(()=>rpc(f,'app_feed_room_pin')).toEqual([{p_room_key:'room-a',p_pinned:false}]);
 await expect.poll(()=>pinKeys(view)).toEqual([Z]);
 expect(await keys(view)).toEqual([Z,B6,B3]);
 // 고정 방 줄을 누르면 그 날 상세가 열린다.
 await rd(view,Z).locator('[data-tg-rdopen]').click();
 await expect(page.locator('#tgDetail [data-tg-detail]')).toHaveAttribute('data-tg-detail',Z);
 expect(f.errors).toEqual([]);
});

test('DB 적용 전(고정 칸 없음): 메뉴에 [고정]이 없고 목록은 그대로',async({page})=>{
 const f=await fixture(page,{roomPins:false});
 await openTelegram(page,1440);
 const view=page.locator('#telegramView'),menu=page.locator('#tgRowMenu');
 expect(await keys(view)).toEqual([A6,B6,A5,B3]);
 await expect(view.locator('.feed-chiprow .feed-chip')).toHaveText(['전체','가상 업무','+ 폴더','보관함 1']);
 await rd(view,A6).locator('.feed-rl').click({button:'right'});
 await expect(menu.locator('button')).toHaveText(['폴더로','보관','삭제 이 날 한 줄만']);
 await expect(view.locator('[data-tg-pinrooms]')).toHaveCount(0);
 expect(rpc(f,'app_feed_room_pin')).toEqual([]);
 expect(f.errors).toEqual([]);
});
});

for(const width of [412,884])test.describe(`폰 ${width}`,()=>{test.use({hasTouch:true});
test(`폰 ${width}: 꾹 누르기 [고정] → 맨 위 칸, 폴더를 고르면 그 폴더의 고정 방만 위에, [고정 풀기]`,async({page})=>{
 const f=await fixture(page,{width});
 await openTelegram(page,width);
 const view=page.locator('#telegramView'),menu=page.locator('#tgRowMenu');
 await hold(page,rd(view,A6).locator('.feed-rl'));
 await expect(menu).toBeVisible();
 await expect(menu.locator('button').first()).toHaveText('고정');
 await menu.getByRole('button',{name:'고정',exact:true}).tap();
 await expect.poll(()=>pinKeys(view)).toEqual([A6]);
 await hold(page,rd(view,B6).locator('.feed-rl'));
 await menu.getByRole('button',{name:'고정',exact:true}).tap();
 await expect.poll(()=>pinKeys(view)).toEqual([A6,B6]);
 // 폴더 '가상 업무'에는 room-b만 있다.
 await view.locator('.feed-chiprow').getByRole('button',{name:'가상 업무'}).tap();
 await expect.poll(()=>pinKeys(view)).toEqual([B6]);
 expect(await keys(view)).toEqual([B6]);
 await view.locator('.feed-chiprow [data-tg-folder=""]').tap();
 await hold(page,rd(view,A6).locator('.feed-rl'));
 await menu.getByRole('button',{name:'고정 풀기'}).tap();
 await expect.poll(()=>pinKeys(view)).toEqual([B6]);
 expect(await keys(view)).toEqual([B6,A6,A5]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(rpc(f,'app_feed_room_pin')).toEqual([{p_room_key:'room-a',p_pinned:true},{p_room_key:'room-b',p_pinned:true},{p_room_key:'room-a',p_pinned:false}]);
 expect(f.errors).toEqual([]);
});
});
