import {test,expect} from '@playwright/test';
import {appOrigin} from './helpers/test-origin.mjs';
// ORG-빠진일2차 5번(S59-3 PR B, 요청함 11/11 · #2347 '범위 밖 발견'): PC 사진 크게 보기에서 맨 끝·맨 처음 사진이라 ›/‹ 단추가 잠기면 ←/→/Esc 키가 안 먹던 고장.
// 까닭: 방금 누른 ›(‹) 단추가 잠기면서 키보드 초점을 쥔 채 못 쓰게 되어, 키 입력이 보기 창(keydown을 받는 곳)까지 오지 않았다.
// 사진 크게 보기 부품은 app/photo-view.js 하나이고 사진·잊지 말기(노트 사진)·사업 보고 사진 줄이 모두 이 껍데기를 쓴다 — 그래서 껍데기에서 고치고, 세 갈래를 다 시험한다.
// 사진은 모두 합성 그림(단색 SVG), 서버 요청 없음. 사진 파일: PHOTO_KEYS_SHOTS 폴더가 있으면 남긴다.
const SHOTS=process.env.PHOTO_KEYS_SHOTS||'';
const CSS=['theme-tokens','base-ui','desktop-ui','ui-standard'];
const svg=(n,color)=>`data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" fill="${color}"/><text x="320" y="225" font-size="44" text-anchor="middle" fill="#fff" font-family="sans-serif">합성 사진 ${n}</text></svg>`)}`;
async function mount(page,width,mode){
 await page.setViewportSize({width,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const blank=`${appOrigin}/__photo-view-blank__.html`;
 await page.route(blank,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${CSS.map(n=>`<link rel="stylesheet" href="/app/${n}.css">`).join('')}</head><body><main id="appView" class="view-panel kptu-ui-ready"><button id="opener" type="button">사진 열기</button></main></body></html>`}));
 await page.goto(blank);
 await page.evaluate(async ({mode,colors,urls})=>{
  const mod=await import('/app/photo-view.js');
  window.__pv=mod;
  const files=urls.map((_,i)=>({name:`합성 사진 ${i+1}.png`}));
  const itemOf=i=>({file:files[i],getUrl:()=>urls[i],driveHref:''});
  const trigger=document.querySelector('#opener');
  window.__pvOpen=(at=0)=>{
   // 'strip' = 사업 보고 사진 줄(nav + ⋯ 메뉴) · 'one' = 사진 한 장(nav 없음) · 'note' = 노트·잊지 말기 사진(openPhotoView 한 장)
   if(mode==='strip')return mod.openDocumentPhotoView({...itemOf(at),trigger,nav:{count:files.length,index:at,item:itemOf},actions:()=>[{label:'내려받기',run:async()=>false}]});
   if(mode==='nav')return mod.openDocumentPhotoView({...itemOf(at),trigger,nav:{count:files.length,index:at,item:itemOf}});
   if(mode==='one')return mod.openDocumentPhotoView({...itemOf(at),trigger});
   return false;
  };
 },{mode,colors:[],urls:[svg(1,'#2f5d8a'),svg(2,'#7a4a8a'),svg(3,'#3f7a5a')]});
 return errors;
}
const open=async(page,at=0)=>{await page.evaluate(a=>window.__pvOpen(a),at);await expect(page.locator('[data-basket-photo-view]')).toHaveCount(1);await expect(page.locator('.basket-photo-stage .diary-photo[data-state="shown"]')).toHaveCount(1)};
const countText=page=>page.locator('.basket-photo-count').textContent();
const view=page=>page.locator('[data-basket-photo-view]');
// 키보드 초점이 보기 창 안(단추가 아니라 창 자신이거나 쓸 수 있는 단추)에 있어야 키가 먹는다.
const focusOk=page=>page.evaluate(()=>{const a=document.activeElement,v=document.querySelector('[data-basket-photo-view]');return !!(v&&a&&v.contains(a)&&!a.disabled&&!a.closest('[hidden]'))});

for(const mode of ['nav','strip'])for(const width of [1280,412])test(`사진 크게 보기(${mode==='strip'?'사업 보고 사진 줄':'앞뒤 사진'}) ${width}px: 맨 끝 사진에서 ›가 잠겨도 ←·Esc가 먹고, 맨 처음에서 ‹가 잠겨도 →가 먹는다`,async({page})=>{
 const errors=await mount(page,width,mode);
 await open(page,1);
 expect(await countText(page)).toBe('2/3');
 // 마우스로 › 를 눌러 맨 끝까지 → › 잠김. 초점이 잠긴 단추에 남아 있지 않아야 한다.
 await page.locator('.basket-photo-step[data-dir="1"]').click();
 expect(await countText(page)).toBe('3/3');
 await expect(page.locator('.basket-photo-step[data-dir="1"]')).toBeDisabled();
 expect(await focusOk(page)).toBe(true);
 if(SHOTS)await page.screenshot({path:`${SHOTS}/photo-view-last-${mode}-${width}.png`});
 await page.keyboard.press('ArrowLeft');
 expect(await countText(page)).toBe('2/3');
 await page.keyboard.press('ArrowRight');
 expect(await countText(page)).toBe('3/3');
 // 맨 끝에서 → 는 제자리(넘길 사진 없음)지만 키는 받는다(막히지 않고 창이 살아 있음).
 await page.keyboard.press('ArrowRight');
 expect(await countText(page)).toBe('3/3');
 expect(await focusOk(page)).toBe(true);
 // 맨 처음까지 ‹ 로: ‹ 잠김, 그래도 → 가 먹는다.
 await page.locator('.basket-photo-step[data-dir="-1"]').click();
 await page.locator('.basket-photo-step[data-dir="-1"]').click();
 expect(await countText(page)).toBe('1/3');
 await expect(page.locator('.basket-photo-step[data-dir="-1"]')).toBeDisabled();
 expect(await focusOk(page)).toBe(true);
 await page.keyboard.press('ArrowRight');
 expect(await countText(page)).toBe('2/3');
 // 맨 끝으로 가서 Esc 로 닫기(잠긴 단추가 있어도 닫힘), 닫으면 초점은 처음 누른 단추로.
 await page.keyboard.press('ArrowRight');
 await expect(page.locator('.basket-photo-step[data-dir="1"]')).toBeDisabled();
 await page.keyboard.press('Escape');
 await expect(view(page)).toHaveCount(0);
 await expect(page.locator('#opener')).toBeFocused();
 expect(errors).toEqual([]);
});

for(const width of [1280,412])test(`사진 크게 보기 ${width}px: 키보드만으로(Tab·Enter) 맨 끝까지 넘겨도 ←·Esc가 먹는다`,async({page})=>{
 const errors=await mount(page,width,'nav');
 await open(page,0);
 // 처음 초점은 닫기 ×. Tab 으로 › 까지 가서 Enter 로 끝까지.
 await expect(page.locator('[data-basket-photo-close]')).toBeFocused();
 const next=page.locator('.basket-photo-step[data-dir="1"]');
 await next.focus();
 await page.keyboard.press('Enter');
 await page.keyboard.press('Enter');
 expect(await countText(page)).toBe('3/3');
 await expect(next).toBeDisabled();
 expect(await focusOk(page)).toBe(true);
 // 키보드로 넘긴 뒤 초점이 보기 창 자신에 있어도 전체 화면 테두리가 그려지지 않는다.
 expect(await page.evaluate(()=>{const v=document.querySelector('[data-basket-photo-view]');return document.activeElement===v?getComputedStyle(v).outlineStyle:'none'})).toBe('none');
 if(SHOTS)await page.screenshot({path:`${SHOTS}/photo-view-last-keyboard-${width}.png`});
 await page.keyboard.press('ArrowLeft');
 expect(await countText(page)).toBe('2/3');
 await page.keyboard.press('Enter'); // 보기 창에 초점이 있으면 Enter 는 아무 일도 없다(단추가 아니라서)
 await page.keyboard.press('Escape');
 await expect(view(page)).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('사진 크게 보기(사업 보고 사진 줄): ⋯ 메뉴를 열어 둔 채 ← 로 넘겨 메뉴가 다시 그려져도 키가 계속 먹고, Esc 로 닫힌다',async({page})=>{
 const errors=await mount(page,1280,'strip');
 await open(page,2);
 expect(await countText(page)).toBe('3/3');
 await expect(page.locator('.basket-photo-step[data-dir="1"]')).toBeDisabled();
 await page.locator('.basket-photo-more-btn').click();
 await expect(page.locator('.basket-photo-more')).toHaveAttribute('open','');
 await page.keyboard.press('ArrowLeft');
 expect(await countText(page)).toBe('2/3');
 expect(await focusOk(page)).toBe(true);
 await page.keyboard.press('ArrowLeft');
 expect(await countText(page)).toBe('1/3');
 await expect(page.locator('.basket-photo-step[data-dir="-1"]')).toBeDisabled();
 expect(await focusOk(page)).toBe(true);
 await page.keyboard.press('Escape');
 await expect(view(page)).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('사진 크게 보기(사진 한 장, 앞뒤·메뉴 없음): ←·→ 는 제자리고 Esc 로 닫힌다 — 처음 초점은 닫기 ×',async({page})=>{
 const errors=await mount(page,1280,'one');
 await open(page,0);
 await expect(page.locator('.basket-photo-step')).toHaveCount(0);
 await expect(page.locator('[data-basket-photo-close]')).toBeFocused();
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');
 await expect(view(page)).toHaveCount(1);
 await page.keyboard.press('Escape');
 await expect(view(page)).toHaveCount(0);
 expect(errors).toEqual([]);
});
