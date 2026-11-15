// NEWS-모두에게열기 ③: 텔레그램 방 메뉴 [뉴스방으로]·[뉴스방에서 빼기]. 판정은 서버 함수(app_feed_room_news — 텔레그램 허용 작업공간 주인만,
// 그룹·채널만, 1:1·가족 방 거절). 화면은 1:1 방에 단추를 두지 않고, 서버가 거절하면 까닭 한 줄만 보이고 표시를 바꾸지 않는다.
// 방·글은 모두 가상(tg-room-day-server.mjs).
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {installTgServer,telegramRows,F} from './helpers/tg-room-day-server.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const A6='room-a|2026-10-06',B6='room-b|2026-10-06';

async function fixture(page,{answer}){
 await page.setViewportSize({width:1440,height:860});
 const items=telegramRows(),errors=[],writes=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource/.test(e.text()))errors.push(e.text());});
 // room-a = 그룹, room-b = 1:1. 뉴스방 표시(news_at)는 서버 칸.
 const rooms=[{room_key:'room-a',room_label:'가상지부 단톡',chat_kind:'group',news_at:null},{room_key:'room-b',room_label:'예시 간부방',chat_kind:'user',news_at:null,folder_id:F.work}];
 await openHome(page,{beforeLoad:async()=>{
  for(const path of ['app_tg_senders','app_tg_day_senders'])await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+path,r=>r.fulfill({json:[]}));
  await installTgServer(page,{items,writes,folders:[{id:F.work,name:'가상 업무'}],rooms,roomPins:true});
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_feed_room_news',r=>{
   const b=r.request().postDataJSON();calls.push(b);
   const a=answer(b);
   if(a.error)return r.fulfill({status:400,json:{code:'22023',message:a.error}});
   const row=rooms.find(x=>x.room_key===b.p_room_key);row.news_at=b.p_on?'2026-10-06T02:00:00Z':null;
   return r.fulfill({json:{ok:true,changed:true,room_key:b.p_room_key,news_at:row.news_at}});
  });
 }});
 return {errors,calls,rooms};
}
async function openTelegram(page){
 const item=page.locator('#appView>.app-nav').getByRole('link',{name:'텔레그램 소식',exact:true});await expect(item).toBeVisible();await item.click();
 await expect(page.locator('#telegramView [data-tg-rd]').first()).toBeVisible();
}
const rd=(view,key)=>view.locator(`[data-tg-rd="${key}"]`);

test.describe('마우스 PC',()=>{test.use({hasTouch:false});
test('PC 1440: 그룹 방만 [뉴스방으로], 1:1 방은 단추 없음 · 서버가 받으면 [뉴스방에서 빼기]로 · 다시 누르면 빼기',async({page})=>{
 const f=await fixture(page,{answer:()=>({})});
 await openTelegram(page);
 const view=page.locator('#telegramView'),menu=page.locator('#tgRowMenu');
 await rd(view,B6).locator('.feed-rl').click({button:'right'});
 await expect(menu.locator('button')).toHaveText(['고정','폴더로','보관','삭제 이 날 한 줄만']);
 await page.keyboard.press('Escape');
 await rd(view,A6).locator('.feed-rl').click({button:'right'});
 await expect(menu.locator('button')).toHaveText(['고정','폴더로','보관','뉴스방으로','삭제 이 날 한 줄만']);
 await menu.getByRole('button',{name:'뉴스방으로',exact:true}).click();
 await expect.poll(()=>f.calls).toEqual([{p_room_key:'room-a',p_on:true}]);
 await expect(view).toContainText('뉴스방으로 정했어요');
 await rd(view,A6).locator('.feed-rl').click({button:'right'});
 await menu.getByRole('button',{name:'뉴스방에서 빼기',exact:true}).click();
 await expect.poll(()=>f.calls.at(-1)).toEqual({p_room_key:'room-a',p_on:false});
 await expect(view).toContainText('이미 들어간 기사는 남아요');
 expect(f.errors).toEqual([]);
});
test('PC 1440: 서버가 거절하면(가족 방) 까닭 한 줄, 표시는 그대로 [뉴스방으로]',async({page})=>{
 const f=await fixture(page,{answer:()=>({error:'TGNEWS_FAMILY'})});
 await openTelegram(page);
 const view=page.locator('#telegramView'),menu=page.locator('#tgRowMenu');
 await rd(view,A6).locator('.feed-rl').click({button:'right'});
 await menu.getByRole('button',{name:'뉴스방으로',exact:true}).click();
 await expect(view).toContainText('가족 방은 뉴스방으로 정할 수 없어요.');
 expect(f.rooms.find(r=>r.room_key==='room-a').news_at).toBeNull();
 await rd(view,A6).locator('.feed-rl').click({button:'right'});
 await expect(menu.getByRole('button',{name:'뉴스방으로',exact:true})).toBeVisible();
 expect(f.errors).toEqual([]);
});
});
