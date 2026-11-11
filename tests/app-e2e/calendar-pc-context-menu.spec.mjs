import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';

// S51-27 UI-PC우클릭: PC(1280) 월간 달력에서 우클릭하면 크롬 기본 메뉴 대신 누른 자리에 공용 줄 메뉴(#rowMenu, row-menu.js).
// 날짜 칸(일정으로 꽉 찬 날도 칸 어디든) → [이날 일정 등록][이날 할 일][이날 하루 보기], 일정 → [수정]…[삭제], 할 일 막대 → 그 할 일 ⋯ 메뉴.
// 칸에 마우스를 올리면 날짜 숫자 옆 [+] → 그날 일정 등록 창. 글자 칸 우클릭은 기본 메뉴 그대로. Shift+F10(키보드)도 같은 메뉴.
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({timezoneId:'Asia/Seoul',viewport:{width:1280,height:844}});
const iso=(d,t)=>new Date(`${d}T${t}:00+09:00`).toISOString();
const FULL='2026-10-21';
async function open(page){
  const events=Array.from({length:7},(_,i)=>({id:'e'+i,calendarId:'own',title:'꽉 찬 날 일정 '+i,start:iso(FULL,String(8+i).padStart(2,'0')+':00'),end:iso(FULL,String(9+i).padStart(2,'0')+':00'),allDay:false,description:'',location:'',organizationIds:[],recurring:false,source:'google'}));
  const state={creates:[],tasks:[{id:'t1',title:'칸 할 일',notes:'',due:'2026-10-23T00:00:00.000Z',status:'needsAction',completed:null,taskListId:'@default',taskListTitle:'QA',source:'google-task'}],events};
  await page.clock.setFixedTime(new Date('2026-10-20T00:00:00Z'));
  await installViewPrefsServer(page,{calendar_view:'month'});
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===BASE)return route.continue();
    if(url.origin!==SB)return route.abort();
    const ok=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    const user={id:'rc-user',email:'qa@example.org',user_metadata:{display_name:'QA'}};
    if(url.pathname==='/auth/v1/token')return ok({access_token:'synthetic',refresh_token:'synthetic',expires_at:4102444800,user});
    if(url.pathname==='/auth/v1/user')return ok(user);
    if(url.pathname==='/rest/v1/app_workspace_members')return ok([{workspace_id:'rc-ws',user_id:user.id,role:'owner'}]);
    if(url.pathname==='/rest/v1/app_workspaces')return ok([{id:'rc-ws',name:'QA'}]);
    if(url.pathname==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'QA'}]);
    if(url.pathname==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action');
      if(req.method()==='POST'){state.creates.push(req.postDataJSON());return ok({ok:true})}
      if(action==='event')return ok({event:state.events.find(e=>e.id===url.searchParams.get('eventId')),eventColors:{}});
      const status={connected:true,enabled:true,selected:['own'],calendars:[{id:'own',summary:'내 캘린더',accessRole:'owner',backgroundColor:'#336699'}],colors:{},eventColors:{}};
      return ok(action==='events'?{...status,events:state.events.map(e=>({...e}))}:status);
    }
    if(url.pathname==='/functions/v1/google-tasks'){
      if(url.searchParams.get('action')==='links')return ok({links:[],meeting_links:[]});
      return ok({connected:true,authorized:true,needs_reconnect:false,tasks:state.tasks.map(t=>({...t})),links:[],meeting_links:[],pending_scope:'all'});
    }
    return ok([]);
  });
  await page.goto(loginEntry(BASE+'/app/?view=calendar'));
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(page.locator('#calendarGrid [data-google-event="e0"]').first()).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>!!window.__KPTU_CALENDAR_CONTEXT_MENU__&&!!window.KPTUCalendarEvents?.slotFor&&!!window.KPTUCalendarTasks?.menuAt)).toBe(true);
  await page.evaluate(()=>{window.__kept=[];window.addEventListener('contextmenu',e=>window.__kept.push(!e.defaultPrevented))});
  return state;
}
const menu=page=>page.locator('#rowMenu');
const labels=page=>menu(page).locator('button').allTextContents().then(a=>a.map(s=>s.trim()));
const cell=(page,d)=>page.locator(`#calendarGrid .cal-cell[data-date="${d}"]`);
async function rightAt(page,locator,dx=0.5,dy=0.5){const b=await locator.boundingBox(),x=Math.round(b.x+b.width*dx),y=Math.round(b.y+b.height*dy);await page.mouse.move(x,y);await page.mouse.click(x,y,{button:'right'});return {x,y}}

test('1280 월간: 빈 날짜 칸 우클릭 → 그 자리 [이날 일정 등록][이날 할 일][이날 하루 보기], 일정 등록 창은 그 날짜',async({page})=>{
  await open(page);
  const {x,y}=await rightAt(page,cell(page,'2026-10-14'),0.5,0.8);
  await expect(menu(page)).toBeVisible();
  expect(await labels(page)).toEqual(['이날 일정 등록','이날 할 일','이날 하루 보기']);
  await expect(menu(page).locator('.row-menu-title')).toHaveText('10월 14일 (수)');
  const m=await menu(page).boundingBox();expect(Math.abs(m.x-x)).toBeLessThanOrEqual(14);expect(Math.abs(m.y-y)).toBeLessThanOrEqual(14);
  expect(await page.evaluate(()=>window.__kept)).toEqual([false]);
  await menu(page).getByRole('button',{name:'이날 일정 등록'}).click();
  await expect(page.locator('#eventModal')).toBeVisible();
  await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-14');
  await expect(page.locator('[data-event-mode="event"]')).toHaveAttribute('aria-pressed','true');
});

test('1280 월간: 일정으로 꽉 찬 날도 칸 어디든 우클릭 → 날짜 메뉴, [이날 할 일]·[이날 하루 보기]',async({page})=>{
  await open(page);
  // 날짜 숫자 줄(위쪽)·맨 아래 '+N' 근처 — 일정 막대가 아닌 곳.
  await rightAt(page,cell(page,FULL).locator('.cmv-date-list'),0.8,0.5);
  await expect(menu(page)).toBeVisible();
  expect(await labels(page)).toEqual(['이날 일정 등록','이날 할 일','이날 하루 보기']);
  await menu(page).getByRole('button',{name:'이날 할 일'}).click();
  await expect(page.locator('#eventModal')).toBeVisible();
  await expect(page.locator('[data-event-mode="task"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#eventStartDate')).toHaveValue(FULL);
  await page.locator('[data-close="eventModal"]').click();await expect(page.locator('#eventModal')).toBeHidden();
  await rightAt(page,cell(page,FULL).locator('.cmv-date-list'),0.8,0.5);
  await menu(page).getByRole('button',{name:'이날 하루 보기'}).click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayModal [data-google-event="e6"]')).toBeVisible();
});

test('1280 월간: 일정 우클릭 → [수정][보고할 일정][담당조직 연결][결과 남기기][삭제](맨 아래·빨강, S51-31), 할 일 막대 → 그 할 일 메뉴',async({page})=>{
  await open(page);
  // S57-20 BIZ-보고할일정: 이 서버 흉내는 '보고할 일정' 표 읽기에 빈 목록으로 답한다(표가 있는 서버) → 읽은 뒤에는 [수정] 아래 [보고할 일정] 한 줄이 있다.
  // (표가 없는 서버에서 예전 네 줄 그대로인 것은 report-plan-toggle.spec.mjs가 본다.)
  await expect.poll(()=>page.evaluate(()=>window.KPTUCalendarEvents.planOf('e0','own')!==null)).toBe(true);
  await rightAt(page,page.locator('#calendarGrid [data-google-event="e0"]').first());
  await expect(menu(page)).toBeVisible();
  expect(await labels(page)).toEqual(['수정','보고할 일정','담당조직 연결','결과 남기기','삭제']);
  const last=menu(page).locator('button').last();
  await expect(last).toHaveClass(/row-menu-last/);
  const [red,ink,danger]=await last.evaluate(b=>{const d=document.createElement('i');d.style.color='var(--kptu-danger)';document.body.append(d);const c=getComputedStyle(d).color;d.remove();return [getComputedStyle(b).color,getComputedStyle(b.previousElementSibling).color,c]});expect(red).toBe(danger);expect(red).not.toBe(ink);
  await page.keyboard.press('Escape');await expect(menu(page)).toBeHidden();
  const chip=page.locator('#calendarGrid [data-calendar-task="t1"]').first();
  await expect(chip).toBeVisible();
  await rightAt(page,chip);
  const taskMenu=page.locator('#calendarTaskMenu');
  await expect(taskMenu).toBeVisible();
  expect(await taskMenu.locator('button').allTextContents().then(a=>a.map(s=>s.trim()))).toEqual(['내일로','기한 바꾸기','수정','완료','삭제']);
  expect(await page.evaluate(()=>window.__kept)).toEqual([false,false]);
});

test('1280 월간: 칸에 마우스를 올리면 날짜 옆 [+] → 그날 일정 등록 창(꽉 찬 날도)',async({page})=>{
  await open(page);
  const plus=cell(page,FULL).locator('.cmv-date-plus');
  await expect(plus).toHaveCSS('opacity','0');
  await cell(page,FULL).locator('.cmv-date-list').hover();
  await expect(plus).toHaveCSS('opacity','1');
  const p=await plus.boundingBox(),num=await cell(page,FULL).locator('.cal-day').boundingBox();
  expect(p.x).toBeGreaterThan(num.x+num.width-1);expect(p.x-(num.x+num.width)).toBeLessThan(30);
  await plus.click();
  await expect(page.locator('#eventModal')).toBeVisible();
  await expect(page.locator('#eventStartDate')).toHaveValue(FULL);
});

test('1280: 글자 칸 우클릭은 브라우저 기본 메뉴 그대로, Shift+F10은 포커스 받은 날짜 칸 메뉴',async({page})=>{
  await open(page);
  await rightAt(page,cell(page,'2026-10-14'),0.5,0.8);
  await menu(page).getByRole('button',{name:'이날 일정 등록'}).click();
  await expect(page.locator('#eventTitle')).toBeVisible();
  await page.evaluate(()=>{window.__kept=[]});
  await page.locator('#eventTitle').click({button:'right'});
  expect(await page.evaluate(()=>window.__kept)).toEqual([true]);
  await expect(menu(page)).toBeHidden();
  await page.locator('[data-close="eventModal"]').click();await expect(page.locator('#eventModal')).toBeHidden();
  await page.evaluate(()=>{window.__kept=[]});
  await cell(page,'2026-10-14').locator('.cmv-date-list').focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu(page)).toBeVisible();
  expect(await labels(page)).toEqual(['이날 일정 등록','이날 할 일','이날 하루 보기']);
  await expect(menu(page).getByRole('button',{name:'이날 일정 등록'})).toBeFocused();
});
