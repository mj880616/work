import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
// MTG-3칸폭끌기(2026-10-26 요청): PC(≥1024) 사업 보고 3단(왼쪽 회의 종류 / 가운데 차수 / 오른쪽 결과)의 두 경계를 끌어 칸 폭을 바꾼다.
// 할 일·프로젝트·담당조직과 같은 공용 app/split-resize.js(경계 여러 개). 기본 1/6 : 1/6 : 2/3, 경계는 이웃 두 칸만 움직이고, 칸마다 최소 폭
// (종류·차수 120, 결과 360), 두 번 누르면 그 경계만 기본, 키보드 ←→·Home·End, 고른 폭은 서버(프로필 view_prefs.split_ratio.reports)에 기억한다.
// 칸 크기는 화면 안에서 한 번에 읽는다(그리는 도중 바뀌는 칸을 두 번에 나눠 잡지 않도록).
test.use({timezoneId:'Asia/Seoul'});

function columnState(){
  const s=baseState();s.meetingWrites=[];
  const row=(id,name,round,at)=>({id,workspace_id:s.workspace.id,title:name,series_name:name,round_no:round,meeting_at:at,transcript_text:'원문',created_by:s.user.id});
  s.meetings=[
    ...[1,2,3].map(n=>row(`rail-${n}`,'궤도협의회',n,`2026-09-0${n}T01:00:00Z`)),
    row('labor-1','노사협의회',1,'2026-10-01T01:00:00Z'),row('labor-2','노사협의회',2,'2026-10-12T05:30:00Z'),
  ];
  return s;
}
let prefs;
async function open(page,width,options={}){
  await page.setViewportSize({width,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  prefs=await installViewPrefsServer(page,null,options);
  await mockApp(page,columnState());
  await signIn(page,testOrigin+'/app/?view=meetings');
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingList .mcol-layout>.split-resize-handle')).toHaveCount(2);
  // 오른쪽 결과의 후속 할 일까지 불러온 뒤(그 뒤에는 칸을 다시 그리지 않는다) 잰다.
  await expect(page.locator('#meetingList #mcolTasks')).not.toContainText('불러오는 중');
  await settle(page);
  return errors;
}
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const stored=()=>prefs.value?.split_ratio?.reports??null;
const widths=page=>page.evaluate(()=>{
  const w=s=>document.querySelector(s).getBoundingClientRect().width,c=document.querySelector('#meetingList .mcol-layout'),st=getComputedStyle(c),g=parseFloat(st.columnGap)||0;
  return {kinds:w('#meetingList .mcol-kinds'),rounds:w('#meetingList .mcol-rounds'),result:w('#meetingList .mcol-result'),total:c.clientWidth-(parseFloat(st.paddingLeft)||0)-(parseFloat(st.paddingRight)||0)-2*g,gap:g,over:document.documentElement.scrollWidth-innerWidth};
});
const handleRect=(page,i)=>page.evaluate(i=>{const b=document.querySelectorAll('#meetingList .mcol-layout>.split-resize-handle')[i].getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}},i);
// x on screen where boundary i sits when the columns left of it hold the share `cum` of the shared width.
const xFor=(page,i,cum)=>page.evaluate(([i,cum])=>{const c=document.querySelector('#meetingList .mcol-layout'),st=getComputedStyle(c),g=parseFloat(st.columnGap)||0,b=c.getBoundingClientRect(),left=b.left+(parseFloat(st.paddingLeft)||0),w=c.clientWidth-(parseFloat(st.paddingLeft)||0)-(parseFloat(st.paddingRight)||0)-2*g;return left+cum*w+g*(i+0.5)},[i,cum]);
async function dragTo(page,i,x){
 const b=await handleRect(page,i),y=b.y+Math.min(b.h/2,200);
 await page.mouse.move(b.x+b.w/2,y);await page.mouse.down();
 await page.mouse.move((b.x+b.w/2+x)/2,y,{steps:4});await page.mouse.move(x,y,{steps:4});await page.mouse.up();await settle(page);
}
const handle=(page,i)=>page.locator('#meetingList .mcol-layout>.split-resize-handle').nth(i);

for(const width of [1280,1440,1920]){
 test(`PC ${width}: 사업 보고 3단 — 기본 1/6·1/6·2/3, 두 경계 끌기·최소 폭·기억·두 번 눌러 기본·키보드`,async({page})=>{
  const errors=await open(page,width);
  await expect(handle(page,0)).toHaveAttribute('role','separator');await expect(handle(page,0)).toHaveAttribute('aria-orientation','vertical');
  await expect(handle(page,0)).toHaveAttribute('aria-valuenow','17');await expect(handle(page,1)).toHaveAttribute('aria-valuenow','33');
  // 기본: 종류 = 차수 = 1/6, 결과 2/3. 경계선은 두 칸 사이 틈에 있다.
  let m=await widths(page);
  expect(Math.abs(m.kinds/m.total-1/6)).toBeLessThan(0.01);expect(Math.abs(m.rounds/m.total-1/6)).toBeLessThan(0.01);expect(Math.abs(m.result/m.total-2/3)).toBeLessThan(0.01);
  const geo=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect(),hs=[...document.querySelectorAll('#meetingList .mcol-layout>.split-resize-handle')].map(h=>h.getBoundingClientRect()),k=r('.mcol-kinds'),d=r('.mcol-rounds'),x=r('.mcol-result');return {h0:[hs[0].x,hs[0].right],h1:[hs[1].x,hs[1].right],k:k.right,d:[d.left,d.right],x:x.left}});
  expect(geo.h0[0]).toBeLessThanOrEqual(geo.d[0]);expect(geo.h0[1]).toBeGreaterThanOrEqual(geo.k);
  expect(geo.h1[0]).toBeLessThanOrEqual(geo.x);expect(geo.h1[1]).toBeGreaterThanOrEqual(geo.d[1]);
  expect(stored()).toBeNull();

  // 첫 경계(종류|차수)를 끌면 종류와 차수만 바뀌고 결과 폭은 그대로.
  const resultBefore=m.result;
  // 종류는 (종류+차수 몫 1/3) - (차수 최소 폭) 까지만 넓어진다. 가장 좁은 1280에서도 들어가는 0.19로 끈다.
  await dragTo(page,0,await xFor(page,0,0.19));
  m=await widths(page);
  expect(Math.abs(m.kinds/m.total-0.19)).toBeLessThan(0.01);expect(Math.abs(m.result-resultBefore)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(m.kinds+m.rounds-(m.total/3))).toBeLessThanOrEqual(1.5);
  await expect(handle(page,0)).toHaveAttribute('aria-valuenow','19');await expect(handle(page,1)).toHaveAttribute('aria-valuenow','33');
  await expect.poll(()=>typeof stored()).toBe('number');

  // 둘째 경계(차수|결과)를 끌면 차수와 결과만 바뀌고 종류 폭은 그대로.
  const kindsBefore=m.kinds;
  await dragTo(page,1,await xFor(page,1,0.5));
  m=await widths(page);
  expect(Math.abs((m.kinds+m.rounds)/m.total-0.5)).toBeLessThan(0.01);expect(Math.abs(m.kinds-kindsBefore)).toBeLessThanOrEqual(1.5);
  await expect(handle(page,1)).toHaveAttribute('aria-valuenow','50');
  expect(m.over).toBeLessThanOrEqual(1);

  // 기억: 다른 종류를 고르거나(칸을 다시 그림) 새로 불러와도 같은 폭. 서버에 올라간 값은 0 초과 1 미만 숫자 하나.
  await page.locator('#meetingList [data-meeting-kind]').nth(1).click();await settle(page);
  const kept=await widths(page);// 서버 숫자 하나에 천분율로 담으므로 몇 px 안팎의 반올림 차이는 있다.
  expect(Math.abs(kept.kinds-m.kinds)).toBeLessThanOrEqual(2.5);expect(Math.abs(kept.rounds-m.rounds)).toBeLessThanOrEqual(2.5);
  await expect.poll(()=>{const v=stored();return typeof v==='number'&&v>0&&v<1}).toBe(true);
  await page.reload();await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingList .mcol-layout>.split-resize-handle')).toHaveCount(2);await expect(page.locator('#meetingList #mcolTasks')).not.toContainText('불러오는 중');await settle(page);
  const back=await widths(page);expect(Math.abs(back.kinds/back.total-m.kinds/m.total)).toBeLessThan(0.01);expect(Math.abs(back.rounds/back.total-m.rounds/m.total)).toBeLessThan(0.01);

  // 최소 폭: 맨 왼쪽·맨 오른쪽 끝까지 끌어도 종류·차수 120, 결과 360 아래로 줄지 않는다.
  await dragTo(page,0,5);m=await widths(page);expect(m.kinds).toBeGreaterThanOrEqual(119);expect(m.kinds).toBeLessThan(130);
  await dragTo(page,0,width-5);m=await widths(page);expect(m.rounds).toBeGreaterThanOrEqual(119);expect(m.rounds).toBeLessThan(130);
  await dragTo(page,1,5);m=await widths(page);expect(m.rounds).toBeGreaterThanOrEqual(119);expect(m.rounds).toBeLessThan(130);
  await dragTo(page,1,width-5);m=await widths(page);expect(m.result).toBeGreaterThanOrEqual(359);expect(m.result).toBeLessThan(370);
  expect(m.over).toBeLessThanOrEqual(1);

  // 두 번 누르면 그 경계만 기본으로. 둘 다 기본이면 서버 기억도 지운다.
  await handle(page,0).dblclick();await settle(page);
  m=await widths(page);expect(Math.abs(m.kinds/m.total-1/6)).toBeLessThan(0.01);expect(m.result).toBeLessThan(m.total*2/3);
  await handle(page,1).dblclick();await settle(page);
  m=await widths(page);expect(Math.abs(m.kinds/m.total-1/6)).toBeLessThan(0.01);expect(Math.abs(m.rounds/m.total-1/6)).toBeLessThan(0.01);expect(Math.abs(m.result/m.total-2/3)).toBeLessThan(0.01);
  await expect.poll(()=>stored()).toBeNull();

  // 키보드: 경계에 초점 → → 한 번에 2%, ← 되돌림, Home은 왼쪽 칸 최소 폭, End는 오른쪽 칸 최소 폭.
  await handle(page,0).focus();await expect(handle(page,0)).toBeFocused();
  for(let i=0;i<2;i++)await page.keyboard.press('ArrowRight');await settle(page);
  m=await widths(page);expect(Math.abs(m.kinds/m.total-(1/6+0.04))).toBeLessThan(0.01);expect(Math.abs(m.result/m.total-2/3)).toBeLessThan(0.01);
  await expect.poll(()=>typeof stored()).toBe('number');
  await page.keyboard.press('ArrowLeft');await settle(page);
  expect(Math.abs((await widths(page)).kinds/m.total-(1/6+0.02))).toBeLessThan(0.01);
  await page.keyboard.press('Home');await settle(page);expect((await widths(page)).kinds).toBeLessThan(130);
  await handle(page,1).focus();await page.keyboard.press('End');await settle(page);
  m=await widths(page);expect(m.result).toBeGreaterThanOrEqual(359);expect(m.result).toBeLessThan(370);
  expect(errors).toEqual([]);
 });
}

test('서버 값을 읽거나 저장하지 못해도 기본으로 그리고 끌기는 된다(기억만 없음)',async({page})=>{
 const errors=await open(page,1280,{failRead:true,failWrite:true});
 let m=await widths(page);expect(Math.abs(m.kinds/m.total-1/6)).toBeLessThan(0.01);
 await dragTo(page,0,await xFor(page,0,0.19));
 m=await widths(page);expect(Math.abs(m.kinds/m.total-0.19)).toBeLessThan(0.01);
 await page.locator('#meetingList [data-meeting-kind]').nth(1).click();await settle(page);
 m=await widths(page);expect(Math.abs(m.kinds/m.total-0.19)).toBeLessThan(0.01);
 expect(errors).toEqual([]);
});

test('중간 폭·폰에는 3단 경계선이 없고, PC로 넓히면 나타난다',async({page})=>{
 await page.setViewportSize({width:900,height:800});
 await mockApp(page,columnState());await signIn(page,testOrigin+'/app/?view=meetings');
 await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
 await expect(page.locator('#meetingList .meeting-list-row').first()).toBeVisible();
 await expect(page.locator('.split-resize-handle:visible')).toHaveCount(0);
 await page.setViewportSize({width:1280,height:900});
 await expect(page.locator('#meetingList .mcol-layout>.split-resize-handle')).toHaveCount(2);
 await expect(page.locator('#meetingList .mcol-layout>.split-resize-handle').first()).toBeVisible();
 await page.setViewportSize({width:390,height:800});
 await expect(page.locator('.split-resize-handle:visible')).toHaveCount(0);
});
