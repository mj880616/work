import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
// UI-칸폭조절(2026-10-22 요청·승인): PC(≥1024) 할 일·프로젝트·담당조직 화면의 왼쪽 목록 칸과 오른쪽 상세 칸 사이 경계선을
// 마우스로 끌어 폭을 바꾼다(공용 app/split-resize.js). 기본 1/3 : 2/3, 화면별로 서버(프로필 view_prefs.split_ratio)에 기억, 칸 최소 폭(왼쪽 240·오른쪽 360),
// 경계선을 두 번 누르면 기본으로, 사이드바를 숨겨도 비율 유지, 키보드(경계선에 초점 → ←→), role=separator·aria-valuenow.
const SCREENS={
 tasks:{container:'#gtTaskSection',list:'#gtTaskSection .gt-cols',pane:'#gtDetailPane',ready:async page=>{
  await expect(page.locator('#gtTaskSection.gt-pc')).toBeVisible();
  // 입력창이 늦게 나타나면 아래 칸이 밀리므로, 배치를 재기 전에 입력창부터 기다린다.
  await expect(page.locator('#tasksView .home-quick [data-quick-input]')).toBeVisible();
 }},
 projects:{container:'#projectGrid',list:'#projectGrid>.ps3-plist',pane:'#ps3DetailPane',ready:async page=>{await expect(page.locator('#ps3DetailPane #ps3DetailModal')).toBeVisible()}},
 team:{container:'#soTeamSection',list:'#soOrganizationList',pane:'#wdDetailPane',ready:async page=>{await expect(page.locator('#wdDetailPane #wdModal')).toBeVisible()}},
};
// 서버를 흉내 낸 상태(open()이 시험마다 새로 만든다). 쓰기는 0.4초 모아 가므로 바뀐 뒤의 값은 expect.poll로 본다.
let prefs;
const stored=(page,name)=>prefs.value?.split_ratio?.[name]??null;
// STAB-분할시험(2026-10-26): 칸 자리는 화면 안에서 한 번에 읽는다. locator.boundingBox()는 "요소 찾기 → 자리 묻기" 두 걸음이라, 그 사이에
// 화면이 목록을 다시 그리면(할 일: 새로고침 뒤 연결 표시가 늦게 도착, 프로젝트: 첫 항목을 열며 목록 교체) 방금 찾은 요소가 사라져 null이 된다.
// 화면의 다시 그리기는 한 번에 끝나므로(innerHTML·replaceWith) 한 번에 읽으면 그 순간의 요소를 항상 잰다.
const box=(page,selector)=>page.evaluate(sel=>{const e=document.querySelector(sel);if(!e)throw new Error('요소 없음: '+sel);const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}},selector);
async function measure(page,s){
 const l=await box(page,s.list),p=await box(page,s.pane);
 return {list:l.width,pane:p.width,ratio:l.width/(l.width+p.width),gapOk:p.x>=l.x+l.width-1};
}
async function settle(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
async function dragTo(page,handleSel,x){
 const b=await box(page,handleSel);const y=b.y+Math.min(b.height/2,200);
 await page.mouse.move(b.x+b.width/2,y);await page.mouse.down();
 await page.mouse.move((b.x+b.width/2+x)/2,y,{steps:4});await page.mouse.move(x,y,{steps:4});await page.mouse.up();await settle(page);
}
// Target x for a left share r of the space the two panes share (content box minus the gap).
const xFor=(page,s,r)=>page.evaluate(([sel,r])=>{const c=document.querySelector(sel),st=getComputedStyle(c),g=parseFloat(st.columnGap)||0,b=c.getBoundingClientRect(),left=b.left+(parseFloat(st.paddingLeft)||0),w=c.clientWidth-(parseFloat(st.paddingLeft)||0)-(parseFloat(st.paddingRight)||0)-g;return left+r*w+g/2},[s.container,r]);
async function open(page,name,width,options={}){
 await page.setViewportSize({width,height:860});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 prefs=await installViewPrefsServer(page,null,options);
 await openHome(page);await clickView(page,name);await SCREENS[name].ready(page);await settle(page);
 return errors;
}

for(const width of [1280,1440,1920]){
 for(const name of Object.keys(SCREENS)){
  test(`PC ${width} ${name}: 기본 1/3, 끌기·기억·두 번 눌러 초기화·최소 폭·사이드바 숨김 비율 유지·키보드`,async({page})=>{
   const s=SCREENS[name];const errors=await open(page,name,width);
   const handleSel=`${s.container}>.split-resize-handle`,handle=page.locator(handleSel);
   await expect(handle).toBeVisible();
   await expect(handle).toHaveAttribute('role','separator');await expect(handle).toHaveAttribute('aria-orientation','vertical');
   await expect(handle).toHaveAttribute('aria-valuenow','33');
   // 기본 1/3 : 2/3, 경계선은 두 칸 사이 틈에 있다.
   let m=await measure(page,s);expect(Math.abs(m.ratio-1/3)).toBeLessThan(0.02);expect(m.gapOk).toBe(true);
   const hb=await box(page,handleSel),lb=await box(page,s.list),pb=await box(page,s.pane);
   expect(hb.x).toBeLessThanOrEqual(pb.x);expect(hb.x+hb.width).toBeGreaterThanOrEqual(lb.x+lb.width);
   expect(await stored(page,name)).toBeNull();

   // 끌기: 절반으로.
   await dragTo(page,handleSel,await xFor(page,s,0.5));
   m=await measure(page,s);expect(Math.abs(m.ratio-0.5)).toBeLessThan(0.02);
   await expect(handle).toHaveAttribute('aria-valuenow','50');
   await expect.poll(()=>Math.abs(Number(stored(page,name))-0.5)).toBeLessThan(0.02);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);

   // 사이드바 숨김(UI-상단줄): 본문이 넓어져도 비율은 그대로, 다시 보여도 그대로.
   const before=m;await page.locator('[data-nav-toggle]').click();await expect(page.locator('#appView')).toHaveClass(/nav-collapsed/);await settle(page);
   m=await measure(page,s);expect(m.list+m.pane).toBeGreaterThan(before.list+before.pane+50);expect(Math.abs(m.ratio-0.5)).toBeLessThan(0.02);
   const hb2=await box(page,handleSel),pb2=await box(page,s.pane);expect(Math.abs(hb2.x+hb2.width/2-(pb2.x-6))).toBeLessThan(8);
   await page.locator('[data-nav-toggle]').click();await expect(page.locator('#appView')).not.toHaveClass(/nav-collapsed/);await settle(page);
   m=await measure(page,s);expect(Math.abs(m.ratio-0.5)).toBeLessThan(0.02);

   // 기억: 다른 화면에 갔다 오고, 다시 불러와도 같은 비율. 다른 화면의 비율은 따로다.
   await clickView(page,'home');await clickView(page,name);await s.ready(page);await settle(page);
   m=await measure(page,s);expect(Math.abs(m.ratio-0.5)).toBeLessThan(0.02);
   const other=Object.keys(SCREENS).filter(n=>n!==name);for(const n of other)expect(await stored(page,n)).toBeNull();
   await page.reload();await s.ready(page).catch(async()=>{await clickView(page,name);await s.ready(page)});await settle(page);
   m=await measure(page,s);expect(Math.abs(m.ratio-0.5)).toBeLessThan(0.02);

   // 최소 폭: 맨 왼쪽·맨 오른쪽 끝까지 끌어도 왼쪽 240·오른쪽 360 아래로 줄지 않는다.
   await dragTo(page,handleSel,5);m=await measure(page,s);expect(m.list).toBeGreaterThanOrEqual(239);expect(m.list).toBeLessThan(250);
   await dragTo(page,handleSel,width-5);m=await measure(page,s);expect(m.pane).toBeGreaterThanOrEqual(359);expect(m.pane).toBeLessThan(370);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);

   // 두 번 누르면 기본 1/3으로, 기억도 지운다.
   await handle.dblclick();await settle(page);
   m=await measure(page,s);expect(Math.abs(m.ratio-1/3)).toBeLessThan(0.02);await expect(handle).toHaveAttribute('aria-valuenow','33');
   await expect.poll(()=>stored(page,name)).toBeNull();

   // 키보드: 경계선에 초점 → → 한 번에 2%씩, ← 되돌림, Home은 최소 폭.
   await handle.focus();await expect(handle).toBeFocused();
   for(let i=0;i<5;i++)await page.keyboard.press('ArrowRight');await settle(page);
   m=await measure(page,s);expect(Math.abs(m.ratio-(1/3+0.1))).toBeLessThan(0.02);
   await expect.poll(()=>Math.abs(Number(stored(page,name))-(1/3+0.1))).toBeLessThan(0.02);
   await page.keyboard.press('ArrowLeft');await settle(page);
   expect(Math.abs((await measure(page,s)).ratio-(1/3+0.08))).toBeLessThan(0.02);
   await page.keyboard.press('Home');await settle(page);expect((await measure(page,s)).list).toBeLessThan(250);
   expect(errors).toEqual([]);
  });
 }
}

test('서버 값을 읽거나 저장하지 못해도 기본 1/3으로 그리고 끌기는 된다(기억만 없음)',async({page})=>{
 const s=SCREENS.projects;const errors=await open(page,'projects',1280,{failRead:true,failWrite:true});
 const handleSel=`${s.container}>.split-resize-handle`,handle=page.locator(handleSel);
 expect(Math.abs((await measure(page,s)).ratio-1/3)).toBeLessThan(0.02);
 await dragTo(page,handleSel,await xFor(page,s,0.5));expect(Math.abs((await measure(page,s)).ratio-0.5)).toBeLessThan(0.02);
 await handle.dblclick();await settle(page);expect(Math.abs((await measure(page,s)).ratio-1/3)).toBeLessThan(0.02);
 expect(errors).toEqual([]);
});

test('폰에는 경계선이 없고, PC 틀(761px~, 폴드 펼침 포함)로 넓히면 나타난다',async({page})=>{
 await page.setViewportSize({width:760,height:800});
 await openHome(page);await clickView(page,'projects');
 await expect(page.locator('#projectGrid .kptu-list-row').first()).toBeVisible();
 await expect(page.locator('.split-resize-handle:visible')).toHaveCount(0);
 await page.setViewportSize({width:884,height:800});
 await expect(page.locator('#projectGrid>.split-resize-handle')).toBeVisible();
 await page.setViewportSize({width:390,height:800});
 await expect(page.locator('.split-resize-handle:visible')).toHaveCount(0);
});
