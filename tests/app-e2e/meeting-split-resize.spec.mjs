import {test,expect} from '@playwright/test';
import {showReportsOf} from './helpers/meeting-open.mjs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {showAllReportWeeks} from './helpers/report-week.mjs';
// MTG-3칸폭끌기(2026-10-26 요청): PC(≥1024) 사업 보고 3단(왼쪽 회의 종류 / 가운데 차수 / 오른쪽 결과)의 두 경계를 끌어 칸 폭을 바꾼다.
// 할 일·프로젝트·담당조직과 같은 공용 app/split-resize.js(경계 여러 개). 기본 1.3 : 0.8 : 5.9(S52-34, 처음엔 1 : 0.5 : 4.5), 경계는 이웃 두 칸만 움직이고, 칸마다 최소 폭
// (종류 150·차수 112(S56-36), 결과 360), 두 번 누르면 그 경계만 기본, 키보드 ←→·Home·End, 고른 폭은 서버(프로필 view_prefs.split_ratio.reports3 — UI-작은결정묶음 ④, 2단 reports와 따로)에 기억한다.
// 칸 크기는 화면 안에서 한 번에 읽는다(그리는 도중 바뀌는 칸을 두 번에 나눠 잡지 않도록).
test.use({timezoneId:'Asia/Seoul'});
// S52-34 UI-전체정리(사업 보고): 기본 비율 1.3 : 0.8 : 5.9, 최소 폭 종류 150·차수 96(회의 이름·차수 날짜가 잘리지 않게).
const KA=1.3/8,KB=0.8/8;

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
  prefs=await installViewPrefsServer(page,options.initial??null,options);
  await mockApp(page,columnState());
  await signIn(page,testOrigin+'/app/?view=meetings');
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  // MTG-프로젝트합치기 3단계: 가짜 보고가 여러 주에 걸쳐 있어(종류 둘을 다 보려고) [전체]로 모든 주를 본다.
  await showAllReportWeeks(page);
  await expect(page.locator('#meetingList .mcol-layout>.split-resize-handle')).toHaveCount(2);
  // 오른쪽 결과의 후속 할 일까지 불러온 뒤(그 뒤에는 칸을 다시 그리지 않는다) 잰다.
  await columnsReady(page);
  return errors;
}
// 3단 위 [주간 사업요약표] 칸은 모듈을 늦게 불러와 그린 뒤에야 제 높이(약 100px → 400px)가 되어 아래 3단 전체가 밀려 내려간다.
// 잰 칸 자리·끌 경계선 자리가 그 사이에 어긋나지 않도록, 요약표와 오른쪽 결과(후속 할 일까지)가 다 그려진 뒤에 잰다. (새로 불러온 뒤 같은 어긋남으로 간헐 실패했음)
async function columnsReady(page){
  // [전체] 기간(여러 주)에서는 주간보고 칸이 접힌 한 줄(표는 펼칠 때만 그림) — 그 한 줄이 나타나면 높이가 정해진 것. 한 주를 보면 펼쳐진 표가 다 그려질 때까지 기다린다.
  const fold=page.locator('#bizWeekBox .biz-week-title [data-bw-fold]');
  await expect(fold.or(page.locator('#bizWeekBox [data-bp-paper]').filter({hasText:'1) 사업요약표'})).first()).toBeVisible();
  if(await fold.count())await expect(fold).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#meetingList #mcolResult #mrdMeta')).toBeVisible();await expect(page.locator('#meetingList #mrdLoading')).toBeHidden();
  await settle(page);
}
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const stored=()=>prefs.value?.split_ratio?.reports3??null;
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
 test(`PC ${width}: 사업 보고 3단 — 기본 1.3·0.8·5.9, 두 경계 끌기·최소 폭·기억·두 번 눌러 기본·키보드`,async({page})=>{
  const errors=await open(page,width);
  await expect(handle(page,0)).toHaveAttribute('role','separator');await expect(handle(page,0)).toHaveAttribute('aria-orientation','vertical');
  await expect(handle(page,0)).toHaveAttribute('aria-valuenow',String(Math.round(KA*100)));expect(Number(await handle(page,1).getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(25);expect(Number(await handle(page,1).getAttribute('aria-valuenow'))).toBeLessThanOrEqual(28);
  // 기본(MTG-3칸정리 ④): 종류 1.3/8, 차수 0.8/8(최소 112px 아래로는 안 줄임 — S56-36: '46차 11.10'이 한 줄로 보이는 폭), 결과 나머지. 경계선은 두 칸 사이 틈에 있다.
  let m=await widths(page);
  expect(Math.abs(m.kinds/m.total-KA)).toBeLessThan(0.01);expect(Math.abs(m.rounds/m.total-Math.max(KB,112/m.total))).toBeLessThan(0.01);expect(m.rounds).toBeLessThan(m.kinds*0.75);
  const geo=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect(),hs=[...document.querySelectorAll('#meetingList .mcol-layout>.split-resize-handle')].map(h=>h.getBoundingClientRect()),k=r('.mcol-kinds'),d=r('.mcol-rounds'),x=r('.mcol-result');return {h0:[hs[0].x,hs[0].right],h1:[hs[1].x,hs[1].right],k:k.right,d:[d.left,d.right],x:x.left}});
  expect(geo.h0[0]).toBeLessThanOrEqual(geo.d[0]);expect(geo.h0[1]).toBeGreaterThanOrEqual(geo.k);
  expect(geo.h1[0]).toBeLessThanOrEqual(geo.x);expect(geo.h1[1]).toBeGreaterThanOrEqual(geo.d[1]);
  expect(stored()).toBeNull();

  // 첫 경계(종류|차수)를 끌면 종류와 차수만 바뀌고 결과 폭은 그대로.
  const resultBefore=m.result;
  // 종류는 (종류+차수 몫) - (차수 최소 폭) 까지만 넓어진다. 줄이는 쪽(최소 폭과 기본의 가운데, KT)으로 끈다.
  const KT=(150/m.total+KA)/2;
  const pairBefore=m.kinds+m.rounds,ratioBefore=await handle(page,1).getAttribute('aria-valuenow');
  await dragTo(page,0,await xFor(page,0,KT));
  m=await widths(page);
  expect(Math.abs(m.kinds/m.total-KT)).toBeLessThan(0.01);expect(Math.abs(m.result-resultBefore)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(m.kinds+m.rounds-pairBefore)).toBeLessThanOrEqual(1.5);
  await expect(handle(page,0)).toHaveAttribute('aria-valuenow',String(Math.round(KT*100)));await expect(handle(page,1)).toHaveAttribute('aria-valuenow',ratioBefore);
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
  // 서버 기억은 0.4초 모아 보내므로, 방금 끈 둘째 경계(앞 두 칸 몫 50%)가 서버에 올라간 것을 본 뒤에 새로 불러온다
  // (첫 경계를 끌 때 올라간 옛 값만 보고 넘어가면 새로 불러온 폭이 옛 값이라 어긋난다). 값 모양은 encodeTriple: 천분율 L(둘째 경계 왼쪽 몫)·K.
  await expect.poll(()=>{const v=stored();return typeof v==='number'&&v>0&&v<1&&Math.floor(Math.round(v*1e6)/1000)===500}).toBe(true);
  await page.reload();await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingList .mcol-layout>.split-resize-handle')).toHaveCount(2);await columnsReady(page);
  const back=await widths(page);expect(Math.abs(back.kinds/back.total-m.kinds/m.total)).toBeLessThan(0.01);expect(Math.abs(back.rounds/back.total-m.rounds/m.total)).toBeLessThan(0.01);

  // 최소 폭: 맨 왼쪽·맨 오른쪽 끝까지 끌어도 종류 150·차수 112(S56-36), 결과 360 아래로 줄지 않는다.
  await dragTo(page,0,5);m=await widths(page);expect(m.kinds).toBeGreaterThanOrEqual(149);expect(m.kinds).toBeLessThan(160);
  await dragTo(page,0,width-5);m=await widths(page);expect(m.rounds).toBeGreaterThanOrEqual(111);expect(m.rounds).toBeLessThan(122);
  await dragTo(page,1,5);m=await widths(page);expect(m.rounds).toBeGreaterThanOrEqual(111);expect(m.rounds).toBeLessThan(122);
  await dragTo(page,1,width-5);m=await widths(page);expect(m.result).toBeGreaterThanOrEqual(359);expect(m.result).toBeLessThan(370);
  expect(m.over).toBeLessThanOrEqual(1);

  // 두 번 누르면 그 경계만 기본으로. 둘 다 기본이면 서버 기억도 지운다.
  await handle(page,0).dblclick();await settle(page);
  m=await widths(page);expect(Math.abs(m.kinds/m.total-KA)).toBeLessThan(0.01);expect(m.result).toBeLessThan(m.total*3/4);
  await handle(page,1).dblclick();await settle(page);
  m=await widths(page);expect(Math.abs(m.kinds/m.total-KA)).toBeLessThan(0.01);expect(Math.abs(m.rounds/m.total-Math.max(KB,112/m.total))).toBeLessThan(0.01);expect(Math.abs(m.result/m.total-(1-KA-Math.max(KB,112/m.total)))).toBeLessThan(0.01);
  await expect.poll(()=>stored()).toBeNull();

  // 키보드: 경계에 초점 → → 한 번에 2%, ← 되돌림, Home은 왼쪽 칸 최소 폭, End는 오른쪽 칸 최소 폭. (차수 칸이 좁아 둘째 경계로 시험한다.)
  const roundsDefault=m.rounds/m.total;
  await handle(page,1).focus();await expect(handle(page,1)).toBeFocused();
  for(let i=0;i<2;i++)await page.keyboard.press('ArrowRight');await settle(page);
  m=await widths(page);expect(Math.abs(m.rounds/m.total-(roundsDefault+0.04))).toBeLessThan(0.01);expect(Math.abs(m.kinds/m.total-KA)).toBeLessThan(0.01);
  await expect.poll(()=>typeof stored()).toBe('number');
  await page.keyboard.press('ArrowLeft');await settle(page);
  expect(Math.abs((await widths(page)).rounds/m.total-(roundsDefault+0.02))).toBeLessThan(0.01);
  await handle(page,0).focus();await page.keyboard.press('Home');await settle(page);expect((await widths(page)).kinds).toBeLessThan(160);
  await handle(page,1).focus();await page.keyboard.press('End');await settle(page);
  m=await widths(page);expect(m.result).toBeGreaterThanOrEqual(359);expect(m.result).toBeLessThan(370);
  expect(errors).toEqual([]);
 });
}

test('서버 값을 읽거나 저장하지 못해도 기본으로 그리고 끌기는 된다(기억만 없음)',async({page})=>{
 const errors=await open(page,1280,{failRead:true,failWrite:true});
 let m=await widths(page);expect(Math.abs(m.kinds/m.total-KA)).toBeLessThan(0.01);const KT=(150/m.total+KA)/2;
 await dragTo(page,0,await xFor(page,0,KT));
 m=await widths(page);expect(Math.abs(m.kinds/m.total-KT)).toBeLessThan(0.01);
 await page.locator('#meetingList [data-meeting-kind]').nth(1).click();await settle(page);
 m=await widths(page);expect(Math.abs(m.kinds/m.total-KT)).toBeLessThan(0.01);
 expect(errors).toEqual([]);
});

test('폰에는 3단 경계선이 없고, PC 틀(761px~)로 넓히면 나타난다',async({page})=>{
 await page.setViewportSize({width:760,height:800});
 await mockApp(page,columnState());await signIn(page,testOrigin+'/app/?view=meetings');
 await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
 await showReportsOf(page);
 await expect(page.locator('#meetingList .meeting-list-row').first()).toBeVisible();
 await expect(page.locator('.split-resize-handle:visible')).toHaveCount(0);
 await page.setViewportSize({width:1280,height:900});
 await expect(page.locator('#meetingList .mcol-layout>.split-resize-handle')).toHaveCount(2);
 await expect(page.locator('#meetingList .mcol-layout>.split-resize-handle').first()).toBeVisible();
 await page.setViewportSize({width:390,height:800});
 await expect(page.locator('.split-resize-handle:visible')).toHaveCount(0);
});

// UI-작은결정묶음 ④: 3단은 자기 이름(reports3)에만 쓰고, 아직 없으면 예전에 같이 쓰던 reports 값(두 경계 묶음)에서 시작한다. 2단 값은 건드리지 않는다.
test('3단 폭은 reports3에 따로 기억하고 처음엔 예전 reports 값을 이어받는다',async({page})=>{
 const old=0.350571; // 종류 0.2 · 차수 0.15 · 결과 0.65 (encodeTriple)
 const errors=await open(page,1280,{initial:{split_ratio:{reports:old}}});
 let m=await widths(page);expect(Math.abs(m.kinds/m.total-0.2)).toBeLessThan(0.01);expect(Math.abs(m.rounds/m.total-0.15)).toBeLessThan(0.01);
 expect(stored()).toBeNull();
 await dragTo(page,0,await xFor(page,0,0.15));
 await expect.poll(()=>typeof stored()).toBe('number');
 expect(prefs.value.split_ratio.reports).toBe(old);
 expect(errors).toEqual([]);
});
