import {showBasketRow} from './helpers/basket-more.mjs';
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {noteMenuAction} from './helpers/note-menu.mjs';
import { chooseBasketKind, basketKindButton } from './helpers/basket-kind.mjs';
// UI-버튼작게(2026-10-18 사용자 결정):
// ① 바구니 노트·메모 읽기 화면 아래 버튼은 한 줄, 보이는 높이 32px(누르는 범위 44px), [연결하기]만 주 버튼 색. 첨부만 있는 메모도 같음. 노트는 UI-노트메뉴정리로 이 줄이 없어지고 [⋯] 안으로 들어갔다.
// ② 메뉴 [쓰기] 큰 편집기 서식 도구줄 버튼은 보이는 높이 28px(누르는 범위 44px).
// ③ 폰(760px 이하): 일정 [달력|할 일|일지|일기]·바구니 [메모|노트] 전환은 아래 탭 6칸 바로 위 한 줄(알약, 32px, 고른 쪽 회색).
//    자판이 뜨면 아래 탭과 함께 숨고, 공용 [+]는 전환 줄 바로 위. 노트·메모를 연 동안은 보이지 않는다. PC는 그대로 위.
// 캡처: UI_REVIEW_DIR=<폴더>가 있으면 390·1280 라이트·다크를 그 폴더에 남긴다(docs/review/ui-small-buttons/).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const REVIEW=process.env.UI_REVIEW_DIR||'';
test.use({hasTouch:true});
const at='2026-10-05T01:00:00Z';
const row=extra=>({workspace_id:'w',title:null,journal_day:null,occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},...extra});

async function fixture(page,{width=390,height=844,scheme='light'}={}){
 const errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await page.emulateMedia({colorScheme:scheme});
 await page.setViewportSize({width,height});
 await openHome(page);
 const rows=[
  row({id:'m1',kind:'basket',raw_text:'10/20 기자회견 준비 메모'}),
  row({id:'m2',kind:'basket',raw_text:'',attachments:[{drive_file_id:'drive-hwp',file_name:'임단협 요구안.hwp',mime_type:'application/x-hwp',size_bytes:2048}]}),
  row({id:'n1',kind:'note',title:'임금협상 정리',raw_text:'## 쟁점\n\n- 기본급 인상',updated_at:'2026-10-05T02:00:00Z'}),
 ];
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='GET'){
   if(q.get('metadata'))return r.fulfill({json:[]});
   return r.fulfill({json:rows.filter(x=>(!q.get('kind')||q.get('kind')==='eq.'+x.kind)&&(!q.get('id')||q.get('id')==='eq.'+x.id)).slice(Number(q.get('offset')||0))});
  }
  writes.push({method:req.method(),url:req.url()});return r.fulfill({status:500,json:{}});
 });
 for(const t of ['app_suborganizations','app_suborganization_assignees','app_spaces'])await page.route(SB+'/rest/v1/'+t+'?**',r=>r.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 return {errors,writes};
}
const go=async(page,view)=>{await page.evaluate(v=>window.KPTURouter.go(v),view);await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe(view);};
const tap=async(page,locator,width)=>{await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();};
const paint=(page,prop,name)=>page.evaluate(([prop,name])=>{const e=document.createElement('span');e.style[prop]=`var(${name})`;document.querySelector('#appView').append(e);const c=getComputedStyle(e)[prop];e.remove();return c;},[prop,name]);
// Visible box and the ::after press area (centred on the button).
const measure=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect(),a=getComputedStyle(el,'::after');
 const top=r.top+parseFloat(a.top),h=parseFloat(a.height),hits=[r.top+r.height/2,top+1,top+h-1].map(y=>document.elementFromPoint(r.left+r.width/2,y)?.closest('button')===el);
 return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom,hit:h,hits,bg:getComputedStyle(el).backgroundColor,radius:getComputedStyle(el).borderTopLeftRadius};});
// The phone keyboard as most Android browsers show it: only the visual viewport shrinks (as in ui-keyboard-tabbar.spec).
const keyboard=(page,open)=>page.evaluate(open=>{if(open)Object.defineProperty(window.visualViewport,'height',{configurable:true,value:444});else delete window.visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));},open);
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

async function readRow(page,actions,labels,width){
 await expect(actions.getByRole('button')).toHaveText(labels);
 const boxes=[];for(const b of await actions.getByRole('button').all())boxes.push(await measure(b));
 for(const [i,b] of boxes.entries()){
  expect(b.h,labels[i]).toBe(32);expect(b.hit,labels[i]).toBe(44);expect(b.hits,labels[i]).toEqual([true,true,true]);
  expect(Math.abs(b.y-boxes[0].y),labels[i]).toBeLessThan(1);
  if(i)expect(b.x,labels[i]).toBeGreaterThan(boxes[i-1].right);
 }
 expect(boxes.at(-1).right).toBeLessThanOrEqual(width);
 return boxes;
}

for(const width of [390,1280]){
 test(`① 읽기 화면 아래 버튼: 한 줄·32px·누르는 범위 44px, 세 버튼 같은 모양 (노트·메모·첨부 메모) ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  const surface=await paint(page,'backgroundColor','--kptu-surface');
  await go(page,'basket');
  // 노트 (UI-노트메뉴정리): 본문 아래 [수정][연결하기] 줄이 없다. 수정·연결하기는 맨 위 한 줄의 [⋯] 안에 있다.
  await tap(page,basketKindButton(page,'note'),width);
  await tap(page,page.locator('[data-note-row="n1"]'),width);
  await expect(page.locator('[data-note-read-actions]')).toHaveCount(0);
  await expect(page.locator('[data-note-detail]').getByRole('button',{name:'연결하기',exact:true})).toHaveCount(0);
  expect(await noWideScroll(page)).toBe(true);
  // The ⋯ still does what the buttons did: [수정] opens the edit view, [취소] returns to the read view.
  await noteMenuAction(page,'data-note-edit',{width});
  await expect(page.locator('[data-note-editor]')).toBeVisible();
  await tap(page,page.locator('[data-note-cancel]'),width);await expect(page.locator('[data-note-more]')).toBeVisible();
  await tap(page,page.locator('[data-note-close]'),width);
  // 메모: [연결하기][할 일 만들기][노트로 옮기기] — 같은 규칙, 세 버튼 모두 같은 모양(UI-바구니상세버튼색).
  await tap(page,basketKindButton(page,'memo'),width);
  await showBasketRow(page,'m1');
  await tap(page,page.locator('[data-basket-row="m1"]'),width);
  const memoRow=page.locator('[data-basket-read-actions]');
  const memo=await readRow(page,memoRow,['연결하기','할 일 만들기','노트로 옮기기'],width);
  expect(memo[0].bg).toBe(surface);expect(memo[1].bg).toBe(surface);expect(memo[2].bg).toBe(surface);
  await tap(page,memoRow.getByRole('button',{name:'할 일 만들기',exact:true}),width);
  await expect(page.locator('[data-basket-manual]')).toBeVisible();await expect(memoRow).toBeHidden();
  await page.keyboard.press('Escape');
  await go(page,'home');await go(page,'basket');
  // 첨부만 있는 메모 화면도 같은 규칙.
  await showBasketRow(page,'m2');
  await tap(page,page.locator('[data-basket-row="m2"]'),width);
  await expect(page.locator('[data-basket-file-card="drive-hwp"]')).toBeVisible();
  await readRow(page,page.locator('[data-basket-read-actions]'),['연결하기','할 일 만들기','노트로 옮기기'],width);
  expect(await noWideScroll(page)).toBe(true);
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });

 test(`② 쓰기 창 서식 도구줄 버튼 28px·누르는 범위 44px, 줄은 머리줄 바로 아래 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  if(width<761){await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu [data-menu-write]').click();}
  else await page.locator('#appView>.app-nav [data-menu-write]').click();
  const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();
  const tools=editor.locator('.md-editor-tools');
  const buttons=await tools.locator('button').all();expect(buttons.length).toBeGreaterThan(10);
  for(const b of buttons){const m=await b.evaluate(el=>{const r=el.getBoundingClientRect(),a=getComputedStyle(el,'::after');return {h:r.height,hit:a.height,font:getComputedStyle(el).fontSize};});
   expect(m.h).toBe(28);expect(m.hit).toBe('44px');expect(m.font).toBe('13px');}
  // The row is the press height (44px), right under the head and above the text.
  const [head,row,text]=await Promise.all([editor.locator('.md-editor-head'),tools,editor.locator('.md-editor-text')].map(l=>l.boundingBox()));
  expect(Math.round(row.height)).toBe(44);expect(Math.abs(row.y-(head.y+head.height))).toBeLessThan(2);expect(text.y).toBeGreaterThanOrEqual(row.y+row.height-1);
  // The whole 44px press area of a visible button lands on that button.
  const first=tools.locator('button').first(),fb=await first.boundingBox();
  for(const y of [fb.y+fb.height/2-21,fb.y+fb.height/2+21])expect(await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.closest('button')?.dataset.mdAction,[fb.x+fb.width/2,y])).toBe('heading-menu');
  // The choice row under it follows the same size.
  await tap(page,editor.getByRole('button',{name:'제목 단계 고르기',exact:true}),width);
  const choices=editor.locator('.md-editor-menu button');await expect(choices).toHaveText(['제목 1','제목 2','제목 3']);
  for(const b of await choices.all())expect((await b.boundingBox()).height).toBe(28);
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });
}

test('③ 폰: 일정·바구니 전환은 아래 탭 바로 위 한 줄(알약 32px, 고른 쪽 회색), 고르면 화면이 바뀌고 [+]는 그 위',async({page})=>{
 const f=await fixture(page);
 const tabs=page.locator('#appView > .mobile-tabs'),tabsTop=(await tabs.boundingBox()).y;
 const gray=await paint(page,'backgroundColor','--ds-kind-other-soft'),white=await paint(page,'backgroundColor','--kptu-surface');
 const header=await page.locator('.mobile-shell-header').boundingBox();
 async function dock(switchSel,labels,picked){
  const sw=page.locator(switchSel);await expect(sw).toBeVisible();
  await expect(sw.getByRole('button')).toHaveText(labels);
  const b=await sw.boundingBox();
  // A 44px row right on top of the tabs; the 32px pill sits in its middle, centred across the screen.
  expect(Math.round(b.height)).toBe(32);expect(Math.round(tabsTop-(b.y+b.height))).toBe(6);expect(Math.abs(b.x+b.width/2-195)).toBeLessThanOrEqual(1);
  expect(b.y).toBeGreaterThan(header.y+header.height+300);
  const cells=[];for(const c of await sw.getByRole('button').all())cells.push(await measure(c));
  // Cells sit inside the pill's 0.5px border (like every segment, ui-standard-buttons.spec: 30~32px).
  for(const [i,c] of cells.entries()){expect(c.h).toBeGreaterThanOrEqual(30);expect(c.h).toBeLessThanOrEqual(32);expect(c.hit).toBe(44);expect(c.hits).toEqual([true,true,true]);expect(c.bg).toBe(labels[i]===picked?gray:white);}
  expect(cells[0].radius).toBe('999px');
  // The row behind the pill is filled (nothing from the page shows through between the pill and the tabs).
  expect(await page.evaluate(([x,y])=>!!document.elementFromPoint(x,y)?.closest('.schedule-switch,.basket-kind-switch'),[20,b.y+b.height/2])).toBe(true);
  return b;
 }
 const fabOf={calendar:'#calendarView .calendar-toolbar #newEventBtn',diary:'#diaryRoot #newDiaryBtn'};
 const fabAbove=async(sel,row)=>{const b=await page.locator(sel).boundingBox();expect(Math.round(row.y-(b.y+b.height))).toBe(6+12+4);};
 // 일정: [달력] → [할 일] → [업무일지] → [일기], each choice changes the screen; the [+] stays at one spot above the row.
 await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
 await expect(page.locator('#calendarView')).toBeVisible();
 let row=await dock('#calendarView .schedule-switch',['달력','할 일','업무일지','일기'],'달력');
 await fabAbove(fabOf.calendar,row);const spot=await page.locator(fabOf.calendar).boundingBox();
 for(const [view,label] of [['tasks','할 일'],['journal','업무일지'],['diary','일기'],['calendar','달력']]){
  await page.locator(`#appView .view-panel:not(.hidden) > .schedule-switch [data-view="${view}"]`).tap();
  await expect(page.locator(`#${view}View`)).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe(view);
  row=await dock(`#${view}View .schedule-switch`,['달력','할 일','업무일지','일기'],label);
  if(fabOf[view]){const b=await page.locator(fabOf[view]).boundingBox();expect({x:Math.round(b.x),y:Math.round(b.y)}).toEqual({x:Math.round(spot.x),y:Math.round(spot.y)});}
 }
 // 달력 끝 여백(::after)이 탭 + 전환 줄 + [+] 만큼(56 + 44 + 12 + 44 + 8): 끝까지 내려도 마지막 줄이 가리지 않는다.
 expect(await page.locator('#calendarView').evaluate(el=>getComputedStyle(el,'::after').height)).toBe('164px');
 // 할 일 목록 끝 여백: [+] 대신 늘 보이는 입력 칸(UI-할일입력) 높이 + 전환 줄 + 16.
 await go(page,'tasks');const quickH=await page.locator('#tasksView .home-quick').evaluate(el=>Math.ceil(el.getBoundingClientRect().height));
 expect(await page.locator('#tasksView').evaluate(el=>getComputedStyle(el).paddingBottom)).toBe(`${quickH+44+16}px`);
 await go(page,'calendar');
 // 바구니: [메모] → [노트]; 메모·노트 목록 모두 입력칸이 전환 줄 바로 위(BASKET-노트입력창: 노트도 [+] 대신 같은 입력칸).
 await page.locator('.mobile-tabs [data-view="basket"]').tap();
 row=await dock('#basketView .basket-kind-switch',['업데이트','노트'],'업데이트');
 const quick=await page.locator('#basketView [data-basket-list] .home-quick').boundingBox();expect(Math.round(quick.y+quick.height)).toBe(Math.round(row.y-6));
 // Filters stay at the top, alone on their row.
 const filter=await page.locator('[data-basket-filter="unclassified"]').boundingBox();expect(filter.y).toBeLessThan(header.y+header.height+40);
 await page.locator('[data-basket-kind="note"]').tap();
 await expect(page.locator('[data-note-row="n1"]')).toBeVisible();
 row=await dock('#basketView .basket-kind-switch',['업데이트','노트'],'노트');
 await expect(page.locator('#basketView #newNoteBtn')).toHaveCount(0);
 const noteQuick=await page.locator('#basketView [data-note-list] .home-quick').boundingBox();expect(Math.round(noteQuick.y+noteQuick.height)).toBe(Math.round(row.y-6));
 // An opened note (head "‹ 노트") keeps the row hidden, as before (#660 ⑥); it comes back on close.
 await page.locator('[data-note-row="n1"]').tap();await expect(page.locator('[data-note-close]')).toBeVisible();
 await expect(page.locator('#basketView .basket-kind-switch')).toBeHidden();
 await page.locator('[data-note-close]').tap();await expect(page.locator('#basketView .basket-kind-switch')).toBeVisible();
 // The same for an opened memo.
 await page.locator('[data-basket-kind="memo"]').tap();await showBasketRow(page,'m1');
 await page.locator('[data-basket-row="m1"]').tap();await expect(page.locator('[data-basket-close]')).toBeVisible();
 await expect(page.locator('#basketView .basket-kind-switch')).toBeHidden();
 expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--kptu-switch-dock').trim()||'0px')).toBe('0px');
 await page.locator('[data-basket-close]').tap();await expect(page.locator('#basketView .basket-kind-switch')).toBeVisible();
 // One painter per screen: each switch is the screen's own element, there is no second copy anywhere.
 expect(await page.locator('.schedule-switch').count()).toBe(4);expect(await page.locator('.basket-kind-switch').count()).toBe(1);
 for(const v of ['calendar','tasks','journal','diary'])expect(await page.locator(`#${v}View > .schedule-switch`).count()).toBe(1);
 expect(await noWideScroll(page)).toBe(true);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('③ 폰: 자판이 뜨면 전환 줄·아래 탭이 함께 숨고, 내려가면 둘 다 돌아온다(일정·바구니)',async({page})=>{
 const f=await fixture(page);
 const tabs=page.locator('#appView > .mobile-tabs');
 // 바구니 메모: 빠른 입력칸에 초점 → 자판.
 await page.locator('.mobile-tabs [data-view="basket"]').tap();
 const sw=page.locator('#basketView .basket-kind-switch');await expect(sw).toBeVisible();
 await page.locator('#basketView [data-basket-list] .home-quick [data-quick-input]').focus();await keyboard(page,true);
 await expect(page.locator('body')).toHaveClass(/kptu-mobile-keyboard/);
 await expect(tabs).toBeHidden();await expect(sw).toBeHidden();
 // The input sits right on the keyboard (no room left for the hidden row).
 await expect.poll(async()=>{const b=await page.locator('#basketView [data-basket-list] .home-quick').boundingBox();return Math.round(b.y+b.height);}).toBe(444);
 await keyboard(page,false);
 await expect(tabs).toBeVisible();await expect(sw).toBeVisible();
 // 노트 검색칸도 같은 공용 감지.
 await page.locator('[data-basket-kind="note"]').tap();await page.locator('[data-note-search]').focus();await keyboard(page,true);
 await expect(tabs).toBeHidden();await expect(sw).toBeHidden();
 await keyboard(page,false);await expect(tabs).toBeVisible();await expect(sw).toBeVisible();await expect(page.locator('#basketView [data-note-list] .home-quick')).toBeVisible();
 // 일정 [일기]: 글 칸에 초점 → 자판.
 await page.locator('[data-note-search]').blur();
 await page.locator('.mobile-tabs [data-mobile-schedule-tab]').tap();
 await page.locator('#appView .view-panel:not(.hidden) > .schedule-switch [data-view="diary"]').tap();
 const diarySwitch=page.locator('#diaryView .schedule-switch');await expect(diarySwitch).toBeVisible();
 await page.locator('#diaryRoot #newDiaryBtn').tap();
 // The editor focuses its heading one frame after it opens: wait for it, or that focus can land after ours and the
 // keyboard check sees a heading (not a text field) focused.
 await expect(page.locator('#diaryRoot #diaryEditorTitle')).toBeFocused();
 const text=page.locator('#diaryRoot [data-diary-text]');await expect(text).toBeVisible();await text.focus();await expect(text).toBeFocused();await keyboard(page,true);
 await expect(tabs).toBeHidden();await expect(diarySwitch).toBeHidden();
 await keyboard(page,false);await expect(tabs).toBeVisible();await expect(diarySwitch).toBeVisible();
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('③ 폰: 전환 줄이 있는 바구니·일정에서 고르기 시트는 전환 줄 위에서 열리고, 고른 뒤 같은 자리 누름이 전환 줄로 가지 않음',async({page})=>{
 const f=await fixture(page);
 const settle=sheet=>sheet.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
 async function aboveRow(sheet,row){
  const box=await sheet.boundingBox(),r=await row.boundingBox(),tabs=await page.locator('#appView > .mobile-tabs').boundingBox();
  // The row is 44px on the tabs; the sheet ends where that row starts.
  expect(Math.round(box.y+box.height)).toBe(Math.round(tabs.y-44));expect(box.y+box.height).toBeLessThanOrEqual(r.y-6+0.5);
  for(const item of await sheet.locator('[data-sheet-value]').all()){const b=await item.boundingBox();expect(b.y+b.height).toBeLessThanOrEqual(tabs.y-44);}
 }
 // 바구니 빠른 입력은 [바구니] 한 가지라 고르기 시트가 없다. 전환 줄이 보이는 일정 화면에서 일정 창 [할 일]의 프로젝트 고르기로 본다.
 await page.locator('.mobile-tabs [data-mobile-schedule-tab]').tap();
 const row=page.locator('#calendarView .schedule-switch');await expect(row).toBeVisible();
 await page.waitForFunction(()=>window.KPTUCalendarPlus);
 await page.locator('#calendarView .calendar-toolbar #newEventBtn').tap();
 await expect(page.locator('#eventModal')).toBeVisible();
 await page.locator('[data-event-mode="task"]').tap();
 await page.locator('#eventTaskProject').tap();
 const sheet=page.locator('#eventProjectSheet');await expect(sheet).toHaveAttribute('open','');await settle(sheet);
 await aboveRow(sheet,row);
 // Pick the lowest row at its bottom edge, then press the same spot again: it must not reach the switch row.
 const last=await sheet.locator('[data-sheet-value]').last().boundingBox(),x=last.x+last.width/2,y=last.y+last.height-2;
 await page.touchscreen.tap(x,y);await expect(sheet).not.toHaveAttribute('open','');
 await page.touchscreen.tap(x,y);
 expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('calendar');
 await expect(page.locator('#eventModal')).toBeVisible();
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

// BASKET-노트입력창 (2026-10-22 사용자 결정): PC(≥1024)에는 바구니 화면 위 [업데이트 | 노트]가 없다 — 사이드바 [바구니] 아래
// [업데이트]·[노트]가 맡는다. 필터 줄은 그대로 목록 위.
test('③ PC 1280: 바구니 [업데이트|노트]는 사이드바가 맡고(화면 위 전환 없음), 일정 전환도 보이지 않음, [+]·아래 탭 없음',async({page})=>{
 const f=await fixture(page,{width:1280,height:900});
 await go(page,'basket');
 const sw=page.locator('#basketView .basket-kind-switch');await expect(sw).toBeHidden();
 const sub=page.locator('#appView > .app-nav [data-basket-kind-nav]');await expect(sub).toHaveText(['업데이트','노트']);
 const filter=await page.locator('[data-basket-filter="unclassified"]').boundingBox(),rows=await page.locator('#basketView [data-basket-rows]').boundingBox();
 expect(filter.y+filter.height).toBeLessThanOrEqual(rows.y);
 await sub.nth(1).click();await expect(page.locator('[data-note-row="n1"]')).toBeVisible();await expect(sw).toBeHidden();
 await sub.nth(0).click();await expect(page.locator('#basketView [data-basket-list]')).toBeVisible();
 await expect(page.locator('.mobile-tabs')).toBeHidden();
 for(const v of ['calendar','tasks']){await go(page,v);await expect(page.locator(`#${v}View .schedule-switch`)).toBeHidden();}
 expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--kptu-switch-dock').trim()||'0px')).toBe('0px');
 expect(f.errors).toEqual([]);
});

if(REVIEW){
 for(const scheme of ['light','dark'])for(const width of [390,1280]){
  test(`캡처 ${width} ${scheme}`,async({page})=>{
   await fixture(page,{width,scheme});
   const shot=name=>page.screenshot({path:`${REVIEW}/${name}-${width}-${scheme}.png`});
   await go(page,'basket');await showBasketRow(page,'m1');await expect(page.locator('[data-basket-row="m1"]')).toBeVisible();await shot('basket-memo-list');
   await page.locator('[data-basket-row="m1"]').click();await expect(page.locator('[data-basket-read-actions]')).toBeVisible();await shot('memo-read');
   await page.locator('[data-basket-close]').click();
   await chooseBasketKind(page,'note');await expect(page.locator('[data-note-row="n1"]')).toBeVisible();await shot('basket-note-list');
   await page.locator('[data-note-row="n1"]').click();await expect(page.locator('[data-note-more]')).toBeVisible();await shot('note-read');
   await page.locator('[data-note-close]').click();
   await go(page,'calendar');await page.waitForTimeout(300);await shot('calendar');
   await go(page,'diary');await expect(page.locator('#diaryRoot [data-diary-day="2026-10-06"]')).toBeVisible();await shot('diary');
   if(width<761){await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu [data-menu-write]').click();}
   else await page.locator('#appView>.app-nav [data-menu-write]').click();
   await expect(page.locator('#mdEditor')).toBeVisible();await shot('write');
  });
 }
}
