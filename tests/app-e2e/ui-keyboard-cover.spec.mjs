import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-자판가림(2026-10-31 명진 결정): 폰에서 칸을 누르면 그 칸이 자판 위 보이는 자리에 오고, 화면 아래에 붙은 줄
// (홈 빠른 입력·[업데이트|할 일]·동그란 [+]·전환 줄·저장 줄·아래 탭)이 그 칸을 덮지 않는다. 자판을 내리면 줄이 돌아온다.
// 규칙은 한 곳(app/accessibility-dialog.js 감지·올리기, app/ui-standard.css UI-자판가림 숨김 목록).
// 자판은 두 가지로 흉내 낸다: 앱(interactive-widget=resizes-content)처럼 화면 높이가 줄어드는 것, 화면 위만 덮는 것.
test.use({hasTouch:true,timezoneId:'Asia/Seoul'});
const KB=330;

async function boot(page,width,height,query=''){
 await page.setViewportSize({width,height});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page,{query});
 return errors;
}
// 앱의 자판: 레이아웃이 줄어든다(폰 앱·삼성 인터넷).
const resizeKeyboard=(page,width,height,open)=>page.setViewportSize({width,height:open?height-KB:height});
// 화면 위만 덮는 자판.
const overlayKeyboard=(page,open)=>page.evaluate(([open,kb])=>{if(open)Object.defineProperty(window.visualViewport,'height',{configurable:true,value:innerHeight-kb});else delete window.visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));},[open,KB]);

// 지금 쓰는 칸이 보이는 자리(자판 위)에 있고, 그 칸을 품지 않은 붙박이(fixed/sticky)와 겹치지 않는지.
function coverCheck(){
 const field=document.activeElement,vv=window.visualViewport;
 const top=vv?vv.offsetTop:0,bottom=top+(vv?vv.height:innerHeight),r=field.getBoundingClientRect();
 const tall=r.height>bottom-top-60;
 const visible=tall?(r.top<bottom-20&&r.bottom>top+20):(r.top>=top-1&&r.bottom<=bottom+1);
 const seen={top:Math.max(r.top,top),bottom:Math.min(r.bottom,bottom)};
 const blockers=[];
 for(const el of document.querySelectorAll('body *')){
  const cs=getComputedStyle(el);
  if(cs.position!=='fixed'&&cs.position!=='sticky')continue;
  if(el.contains(field)||field.contains(el)||cs.pointerEvents==='none')continue;
  if(!el.checkVisibility({visibilityProperty:true,opacityProperty:true}))continue;
  const b=el.getBoundingClientRect();if(!b.width||!b.height)continue;
  const h=Math.min(b.bottom,seen.bottom)-Math.max(b.top,seen.top),w=Math.min(b.right,r.right)-Math.max(b.left,r.left);
  if(h>2&&w>2)blockers.push((el.id?'#'+el.id:el.tagName.toLowerCase())+'.'+[...el.classList].join('.'));
 }
 const name=field.id||field.getAttribute('aria-label')||field.getAttribute('placeholder')||field.className||field.tagName;
 return {name:String(name).slice(0,60),visible,blockers,marked:field.hasAttribute('data-keyboard-field'),rect:[Math.round(r.top),Math.round(r.bottom)],view:[Math.round(top),Math.round(bottom)]};
}
// 보이는 화면(또는 열린 팝업) 안의 칸들. 숨은 칸·한글 상자(iframe)는 뺀다.
const FIELDS='input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color]):not([type=hidden]):not([disabled]),textarea:not([disabled]),[contenteditable="true"]';
async function sweep(page,scope,limit=10){
 const count=await page.evaluate(([scope,sel])=>{
  const root=document.querySelector(scope);if(!root)return 0;
  const list=[...root.querySelectorAll(sel)].filter(el=>el.checkVisibility({visibilityProperty:true})&&el.getClientRects().length);
  list.forEach((el,i)=>el.setAttribute('data-kb-sweep',String(i)));
  return list.length;
 },[scope,FIELDS]);
 const results=[];
 for(let i=0;i<Math.min(count,limit);i++){
  // 손가락으로 누른 것처럼 초점만 옮긴다(브라우저 스스로의 스크롤 없이: 올리기는 앱 규칙이 한다).
  const ok=await page.evaluate(i=>{const el=document.querySelector(`[data-kb-sweep="${i}"]`);if(!el||!el.checkVisibility())return false;el.focus({preventScroll:true});return document.activeElement===el;},i);
  if(!ok)continue;
  results.push(await page.evaluate(coverCheck));
 }
 await page.evaluate(()=>document.querySelectorAll('[data-kb-sweep]').forEach(el=>el.removeAttribute('data-kb-sweep')));
 return results;
}
const bad=results=>results.filter(r=>!r.visible||r.blockers.length||!r.marked);

for(const [width,height] of [[412,915],[344,882]])test(`홈 ${width}: 업무일지 칸을 누르면 빠른 입력·[업데이트|할 일]·아래 탭이 숨고 칸이 자판 위로, 자판을 내리면 돌아옴`,async({page})=>{
 const errors=await boot(page,width,height);
 const quick=page.locator('#homeView [data-home-quick]'),tabs=page.locator('#appView > .mobile-tabs');
 const field=page.locator('#homeView [data-journal-input]');
 await expect(field).toBeVisible();await expect(quick).toBeVisible();await expect(tabs).toBeVisible();
 // 칸을 화면 아래(빠른 입력 줄 뒤)로 내려 둔 채 누른다: 자판이 열리면 칸이 가려질 자리.
 await field.evaluate(el=>{const r=el.getBoundingClientRect();scrollBy(0,r.top-(innerHeight-90));el.focus({preventScroll:true});});
 await resizeKeyboard(page,width,height,true);
 await expect(page.locator('body')).toHaveClass(/kptu-mobile-keyboard/);
 await expect(field).toHaveAttribute('data-keyboard-field','');
 await expect(quick).toBeHidden();await expect(tabs).toBeHidden();
 const at=await page.evaluate(coverCheck);
 expect(at,JSON.stringify(at)).toMatchObject({visible:true,blockers:[]});
 // 칸 아래 1~2줄 여유.
 expect(at.view[1]-at.rect[1]).toBeGreaterThanOrEqual(40);
 // 자판을 내리면 숨긴 줄이 돌아오고 표시가 없어진다.
 await resizeKeyboard(page,width,height,false);
 await expect(page.locator('body')).not.toHaveClass(/kptu-mobile-keyboard/);
 await expect(quick).toBeVisible();await expect(tabs).toBeVisible();
 await expect(page.locator('[data-keyboard-field]')).toHaveCount(0);
 // 빠른 입력 줄 자체에 쓸 때는 그 줄만 남아 자판 바로 위.
 await quick.locator('[data-quick-input]').focus();await resizeKeyboard(page,width,height,true);
 await expect(quick).toBeVisible();await expect(tabs).toBeHidden();
 await expect.poll(async()=>{const b=await quick.boundingBox();return Math.round(b.y+b.height);}).toBe(height-KB);
 await resizeKeyboard(page,width,height,false);await expect(tabs).toBeVisible();
 expect(errors).toEqual([]);
});

test('홈 412: 화면 위만 덮는 자판에서도 칸이 자판 위로, 다음 칸으로 넘어가도 같음',async({page})=>{
 const errors=await boot(page,412,915);
 const field=page.locator('#homeView [data-journal-input]');await expect(field).toBeVisible();
 await field.evaluate(el=>{const r=el.getBoundingClientRect();scrollBy(0,r.top-(innerHeight-90));el.focus({preventScroll:true});});
 await overlayKeyboard(page,true);
 await expect(page.locator('#homeView [data-home-quick]')).toBeHidden();
 const at=await page.evaluate(coverCheck);
 expect(at,JSON.stringify(at)).toMatchObject({visible:true,blockers:[],marked:true});
 // 자판이 열린 채 빠른 입력 칸으로: 그 줄이 다시 보이고 표시도 옮겨 간다.
 await page.locator('#homeView [data-home-quick] [data-quick-input]').evaluate(el=>el.focus({preventScroll:true}));
 await expect(page.locator('#homeView [data-home-quick]')).toBeVisible();
 await expect(page.locator('[data-keyboard-field]')).toHaveCount(1);await expect(field).not.toHaveAttribute('data-keyboard-field','');
 await overlayKeyboard(page,false);
 await expect(page.locator('[data-keyboard-field]')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('팝업 412: 일정 창 안 칸도 아래 버튼 줄에 덮이지 않고 자판 위로',async({page})=>{
 const errors=await boot(page,412,915,'?view=calendar');
 await page.locator('#newEventBtn').click();await expect(page.locator('#eventModal')).toBeVisible();
 const desc=page.locator('#eventDescription');
 await desc.evaluate(el=>el.focus({preventScroll:true}));
 await resizeKeyboard(page,412,915,true);
 await expect(page.locator('#eventModal .modal-action-footer')).toHaveCSS('position','static');
 const results=await sweep(page,'#eventModal .modal-card');
 expect(results.length).toBeGreaterThan(1);
 expect(bad(results),JSON.stringify(results)).toEqual([]);
 // 화면 위만 덮는 자판: 팝업은 자판 위에서 끝나고 칸은 그 안에서 올라온다.
 await resizeKeyboard(page,412,915,false);await desc.evaluate(el=>el.focus({preventScroll:true}));await overlayKeyboard(page,true);
 const again=await sweep(page,'#eventModal .modal-card');
 expect(bad(again),'overlay '+JSON.stringify(again)).toEqual([]);
 await overlayKeyboard(page,false);
 expect(errors).toEqual([]);
});

// 전수: 폰 412·폴드 접힘 344에서 메뉴 화면마다 칸을 하나씩 눌러(자판이 열린 채 다음 칸으로) 가려지는 곳 0.
const VIEWS=['home','calendar','tasks','basket','library','meetings','diary','projects','pages','profile'];
for(const [width,height] of [[412,915],[344,882]])test(`전수 ${width}: 모든 메뉴 화면의 칸이 자판 위에서 아무것에도 덮이지 않음`,async({page})=>{
 test.setTimeout(120000);
 await boot(page,width,height);
 let checked=0;const failures=[];
 for(const view of VIEWS){
  await page.evaluate(()=>document.activeElement?.blur?.());
  await resizeKeyboard(page,width,height,false);
  await page.evaluate(view=>window.KPTURouter.go(view),view);
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe(view);
  await page.waitForTimeout(300);
  // 첫 칸에 초점 → 자판 열기 → 칸마다 넘어가며 확인.
  const first=await page.evaluate(sel=>{const v=document.querySelector('#appView .view-panel:not(.hidden)');const el=v&&[...v.querySelectorAll(sel)].find(el=>el.checkVisibility()&&el.getClientRects().length);if(!el)return false;el.focus({preventScroll:true});return document.activeElement===el;},FIELDS);
  if(!first)continue;
  await resizeKeyboard(page,width,height,true);
  await expect(page.locator('body')).toHaveClass(/kptu-mobile-keyboard/);
  const results=await sweep(page,'#appView .view-panel:not(.hidden)',8);
  checked+=results.length;
  failures.push(...bad(results).map(r=>view+': '+JSON.stringify(r)));
 }
 await resizeKeyboard(page,width,height,false);
 expect(checked).toBeGreaterThanOrEqual(3);
 expect(failures).toEqual([]);
});
