import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// UI-PC스크롤묶음(S56-43, 2026-11-10): PC(761px~) 스크롤을 한 가지로.
// ① 맨 위 줄(뒤로·위치·검색·+ 추가)은 모든 화면에서 화면 맨 위에 붙어 늘 보인다(CC 결정 '늘 보임', 달력·할 일과 같은 방식).
// ② '목록 | 상세' 화면의 붙은 칸 위에서 굴린 휠은 칸에 굴릴 것이 없거나 칸 끝이면 문서 스크롤로 넘어간다.
// ③ 창(.modal)이 떠 있는 동안 창 바깥에서 굴린 휠로 뒤 화면이 움직이지 않는다.
// ④ 내용이 화면에 다 들어오는 화면은 문서가 내려가지 않는다(사이드바가 빈 줄 40칸에 걸쳐 생기던 빈 높이·본문 아래 76px 여백 없앰).
// 시험만 쓰는 긴 여백(::after)으로 문서를 길게 만든다. 이름·글은 모두 합성 값.
const top=page=>page.locator('#appView>.app-topline').evaluate(e=>Math.round(e.getBoundingClientRect().top));
const lengthen=(page,view)=>page.addStyleTag({content:`#${view}View::after{content:"";display:block;height:2400px}`});
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));

for(const width of [1280,884]){
  test(`${width}: 맨 위 줄은 화면을 끝까지 내려도 맨 위에 붙어 있고, 짧은 화면은 문서가 내려가지 않는다`,async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:800});await openHome(page);
    for(const [nav,view] of [['library','library'],['pages','pages'],['basket','basket'],['home','home'],['meetings','meetings']]){
      await clickView(page,nav);await expect(page.locator(`#${view}View`)).toBeVisible();await settle(page);
      if(nav==='library'||nav==='pages')expect(await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight),`${nav}: 빈 높이로 문서가 내려가지 않음`).toBeLessThanOrEqual(0);
      await lengthen(page,view);await settle(page);
      await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await settle(page);
      expect(await page.evaluate(()=>scrollY),nav).toBeGreaterThan(1000);
      expect(await top(page),`${nav}: 맨 위 줄이 화면 맨 위`).toBe(0);
      await expect(page.locator('#appView>.app-topline [data-quick-add]')).toBeInViewport();
      // 붙은 줄 아래로 지나가는 글이 비치지 않게 줄은 바탕색이 있다.
      expect(await page.locator('#appView>.app-topline').evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      await page.evaluate(()=>scrollTo(0,0));
    }
  });
}

test('1280: 창이 떠 있는 동안 창 바깥 휠로 뒤 화면이 움직이지 않고, 창이 닫히면 다시 움직인다',async({page})=>{
  await page.setViewportSize({width:1280,height:800});await openHome(page);
  await clickView(page,'library');await expect(page.locator('#libraryView')).toBeVisible();
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded?.('library')!==false);
  await lengthen(page,'library');await settle(page);
  await page.evaluate(()=>{const m=document.createElement('div');m.id='zzScrollModal';m.className='modal';m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');
    m.innerHTML='<div class="modal-card" style="width:320px;max-height:200px"><div style="height:600px">합성 창 내용</div></div>';document.body.append(m)});
  // 창이 화면에 그려져 휠 자리(40,400)를 덮은 뒤에 굴린다(붙인 직후 프레임 전에 굴리면 휠이 뒤 화면으로 감, STAB-main화면시험흔들림).
  await settle(page);await expect.poll(()=>page.evaluate(()=>document.elementFromPoint(40,400)?.id)).toBe('zzScrollModal');
  await page.mouse.move(40,400);await page.mouse.wheel(0,500);await page.waitForTimeout(300);
  expect(await page.evaluate(()=>scrollY),'바탕 위 휠').toBe(0);
  // 창 안 내용은 굴러가고, 끝에 닿아도 뒤 화면으로 넘어가지 않는다.
  await page.mouse.move(640,400);for(let i=0;i<4;i++)await page.mouse.wheel(0,400);await page.waitForTimeout(300);
  expect(await page.locator('#zzScrollModal .modal-card').evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>scrollY),'창 끝에서 넘어가지 않음').toBe(0);
  await page.evaluate(()=>document.querySelector('#zzScrollModal').remove());
  await page.mouse.move(640,400);await page.mouse.wheel(0,500);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
});

test('1280: 조직 보고 상세 칸 위 휠 — 칸 끝에 닿으면 문서가 내려가고, 칸은 맨 위 줄 아래에 붙는다',async({page})=>{
  await page.setViewportSize({width:1280,height:800});await openHome(page);
  await clickView(page,'team');
  const pane=page.locator('#wdDetailPane.kptu-follow-pane');await expect(pane).toBeVisible();
  expect(await pane.evaluate(e=>getComputedStyle(e).overscrollBehaviorY)).toBe('auto');
  // 왼쪽 목록을 길게(칸이 든 줄이 길어야 칸이 붙어 따라온다).
  await page.addStyleTag({content:'#soOrganizationList::after{content:"";display:block;height:2400px}'});await settle(page);
  await pane.evaluate(e=>{e.scrollTop=e.scrollHeight});
  const box=await pane.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+Math.min(box.height/2,200));
  await page.mouse.wheel(0,400);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
  // 칸이 붙는 자리 = 맨 위 줄(40px) + 간격(8px) + 12px.
  await page.evaluate(()=>scrollTo(0,1500));await settle(page);
  expect(await pane.evaluate(e=>Math.round(e.getBoundingClientRect().top))).toBe(60);
  expect(await top(page)).toBe(0);
});

test('1280: <dialog> 창이 떠 있는 동안 바탕 위 휠로 뒤 화면이 움직이지 않는다(공용 창 부품)',async({page})=>{
  await page.setViewportSize({width:1280,height:800});await openHome(page);
  await clickView(page,'library');await lengthen(page,'library');await settle(page);
  await page.evaluate(()=>{const d=document.createElement('dialog');d.id='zzScrollDialog';d.innerHTML='<p>합성 창</p>';document.body.append(d);d.showModal()});
  await page.mouse.move(40,400);await page.mouse.wheel(0,500);await page.waitForTimeout(300);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
  await page.mouse.move(640,400);await page.mouse.wheel(0,500);await page.waitForTimeout(300);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
  await page.evaluate(()=>document.querySelector('#zzScrollDialog').close());
  await page.mouse.wheel(0,500);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
});
