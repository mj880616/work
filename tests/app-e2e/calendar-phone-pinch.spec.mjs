// S52-11 CAL-폰달력핀치·제목먼저(명진 11/07 10:59·11:05, 시안 docs/design/mockups/calendar-phone-pinch.html).
// ① 폰 월 보기 칸 안 일정 줄은 제목만(시각은 읽기 이름·그날 목록에), PC·펼친 폴드는 시각 + 제목 그대로.
// ② 달력 칸 위 두 손가락 벌리기 = 칸이 가로·세로 같은 비율로 함께 커짐(화면 전체 확대 아님), 글자 조금 커지고 제목은 줄을 바꿔 전부,
//    커진 달력은 달력 안에서 밀어 봄, 최대 약 2.5배, 오므리면 0.2초에 처음 크기. 머리 줄·아래 줄·하단바는 그대로. 크기는 기억하지 않음.
// ③ 처음·커진 크기 모두: ☐ = 바로 완료(5초 되돌리기), 제목 = 상세, 일정 = 열기, 빈 곳 = 그날로 새 일정.
// 실제 화면·저장 길을 그대로 쓰고 바깥 API만 흉내 낸다(가짜 일정·할 일).
import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';

const ORIGIN=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const NOW='2026-10-15T03:00:00.000Z';
test.use({timezoneId:'Asia/Seoul'});

const LONG='집회 준비 회의 저녁 모임과 자료 정리';
const EVENTS=[
  {id:'timed',calendarId:'qa-cal',source:'google',title:LONG,start:'2026-10-20T10:30:00+09:00',end:'2026-10-20T11:30:00+09:00',allDay:false,color:'#4285f4'},
  {id:'allday',calendarId:'qa-cal',source:'google',title:'울산 출장',start:'2026-10-21',end:'2026-10-23',allDay:true,color:'#a4bdfc'},
  ...Array.from({length:8},(_,i)=>({id:'busy-'+i,calendarId:'qa-cal',source:'google',title:'공동 회의 '+(i+1),start:`2026-10-22T0${i+1}:00:00+09:00`,end:`2026-10-22T0${i+1}:30:00+09:00`,allDay:false,color:'#5484ed'})),
  // S52-19 CAL-확대높이따로: 같은 주 같은 줄에 짧은 일정 둘(26·27일)과 긴 할 일(28일), 여러 날 띠(29~30일)와 그 아래 짧은 할 일.
  {id:'short-a',calendarId:'qa-cal',source:'google',title:'국회 선전전',start:'2026-10-26T12:00:00+09:00',end:'2026-10-26T13:00:00+09:00',allDay:false,color:'#4285f4'},
  {id:'short-b',calendarId:'qa-cal',source:'google',title:'기자회견',start:'2026-10-27T10:00:00+09:00',end:'2026-10-27T11:00:00+09:00',allDay:false,color:'#4285f4'},
  {id:'band',calendarId:'qa-cal',source:'google',title:'부산 출장',start:'2026-10-29',end:'2026-10-31',allDay:true,color:'#a4bdfc'}
];
const LONG_TASK='위원회 회의 자료 묶음 정리해서 사무실 전체에 다시 보내고 답 모으기';
const make=(id,title,date)=>({id,title,notes:'',due:date+'T00:00:00.000Z',status:'needsAction',completed:null,taskListId:'@default',taskListTitle:'QA',source:'google-task'});

async function fixture(page,{width=412,hasTouch=true}={}){
  await installViewPrefsServer(page,{calendar_view:'month'});
  await page.clock.setFixedTime(new Date(NOW));
  const tasks=[make('cell','국토부 자료 보내기','2026-10-20'),make('other','의원실 연락','2026-10-14'),make('long','위원회 회의 자료 묶음 정리해서 사무실 전체에 다시 보내고 답 모으기','2026-10-28'),make('under','연락','2026-10-29')];
  const calls=[],external=[];
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),p=url.pathname;
    if(url.origin===ORIGIN)return route.continue();
    if(url.hostname!=='xmlkxfjeagycwttklxjw.supabase.co'){external.push(url.origin);return route.abort()}
    const ok=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    const user={id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}};
    if(p==='/auth/v1/token')return ok({access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user});
    if(p==='/auth/v1/user')return ok(user);
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok([{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action');
      if(action==='event')return ok({event:EVENTS.find(e=>e.id===url.searchParams.get('eventId')),eventColors:{}});
      const status={connected:true,enabled:true,calendars:[{id:'qa-cal',summary:'QA',backgroundColor:'#4285f4',accessRole:'owner'}],calendar_ids:['qa-cal']};
      return ok(action==='events'?{...status,events:EVENTS}:status);
    }
    if(p==='/functions/v1/google-tasks'){
      const action=url.searchParams.get('action'),body=req.method()==='POST'?req.postDataJSON():null;calls.push({action,body});
      if(action==='links')return ok({links:[],meeting_links:[]});
      if(action==='toggle'){
        const i=tasks.findIndex(t=>t.id===body.task_id);
        tasks[i]={...tasks[i],status:body.completed?'completed':'needsAction',completed:body.completed?NOW:null};
        return ok({ok:true,task:tasks[i]});
      }
      return ok({connected:true,authorized:true,needs_reconnect:false,tasks:JSON.parse(JSON.stringify(tasks)),pending_scope:'all'});
    }
    return ok([]);
  });
  await page.goto(loginEntry(ORIGIN+'/app/?view=calendar'));
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(page.locator('#calendarGrid [data-google-event="timed"]')).toBeVisible();
  await expect(page.locator('#calendarGrid .cmv-cell-task[data-calendar-task="cell"]')).toBeVisible();
  return {calls,external,toggles:()=>calls.filter(c=>c.action==='toggle')};
}

// 실제 손가락 두 개(CDP 터치): from 거리에서 to 거리로, 가운데 (cx,cy).
async function pinch(page,{cx,cy,from,to,steps=8}){
  const cdp=await page.context().newCDPSession(page);
  const pts=d=>[{x:cx-d/2,y:cy,id:1},{x:cx+d/2,y:cy,id:2}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pts(from)});
  for(let i=1;i<=steps;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pts(from+(to-from)*i/steps)});
  // 손가락은 하나씩 뗀다(실제 손처럼).
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[pts(to)[0]]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await cdp.detach();
}
async function tap(page,x,y){
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await cdp.detach();
}
const centerOf=async loc=>{await loc.scrollIntoViewIfNeeded();const b=await loc.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2,b}};
const zoomOf=page=>page.locator('#calendarGrid').evaluate(el=>Number(el.dataset.cmvZoom||1));

test.describe('폰 월 보기(폴드 접힘 412px)',()=>{
  test.use({viewport:{width:412,height:844},hasTouch:true,isMobile:true});

  test('칸 안 일정 줄은 제목만, 시각은 읽기 이름에 남는다',async({page})=>{
    const {external}=await fixture(page);
    const timed=page.locator('#calendarGrid [data-google-event="timed"]');
    await expect(timed.locator('.cmv-event-time')).toHaveCount(0);
    await expect(timed).toHaveText(LONG);
    await expect(timed).toHaveAttribute('aria-label','10:30 '+LONG);
    // 처음 크기에서도 제목이 칸 폭만큼 보인다(시각 자리가 없음): 제목 글자 칸이 일정 막대 안쪽 폭을 다 쓴다.
    const fill=await timed.evaluate(el=>{const t=el.querySelector('.cmv-event-title');return t.getBoundingClientRect().left-el.getBoundingClientRect().left});
    expect(fill).toBeLessThanOrEqual(4);
    // 그날 목록에는 시각이 그대로.
    await page.locator('.cmv-date-list[data-date="2026-10-20"]').click();
    await expect(page.locator('#calendarDayModal')).toBeVisible();
    await expect(page.locator('#calendarDayModal')).toContainText('10:30');
    expect(external).toEqual([]);
  });

  test('두 손가락 벌리면 칸이 가로·세로 함께 커지고, 화면 전체 확대·머리 줄·하단바는 그대로',async({page})=>{
    await fixture(page);
    const grid=page.locator('#calendarGrid');
    await expect(grid).toHaveCSS('touch-action','pan-x pan-y');
    const cell=page.locator('.cal-cell[data-date="2026-10-20"]');
    const before=await cell.boundingBox();
    const week=page.locator('.cmv-week').filter({has:cell});
    const weekBefore=await week.boundingBox();
    const title=await page.locator('#monthTitle').boundingBox();
    const tabs=await page.locator('nav.mobile-tabs').boundingBox();
    const gridBox=await grid.boundingBox();
    // 22일은 일정이 넘쳐 '+n'이 있다(처음 크기).
    await expect(page.locator('.kptu-day-more[data-date="2026-10-22"]')).toHaveCount(1);
    await pinch(page,{cx:gridBox.x+gridBox.width/2,cy:gridBox.y+gridBox.height/2,from:80,to:160});
    await expect.poll(()=>zoomOf(page)).toBeGreaterThan(1.8);
    const z=await zoomOf(page);
    await expect(grid).toHaveClass(/cmv-zoomed/);
    const after=await cell.boundingBox(),weekAfter=await week.boundingBox();
    // 가로·세로가 같은 배율로 함께(세로로만 커지면 안 됨). 세로는 제목이 줄을 바꾸면 그보다 더 커질 수 있다.
    expect(after.width/before.width).toBeGreaterThan(z*.95);
    expect(after.width/before.width).toBeLessThan(z*1.05);
    expect(weekAfter.height/weekBefore.height).toBeGreaterThan(z*.95);
    // 화면 전체 확대가 아니다: 배율 1, 머리 줄(‹ 월 ›)·하단바·달력 칸 자리 그대로.
    expect(await page.evaluate(()=>visualViewport.scale)).toBe(1);
    expect(await page.locator('#monthTitle').boundingBox()).toEqual(title);
    expect(await page.locator('nav.mobile-tabs').boundingBox()).toEqual(tabs);
    const gridAfter=await grid.boundingBox();
    expect(Math.abs(gridAfter.height-gridBox.height)).toBeLessThan(1);
    // 글자도 조금 커지고, 긴 제목은 줄을 바꿔 전부 보인다(말줄임 없음). 넘치던 일정도 모두 보인다('+n' 없음).
    const look=await page.locator('#calendarGrid [data-google-event="timed"]').evaluate(el=>{const t=el.querySelector('.cmv-event-title'),cs=getComputedStyle(el);return {font:parseFloat(cs.fontSize),lines:Math.round(t.getBoundingClientRect().height/parseFloat(getComputedStyle(t).lineHeight)),clipped:t.scrollWidth>t.clientWidth+1||t.scrollHeight>t.clientHeight+1}});
    expect(look.font).toBeGreaterThan(11);expect(look.font).toBeLessThan(11*z);
    expect(look.lines).toBeGreaterThan(1);expect(look.clipped).toBe(false);
    await expect(page.locator('.kptu-day-more')).toHaveCount(0);
    await expect(page.locator('[data-google-event="busy-7"]')).toBeVisible();
    // 커진 달력은 달력 안에서 옆·위아래로 밀어 본다.
    const scroll=await grid.evaluate(el=>({w:el.scrollWidth>el.clientWidth,h:el.scrollHeight>el.clientHeight}));
    expect(scroll).toEqual({w:true,h:true});
    // 더 벌려도 최대 약 2.5배.
    await pinch(page,{cx:gridBox.x+gridBox.width/2,cy:gridBox.y+gridBox.height/2,from:60,to:300});
    await expect.poll(()=>zoomOf(page)).toBe(2.5);
    // 오므리면 처음 한 화면 크기로(0.2초).
    await pinch(page,{cx:gridBox.x+gridBox.width/2,cy:gridBox.y+gridBox.height/2,from:200,to:120});
    await expect(grid).not.toHaveClass(/cmv-zoomed/,{timeout:1500});
    expect(await zoomOf(page)).toBe(1);
    const back=await cell.boundingBox();
    expect(Math.abs(back.width-before.width)).toBeLessThan(1);
    await expect(page.locator('.kptu-day-more[data-date="2026-10-22"]')).toHaveCount(1);
  });

  test('처음·커진 크기 모두: ☐ 바로 완료(되돌리기), 제목은 상세, 일정은 열기, 빈 곳은 그날 새 일정',async({page})=>{
    const {toggles}=await fixture(page);
    const box=page.locator('#calendarGrid .cmv-cell-task[data-calendar-task="cell"] .cmv-cell-task-box');
    for(const zoomed of [false,true]){
      if(zoomed){
        const g=await page.locator('#calendarGrid').boundingBox();
        await pinch(page,{cx:g.x+g.width/3,cy:g.y+g.height/3,from:80,to:150});
        await expect.poll(()=>zoomOf(page)).toBeGreaterThan(1.5);
        await page.waitForTimeout(450); // 두 손가락을 뗀 직후(0.4초)의 누름은 손짓 끝이라 먹는다
      }
      // ☐ → 바로 완료 + '끝냈어요 [되돌리기]'. 제목 상세 창은 열리지 않는다.
      const p=await centerOf(box);
      await tap(page,p.x,p.y);
      await expect.poll(()=>toggles().length).toBe(zoomed?3:1);
      expect(toggles().at(-1).body.completed).toBe(true);
      await expect(page.locator('[data-undo-notice]')).toContainText('끝냈어요');
      await expect(page.locator('#gtTaskModal')).toBeHidden();
      await expect(page.locator('#calendarGrid .cmv-cell-task[data-calendar-task="cell"]')).toHaveCount(0);
      if(zoomed)await expect(page.locator('#calendarGrid')).toHaveClass(/cmv-zoomed/); // 완료 뒤 다시 그려도 커진 크기 그대로
      await page.locator('[data-undo-notice] [data-undo-action]').click();
      await expect.poll(()=>toggles().length).toBe(zoomed?4:2);
      expect(toggles().at(-1).body.completed).toBe(false);
      await expect(page.locator('#calendarGrid .cmv-cell-task[data-calendar-task="cell"]')).toBeVisible();
      // 제목 → 할 일 상세.
      const t=await centerOf(page.locator('#calendarGrid .cmv-cell-task[data-calendar-task="cell"] .cmv-event-title'));
      await tap(page,t.x,t.y);
      await expect(page.locator('#gtTaskModal')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#gtTaskModal')).toBeHidden();
      // 일정 → 일정 창.
      const ev=await centerOf(page.locator('#calendarGrid [data-google-event="timed"]'));
      await tap(page,ev.x,ev.y);
      await expect(page.locator('#ciGoogleModal')).toBeVisible();
      await page.locator('#ciGoogleClose').click();
      await expect(page.locator('#ciGoogleModal')).toBeHidden();
      // 빈 곳(16일 칸 아래쪽) → 그날로 새 일정.
      const c=(await centerOf(page.locator('.cal-cell[data-date="2026-10-16"]'))).b;
      await tap(page,c.x+c.width/2,c.y+c.height-6);
      await expect(page.locator('#eventModal')).toBeVisible();
      await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-16');
      await page.keyboard.press('Escape');
      await expect(page.locator('#eventModal')).toBeHidden();
    }
  });

  test('커진 동안 날마다 따로 쌓기: 긴 할 일이 있는 주에서도 짧은 일정은 자기 글만큼, 띠만 가로로 잇고 글자는 왼쪽',async({page})=>{
    await fixture(page);
    const ev=id=>page.locator(`#calendarGrid [data-google-event="${id}"]`);
    const task=id=>page.locator(`#calendarGrid .cmv-cell-task[data-calendar-task="${id}"]`);
    // 처음 크기: 줄 높이는 고정(같은 줄 일정은 같은 한 줄 높이), 글자는 왼쪽.
    const h0=[await ev('short-a').boundingBox(),await task('long').boundingBox()].map(b=>b.height);
    expect(Math.abs(h0[0]-h0[1])).toBeLessThan(2);
    const g=await page.locator('#calendarGrid').boundingBox();
    await pinch(page,{cx:g.x+g.width/2,cy:g.y+g.height/2,from:60,to:300});
    await expect.poll(()=>zoomOf(page)).toBe(2.5);
    await expect(task('long')).toHaveText(LONG_TASK);
    const box=async loc=>{await loc.scrollIntoViewIfNeeded();return loc.evaluate(el=>{const r=el.getBoundingClientRect(),t=el.querySelector('.cmv-event-title'),tr=t.getBoundingClientRect(),lh=parseFloat(getComputedStyle(t).lineHeight);
      return {top:r.top,left:r.left,width:r.width,height:r.height,lines:Math.round(tr.height/lh),lh,align:getComputedStyle(el).textAlign,titleAlign:getComputedStyle(t).textAlign,pad:tr.left-r.left}})};
    const a=await box(ev('short-a')),b=await box(ev('short-b')),long=await box(task('long'));
    // 긴 할 일은 여러 줄, 짧은 일정은 한 줄 높이 그대로(긴 할 일 높이로 늘어나지 않음).
    expect(long.lines).toBeGreaterThan(2);
    for(const s of [a,b]){
      expect(s.lines).toBe(1);
      expect(s.height).toBeLessThan(s.lh+6);
      expect(s.height).toBeLessThan(long.height/2);
      // 글자는 왼쪽 정렬(가운데 아님).
      expect(s.align).toBe('left');expect(s.titleAlign).toBe('left');expect(s.pad).toBeLessThan(6);
    }
    expect(long.align).toBe('left');
    // 여러 날 띠는 두 날 칸에 걸쳐 가로로 잇고, 그 날 짧은 할 일은 띠 바로 아래에 자기 높이로.
    const band=await box(ev('band')),under=await box(task('under'));
    const cellW=(await page.locator('.cal-cell[data-date="2026-10-29"]').boundingBox()).width;
    expect(band.width).toBeGreaterThan(cellW*1.8);
    expect(under.top).toBeGreaterThanOrEqual(band.top+band.height-1);
    expect(under.top-(band.top+band.height)).toBeLessThan(4);
    expect(under.lines).toBe(1);
    // 이 주 짧은 일정 둘은 같은 높이에서 시작(날짜 줄 바로 아래).
    expect(Math.abs(a.top-b.top)).toBeLessThan(1);
    // 오므리면 처음 크기(고정 줄)로.
    await pinch(page,{cx:g.x+g.width/2,cy:g.y+g.height/2,from:200,to:60});
    await expect(page.locator('#calendarGrid')).not.toHaveClass(/cmv-zoomed/,{timeout:1500});
    await expect(page.locator('#calendarGrid .cmv-day-stack')).toHaveCount(0);
  });

  test('크기는 기억하지 않는다(메모리만): 달을 바꾸면 처음 크기',async({page})=>{
    await fixture(page);
    const g=await page.locator('#calendarGrid').boundingBox();
    await pinch(page,{cx:g.x+g.width/2,cy:g.y+g.height/2,from:80,to:160});
    await expect.poll(()=>zoomOf(page)).toBeGreaterThan(1.5);
    await page.locator('#nextMonthBtn').click();
    await expect(page.locator('#calendarGrid')).not.toHaveClass(/cmv-zoomed/);
    expect(await zoomOf(page)).toBe(1);
  });
});

test('펼친 폴드·PC 월 보기는 시각 + 제목 그대로, 칸 ☐도 바로 완료',async({page})=>{
  await page.setViewportSize({width:1280,height:844});
  const {toggles}=await fixture(page,{width:1280});
  const timed=page.locator('#calendarGrid [data-google-event="timed"]');
  await expect(timed.locator('.cmv-event-time')).toHaveText('10:30');
  await page.locator('#calendarGrid .cmv-cell-task[data-calendar-task="cell"] .cmv-cell-task-box').click();
  await expect.poll(()=>toggles().length).toBe(1);
  await expect(page.locator('#gtTaskModal')).toBeHidden();
});
