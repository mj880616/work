// TG-방날짜묶기 4-나: 폴더 칸 줄(전체·폴더·+ 폴더·보관함), 폰 줄 밀기([폴더로][보관] / [삭제]), 보관함 [꺼내기], PC 행 ⋯·오른쪽 클릭.
// 서버는 흉내(helpers/tg-room-day-server.mjs). 방·폴더 이름은 모두 지어낸 것. 시계는 2026-10-06 10:00(한국)으로 고정.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {installTgServer,telegramRows,F} from './helpers/tg-room-day-server.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const A6='room-a|2026-10-06',B6='room-b|2026-10-06',C6='-1001234567|2026-10-06',A5='room-a|2026-10-05',B3='room-b|2026-10-03';

async function fixture(page,{width=390,folders=[{id:F.work,name:'가상 업무'}],rooms=[{room_key:'room-b',room_label:'예시 간부방',folder_id:F.work},{room_key:'-1001234567',room_label:'가상 채널',archived_at:'2026-10-01T00:00:00Z'}],noFolderFns=false}={}){
 await page.setViewportSize({width,height:860});
 const items=telegramRows(),errors=[],writes=[],calls=[];let server;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource/.test(e.text()))errors.push(e.text());});
 await openHome(page,{beforeLoad:async()=>{
  for(const path of ['app_tg_senders','app_tg_day_senders'])await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+path,r=>r.fulfill({json:[]}));
  server=await installTgServer(page,{items,writes,calls,folders:folders.map(f=>({...f})),rooms:rooms.map(r=>({...r})),noFolderFns});
 }});
 return {items,errors,writes,calls,server};
}
async function openTelegram(page,width){
 if(width>=1024){const item=page.locator('#appView>.app-nav').getByRole('button',{name:'텔레그램 소식',exact:true});await expect(item).toBeVisible();await item.click();}
 else{await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu nav').getByRole('button',{name:'텔레그램 소식',exact:true}).click();}
 await expect(page.locator('#telegramView')).toBeVisible();
 await expect(page.locator('#telegramView [data-tg-rd]').first()).toBeVisible();
}
const rd=(view,key)=>view.locator(`[data-tg-rd="${key}"]`);
const wrapOf=(view,key)=>view.locator(`[data-tg-swipe="${key}"]`);
const keys=view=>view.locator('[data-tg-rd]').evaluateAll(els=>els.map(e=>e.dataset.tgRd));
// 손가락 움직임은 터치 포인터 이벤트로 흉내 낸다(옛 카드 밀기 시험과 같은 방식). fromX: 줄 왼쪽에서의 가로 위치.
async function drag(page,locator,fromX,dx,dy=0,{steps=8,startAt=null}={}){
 const box=await locator.boundingBox();const hx=box.x+fromX,y=box.y+box.height/2,x=startAt??hx;
 await page.evaluate(async({hx,x,y,dx,dy,steps})=>{
  const el=document.elementFromPoint(hx,y),o=(px,py)=>({bubbles:true,cancelable:true,clientX:px,clientY:py,pointerType:'touch',pointerId:11,isPrimary:true});
  el.dispatchEvent(new PointerEvent('pointerdown',o(x,y)));
  for(let i=1;i<=steps;i++){el.dispatchEvent(new PointerEvent('pointermove',o(x+dx*i/steps,y+dy*i/steps)));await new Promise(r=>setTimeout(r,16));}
  el.dispatchEvent(new PointerEvent('pointerup',o(x+dx,y+dy)));
 },{hx,x,y,dx,dy,steps});
}
const rpc=(f,name)=>f.writes.filter(w=>w.rpc===name);

test('폴더 칸 줄: [전체][폴더][+ 폴더][보관함 n], 모든 방 고르기는 없고, 폴더를 고르면 그 폴더의 방만',async({page})=>{
 const f=await fixture(page);
 await openTelegram(page,390);
 const view=page.locator('#telegramView');
 await expect(view.locator('[data-tg-room]')).toHaveCount(0);
 const row=view.locator('.feed-chiprow');
 await expect(row.locator('.feed-chip')).toHaveText(['전체','가상 업무','+ 폴더','보관함 1']);
 await expect(row.locator('[data-tg-folder=""]')).toHaveAttribute('aria-pressed','true');
 expect(await keys(view)).toEqual([A6,B6,A5,B3]);
 await row.getByRole('button',{name:'가상 업무'}).tap();
 expect(await keys(view)).toEqual([B6,B3]);
 await expect(row.getByRole('button',{name:'가상 업무'})).toHaveAttribute('aria-pressed','true');
 await row.locator('[data-tg-folder=""]').tap();
 expect(await keys(view)).toEqual([A6,B6,A5,B3]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.errors).toEqual([]);
});

test('폰 오른쪽 밀기: [폴더로](파랑)·[보관](연노랑) 두 버튼, 보관하면 방이 목록에서 빠지고 되돌리기 줄은 하단바 위',async({page})=>{
 const f=await fixture(page);
 await openTelegram(page,390);
 const view=page.locator('#telegramView'),w=wrapOf(view,A6);
 await expect(w.locator('[data-tg-act-btn]')).toHaveCount(3);
 await drag(page,rd(view,A6),60,110);
 await expect(w).toHaveAttribute('data-side','start');
 const btns=w.locator('.feed-acts-start [data-tg-act-btn]');await expect(btns).toHaveText(['폴더로','보관']);
 const bw=await btns.evaluateAll(els=>els.map(e=>Math.round(e.getBoundingClientRect().width)));expect(bw).toEqual([64,64]);
 await btns.nth(1).tap();
 await expect.poll(()=>rpc(f,'app_feed_room_set').length).toBe(1);
 expect(rpc(f,'app_feed_room_set')[0].body).toEqual({p_room_key:'room-a',p_folder:null,p_archived:true});
 expect(await keys(view)).toEqual([B6,B3]);
 await expect(view.locator('[data-tg-folder="' + '' + '"]')).toBeVisible();
 await expect(view.locator('.feed-chiprow [data-tg-shelf]')).toHaveText('보관함 2');
 const bar=view.locator('[data-tg-undobar]');await expect(bar).toContainText('보관했어요');
 const tabs=await page.locator('.mobile-tabs').boundingBox(),b=await bar.boundingBox();expect(b.y+b.height).toBeLessThanOrEqual(tabs.y+1);
 await bar.locator('[data-tg-undo]').tap();
 await expect.poll(()=>rpc(f,'app_feed_room_set').length).toBe(2);
 expect(rpc(f,'app_feed_room_set')[1].body).toEqual({p_room_key:'room-a',p_folder:null,p_archived:false});
 expect(await keys(view)).toEqual([A6,B6,A5,B3]);
 expect(f.errors).toEqual([]);
});

test('폰 왼쪽 밀기: [삭제] 한 버튼, 그 날 한 줄만 빠지고(같은 방의 다른 날은 그대로) 되돌릴 수 있다',async({page})=>{
 const f=await fixture(page);
 await openTelegram(page,390);
 const view=page.locator('#telegramView'),w=wrapOf(view,A6);
 const box=await rd(view,A6).boundingBox();
 await drag(page,rd(view,A6),box.width-50,-110);
 await expect(w).toHaveAttribute('data-side','end');
 const del=w.locator('.feed-acts-end [data-tg-act-btn]');await expect(del).toHaveText('삭제');
 await del.tap();
 await expect.poll(()=>rpc(f,'app_feed_room_day_set').length).toBe(1);
 expect(rpc(f,'app_feed_room_day_set')[0].body).toEqual({p_room_key:'room-a',p_day:'2026-10-06',p_state:'trashed'});
 expect(await keys(view)).toEqual([B6,A5,B3]);
 await expect(view.locator('[data-tg-undobar]')).toContainText('삭제했어요');
 await view.locator('[data-tg-undo]').tap();
 await expect.poll(()=>rpc(f,'app_feed_room_day_set').length).toBe(2);
 expect(rpc(f,'app_feed_room_day_set')[1].body.p_state).toBe('active');
 expect(await keys(view)).toEqual([A6,B6,A5,B3]);
 expect(f.errors).toEqual([]);
});

test('밀기는 분명한 가로 움직임만: 세로 스크롤·화면 가장자리 시작·짧은 움직임은 줄을 열지 않고, 줄을 누르면 방 상세가 열린다',async({page})=>{
 await fixture(page);
 await openTelegram(page,390);
 const view=page.locator('#telegramView'),w=wrapOf(view,A6);
 await drag(page,rd(view,A6),60,12,90);
 await expect(w).not.toHaveAttribute('data-side',/.+/);
 await drag(page,rd(view,A6),60,110,0,{startAt:8});
 await expect(w).not.toHaveAttribute('data-side',/.+/);
 await drag(page,rd(view,A6),60,30);
 await expect(w).not.toHaveAttribute('data-side',/.+/);
 // 열린 줄은 하나뿐: 다른 줄을 밀면 앞의 줄은 닫힌다.
 await drag(page,rd(view,A6),60,110);await expect(w).toHaveAttribute('data-side','start');
 await drag(page,rd(view,B6),60,110);
 await expect(wrapOf(view,B6)).toHaveAttribute('data-side','start');await expect(w).not.toHaveAttribute('data-side',/.+/);
 await rd(view,A5).locator('.feed-rdb').tap();
 await expect(wrapOf(view,B6)).not.toHaveAttribute('data-side',/.+/);
 await expect(page.locator('#tgDetail [data-tg-daybox]')).toBeVisible();
});

test('[폴더로]: 폴더 목록·새 폴더, 고르면 그 방이 폴더로 들어가고 폴더를 고른 칸에서 사라진다',async({page})=>{
 const f=await fixture(page);
 await openTelegram(page,390);
 const view=page.locator('#telegramView'),pick=page.locator('#tgFolderPick');
 await drag(page,rd(view,A6),60,110);
 await wrapOf(view,A6).locator('[data-tg-kind="folder"]').tap();
 await expect(pick.locator('button')).toHaveText(['가상 업무','+ 새 폴더']);
 await pick.getByRole('button',{name:'가상 업무'}).tap();
 await expect.poll(()=>rpc(f,'app_feed_room_set').length).toBe(1);
 expect(rpc(f,'app_feed_room_set')[0].body).toEqual({p_room_key:'room-a',p_folder:F.work,p_archived:false});
 await expect(view.locator('[data-tg-undobar]')).toContainText("'가상 업무'에 넣었어요");
 await view.locator('.feed-chiprow').getByRole('button',{name:'가상 업무'}).tap();
 expect(await keys(view)).toEqual([A6,B6,A5,B3]);
 // 이미 들어 있으면 체크와 [폴더에서 빼기].
 await drag(page,rd(view,A6),60,110);
 await wrapOf(view,A6).locator('[data-tg-kind="folder"]').tap();
 await expect(pick.locator('button')).toHaveText(['✓ 가상 업무','폴더에서 빼기','+ 새 폴더']);
 await pick.getByRole('button',{name:'폴더에서 빼기'}).tap();
 await expect.poll(()=>rpc(f,'app_feed_room_set').length).toBe(2);
 expect(rpc(f,'app_feed_room_set')[1].body.p_folder).toBe(null);
 expect(await keys(view)).toEqual([B6,B3]);
 // + 새 폴더: 이름 상자 → 폴더를 만들고 그 방을 넣는다.
 await view.locator('.feed-chiprow [data-tg-folder=""]').tap();
 await drag(page,rd(view,A5),60,110);
 await wrapOf(view,A5).locator('[data-tg-kind="folder"]').tap();
 await pick.getByRole('button',{name:'+ 새 폴더'}).tap();
 const box=view.locator('[data-tg-fedit]');await expect(box).toContainText("'가상지부 단톡' 방을 넣을 새 폴더");
 await box.locator('input').fill('가상 새폴더');await box.getByRole('button',{name:'저장'}).tap();
 await expect.poll(()=>rpc(f,'app_feed_folder_create').length).toBe(1);
 await expect.poll(()=>rpc(f,'app_feed_room_set').length).toBe(3);
 expect(rpc(f,'app_feed_room_set')[2].body.p_room_key).toBe('room-a');
 await expect(view.locator('.feed-chiprow .feed-chip')).toHaveText(['전체','가상 업무','가상 새폴더','+ 폴더','보관함 1']);
 expect(f.errors).toEqual([]);
});

test('폴더 만들기·이름 바꾸기·지우기: 이름 규칙 안내, 같은 이름 거절, 지워도 방은 전체에 남는다',async({page})=>{
 const f=await fixture(page);
 await openTelegram(page,390);
 const view=page.locator('#telegramView'),row=view.locator('.feed-chiprow'),box=view.locator('[data-tg-fedit]');
 await row.locator('[data-tg-folder-add]').tap();
 await box.locator('input').fill('   ');await box.getByRole('button',{name:'저장'}).tap();
 await expect(box).toContainText('폴더 이름을 적어 주세요.');
 await box.locator('input').fill('가'.repeat(21));await box.getByRole('button',{name:'저장'}).tap();
 await expect(box).toContainText('폴더 이름은 20자까지예요.');
 expect(rpc(f,'app_feed_folder_create')).toHaveLength(0);
 await box.locator('input').fill('가상 업무');await box.getByRole('button',{name:'저장'}).tap();
 await expect(box).toContainText('이미 있는 폴더 이름이에요.');
 await box.locator('input').fill('가상 모임');await box.getByRole('button',{name:'저장'}).tap();
 await expect(row.locator('.feed-chip')).toHaveText(['전체','가상 업무','가상 모임','+ 폴더','보관함 1']);
 await expect(row.locator('[data-tg-folder="' + (await row.locator('[data-tg-folder]').nth(2).getAttribute('data-tg-folder')) + '"]')).toHaveAttribute('aria-pressed','true');
 // 고른 폴더의 ⋯: 이름 바꾸기.
 await row.locator('[data-tg-folder-more]').tap();
 await page.locator('#tgFolderMenu').getByRole('button',{name:'이름 바꾸기'}).tap();
 await box.locator('input').fill('가상 모임2');await box.getByRole('button',{name:'저장'}).tap();
 await expect(row.getByRole('button',{name:'가상 모임2'})).toBeVisible();
 expect(rpc(f,'app_feed_folder_rename')).toHaveLength(1);
 // 지우기: 폴더만 지워지고 안에 있던 방은 전체에 그대로.
 await row.getByRole('button',{name:'가상 업무'}).tap();
 await row.locator('[data-tg-folder-more]').tap();
 await page.locator('#tgFolderMenu').getByRole('button',{name:/폴더 지우기/}).tap();
 await expect(box).toContainText('폴더만 지워져요');
 await box.getByRole('button',{name:'지우기'}).tap();
 await expect.poll(()=>rpc(f,'app_feed_folder_delete').length).toBe(1);
 await expect(row.locator('.feed-chip')).toHaveText(['전체','가상 모임2','+ 폴더','보관함 1']);
 expect(await keys(view)).toEqual([A6,B6,A5,B3]);
 expect(f.errors).toEqual([]);
});

test('보관함: 방 단위로 모아 보여 주고 [꺼내기]로 되돌리며, 보관한 방도 눌러 볼 수 있다',async({page})=>{
 const f=await fixture(page);
 await openTelegram(page,390);
 const view=page.locator('#telegramView');
 await view.locator('[data-tg-shelf="archive"]').tap();
 await expect(view.locator('.feed-head-title')).toHaveText('보관함 1');
 const row=view.locator('[data-tg-arow="-1001234567"]');await expect(row).toContainText('가상 채널');await expect(row.getByRole('button',{name:'꺼내기'})).toBeVisible();
 await expect(view.locator('[data-tg-archive-note]')).toContainText('수집·요약은 계속돼요');
 await row.locator('.feed-rdb').tap();
 await expect(page.locator('#tgDetail [data-tg-daybox]')).toBeVisible();
 await page.goBack();
 await row.getByRole('button',{name:'꺼내기'}).tap();
 await expect.poll(()=>rpc(f,'app_feed_room_set').length).toBe(1);
 expect(rpc(f,'app_feed_room_set')[0].body).toEqual({p_room_key:'-1001234567',p_folder:null,p_archived:false});
 await expect(view.locator('.feed-chiprow')).toBeVisible();
 expect(await keys(view)).toEqual([A6,C6,B6,A5,B3]);
 expect(f.errors).toEqual([]);
});

test('휴지통: 삭제한 날은 "삭제한 날"에 모이고 [되살리기]로 돌아오며 안내는 직접 비우기 전까지 남는다고 말한다',async({page})=>{
 const f=await fixture(page);
 await openTelegram(page,390);
 const view=page.locator('#telegramView');
 await drag(page,rd(view,A5),(await rd(view,A5).boundingBox()).width-50,-110);
 await wrapOf(view,A5).locator('[data-tg-kind="trash"]').tap();
 await expect.poll(()=>rpc(f,'app_feed_room_day_set').length).toBe(1);
 await view.locator('[data-tg-head-more]').tap();
 await page.locator('#tgMenu').getByRole('button',{name:'휴지통 1'}).tap();
 await expect(view.locator('[data-tg-trash-note]')).toContainText('직접 비우기 전까지 남아요');
 await expect(view.locator('[data-tg-tdrow]')).toContainText('10. 5. (월) 하루 전체');
 await view.locator('[data-tg-restore-day]').tap();
 await expect.poll(()=>rpc(f,'app_feed_room_day_set').length).toBe(2);
 expect(rpc(f,'app_feed_room_day_set')[1].body.p_state).toBe('active');
 await expect(view.locator('[data-tg-rd]').first()).toBeVisible();
 expect(await keys(view)).toEqual([A6,B6,A5,B3]);
 expect(f.errors).toEqual([]);
});

test('저장이 안 되면 화면을 바꾸지 않고 안내한다(폴더 기능 준비 전)',async({page})=>{
 const f=await fixture(page,{noFolderFns:true});
 await openTelegram(page,390);
 const view=page.locator('#telegramView');
 await drag(page,rd(view,A6),60,110);
 await wrapOf(view,A6).locator('[data-tg-kind="archive"]').tap();
 await expect(view.locator('[data-tg-status]')).toContainText('아직 준비되지 않았어요');
 expect(await keys(view)).toEqual([A6,B6,A5,B3]);
 expect(f.errors).toEqual([]);
});

test.describe('마우스 PC',()=>{test.use({hasTouch:false});
test('PC 1280: 줄 위에 올리면 ⋯, ⋯와 오른쪽 클릭 모두 [폴더로][보관][삭제], 보관하면 줄이 빠진다',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openTelegram(page,1280);
 const view=page.locator('#telegramView'),menu=page.locator('#tgRowMenu');
 const more=rd(view,A6).locator('[data-tg-rdmore]');
 await expect(more).toBeHidden();
 await rd(view,A6).hover();await expect(more).toBeVisible();
 await more.click();
 await expect(menu.locator('button')).toHaveText(['폴더로','보관','삭제 이 날 한 줄만']);
 await page.keyboard.press('Escape');
 await rd(view,A5).locator('.feed-rl').click({button:'right'});
 await expect(menu).toBeVisible();await expect(menu.locator('button')).toHaveText(['폴더로','보관','삭제 이 날 한 줄만']);
 await menu.getByRole('button',{name:'폴더로'}).click();
 await expect(page.locator('#tgFolderPick button')).toHaveText(['가상 업무','+ 새 폴더']);
 await page.keyboard.press('Escape');
 await rd(view,A6).hover();await more.click();
 await menu.getByRole('button',{name:'보관',exact:true}).click();
 await expect.poll(()=>rpc(f,'app_feed_room_set').length).toBe(1);
 expect(await keys(view)).toEqual([B6,B3]);
 expect(f.errors).toEqual([]);
});
});
