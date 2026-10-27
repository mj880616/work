import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {noteMenuAction} from './helpers/note-menu.mjs';
import { chooseBasketKind, basketPaneButton } from './helpers/basket-kind.mjs';
import { closeNote } from './helpers/note-close.mjs';
// UI-일기손질: ① the shared round [+] never moves when a button is pressed (it used to jump while the finger was down,
// because the swipe code put will-change:transform on the view panel and the fixed [+] then followed the panel),
// ② today = filled purple circle on the day number, the chosen day = the cell border, ③ [+] in [일기] writes the chosen day,
// ⑤ an empty note list has no guide sentence, ⑥ an opened note draws only its own "‹ 노트" head, files are the shared file line.
// The clock is 2026-10-06 KST (openHome). Captures: UI_REVIEW_DIR=<folder> keeps 390·1280 light·dark there.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const REVIEW=process.env.UI_REVIEW_DIR||'';
const at='2026-10-05T01:00:00Z';
const row=extra=>({workspace_id:'w',title:null,journal_day:null,occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},...extra});

async function fixture(page,{width=390,notes=true,scheme='light'}={}){
 const errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await page.emulateMedia({colorScheme:scheme});
 await page.setViewportSize({width,height:844});
 await openHome(page);
 const rows=[
  row({id:'d4',kind:'diary',journal_day:'2026-10-04',raw_text:'글만 쓴 날',ai_export_allowed:false}),
  ...(notes?[row({id:'n1',kind:'note',title:'임금협상 정리',raw_text:'## 쟁점\n\n- 기본급',attachments:[{drive_file_id:'f_pdf',file_name:'교섭요구안.pdf',mime_type:'application/pdf',size_bytes:204800},{drive_file_id:'f_hwp',file_name:'회의 결과.hwp',mime_type:'application/x-hwp',size_bytes:4096}]})]:[]),
 ];
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='GET'){
   if(q.get('metadata'))return r.fulfill({json:[]});
   return r.fulfill({json:rows.filter(x=>(!q.get('kind')||q.get('kind')==='eq.'+x.kind)&&(!q.get('journal_day')||!q.get('journal_day').startsWith('eq.')||q.get('journal_day')==='eq.'+x.journal_day))});
  }
  const body=req.postDataJSON();writes.push({method:req.method(),body});
  if(req.method()==='POST'){const made=row({id:'d-new',updated_at:'2026-10-06T01:00:01Z',...body});rows.push(made);return r.fulfill({status:201,json:[made]});}
  return r.fulfill({status:500,json:{}});
 });
 return {errors,writes,rows};
}
// Same pressing order as a phone: finger down (touchstart), then the click. The [+] is measured at both moments.
async function pressAndMeasure(page,target,fab){
 const during=await page.evaluate(([t,f])=>{
  const el=document.querySelector(t),r=el.getBoundingClientRect(),x=r.left+Math.min(10,r.width/2),y=r.top+Math.min(10,r.height/2);
  const ev=new Event('touchstart',{bubbles:true,cancelable:true});
  Object.defineProperty(ev,'touches',{value:[{clientX:x,clientY:y}]});Object.defineProperty(ev,'changedTouches',{value:[{clientX:x,clientY:y}]});
  el.dispatchEvent(ev);
  const b=document.querySelector(f).getBoundingClientRect();
  const end=new Event('touchend',{bubbles:true,cancelable:true});
  Object.defineProperty(end,'touches',{value:[]});Object.defineProperty(end,'changedTouches',{value:[{clientX:x,clientY:y}]});
  el.dispatchEvent(end);el.click();
  return {x:Math.round(b.x),y:Math.round(b.y)};
 },[target,fab]);
 // A window opened by the press covers the [+]; "after" is then measured once it is closed.
 const box=await page.locator(fab).boundingBox();
 return {during,after:box&&{x:Math.round(box.x),y:Math.round(box.y)}};
}
const fabSpot=async(page,fab)=>{const b=await page.locator(fab).boundingBox();return {x:Math.round(b.x),y:Math.round(b.y)};};
async function openMonth(page){
 await page.evaluate(()=>window.KPTURouter.go('calendar'));
 await page.locator('#calendarView [data-calendar-view="month"]').click();
 await expect(page.locator('#calendarGrid .cal-cell').first()).toBeVisible();
}
const tabsTop=page=>page.locator('#appView > .mobile-tabs').evaluate(el=>el.getBoundingClientRect().top);

test('① the shared [+] stays at the bottom right whatever is pressed (calendar, diary, tasks, notes)',async({page})=>{
 const f=await fixture(page);
 await openMonth(page);
 const fab='#calendarView .calendar-toolbar #newEventBtn';
 const home=await fabSpot(page,fab),top=await tabsTop(page);
 // Bottom right, just above the switch row that sits on the bottom tabs (UI-버튼작게 ③: row 44px).
 expect(home.x+36).toBeGreaterThan(390-30);expect(home.y+36).toBeLessThanOrEqual(top-44);expect(home.y+36).toBeGreaterThan(top-44-40);
 for(const target of ['#calendarTodayBtn','#calendarGrid .cmv-date-list[data-date="2026-10-20"]']){
  const seen=await pressAndMeasure(page,target,fab);
  expect(seen.during,target).toEqual(home);
  if(await page.locator('#calendarDayModal').isVisible()){await page.keyboard.press('Escape');await expect(page.locator('#calendarDayModal')).toBeHidden();}
  expect(await fabSpot(page,fab),target).toEqual(home);
 }
 // Tab change ([달력 | 할 일 | 일지 | 일기]) and the next screen's [+]: the same spot.
 const tasks=await pressAndMeasure(page,'#calendarView .schedule-switch [data-view="tasks"]',fab);
 expect(tasks.during).toEqual(home);
 await expect(page.locator('#tasksView')).toBeVisible();
 // UI-할일입력: [할 일] has the always-visible input instead of a [+].
 await expect(page.locator('#tasksView #newTaskBtn')).toHaveCount(0);await expect(page.locator('#tasksView .home-quick [data-quick-input]')).toBeVisible();
 await page.locator('#tasksView .schedule-switch [data-view="diary"]').click();
 await expect(page.locator('#diaryRoot [data-diary-day="2026-10-06"]')).toBeVisible();
 const diaryFab='#diaryRoot #newDiaryBtn';
 expect(await fabSpot(page,diaryFab)).toEqual(home);
 for(const target of ['#diaryRoot [data-diary-today]','#diaryRoot [data-diary-day="2026-10-04"]','#diaryRoot [data-diary-next]']){
  const seen=await pressAndMeasure(page,target,diaryFab);
  expect(seen.during,target).toEqual(home);expect(seen.after,target).toEqual(home);
 }
 // UI-밀기탭이동삭제: 탭 이동은 하단 탭 누르기뿐이다.
 await page.locator('.mobile-tabs [data-view="basket"]').click();
 await chooseBasketKind(page,'note');
 await expect(page.locator('[data-note-row="n1"]')).toBeVisible();
 // BASKET-노트입력창: notes have no [+] any more; the note input docked above the tabs stays put the same way.
 await expect(page.locator('#basketView #newNoteBtn')).toHaveCount(0);
 const dockSel='#basketView [data-note-list] [data-home-quick]',dock=await fabSpot(page,dockSel);
 const seen=await pressAndMeasure(page,'[data-note-search]',dockSel);
 expect(seen.during).toEqual(dock);expect(seen.after).toEqual(dock);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`② today is a filled theme-primary circle on the number, the chosen day keeps the border (일기·달력) ${width}`,async({page})=>{
 const f=await fixture(page,{width});
 await page.evaluate(()=>window.KPTURouter.go('diary'));
 const today=page.locator('#diaryRoot [data-diary-day="2026-10-06"]'),other=page.locator('#diaryRoot [data-diary-day="2026-10-04"]');
 await expect(today).toHaveAttribute('aria-current','date');
 const purple=await page.evaluate(()=>{const e=document.createElement('span');e.style.color='var(--kptu-primary-ink)';document.querySelector('#diaryView').append(e);const c=getComputedStyle(e).color;e.remove();return c;});
 const look=loc=>loc.evaluate(el=>{const n=el.querySelector('.diary-num'),c=getComputedStyle(n),cell=getComputedStyle(el);const r=n.getBoundingClientRect();return {bg:c.backgroundColor,radius:c.borderRadius,w:Math.round(r.width),h:Math.round(r.height),ring:cell.boxShadow};});
 const t=await look(today),o=await look(other);
 expect(t.bg).toBe(purple);expect(t.radius).toBe('999px');expect(t.h).toBe(20);expect(t.w).toBeGreaterThanOrEqual(20);
 expect(o.bg).toBe('rgba(0, 0, 0, 0)');
 // Today is not "chosen": no ring until it is pressed. Pressing a day adds the ring and leaves today's circle as it was.
 expect(t.ring).toBe('none');
 await other.click();await expect(other).toHaveAttribute('aria-pressed','true');
 expect((await look(other)).ring).not.toBe('none');expect((await look(other)).bg).toBe('rgba(0, 0, 0, 0)');
 expect((await look(today)).bg).toBe(purple);expect((await look(today)).ring).toBe('none');
 await page.locator('#diaryRoot [data-diary-detail-close]').click();
 await today.click();
 const both=await look(today);expect(both.bg).toBe(purple);expect(both.ring).not.toBe('none');
 // [달력]: the same circle and colour on today's number.
 await openMonth(page);
 const day=page.locator('#calendarGrid .cal-cell.today .cal-day');
 await expect(day).toBeVisible();
 const c=await day.evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,radius:s.borderRadius};});
 expect(c.bg).toBe(purple);expect(c.radius).toBe('999px');
 expect(f.errors).toEqual([]);
});

test('③ no write button under the date; [+] writes the chosen day, an existing day opens to edit, no day → today',async({page})=>{
 const f=await fixture(page);
 await page.evaluate(()=>window.KPTURouter.go('diary'));
 const editor=page.locator('#diaryRoot [data-diary-editor]'),plus=page.locator('#diaryRoot #newDiaryBtn');
 await page.locator('#diaryRoot [data-diary-day="2026-10-02"]').click();
 const detail=page.locator('#diaryRoot [data-diary-detail]');
 await expect(detail).toContainText('이 날 일기가 없어요.');
 await expect(detail.locator('button')).toHaveCount(1);// only × (close)
 await expect(detail.getByText('이 날 일기 쓰기')).toHaveCount(0);
 await plus.click();
 await expect(editor.locator('[data-diary-date]')).toHaveValue('2026-10-02');
 await expect(editor.locator('[data-diary-text] .ProseMirror')).toHaveText('');
 await page.goBack();await expect(editor).toBeHidden();
 // A day that has a diary: [+] opens it to edit.
 await page.locator('#diaryRoot [data-diary-day="2026-10-04"]').click();
 await expect(detail).toContainText('글만 쓴 날');
 await plus.click();
 await expect(editor.locator('[data-diary-date]')).toHaveValue('2026-10-04');
 await expect(editor.locator('[data-diary-text] .ProseMirror')).toHaveText('글만 쓴 날');
 await page.goBack();await expect(editor).toBeHidden();
 // Nothing chosen: today.
 if(await detail.isVisible())await page.locator('#diaryRoot [data-diary-detail-close]').click();
 await expect(detail).toBeHidden();
 await plus.click();
 await expect(editor.locator('[data-diary-date]')).toHaveValue('2026-10-06');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('⑤ an empty note list shows no guide sentence',async({page})=>{
 const f=await fixture(page,{notes:false});
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await chooseBasketKind(page,'note');
 const status=page.locator('[data-note-list-status]');
 await expect(page.locator('[data-note-rows] [data-note-row]')).toHaveCount(0);
 await expect(status).toHaveText('');await expect(status).toHaveAttribute('data-basket-empty','');
 await expect(page.locator('[data-note-host]')).not.toContainText('아직 노트가 없어요');
 // A search with no hit still says so.
 await page.locator('[data-note-search]').fill('없는 말');
 await expect(status).toHaveText('찾는 노트가 없어요');
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`⑥ an opened note draws only its own head (no [메모|노트], no back button), files are the shared file line ${width}`,async({page})=>{
 const f=await fixture(page,{width});
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await chooseBasketKind(page,'note');
 await page.locator('[data-note-row="n1"]').click();
 const more=page.locator("[data-note-more]");
 await expect(page.locator('[data-note-close]')).toHaveCount(0);
 await expect(more).toBeVisible();
 // The switch row (and the list head) are not drawn at all while the note is open.
 await expect(page.locator('#basketView .basket-switch-row')).toBeHidden();
 await expect(page.locator('#basketView [data-basket-kind]:visible')).toHaveCount(0);
 const overlap=await page.evaluate(()=>{const b=document.querySelector('[data-note-more]').getBoundingClientRect();
  return [...document.querySelectorAll('#basketView button,#basketView a')].filter(el=>el.getClientRects().length&&!el.closest('[data-note-detail]')).filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top;}).map(el=>el.textContent.trim());});
 expect(overlap).toEqual([]);
 // Editing: the same — only the note's head.
 await noteMenuAction(page,'data-note-edit');
 await expect(page.locator('#basketView .basket-switch-row')).toBeHidden();await expect(page.locator('[data-note-editor]')).toBeVisible();
 await page.locator('[data-note-cancel]').click();
 // Files: the shared line (kind tag · name / size · small [Drive에서 열기]).
 const lines=page.locator('[data-note-attachments] .file-line');
 await expect(lines).toHaveCount(2);
 await expect(lines.nth(0).locator('.file-kind')).toHaveText('PDF');await expect(lines.nth(1).locator('.file-kind')).toHaveText('HWP');
 await expect(lines.nth(0).locator('.file-line-main b')).toHaveText('교섭요구안.pdf');await expect(lines.nth(0).locator('.file-line-main small')).toHaveText('200.0 KB');
 const link=lines.nth(0).getByRole('link',{name:'교섭요구안.pdf Drive에서 열기'});
 await expect(link).toHaveAttribute('href',/f_pdf/);await expect(link).toHaveAttribute('target','_blank');
 const s=await link.evaluate(el=>{const c=getComputedStyle(el),r=el.getBoundingClientRect(),hit=getComputedStyle(el,'::after');return {size:c.fontSize,deco:c.textDecorationLine,h:Math.round(r.height),hit:hit.height};});
 expect(s).toEqual({size:'13px',deco:'none',h:32,hit:'44px'});
 // Back to the list: the switch is drawn again.
 await closeNote(page);
 // BASKET-노트입력창: a PC (≥1024) draws no switch at all (the sidebar changes sides); a phone draws it again.
 await expect(page.locator('[data-basket-kind-switch]')).toHaveCount(0);await expect(page.locator('[data-note-row="n1"]')).toBeVisible();
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('⑥ a memo opened from the list hides the switch the same way, and it comes back on close',async({page})=>{
 const f=await fixture(page);
 f.rows.push(row({id:'m1',kind:'basket',raw_text:'메모 하나'}));
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await page.locator('[data-basket-row="m1"]').click();
 await expect(page.locator('[data-basket-close]')).toBeVisible();await expect(page.locator('#basketView .basket-switch-row')).toBeHidden();
 await page.locator('[data-basket-close]').click();
 await expect(page.locator('#basketView .basket-switch-row')).toBeVisible();await expect(basketPaneButton(page,'update')).toBeVisible();
 expect(f.errors).toEqual([]);
});

if(REVIEW){
 for(const scheme of ['light','dark'])for(const width of [390,1280]){
  test(`캡처 ${width} ${scheme}`,async({page})=>{
   await fixture(page,{width,scheme});
   const shot=name=>page.screenshot({path:`${REVIEW}/${name}-${width}-${scheme}.png`});
   await page.evaluate(()=>window.KPTURouter.go('diary'));
   await page.locator('#diaryRoot [data-diary-day="2026-10-04"]').click();await expect(page.locator('#diaryRoot [data-diary-detail]')).toBeVisible();
   await page.evaluate(()=>scrollTo(0,0));await shot('diary');
   await page.locator('#diaryRoot [data-diary-detail-close]').click();await page.locator('#diaryRoot [data-diary-day="2026-10-02"]').click();
   await page.evaluate(()=>scrollTo(0,0));await shot('diary-empty-day');
   await openMonth(page);await expect(page.locator('#calendarGrid .cal-cell.today')).toBeVisible();await shot('calendar');
   await page.evaluate(()=>window.KPTURouter.go('basket'));await chooseBasketKind(page,'note');
   await page.locator('[data-note-row="n1"]').click();await expect(page.locator('[data-note-attachments] .file-line')).toHaveCount(2);await shot('note-open');
  });
 }
 test('캡처 빈 노트 390',async({page})=>{
  await fixture(page,{notes:false});
  await page.evaluate(()=>window.KPTURouter.go('basket'));await chooseBasketKind(page,'note');
  await expect(page.locator('[data-note-list-status]')).toHaveAttribute('data-basket-empty','');
  await page.screenshot({path:`${REVIEW}/note-empty-390-light.png`});
 });
}
