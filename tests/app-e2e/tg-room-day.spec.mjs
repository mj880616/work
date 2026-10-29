// TG-방날짜묶기 4-가: 텔레그램 소식 = 날짜 아래 "방 한 줄" 목록 → 방 상세(요약 + 그날 소식, ‹ 날짜 ›, [텔레그램에서 열기]). 서버는 흉내(helpers/tg-room-day-server.mjs).
// 방·사람·내용은 모두 지어낸 것이다. 시계는 2026-10-06 10:00(한국)으로 고정.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {installTgServer,telegramRows,T} from './helpers/tg-room-day-server.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const A6='room-a|2026-10-06',B6='room-b|2026-10-06',C6='-1001234567|2026-10-06',A5='room-a|2026-10-05',B3='room-b|2026-10-03';

async function fixture(page,{width=1280,missing=false,empty=false}={}){
 await page.setViewportSize({width,height:860});
 const items=telegramRows(),errors=[],writes=[],calls=[];let server;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource/.test(e.text()))errors.push(e.text());});
 await page.addInitScript(()=>{window.__opened=[];window.open=u=>{window.__opened.push(String(u));return null;};});
 await openHome(page,{beforeLoad:async()=>{
  for(const path of ['app_tg_senders','app_tg_day_senders'])await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+path,r=>r.fulfill({json:[]}));
  server=await installTgServer(page,{items,writes,calls,missing,empty});
 }});
 return {items,errors,writes,calls,server};
}
async function openMenu(page,width,label){
 if(width>=1024){const item=page.locator('#appView>.app-nav').getByRole('button',{name:label,exact:true});await expect(item).toBeVisible();await item.click();}
 else{await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu nav').getByRole('button',{name:label,exact:true}).click();}
}
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();}
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const rd=(view,key)=>view.locator(`[data-tg-rd="${key}"]`);

test('텔레그램 390: 날짜 아래 방 한 줄(방 이름·그날 한 줄·소식 n·원문 n), 소식 카드는 늘어놓지 않음, 요약이 없는 날은 제목 모음',async({page})=>{
 const f=await fixture(page,{width:390});
 await openMenu(page,390,'텔레그램 소식');
 const view=page.locator('#telegramView');await expect(view).toBeVisible();await expect(page).toHaveURL(/view=telegram/);
 await expect(view.locator('[data-tg-today]')).toHaveText('오늘 412개 중 중요한 5개 · 방 3곳');
 await expect(view.locator('[data-tg-day]')).toHaveText(['10. 6. (화)','10. 5. (월)','10. 3. (토)']);
 await expect(view.locator('[data-tg-rd]')).toHaveCount(5);
 expect(await view.locator('[data-tg-rd]').evaluateAll(els=>els.map(e=>e.dataset.tgRd))).toEqual([A6,C6,B6,A5,B3]);
 await expect(view.locator('[data-tg-item]')).toHaveCount(0);
 const a=rd(view,A6);
 await expect(a.locator('.feed-rn')).toHaveText('가상지부 단톡');await expect(a.locator('.feed-rl')).toHaveText('교섭 일정 연기와 자료 요청');
 await expect(a.locator('.feed-ft span:not([data-tg-mark])')).toHaveText(['소식 2','원문 5']);
 // TG-요청강조: 일정 관련 소식이 있는 줄은 회색 꼬리표(다음 주 화요일로 미뤄짐).
 await expect(a.locator('.feed-ft [data-tg-mark]')).toHaveText('일정');
 // 요약이 없는 옛 날: 그날 소식 제목을 모아 한 줄로(AI 호출 없음).
 await expect(rd(view,B3).locator('.feed-rl')).toHaveText('옛 안건 정리 · 옛 일정 확인');
 await expect(rd(view,B3).locator('.feed-ft span:not([data-tg-mark])')).toHaveText(['소식 2','원문 3']);
 // 14일씩: 첫 읽기는 9/23~10/6을 7일씩 두 번.
 expect(f.calls.map(c=>[c.p_from,c.p_to]).sort()).toEqual([['2026-09-23','2026-09-29'],['2026-09-30','2026-10-06']]);
 await expect(view.locator('.feed-pinbar')).toContainText('고정 1');
 expect(await noWideScroll(page)).toBe(true);
 // 이전 날 더 보기 → 9/9~9/22를 더 읽고 9/20 줄이 나온다.
 await tap(page,view.locator('[data-tg-older]'),390);
 await expect(view.locator('[data-tg-rd]')).toHaveCount(6);
 await expect(view.locator('[data-tg-day]').last()).toHaveText('9. 20. (일)');
 expect(f.errors).toEqual([]);
});

test('텔레그램 390: 방 상세 = 요약 4줄 + 그날 소식, ‹ 날짜 ›로 앞뒤 날, 이전 날을 더 읽어 찾고, 끝이면 막힘, 뒤로가기는 목록',async({page})=>{
 const f=await fixture(page,{width:390});
 await openMenu(page,390,'텔레그램 소식');
 const view=page.locator('#telegramView');
 await tap(page,rd(view,A6).locator('.feed-rdb'),390);
 const detail=view.locator('#tgDetail');await expect(detail).toBeVisible();await expect(view.locator('#tgList')).toBeHidden();
 await expect(detail.locator('.feed-detail-name')).toHaveText('가상지부 단톡');
 await expect(detail.locator('[data-tg-navday]')).toHaveText('10. 6. (화)');
 await expect(detail.locator('[data-tg-nav="next"]')).toBeDisabled();await expect(detail.locator('[data-tg-nav="prev"]')).toBeEnabled();
 // 묶음 요약을 첫 메시지 시각 순으로 이어 붙인다(이른 묶음 3줄 + 늦은 묶음 1줄).
 const box=detail.locator('[data-tg-daybox]');await expect(box).toHaveAttribute('data-kind','ai');await expect(box.locator('.feed-k')).toContainText('오늘 요약');
 await expect(box.locator('.feed-dl')).toHaveText(['교섭이 다음 주 화요일로 미뤄졌다.','서면 회신은 월요일까지다.','담당은 아직 정해지지 않았다.','오후에 자료집 초안 공유를 요청받았다.']);
 await expect(detail.locator('[data-tg-old]')).toHaveCount(0);
 // 그날 소식: 시각 오름차순, 원문 n, ⋯만(밀기 없음).
 await expect(detail.locator('.feed-di .feed-at')).toHaveText(['09:31','13:10']);
 await expect(detail.locator('.feed-di .feed-ft').first()).toContainText('원문 3');
 await expect(detail.locator('.feed-di [data-tg-more]')).toHaveCount(2);
 await expect(detail.locator('.feed-swipe,[data-tg-act-btn]')).toHaveCount(0);
 // 보낸 사람 이름(#1291)은 그대로: 원문을 펼치면 A·B 줄.
 await tap(page,detail.locator(`[data-tg-open="${T.a1}"]`),390);
 await expect(detail.locator('[data-tg-raw] .feed-rm')).toHaveCount(3);
 expect(await noWideScroll(page)).toBe(true);
 // ‹: 10/5
 await tap(page,detail.locator('[data-tg-nav="prev"]'),390);
 await expect(detail.locator('[data-tg-navday]')).toHaveText('10. 5. (월)');
 await expect(box.locator('.feed-k')).toContainText('그날 요약');
 await expect(box.locator('.feed-dl')).toHaveText(['공동 기자회견이 10월 8일 11시로 확정됐다.','장소는 따로 공지한다.','참석자는 아직 모른다.']);
 await expect(detail.locator('.feed-di')).toHaveCount(1);
 await expect(detail.locator('[data-tg-nav="next"]')).toBeEnabled();
 // ‹ 한 번 더: 읽어 둔 범위 밖(9/20)이라 이전 창을 읽어 찾는다. 요약이 없는 옛 날은 제목 모음 + "AI 요약 이전 날".
 await tap(page,detail.locator('[data-tg-nav="prev"]'),390);
 await expect(detail.locator('[data-tg-navday]')).toHaveText('9. 20. (일)');
 await expect(box).toHaveAttribute('data-kind','titles');await expect(detail.locator('[data-tg-old]')).toHaveText('AI 요약 이전 날');
 await expect(box.locator('.feed-dl')).toHaveText(['아주 옛 공지']);
 expect(f.calls.some(c=>c.p_from<'2026-09-23')).toBe(true);
 // 더 오래된 날이 없으면 끝까지 찾아 보고 막힌다.
 await tap(page,detail.locator('[data-tg-nav="prev"]'),390);
 await expect(detail.locator('[data-tg-nav="prev"]')).toBeDisabled();
 await expect(detail.locator('[data-tg-detail-status]')).toHaveText('더 이전 소식이 없어요.');
 await tap(page,detail.locator('[data-tg-nav="next"]'),390);
 await expect(detail.locator('[data-tg-navday]')).toHaveText('10. 5. (월)');
 // 폰 뒤로가기 한 칸 = 목록(날짜를 옮겨 다닌 것은 쌓이지 않는다).
 await page.goBack();await expect(view.locator('#tgList')).toBeVisible();await expect(detail).toBeHidden();await expect(page).toHaveURL(/view=telegram/);
 expect(f.errors).toEqual([]);
});

test('텔레그램 390: [텔레그램에서 열기] = 방 주소 → 번호 링크 → 방 이름 복사 + 안내 한 줄',async({page})=>{
 const f=await fixture(page,{width:390});
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await openMenu(page,390,'텔레그램 소식');
 const view=page.locator('#telegramView'),detail=view.locator('#tgDetail');
 // 단체방: @아이디가 있으면 방 주소(새 탭, 열린 창 참조 끊기).
 await tap(page,rd(view,A6).locator('.feed-rdb'),390);
 const link=detail.locator('[data-tg-openlink]');
 await expect(link).toHaveText('텔레그램에서 열기');await expect(link).toHaveAttribute('href','https://t.me/fake_room_a');
 await expect(link).toHaveAttribute('target','_blank');expect(await link.getAttribute('rel')).toMatch(/noopener/);
 await page.goBack();
 // 아이디 없는 채널(-100…): 번호 링크, 그날 첫 메시지 번호는 요약 묶음에서.
 await tap(page,rd(view,C6).locator('.feed-rdb'),390);
 await expect(detail.locator('[data-tg-openlink]')).toHaveAttribute('href','https://t.me/c/1234567/77');
 await page.goBack();
 // 아이디도 번호 링크도 못 만드는 방: 앱 첫 화면을 열고 방 이름을 복사, 안내 한 줄.
 await tap(page,rd(view,B6).locator('.feed-rdb'),390);
 await expect(detail.locator('[data-tg-openlink]')).toHaveCount(0);
 await expect(detail.locator('[data-tg-note]')).toHaveCount(0);
 await tap(page,detail.locator('[data-tg-opencopy]'),390);
 await expect(detail.locator('[data-tg-note]')).toHaveText('방 이름을 복사했어요. 텔레그램 첫 화면에서 검색 칸에 붙여 넣으세요.');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('예시 간부방');
 expect(await page.evaluate(()=>window.__opened)).toEqual(['tg://']);
 expect(f.errors).toEqual([]);
});

test('텔레그램 390: 소식 ⋯ 메뉴(고정·요약 복사·요약 고치기·조직 연결·삭제), 삭제는 한 줄 되돌리기, 고정은 서버 저장',async({page})=>{
 const f=await fixture(page,{width:390});
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await openMenu(page,390,'텔레그램 소식');
 const view=page.locator('#telegramView'),detail=view.locator('#tgDetail');
 await tap(page,rd(view,A6).locator('.feed-rdb'),390);
 await tap(page,detail.locator(`[data-tg-more="${T.a1}"]`),390);
 const menu=page.locator('#tgMenu');await expect(menu.locator('button')).toHaveText(['고정','요약 복사','요약 고치기','조직 연결','삭제']);
 await tap(page,menu.getByRole('button',{name:'고정',exact:true}),390);
 await expect.poll(()=>f.writes.filter(w=>w.id===T.a1&&w.body.pinned_at).length).toBe(1);
 await expect(detail.locator(`[data-tg-di="${T.a1}"] .feed-pin`)).toHaveText('고정');
 await tap(page,detail.locator(`[data-tg-more="${T.a1}"]`),390);
 await tap(page,menu.getByRole('button',{name:'요약 복사',exact:true}),390);
 await expect(detail.locator('[data-tg-detail-status]')).toHaveText('복사했어요');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('가상지부 단톡\n10. 6. (화) 09:31\n\n가상 교섭 다음 주 화요일로 미뤄짐. 서면 회신 월요일까지.');
 // 삭제: 상세에서 빠지고 서버에 휴지통 저장, 되돌리기 줄은 하단바 위.
 await tap(page,detail.locator(`[data-tg-more="${T.a2}"]`),390);
 await tap(page,menu.getByRole('button',{name:'삭제',exact:true}),390);
 await expect.poll(()=>f.writes.filter(w=>w.id===T.a2&&w.body.state==='trashed').length).toBe(1);
 await expect(detail.locator('.feed-di')).toHaveCount(1);
 const bar=view.locator('[data-tg-undobar]');await expect(bar).toContainText('삭제했어요');
 const tabs=await page.locator('.mobile-tabs').boundingBox(),b=await bar.boundingBox();
 expect(tabs&&b).toBeTruthy();expect(b.y+b.height).toBeLessThanOrEqual(tabs.y+1);
 await tap(page,bar.locator('[data-tg-undo]'),390);
 await expect.poll(()=>f.writes.filter(w=>w.id===T.a2&&w.body.state==='active').length).toBe(1);
 await expect(detail.locator('.feed-di')).toHaveCount(2);
 // 목록의 소식 수도 되돌아와 있다.
 await page.goBack();await expect(rd(view,A6).locator('.feed-ft span').first()).toHaveText('소식 2');
 expect(f.errors).toEqual([]);
});

test.describe('마우스 PC',()=>{test.use({hasTouch:false});
test('텔레그램 1280: 목록 1/3 · 상세 2/3, 고른 줄 표시, 소식 ⋯ 오른쪽 클릭, 삭제 → 머리줄 ⋯ → 휴지통에서 되살리기',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openMenu(page,1280,'텔레그램 소식');
 const view=page.locator('#telegramView'),list=view.locator('#tgList'),detail=view.locator('#tgDetail');
 // UI-전수디자인점검 F23: 고른 방이 없으면 안내문 상자 대신 오른쪽 칸이 없고 목록이 두 칸을 다 쓴다.
 await expect(detail).toBeHidden();{const s=await view.locator('#tgSplit').boundingBox(),w=await list.boundingBox();expect(w.width).toBeGreaterThan(s.width-2);}
 await rd(view,A6).locator('.feed-rdb').click();
 await expect(list).toBeVisible();await expect(detail.locator('[data-tg-daybox]')).toBeVisible();
 await expect(rd(view,A6)).toHaveClass(/is-selected/);
 await expect(detail.locator('[data-tg-back]')).toHaveCount(0);
 const l=await list.boundingBox(),d=await detail.boundingBox();expect(l.x+l.width).toBeLessThanOrEqual(d.x+1);expect(l.width).toBeLessThan(d.width);
 // 소식 줄에서 오른쪽 클릭 = 그 소식의 ⋯ 메뉴가 누른 자리에.
 await detail.locator(`[data-tg-di="${T.a2}"] .feed-tx`).click({button:'right'});
 const menu=page.locator('#tgMenu');await expect(menu).toBeVisible();await expect(menu.locator('button')).toHaveText(['고정','요약 복사','요약 고치기','조직 연결','삭제']);
 await menu.getByRole('button',{name:'삭제',exact:true}).click();
 await expect.poll(()=>f.writes.filter(w=>w.id===T.a2&&w.body.state==='trashed').length).toBe(1);
 await expect(detail.locator('.feed-di')).toHaveCount(1);
 // 머리줄 ⋯ → 휴지통 1: 안내 문구는 "직접 비우기 전까지 남아요"(자동으로 비우지 않음).
 await list.locator('[data-tg-head-more]').click();
 await expect(page.locator('#tgMenu button')).toHaveText(['보낸 사람 이름','휴지통 1']);
 await page.locator('#tgMenu').getByRole('button',{name:'휴지통 1'}).click();
 await expect(list.locator('.feed-head-title')).toHaveText('휴지통 1');
 await expect(list.locator('[data-tg-trash-note]')).toContainText('직접 비우기 전까지 남아요');
 await expect(list.locator('[data-tg-trow]')).toHaveCount(1);
 await expect(list.locator('[data-tg-trow]')).toContainText('자료집 초안 공유 요청.');
 await list.locator(`[data-tg-restore="${T.a2}"]`).click();
 await expect.poll(()=>f.writes.filter(w=>w.id===T.a2&&w.body.state==='active').length).toBe(1);
 await expect(list.locator('[data-tg-shelf-back]')).toHaveCount(0);
 await expect(rd(view,A6).locator('.feed-ft span').first()).toHaveText('소식 2');
 expect(f.errors).toEqual([]);
});
});
