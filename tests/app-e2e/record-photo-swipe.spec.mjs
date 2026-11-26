import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// PHOTO-크게보기넘기기(S71-72, 사용자 2026-11-26 "그림이 두장 있을 때 한장 누르면 커지거든 거기서 스와이프 하면 다음 그림으로 가게"):
// 조직 관리 › 한 조직 기록 줄의 사진을 눌러 크게 보면, 같은 기록 줄에 붙은 사진끼리 넘긴다(공용 크게 보기 photo-view.js의 넘기기 그대로).
// 폰: 한 손가락 좌우 밀기 · 위 '1/2' · 끝에서 안 넘어감 · 두 손가락(확대) 중 안 넘김 · 화면 끝에서 시작한 밀기 안 넘김 · 뒤로가기 = 닫기.
// PC: ←/→ 키와 양옆 ‹ ›. 자료는 모두 가짜(네트워크 없음).
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const N1='55555555-0000-4000-8000-000000000011',L1='66666666-0000-4000-8000-000000000011';
const img=n=>({drive_file_id:'drvS'+n,file_name:`가짜 현장 사진 ${n}.png`,mime_type:'image/png',size_bytes:6});
const thisYear=new Date().getUTCFullYear();

async function fixture(page,width){
 await page.setViewportSize({width,height:width>900?800:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const note={id:N1,workspace_id:'w',occurred_at:`${thisYear}-11-25T00:35:00Z`,raw_text:'',kind:'basket',title:null,attachments:[img(1),img(2)]};
 const links=[{id:L1,workspace_id:'w',summary:'사진 2장',note_id:N1,organization_id:'o',project_id:null,status:'confirmed',origin:'record_input'}];
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>r.request().method()==='GET'?r.fulfill({json:links.map(l=>({...l,note:structuredClone(note)}))}):r.fallback());
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',r=>r.request().method()==='GET'?r.fulfill({status:200,contentType:'image/png',body:PNG}):r.fallback());
 await clickView(page,'team');await page.locator('[data-so-org="o"]').first().click();
 await expect(page.locator('#wdModal')).toBeVisible();
 const row=page.locator(`#wdUpdates [data-basket-link="${L1}"]`);
 await expect(row.locator('[data-record-photo]')).toHaveCount(2);
 return {errors,row};
}
const view=page=>page.locator('[data-basket-photo-view]');
const count=page=>view(page).locator('.basket-photo-count');
const nameOf=page=>view(page).locator('.basket-photo-name');
// 넘김은 사진이 밀려 나간 뒤(약 0.14초) 바뀐다 — '안 넘어감'은 사진이 제자리(transform 없음)로 멈춘 뒤에 번호를 본다.
const settled=page=>expect.poll(()=>view(page).locator('.basket-photo-stage .diary-photo').evaluate(el=>el.style.transform)).toBe('');
// CDP 터치: 칸 가운데(또는 x 지정, low = ‹ › 단추 아래 높이)에서 dx만큼 한 손가락(또는 두 손가락) 밀기.
async function swipe(page,dx,{x=null,fingers=1,low=false}={}){
 const b=await view(page).locator('.basket-photo-stage').boundingBox();
 const x0=x??Math.round(b.x+b.width/2),y0=Math.round(b.y+b.height*(low?0.8:0.5));
 const pts=k=>Array.from({length:fingers},(_,i)=>({x:Math.round(x0+dx*k/8),y:y0+i*60,id:i}));
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pts(0)});
 for(let k=1;k<=8;k++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pts(k)});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await cdp.detach();
}

test('폰 390: 사진 두 장 기록 — 첫 장 크게 → 왼쪽 밀기 2/2 → 오른쪽 밀기 1/2, 확대·화면 끝 밀기는 안 넘김, 뒤로가기로 닫힘',async({page})=>{
 const f=await fixture(page,390);
 await f.row.locator('[data-record-photo]').first().click();
 await expect(view(page)).toBeVisible();
 await expect(count(page)).toHaveText('1/2');
 await expect(nameOf(page)).toHaveText('가짜 현장 사진 1.png');
 await swipe(page,150);await settled(page);await expect(count(page)).toHaveText('1/2'); // 첫 장에서 오른쪽: 앞 사진 없음
 await swipe(page,-150);await expect(count(page)).toHaveText('2/2');
 await expect(nameOf(page)).toHaveText('가짜 현장 사진 2.png');
 await swipe(page,-150);await settled(page);await expect(count(page)).toHaveText('2/2'); // 끝에서는 안 넘어감
 await swipe(page,150);await settled(page);await expect(count(page)).toHaveText('1/2');
 await swipe(page,-150,{fingers:2});await settled(page);await expect(count(page)).toHaveText('1/2'); // 두 손가락(확대) 중에는 넘기지 않는다
 await swipe(page,-150,{low:true});await expect(count(page)).toHaveText('2/2'); // ‹ › 아래 높이에서도 넘김은 그대로
 await swipe(page,150,{x:4,low:true});await settled(page);await expect(count(page)).toHaveText('2/2'); // 화면 왼쪽 끝에서 시작 = 폰 뒤로가기 몫, 넘기지 않음
 await expect(view(page)).toBeVisible();
 await page.goBack();
 await expect(view(page)).toHaveCount(0);
 await expect(page.locator('#wdModal')).toBeVisible(); // 뒤로가기는 크게 보기만 닫는다
 expect(f.errors).toEqual([]);
});

test('PC 1280: 사진 두 장 기록 — ←/→ 키와 양옆 ‹ ›로 넘기고, 끝에서는 잠김',async({page})=>{
 const f=await fixture(page,1280);
 await f.row.locator('[data-record-photo]').nth(1).click();
 await expect(count(page)).toHaveText('2/2');
 const prev=view(page).locator('.basket-photo-step[data-dir="-1"]'),next=view(page).locator('.basket-photo-step[data-dir="1"]');
 await expect(prev).toBeVisible();await expect(next).toBeDisabled();
 await page.keyboard.press('ArrowLeft');await expect(count(page)).toHaveText('1/2');
 await expect(prev).toBeDisabled();
 await page.keyboard.press('ArrowRight');await expect(count(page)).toHaveText('2/2');
 await prev.click();await expect(count(page)).toHaveText('1/2');
 await next.click();await expect(count(page)).toHaveText('2/2');
 await page.keyboard.press('Escape');
 await expect(view(page)).toHaveCount(0);
 expect(f.errors).toEqual([]);
});
