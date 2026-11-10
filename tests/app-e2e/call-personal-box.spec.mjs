// CALL-개인통화함 3단계 (docs/design/call-personal.md, B안): 통화 메뉴의 업무 통화함 · 개인 통화함, 확인할 통화(애매), 옮기기.
// 서버는 흉내(app_feed_items·app_call_personal·app_call_move·원장 처리 표)다. 이름·내용은 모두 지어낸 것이다.
import {test,expect} from '@playwright/test';
test.use({hasTouch:true});
import {ORG,W1,W2,P1,U1,U2,fixture,openCalls,tap} from './helpers/call-feed-server.mjs';
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [390,1280])test(`통화 ${width}: 업무 통화함 기본 + 맨 위 '개인 통화함 n ›' + 확인할 통화, 개인 통화함은 같은 목록·상세, 조직 연결·고정 없음`,async({page})=>{
 const f=await fixture(page,{width});
 await openCalls(page,width);
 const view=page.locator('#callsView');
 // 업무 통화함: 업무 통화만 날짜 목록에, 개인·애매는 목록에 섞이지 않는다.
 // 목록은 통화함 읽기가 끝난 뒤 그려지므로, 화면이 보인 직후 한 번 읽지 않고 목록이 맞을 때까지 기다린다(STAB-화면시험간헐).
 await expect.poll(()=>view.locator('.feed-rows:not(.feed-ask-rows) [data-cf-row]').evaluateAll(a=>a.map(e=>e.dataset.cfRow))).toEqual([W1,W2]);
 await expect(view.locator('[data-cf-box="personal"]')).toHaveText('개인 통화함 1 ›');
 await expect(view.locator('[data-cf-ask-head]')).toContainText('확인할 통화 2');
 await expect(view.locator('.feed-ask [data-cf-decide]')).toHaveText(['업무','개인','업무','개인']);
 await expect(view.locator('[data-cf-filtered]')).toHaveCount(0);
 expect(await noWideScroll(page)).toBe(true);
 // 개인 통화함: 같은 목록 모양, 개인 통화만, 맨 위 설명 두 줄 없음.
 await tap(page,view.locator('[data-cf-box="personal"]'),width);
 await expect(view.locator('[data-cf-pcount]')).toHaveText('1건');
 // S53-11: 개인 통화함 머리 줄에도 같은 [최신화](같은 통화 수집기).
 await expect(view.locator('.feed-head [data-cf-pull]')).toHaveText('최신화');
 expect(await view.locator('[data-cf-row]').evaluateAll(a=>a.map(e=>e.dataset.cfRow))).toEqual([P1]);
 await expect(view.locator('[data-cf-note]')).toHaveCount(0);
 await expect(view.locator('[data-cf-legacy]')).toHaveCount(0);
 await expect(view.locator('[data-cf-ask-head]')).toHaveCount(0);
 expect(await noWideScroll(page)).toBe(true);
 await tap(page,view.locator(`[data-cf-row="${P1}"]`),width);
 const detail=view.locator('#cfDetail');
 await expect(detail.locator('[data-cf-meta]')).toContainText('가상 친구 · 개인');
 await expect(detail.locator('[data-cf-points] li')).toHaveText(['토요일 저녁 7시']);
 await expect(detail.locator('[data-cf-link-pick],[data-cf-link-text]')).toHaveCount(0);
 // 전문(사본)이 도착하면 상세를 한 번 다시 그린다. 그 뒤에 누른다.
 await expect(detail.locator('[data-cf-script],[data-cf-raw-empty]')).toHaveCount(1);
 await tap(page,detail.locator('[data-cf-more]'),width);
 const menu=page.locator('#cfMenu');await expect(menu).toBeVisible();
 await expect(menu.locator('button')).toHaveText([/^제목 바꾸기/,'이름 수정','요약 수정','업무 통화로 옮기기','요약 복사','삭제 목록에서만']);
 await page.keyboard.press('Escape');
 // 폰: 뒤로가기 한 칸 = 개인 통화함 목록, 한 칸 더 = 업무 통화함.
 if(width<761){
  await page.goBack();await expect(view.locator('#cfList')).toBeVisible();await expect(view.locator('[data-cf-pcount]')).toBeVisible();
  await page.goBack();await expect(view.locator('[data-cf-box="personal"]')).toBeVisible();
 }else{await tap(page,view.locator('[data-cf-box="work"]'),width);await expect(view.locator('[data-cf-box="personal"]')).toBeVisible();}
 expect(f.moves).toEqual([]);
 expect(f.errors).toEqual([]);
});

test('통화 1280: 개인 통화를 업무 통화로 옮기기(⋯ 메뉴) — app_call_move 한 번, 목록이 두 함 모두 바뀜, 되돌리기',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await view.locator('[data-cf-box="personal"]').click();
 await view.locator(`[data-cf-row="${P1}"]`).click();
 await expect(view.locator('#cfDetail [data-cf-script],#cfDetail [data-cf-raw-empty]')).toHaveCount(1);
 await view.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'업무 통화로 옮기기'}).click();
 await expect.poll(()=>f.moves).toEqual([{p_id:P1,p_to:'work'}]);
 await expect(view.locator('[data-cf-empty="personal"][data-wait-empty]')).toHaveText('없음');
 await expect(view.locator('[data-cf-status]')).toContainText('업무 통화로 옮겼어요.');
 await view.locator('[data-cf-undo]').click();
 await expect.poll(()=>f.moves.length).toBe(2);
 expect(f.moves[1]).toEqual({p_id:P1,p_to:'personal'});
 await expect(view.locator(`[data-cf-row="${P1}"]`)).toHaveCount(1);
 await view.locator('[data-cf-box="work"]').click();
 await expect(view.locator('[data-cf-box="personal"]')).toHaveText('개인 통화함 1 ›');
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`통화 ${width}: 확인할 통화에서 바로 [업무][개인]으로 정한다`,async({page})=>{
 const f=await fixture(page,{width});
 await openCalls(page,width);
 const view=page.locator('#callsView');
 await tap(page,view.locator(`[data-cf-item="${U1}"] [data-cf-decide="personal"]`),width);
 await expect.poll(()=>f.moves).toEqual([{p_id:U1,p_to:'personal'}]);
 await expect(view.locator('[data-cf-ask-head]')).toContainText('확인할 통화 1');
 await expect(view.locator('[data-cf-box="personal"]')).toHaveText('개인 통화함 2 ›');
 await expect(view.locator('[data-cf-status]')).toContainText('개인 통화로 정했어요.');
 await tap(page,view.locator(`[data-cf-item="${U2}"] [data-cf-decide="work"]`),width);
 await expect.poll(()=>f.moves.length).toBe(2);
 expect(f.moves[1]).toEqual({p_id:U2,p_to:'work'});
 await expect(view.locator('[data-cf-ask-head]')).toHaveCount(0);
 await expect(view.locator(`[data-cf-row="${U2}"]`)).toHaveCount(1);
 expect(f.errors).toEqual([]);
});

test('통화 1280: 업무→개인은 원장에 이미 쓰인 통화면 먼저 안내하고, [개인 통화로 옮기기]를 눌러야 옮긴다. 안 쓰였고 연결도 없으면 바로 옮긴다',async({page})=>{
 const f=await fixture(page,{width:1280,ledgerSeen:[W1]});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await view.locator(`[data-cf-row="${W1}"]`).click();
 await expect(view.locator('#cfDetail [data-cf-script],#cfDetail [data-cf-raw-empty]')).toHaveCount(1);
 await view.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'개인 통화로 옮기기'}).click();
 const warn=view.locator('#cfDetail [data-cf-confirm]');
 await expect(warn).toContainText('원장 기록은 삭제되지 않아요');
 await expect(warn).toContainText('고정과 조직 연결은');
 expect(f.moves).toEqual([]);
 await warn.getByRole('button',{name:'취소'}).click();
 await expect(warn).toHaveCount(0);expect(f.moves).toEqual([]);
 await view.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'개인 통화로 옮기기'}).click();
 await view.locator('#cfDetail [data-cf-confirm-go]').click();
 await expect.poll(()=>f.moves).toEqual([{p_id:W1,p_to:'personal'}]);
 await expect(view.locator(`[data-cf-row="${W1}"]`)).toHaveCount(0);
 await expect(view.locator('[data-cf-box="personal"]')).toHaveText('개인 통화함 2 ›');
 // 연결도 원장 흔적도 없는 통화는 묻지 않고 옮긴다.
 await view.locator(`[data-cf-row="${W2}"]`).click();
 await expect(view.locator('#cfDetail [data-cf-script],#cfDetail [data-cf-raw-empty]')).toHaveCount(1);
 await view.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'개인 통화로 옮기기'}).click();
 await expect.poll(()=>f.moves.length).toBe(2);
 expect(f.moves[1]).toEqual({p_id:W2,p_to:'personal'});
 expect(f.errors).toEqual([]);
});

test('통화 1280: 목록 줄을 오른쪽 클릭하면 같은 메뉴가 누른 자리에서 열리고 옮길 수 있다',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await view.locator(`[data-cf-row="${W2}"]`).click({button:'right'});
 const menu=page.locator('#cfMenu');await expect(menu).toBeVisible();
 await expect(menu.locator('button')).toHaveText([/^제목 바꾸기/,'조직·이름 수정','요약 수정','고정','요약 복사','개인 통화로 옮기기','삭제 목록에서만']);
 await menu.getByRole('button',{name:'개인 통화로 옮기기'}).click();
 await expect.poll(()=>f.moves).toEqual([{p_id:W2,p_to:'personal'}]);
 expect(f.errors).toEqual([]);
});

test('통화 390: 줄을 길게 누르면 같은 메뉴가 열린다',async({page})=>{
 const f=await fixture(page,{width:390});
 await openCalls(page,390);
 const view=page.locator('#callsView');
 const row=view.locator(`[data-cf-row="${W2}"]`);await row.scrollIntoViewIfNeeded();
 const b=await row.boundingBox();
 const pt={pointerType:'touch',clientX:b.x+40,clientY:b.y+b.height/2,bubbles:true};
 await row.dispatchEvent('pointerdown',pt);
 await page.waitForTimeout(700);
 // 메뉴는 꾹 누른 채가 아니라 움직이지 않고 손을 뗄 때 열린다(feed-hold.js, 꾹 누른 뒤 밀기를 끊지 않음).
 const menu=page.locator('#cfMenu');await expect(menu).toBeHidden();
 await row.dispatchEvent('pointerup',pt);
 await expect(menu).toBeVisible();
 await expect(menu.getByRole('button',{name:'개인 통화로 옮기기'})).toBeVisible();
 expect(f.moves).toEqual([]);
 expect(f.errors).toEqual([]);
});

test('통화 390: 개인 표가 아직 없으면 업무 통화는 그대로 보이고 개인 통화함 칩만 없다',async({page})=>{
 const f=await fixture(page,{width:390,personalMissing:true});
 await openCalls(page,390);
 const view=page.locator('#callsView');
 await expect(view.locator('[data-cf-row]')).toHaveCount(2);
 await expect(view.locator('[data-cf-box]')).toHaveCount(0);
 await expect(view.locator('[data-cf-ask-head]')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});

test('통화 1280: 개인→업무로 옮기면 그 한 건만 call_refill로 다시 채우고(제목·조직·상대), 핵심내용은 그대로, 안내 줄에 알린다',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await view.locator('[data-cf-box="personal"]').click();
 await view.locator(`[data-cf-row="${P1}"]`).click();
 await expect(view.locator('#cfDetail [data-cf-script],#cfDetail [data-cf-raw-empty]')).toHaveCount(1);
 await view.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'업무 통화로 옮기기'}).click();
 await expect.poll(()=>f.moves).toEqual([{p_id:P1,p_to:'work'}]);
 await expect.poll(()=>f.refills).toEqual([{kind:'call_refill',id:P1}]);
 // 안내 줄은 옮긴 그 자리(개인함)에서 보인다. 통화함을 바꾸면 안내 줄은 비워지는 것이 화면 규칙이므로(setBox) 바꾸기 전에 확인한다.
 await expect(view.locator('[data-cf-status]')).toContainText('제목·조직·상대를 채웠어요');
 await view.locator('[data-cf-box="work"]').click();
 const row=view.locator(`[data-cf-row="${P1}"]`);
 await expect(row.locator('.feed-title')).toContainText('임금교섭 3차 일정 협의');
 await expect(row.locator('.feed-org')).toHaveText('김가상');// CALL-상대표시정리 ①: 목록 꼬리표는 이름만(직책 빼고), 이름을 모르면 조직
 await row.click();
 await expect(view.locator('#cfDetail [data-cf-points] li')).toHaveText(['토요일 저녁 7시']);
 expect(f.refills.length).toBe(1);
 expect(f.errors).toEqual([]);
});

test('통화 1280: 다시 채우기가 실패하면 통화는 업무함에 옛 값 그대로 있고 한 줄로만 알린다. 업무→개인·확인할 통화 "개인"은 AI를 부르지 않는다',async({page})=>{
 const f=await fixture(page,{width:1280,refill:'fail'});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await view.locator('[data-cf-box="personal"]').click();
 await view.locator(`[data-cf-row="${P1}"]`).click();
 await expect(view.locator('#cfDetail [data-cf-script],#cfDetail [data-cf-raw-empty]')).toHaveCount(1);
 await view.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'업무 통화로 옮기기'}).click();
 await expect.poll(()=>f.refills.length).toBe(1);
 await expect(view.locator('[data-cf-status]')).toContainText('채우지 못해 옛 값 그대로예요');
 await view.locator('[data-cf-box="work"]').click();
 await expect(view.locator(`[data-cf-row="${P1}"] .feed-title`)).toContainText('가상 저녁 약속 정하기');
 // 개인으로 보내는 길은 AI를 부르지 않는다.
 await view.locator(`[data-cf-row="${W2}"]`).click({button:'right'});
 await page.locator('#cfMenu').getByRole('button',{name:'개인 통화로 옮기기'}).click();
 await expect.poll(()=>f.moves.length).toBe(2);
 await tap(page,view.locator(`[data-cf-item="${U1}"] [data-cf-decide="personal"]`),1280);
 await expect.poll(()=>f.moves.length).toBe(3);
 expect(f.refills.length).toBe(1);
 expect(f.errors).toEqual([]);
});
