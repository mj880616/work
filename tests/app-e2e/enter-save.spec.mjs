import {appOrigin} from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
import {openSeoulApp} from './helpers/seoul-time-fixture.mjs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

// UI-엔터저장: one shared rule (app/enter-save.js) for add/edit windows and side edit panels.
// One-line field: Enter saves (PC and phone). Many-line field: Enter is a new line; Ctrl+Enter saves on PC.
// A composing Korean Enter never saves, one press saves once, and the save button shows ↵ / Ctrl+↵ on PC only.
// 390 runs as a touch phone (hasTouch: no fine pointer, so no hint). Every request is answered by synthetic fixtures.

// A keydown the way an IME sends it while a syllable is still being composed (Chrome: isComposing, keyCode 229).
const composingEnter=(locator,{ctrl=false}={})=>locator.evaluate((el,ctrl)=>{
  const e=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,composed:true,isComposing:true,ctrlKey:ctrl});
  Object.defineProperty(e,'keyCode',{get:()=>229});el.dispatchEvent(e);return e.defaultPrevented;
},ctrl);
const hint=locator=>locator.getAttribute('data-enter-hint');

for(const width of [1280,390])test.describe(`${width}px`,()=>{
  const phone=width<761;
  test.use({timezoneId:'Europe/Rome',viewport:{width,height:900},hasTouch:phone});

  test('일정 만들기: 제목·시간 칸 엔터 = 저장(시간 정리 뒤), 메모 엔터 = 줄바꿈, 한글 조합 중 엔터는 저장 안 함',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const s=await openSeoulApp(page);await page.locator('#newEventBtn').click();
    const title=page.locator('#eventTitle'),start=page.locator('#eventStartTime'),memo=page.locator('#eventDescription'),save=page.locator('#saveEventBtn');
    await title.fill('엔터 저장 일정');
    expect(await composingEnter(title)).toBe(false);
    await page.waitForTimeout(100);expect(s.writes).toEqual([]);await expect(page.locator('#eventModal')).toBeVisible();
    await memo.fill('첫 줄');await memo.press('Enter');await memo.pressSequentially('둘째 줄');
    await expect(memo).toHaveValue('첫 줄\n둘째 줄');expect(s.writes).toEqual([]);
    if(!phone){await expect.poll(()=>hint(save)).toBe('Ctrl+↵');await title.focus();await expect.poll(()=>hint(save)).toBe('↵')}
    else{await title.focus();expect(await hint(save)).toBeNull()}
    // 930 is tidied to 09:30 by the time cell on the same Enter, then the save reads it.
    await start.fill('930');await start.press('Enter');
    await expect(page.locator('#eventModal')).toBeHidden();
    expect(s.writes).toHaveLength(1);
    expect(s.writes[0]).toMatchObject({action:'create-event',title:'엔터 저장 일정',memo:'첫 줄\n둘째 줄',start_iso:'2026-10-01T00:30:00.000Z'});
    expect(errors).toEqual([]);
  });

  test('일정 수정 창: 장소 칸 엔터 = 저장, 체크 칸 엔터는 저장 안 함',async({page})=>{
    const s=await openSeoulApp(page);
    await page.locator('#prevMonthBtn').click();await page.locator('#calendarGrid [data-google-event="exec"]').first().click();
    const place=page.locator('#ciGoogleLocation');await expect(page.locator('#ciGoogleSave')).toBeEnabled();
    await page.locator('#ciGoogleAllDay').focus();await page.keyboard.press('Enter');
    await page.waitForTimeout(100);expect(s.writes).toEqual([]);await expect(page.locator('#ciGoogleModal')).toBeVisible();
    await place.fill('서울역 회의실');await place.press('Enter');
    await expect(page.locator('#ciGoogleModal')).toBeHidden();
    expect(s.writes).toHaveLength(1);expect(s.writes[0]).toMatchObject({action:'update-event',event_id:'exec',location:'서울역 회의실'});
  });

  test('회의 결과: 원문 엔터 = 줄바꿈, PC Ctrl+엔터 = 저장(폰은 제목 엔터), 후속 할 일 줄은 그 줄만 추가',async({page})=>{
    const s=baseState();s.meetingWrites=[];s.meetings=[];await mockApp(page,s);await signIn(page,`${appOrigin}/app/?view=meetings`);await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
    await page.locator('#newMeetingBtn').click();
    await page.locator('#meetingTitle').fill('엔터 회의');await page.locator('#meetingAtDate').fill('2026-10-11');await page.locator('#meetingAtTime').fill('1405');
    const transcript=page.locator('#meetingTranscript');
    await transcript.fill('1. 안건');await transcript.press('Enter');await transcript.pressSequentially('2. 결과');
    await expect(transcript).toHaveValue('1. 안건\n2. 결과');
    // Shift+Enter is a new line too, and a composing Ctrl+Enter is ignored.
    await transcript.press('Shift+Enter');expect(await composingEnter(transcript,{ctrl:true})).toBe(false);
    await page.waitForTimeout(100);expect(s.meetingWrites).toEqual([]);
    // The follow-up line inside the window is its own small form: Enter adds the line, the meeting is not saved.
    await page.locator('#addMeetingAction').click();const action=page.locator('#meetingActionTitle');await action.fill('후속 확인');await action.press('Enter');
    await expect(page.locator('#meetingActionList')).toContainText('후속 확인');await expect(page.locator('#meetingModal')).toBeVisible();expect(s.meetingWrites).toEqual([]);
    if(phone){await transcript.press('Control+Enter');await page.waitForTimeout(100);await page.locator('#meetingTitle').press('Enter')}
    else await transcript.press('Control+Enter');
    await expect.poll(()=>s.meetingWrites.length).toBe(1);
    expect(s.meetingWrites[0]).toMatchObject({title:'엔터 회의',transcript_text:'1. 안건\n2. 결과\n'});
  });

  test('프로젝트 만들기: 이름 칸 엔터 = 저장 요청, 엔터를 빨리 두 번 눌러도 한 번만 보냄',async({page})=>{
    const s=baseState();await mockApp(page,s);await signIn(page,`${appOrigin}/app/?view=projects`);await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('projects'));
    const before=s.spaces.length;
    await page.locator('#newProjectBtn').click();const name=page.locator('#ps3CreateName');await expect(name).toBeVisible();
    await name.fill('엔터 프로젝트');
    if(!phone)await expect.poll(()=>hint(page.locator('#ps3CreateSave'))).toBe('↵');
    await name.evaluate(el=>{for(let i=0;i<2;i++)el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}))});
    // The synthetic fixture cannot confirm the follow-up project settings, so the window stays with its notice;
    // what matters here is that the two presses sent exactly one create.
    await expect.poll(()=>s.spaces.length-before).toBe(1);
    await page.waitForTimeout(300);
    expect(s.spaces.length-before).toBe(1);expect(s.spaces.at(-1)).toMatchObject({name:'엔터 프로젝트'});
  });
});

// The [할 일] edit: on PC (≥1024) it is docked in the right pane (a side panel, not a popup); on a phone it is the popup.
const NOW=Date.parse('2026-10-08T03:00:00Z');
const task=(id,due=null,extra={})=>({id,title:'할 일 '+id,taskListId:'@default',taskListTitle:'내 할 일',due,status:'needsAction',notes:'',...extra});
async function openTasks(page,width,tasks){
  await page.setViewportSize({width,height:844});
  await openEmphasisFixture(page,{view:'list',now:NOW,events:[],tasks,projects:[],orgs:[],links:[]});
  const calls=[];let release=null;
  await page.route('**/functions/v1/google-tasks**',async route=>{
    const url=new URL(route.request().url()),action=url.searchParams.get('action'),body=route.request().postDataJSON?.()||null;
    calls.push({action,body});
    const ok=json=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
    if(action==='links')return ok({links:[],meeting_links:[]});
    if(action==='update'){if(release)await release;const at=tasks.findIndex(t=>t.id===body.task_id);tasks[at]={...tasks[at],title:body.title,notes:body.notes,due:body.due?body.due+'T00:00:00.000Z':null};return ok({ok:true,task:tasks[at]})}
    return ok({connected:true,authorized:true,needs_reconnect:false,tasks,pending_scope:'all'});
  });
  await page.evaluate(()=>window.KPTURouter.go('tasks'));
  await expect(page.locator('[data-gt-count]')).toHaveText(`할 일 ${tasks.length}개`);
  return {calls,hold(){let open;release=new Promise(r=>{open=r});return ()=>{release=null;open()}}};
}

for(const width of [1280,390])test.describe(`할 일 수정 ${width}px`,()=>{
  const phone=width<761;
  test.use({hasTouch:phone});
  test(`${phone?'폰 수정 창':'PC 오른쪽 수정 칸'}: 제목 엔터 = 저장, 메모 엔터 = 줄바꿈${phone?'':'·Ctrl+엔터 = 저장'}, 저장 중 엔터는 다시 저장하지 않음`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const tasks=[task('a','2026-10-08',{notes:'메모'})];
    const {calls,hold}=await openTasks(page,width,tasks);
    await page.locator('[data-gt-edit="a"]').click();
    const editor=page.locator('#gtTaskModal');await expect(editor).toBeVisible();
    if(!phone)expect(await editor.evaluate(e=>e.closest('#gtDetailPane')!==null)).toBe(true);
    const title=page.locator('#gtEditTitle'),notes=page.locator('#gtEditNotes'),save=page.locator('#gtSaveBtn');
    await expect(save).toBeEnabled();
    await notes.fill('첫 줄');await notes.press('Enter');await notes.pressSequentially('둘째 줄');
    await expect(notes).toHaveValue('첫 줄\n둘째 줄');
    if(!phone)await expect.poll(()=>hint(save)).toBe('Ctrl+↵');else expect(await hint(save)).toBeNull();
    expect(calls.filter(c=>c.action==='update')).toEqual([]);
    // Title Enter saves; while that save is still on its way, more Enter presses do nothing.
    const done=hold();
    await title.fill('고친 할 일');await title.press('Enter');
    await expect(save).toBeDisabled();
    await title.press('Enter').catch(()=>{});await notes.press('Control+Enter').catch(()=>{});
    done();
    await expect.poll(()=>calls.filter(c=>c.action==='update').length).toBe(1);
    expect(calls.find(c=>c.action==='update').body).toMatchObject({task_id:'a',title:'고친 할 일',notes:'첫 줄\n둘째 줄'});
    if(!phone){
      await expect(page.locator('#gtEditStatus')).toHaveText('저장했습니다.');
      await notes.fill('Ctrl 저장');await notes.press('Control+Enter');
      await expect.poll(()=>calls.filter(c=>c.action==='update').length).toBe(2);
      expect(calls.filter(c=>c.action==='update')[1].body).toMatchObject({notes:'Ctrl 저장'});
    }
    expect(errors).toEqual([]);
  });
});
