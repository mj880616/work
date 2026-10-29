import {noticeText} from './helpers/small-notice.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {fillDateTime} from './helpers/date-time.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import {openMeetingResult,mrdMenu,closeMeetingResult} from './helpers/meeting-open.mjs';
import {showAllReportWeeks} from './helpers/report-week.mjs';
import {reportFilterButton,reportFilterLabels,pickReportFilter} from './helpers/report-filter.mjs';

test.use({timezoneId:'Asia/Seoul'});

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const here=dirname(fileURLToPath(import.meta.url));
const read=path=>readFileSync(resolve(here,'../..',path),'utf8');
const meeting={
  id:'meeting-1',workspace_id:'meeting-ws',project_id:'main',title:'접근성 회의',
  meeting_at:'2026-09-17T10:00:00Z',notes:'특이사항 기록',decisions:'과거 결정 내용',
  series_name:'궤도협의회',round_no:1,location:'과거 회의실',attendee_count:6,
  transcript_text:'원문 첫 줄\n원문 둘째 줄',created_by:'meeting-user'
};

async function mock(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'meeting-access',refresh_token:'meeting-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'meeting-user'}});
    if(path==='/auth/v1/user')return ok({id:'meeting-user',email:'meeting@example.org',user_metadata:{display_name:'회의 QA'}});
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'meeting-ws',user_id:'meeting-user',role:'owner',email:'meeting@example.org',workspace:{id:'meeting-ws',name:'QA Workspace'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'meeting-ws',name:'QA Workspace'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'meeting-user',display_name:'회의 QA'}]);
    if(path==='/rest/v1/app_spaces')return ok([
      {id:'main',workspace_id:'meeting-ws',name:'메인',parent_id:null,status:'active',owner_id:'meeting-user',metadata:{project_system:'v2'},sort_order:10},
      {id:'child',workspace_id:'meeting-ws',name:'하위',parent_id:'main',status:'active',owner_id:'meeting-user',metadata:{project_system:'v2'},sort_order:20}
    ]);
    if(path==='/rest/v1/app_meetings'){
      if(method==='PATCH')return ok([{id:meeting.id}]);
      if(method==='POST')return ok([{...meeting,id:'meeting-new'}]);
      return ok([meeting]);
    }
    if(path==='/rest/v1/app_tasks')return ok([]);
    if(path==='/rest/v1/app_documents')return ok([]);
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await mock(page);
  const returnTo=`${BASE}/app/?view=meetings`;
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(returnTo)}`);
  await signInWithSession(page,'meeting@example.org');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#meetingsView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
}
async function fillMeetingName(page,name){const select=page.locator('#meetingNameSelect');if(await select.isVisible())await select.selectOption('__other__');await page.locator('#meetingTitle').fill(name)}

test('meeting create modal exposes the task 9 fields only',async({page})=>{
  await signIn(page);
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  for(const id of ['meetingTitle','meetingRoundNo','meetingAt','meetingProject','meetingTranscript','meetingNotes','meetingFiles','meetingActionList'])await expect(page.locator('#'+id)).toBeAttached();
  await expect(page.locator('#meetingSeriesName')).toHaveCount(0);
  await expect(page.locator('#meetingModal legend')).toHaveText(['기본정보','회의 결과','첨부·후속']);
  await expect(page.locator('#meetingFiles')).toHaveAttribute('multiple','');
  // UI-회의결과창정리: 후속 할 일은 입력 한 줄(입력칸 + [기한 ▾] + [추가])로 시작하고, 넣은 할 일 줄은 아직 없다.
  await expect(page.locator('#meetingActionLine')).toBeVisible();
  await expect(page.locator('#meetingActionLine > :is(input,.due-chip,button)')).toHaveCount(3);
  await expect(page.locator('#meetingActionLine .due-chip')).toHaveText('기한 ▾');
  await expect(page.locator('.meeting-action-row')).toHaveCount(0);
  await expect(page.locator('#meetingActionList [data-wait-empty]')).toHaveText('없음');
  await expect(page.locator('#meetingMaterialsBlock .mtg-note')).toHaveText('자료실에도 자동 등록');
  await expect(page.locator('#meetingMaterialsBlock .mtg-note')).toHaveCSS('font-size','12px');
  await expect(page.locator('#meetingActionList [data-wait-empty]')).toHaveCSS('font-size','12px');
  for(const el of [page.locator('#addMeetingAction'),page.locator('#meetingPickFiles')]){const b=await el.boundingBox();expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44)}
  expect((await page.locator('#meetingActionAdd').boundingBox()).height).toBe(32);
  expect((await page.locator('#meetingActionLine .due-chip').boundingBox()).height).toBe(32);
  // MEET-파일로만들기: [파일·글로 만들기] 칸(#mffPanel)의 파일 +는 따로 센다. 직접 쓰기 칸은 후속 할 일 +, 사진 +(ACT-사진 3단계), 회의자료 + 세 개.
  await expect(page.locator('#meetingModal fieldset .mtg-group-head .mtg-add-plus')).toHaveCount(3);
  await expect(page.locator('#meetingPhotoFiles')).toHaveAttribute('accept','image/*');
  { const b = await page.locator('#meetingPickPhotos').boundingBox(); expect(b.width).toBeGreaterThanOrEqual(44); expect(b.height).toBeGreaterThanOrEqual(44); }
  await expect(page.locator('.meeting-action-assignee,#mrdTaskAssignee,#taskAssignee')).toHaveCount(0);
  await expect(page.locator('#meetingAutoClassify,#meetingDecisions,#wfMeetingLocation,#wfMeetingAttendees')).toHaveCount(0);
  await expect(page.locator('#meetingProject option[value="main"]')).toHaveText('메인');
  await expect(page.locator('#meetingProject option[value="child"]')).toContainText('↳');
});

test('new meeting creates a Google follow-up linked to the meeting and project',async({page})=>{
  await signIn(page);
  let savedMeeting=null,savedTask=null,legacyWrites=0;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    const req=route.request();
    if(req.method()==='POST'){
      savedMeeting=req.postDataJSON();
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...savedMeeting,id:'meeting-new'}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  await page.route(`${SB}/rest/v1/app_tasks**`,async route=>{
    if(route.request().method()!=='GET')legacyWrites++;
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    // PC 3단(MEET-결과3단) 오른쪽 결과는 후속 할 일을 읽기(GET)로 따로 불러온다. 만들기 요청(POST)만 본다.
    if(route.request().method()!=='POST')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks:[]})});
    savedTask=route.request().postDataJSON();
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,task:{id:'google-new'}})});
  });

  await page.locator('#newMeetingBtn').click();
  await fillMeetingName(page,'궤도협의회 집행위원회');
  await page.locator('#meetingRoundNo').fill('8');
  await fillDateTime(page,'#meetingAt','2026-09-25T14:00');
  await page.locator('#meetingPlaces').click();await page.locator('#reportPlacesSheet').getByRole('button',{name:/하위/}).first().click();await page.locator('#reportPlacesSheet').getByRole('button',{name:'저장',exact:true}).click();
  const raw='  첫 줄\n둘째 줄\n마지막 줄  ';
  await page.locator('#meetingTranscript').fill(raw);
  await page.locator('#meetingNotes').fill('특이사항\n둘째 줄');
  // 넣은 할 일은 할 일 화면과 같은 줄(동그라미·이름·기한·⋯)로 보이고, 저장할 때 함께 만든다.
  await page.locator('#meetingActionTitle').fill('결과 공유');
  await page.locator('#meetingActionDue').fill('2026-09-30');
  await expect(page.locator('#meetingActionLine .due-chip')).not.toHaveText('기한 ▾');
  await page.locator('#meetingActionAdd').click();
  const draft=page.locator('#meetingActionList .meeting-action-row');
  await expect(draft).toHaveCount(1);
  await expect(draft.locator('.gt-check')).toBeVisible();
  await expect(draft.locator('.gt-main b')).toHaveText('결과 공유');
  await expect(draft.locator('.gt-due')).not.toBeEmpty();
  await expect(draft.locator('[data-meeting-action-menu]')).toHaveText('⋯');
  await expect(page.locator('#meetingActionTitle')).toHaveValue('');
  await expect(page.locator('#meetingActionLine .due-chip')).toHaveText('기한 ▾');
  // ⋯ → 삭제 / 수정(입력 줄로 다시 올림)
  await page.locator('#meetingActionTitle').fill('지울 할 일');
  await page.locator('#meetingActionTitle').press('Enter');
  await expect(page.locator('#meetingActionList .meeting-action-row')).toHaveCount(2);
  await page.locator('#meetingActionList [data-meeting-action-menu]').nth(1).click();
  await page.locator('#meetingActionMenu [data-meeting-action-do="delete"]').click();
  await expect(page.locator('#meetingActionList .meeting-action-row')).toHaveCount(1);
  await draft.locator('[data-meeting-action-menu]').click();
  await page.locator('#meetingActionMenu [data-meeting-action-do="edit"]').click();
  await expect(page.locator('#meetingActionTitle')).toHaveValue('결과 공유');
  await expect(page.locator('#meetingActionDue')).toHaveValue('2026-09-30');
  await expect(page.locator('#meetingActionList .meeting-action-row')).toHaveCount(0);
  await page.locator('#meetingActionAdd').click();
  await expect(page.locator('#meetingActionList .meeting-action-row')).toHaveCount(1);
  await page.locator('#saveMeetingBtn').click();

  await expect.poll(()=>savedMeeting).not.toBeNull();
  expect(savedMeeting.title).toBe('궤도협의회 집행위원회');
  expect(savedMeeting.series_name).toBe('궤도협의회 집행위원회');
  expect(savedMeeting.round_no).toBe(8);
  expect(savedMeeting.project_id).toBe('child');
  expect(savedMeeting.meeting_at).toBe('2026-09-25T05:00:00.000Z');
  expect(savedMeeting.transcript_text).toBe(raw);
  expect(savedMeeting.notes).toBe('특이사항\n둘째 줄');
  expect(savedMeeting).not.toHaveProperty('decisions');

  await expect.poll(()=>savedTask).not.toBeNull();
  expect(savedTask).toMatchObject({
    action:'create',
    title:'결과 공유',
    due:'2026-09-30',
    links:[{meeting_id:'meeting-new'},{project_id:'child'}]
  });
  expect(legacyWrites).toBe(0);
});

test('repeated meeting save submits one meeting and one Google follow-up',async({page})=>{
  await signIn(page);
  let meetingPosts=0,taskCreates=0,release;
  const held=new Promise(resolve=>{release=resolve});
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    if(route.request().method()==='POST'){
      meetingPosts++;
      await held;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...route.request().postDataJSON(),id:'meeting-once'}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>{
    if(new URL(route.request().url()).searchParams.get('action')==='create')taskCreates++;
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,task:{id:'google-once'}})});
  });
  await page.locator('#newMeetingBtn').click();
  await fillMeetingName(page,'중복 방지 회의');
  await fillDateTime(page,'#meetingAt','2026-09-29T09:00');
  await page.locator('#meetingTranscript').fill('결과');
  await page.locator('.meeting-action-title').fill('후속');
  await page.locator('#saveMeetingBtn').evaluate(button=>{button.click();button.click()});
  await expect.poll(()=>meetingPosts).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(150);
  const busy=await page.locator('#saveMeetingBtn').evaluate(button=>({disabled:button.disabled,text:button.textContent.trim()}));
  release();
  await expect(page.locator('#meetingModal')).toBeHidden();
  await expect.poll(()=>taskCreates).toBeGreaterThanOrEqual(1);
  expect(meetingPosts).toBe(1);
  expect(taskCreates).toBe(1);
  expect(busy).toEqual({disabled:true,text:'저장 중…'});
});

test('failed meeting create restores its save button for a retry',async({page})=>{
  await signIn(page);
  let posts=0;
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>{
    if(route.request().method()==='POST'){
      posts++;
      return route.fulfill(posts===1
        ?{status:503,contentType:'application/json',body:JSON.stringify({message:'잠시 후 다시 시도해 주세요.'})}
        :{status:200,contentType:'application/json',body:JSON.stringify([{...route.request().postDataJSON(),id:'meeting-retry'}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await page.locator('#newMeetingBtn').click();
  await fillMeetingName(page,'재시도 회의');
  await fillDateTime(page,'#meetingAt','2026-09-29T09:00');
  await page.locator('#meetingTranscript').fill('결과');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingStatus')).toHaveClass(/error/);
  await expect(page.locator('#saveMeetingBtn')).toBeEnabled();
  await expect(page.locator('#saveMeetingBtn')).toHaveText('사업 보고 저장');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  expect(posts).toBe(2);
});

test('a Google follow-up failure leaves the saved meeting available without another create attempt',async({page})=>{
  await signIn(page);
  let creates=0,stored=null;
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>{
    if(route.request().method()==='POST'){creates++;stored={...route.request().postDataJSON(),id:'meeting-saved'};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([stored])})}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(stored?[stored]:[meeting])});
  });
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Google 저장 실패'})}));
  await page.locator('#newMeetingBtn').click();
  await fillMeetingName(page,'새 회의');
  await fillDateTime(page,'#meetingAt','2026-09-25T14:00');
  await page.locator('#meetingTranscript').fill('회의 결과');
  await page.locator('.meeting-action-title').fill('후속');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  await expect(page.locator('#meetingList :is([data-mrd-meeting="meeting-saved"],[data-meeting-round="meeting-saved"])')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('사업 보고는 저장됐습니다.');
  expect(creates).toBe(1);
});

test('meeting material upload attempts every selected file and reports partial failure without deleting the meeting',async({page})=>{
  await signIn(page);
  let meetingSaved=false,uploadCount=0;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    if(route.request().method()==='POST'){
      meetingSaved=true;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...meeting,id:'meeting-files'}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  // MEET-파일AI분류: 새 사업 보고의 자료도 자료실 올리기와 같은 library-files 요청으로 올린다(meeting_id 칸으로 연결).
  await page.route(`${SB}/functions/v1/library-files**`,async route=>{
    uploadCount++;
    if(uploadCount===2)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'upload failed'})});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,document:{id:'00000000-0000-4000-8000-00000000000'+uploadCount,meeting_id:'meeting-files'}})});
  });

  await page.locator('#newMeetingBtn').click();
  await fillMeetingName(page,'자료 첨부 회의');
  await fillDateTime(page,'#meetingAt','2026-09-25T14:00');
  await page.locator('#meetingTranscript').fill('회의 결과 원문');
  await page.locator('#meetingFiles').setInputFiles([
    {name:'자료1.txt',mimeType:'text/plain',buffer:Buffer.from('one')},
    {name:'자료2.txt',mimeType:'text/plain',buffer:Buffer.from('two')}
  ]);
  await page.locator('#saveMeetingBtn').click();

  await expect.poll(()=>meetingSaved).toBe(true);
  await expect.poll(()=>uploadCount).toBe(2);
  await expect(page.locator('#toast')).toContainText('사업 보고는 저장했습니다. 회의자료 1개 저장 · 1개 실패');
});

// UI-PC회의: 아래 줄 목록 시험은 폰·중간 폭(1024 미만)의 그리는 방식이다. PC(≥1024)의 열 배치는 meeting-columns.spec.mjs.
test.describe('meeting list rows below PC width',()=>{
test.use({viewport:{width:900,height:900}});
test('meeting list uses canonical meeting names without title-series duplication',async({page})=>{
  await signIn(page);
  // UI-전수디자인점검 F01: 회의명 거르기는 칸 칩 줄 끝 [거르기 ▾] 창의 한 묶음.
  await expect(reportFilterButton(page)).toBeVisible();
  expect(await reportFilterLabels(page,'name')).toEqual(expect.arrayContaining(['전체','궤도협의회','회의명 미지정']));
  await pickReportFilter(page,'name',{label:'궤도협의회'});
  await expect(reportFilterButton(page)).toHaveText(/궤도협의회/);
  const row=page.locator('#meetingList .meeting-list-row');
  await expect(row).toHaveCount(1);
  await expect(row.locator('h3')).toHaveText('궤도협의회');
  await expect(row.locator('.badge')).toHaveCount(0);
  await expect(row.locator('p')).toContainText('1차');
  await expect(row).not.toContainText('과거 회의실');
  const box=await row.boundingBox();
  expect(box.height).toBeLessThanOrEqual(60);
});

});
// UI-화면폭넘침: 줄 앞 색 점은 없앴다. 회의 이름별 색 배정은 줄의 --meeting-color 값(필터 칩 점과 같은 값)으로 확인한다.
const stripe=row=>row.evaluate(el=>{const probe=document.createElement('i');probe.style.color='var(--meeting-color)';el.append(probe);const c=getComputedStyle(probe).color;probe.remove();return c});
const rgb=hex=>`rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`;

const neutral=page=>page.evaluate(()=>{const probe=document.createElement('i');probe.style.color='#808080';document.body.append(probe);const c=getComputedStyle(probe).color;probe.remove();return c});
// MEET-결과정리 ②: 회의 종류 색은 theme-tokens.css의 --ds-meeting-1~16(밝은 화면 값·어두운 화면 값). 시험 화면은 밝은 화면.
const tokenPalette=dark=>{const css=read('app/theme-tokens.css'),at=css.indexOf('@media (prefers-color-scheme:dark)'),part=dark?css.slice(at):css.slice(0,at);return Array.from({length:16},(_,i)=>part.match(new RegExp(`--ds-meeting-${i+1}:(#[0-9a-f]{6})`))?.[1])};
const palette=()=>tokenPalette(false);
async function showMeetings(page,rows,docs=[]){
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)}));
  await page.route(`${SB}/rest/v1/app_documents**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(docs)}));
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  // MTG-프로젝트합치기 3단계: [목록]은 한 주씩이라 여러 주에 걸친 가짜 보고는 [전체]로 모두 본다(보고가 없으면 주 줄도 없다).
  if(rows.length)await showAllReportWeeks(page);
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(rows.length);
}

test.describe('meeting list rows below PC width (colors and names)',()=>{
test.use({viewport:{width:900,height:900}});
test('meeting names keep colors after reload and after older meetings are added',async({page})=>{
  await signIn(page);
  const P=palette();
  const rows=[
    {...meeting,id:'a3',title:'궤도협의회',series_name:'궤도협의회',round_no:3,meeting_at:'2026-09-20T01:00:00Z'},
    {...meeting,id:'c1',title:'안전위원회',series_name:'안전위원회',round_no:1,meeting_at:'2026-09-19T01:00:00Z'},
    {...meeting,id:'b1',title:'노사협의회',series_name:'노사협의회',round_no:1,meeting_at:'2026-09-18T01:00:00Z'},
    {...meeting,id:'a2',title:'  궤도협의회 ',series_name:null,round_no:2,meeting_at:'2026-09-17T01:00:00Z'},
    {...meeting,id:'none',title:'',series_name:null,round_no:null,meeting_at:'2026-09-16T01:00:00Z'},
    {...meeting,id:'a1',title:'궤도협의회',series_name:'궤도협의회',round_no:1,meeting_at:'2026-09-15T01:00:00Z'}
  ];
  await showMeetings(page,rows,[{id:'d1',workspace_id:'meeting-ws',meeting_id:'a3',title:'자료'}]);
  const byId=id=>page.locator(`#meetingList [data-mrd-meeting="${id}"]`);
  const original={};
  for(const id of ['a1','a2','a3','b1','c1'])original[id]=await stripe(byId(id));
  expect(original.a1).toBe(original.a2);
  expect(original.a2).toBe(original.a3);
  for(const color of Object.values(original))expect(P.map(rgb)).toContain(color);
  expect(await byId('a1').evaluate(el=>getComputedStyle(el.querySelector('.meeting-list-title'),'::before').content)).toBe('none');
  expect(await stripe(byId('none'))).toBe(await neutral(page));
  // Second line: round · date · materials only.
  await expect(byId('a3').locator('p')).toHaveText(/^3차 · .+ · 회의자료 있음$/);
  await expect(byId('a3').locator('p')).not.toContainText('메인');
  // Filtering does not reassign colors.
  await pickReportFilter(page,'name',{label:'안전위원회'});
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(1);
  expect(await stripe(byId('c1'))).toBe(original.c1);
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await showAllReportWeeks(page);// 새로 불러오면 다시 주 단위
  await pickReportFilter(page,'name','all');
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(rows.length);
  for(const [id,color] of Object.entries(original))expect(await stripe(byId(id)),id).toBe(color);
  await showMeetings(page,[...rows,{...meeting,id:'older',title:'새 과거 회의',series_name:'새 과거 회의',meeting_at:'2020-01-01T01:00:00Z'}]);
  for(const [id,color] of Object.entries(original))expect(await stripe(byId(id)),id).toBe(color);
  let savedRows=[...rows,{...meeting,id:'older',title:'새 과거 회의',series_name:'새 과거 회의',meeting_at:'2020-01-01T01:00:00Z'}];
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>{
    if(route.request().method()==='POST'){
      const added={...route.request().postDataJSON(),id:'added'};
      savedRows=[added,...savedRows];
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([added])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(savedRows)});
  });
  await page.locator('#newMeetingBtn').click();
  await page.locator('#meetingNameSelect').selectOption({label:'궤도협의회'});
  await fillDateTime(page,'#meetingAt','2026-10-03T10:00');
  await page.locator('#meetingTranscript').fill('모의 결과');
  await page.locator('#saveMeetingBtn').click();
  await expect(byId('added')).toBeVisible();
  expect(await stripe(byId('added'))).toBe(original.a1);
  for(const [id,color] of Object.entries(original))expect(await stripe(byId(id)),id).toBe(color);
});

test('all named meetings use the palette and normalized names share a color',async({page})=>{
  await signIn(page);
  const P=palette();
  const rows=Array.from({length:P.length+2},(_,i)=>({...meeting,id:'n'+i,title:'회의'+(i+1),series_name:'회의'+(i+1),round_no:null,meeting_at:new Date(Date.UTC(2026,0,1+i)).toISOString()})).reverse();
  rows.push({...meeting,id:'normalized-a',title:'  Alpha   Team  ',series_name:null},{...meeting,id:'normalized-b',title:'alpha team',series_name:null});
  await showMeetings(page,rows);
  const colors=[];
  for(let i=0;i<P.length+2;i++)colors.push(await stripe(page.locator(`#meetingList [data-mrd-meeting="n${i}"]`)));
  for(const color of colors)expect(P.map(rgb)).toContain(color);
  expect(await stripe(page.locator('[data-mrd-meeting="normalized-a"]'))).toBe(await stripe(page.locator('[data-mrd-meeting="normalized-b"]')));
});

test('new meeting suggests the next round from loaded names without extra requests and respects manual edits',async({page})=>{
  await signIn(page);
  const rows=[
    {...meeting,id:'round-2',series_name:' Alpha  Team ',round_no:2},
    {...meeting,id:'round-7',series_name:'alpha team',round_no:7},
    {...meeting,id:'round-none',series_name:'ALPHA TEAM',round_no:null},
    {...meeting,id:'other',series_name:'다른 회의',round_no:null}
  ];
  await showMeetings(page,rows);
  let requests=0;
  page.on('request',request=>{if(request.url().startsWith(SB))requests++});
  await page.locator('#newMeetingBtn').click();
  expect(requests).toBe(0);
  const title=page.locator('#meetingTitle'),round=page.locator('#meetingRoundNo'),select=page.locator('#meetingNameSelect');
  await select.selectOption('Alpha  Team');
  await expect(round).toHaveValue('8');
  await select.selectOption({label:'다른 회의'});
  await expect(round).toHaveValue('');
  await select.selectOption('__other__');
  await title.fill('없는 회의');
  await expect(round).toHaveValue('');
  await title.fill('ALPHATEAM');
  await expect(page.locator('#meetingNameMatch')).toContainText('같은 이름이 있습니다');
  await page.locator('#meetingNameUseMatch').click();
  await expect(round).toHaveValue('8');
  await round.fill('14');
  await select.selectOption({label:'다른 회의'});
  await expect(round).toHaveValue('14');
  await round.fill('');
  await select.selectOption('__other__');
  await title.fill('alpha team');
  await expect(round).toHaveValue('');
  await page.locator('#meetingModal [data-close]').click();
  await page.locator('#newMeetingBtn').click();
  await select.selectOption('Alpha  Team');
  await expect(round).toHaveValue('8');
  expect(requests).toBe(0);
});

test('name choices group whitespace variants by latest spelling and suggest their shared round without requests',async({page})=>{
  await signIn(page);
  const rows=[
    {...meeting,id:'recent',series_name:'주간 회의',round_no:4,meeting_at:'2026-10-02T01:00:00Z'},
    {...meeting,id:'second',series_name:'월간회의',round_no:2,meeting_at:'2026-10-01T01:00:00Z'},
    {...meeting,id:'old',series_name:'주간회의',round_no:7,meeting_at:'2026-09-01T01:00:00Z'}
  ];
  await showMeetings(page,rows);
  expect(await stripe(page.locator('[data-mrd-meeting="recent"]'))).toBe(await stripe(page.locator('[data-mrd-meeting="old"]')));
  let requests=0;page.on('request',request=>{if(request.url().startsWith(SB))requests++});
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingNameSelect option')).toHaveText(['이름 선택','주간 회의','월간회의','기타(직접 입력)']);
  await page.locator('#meetingNameSelect').selectOption({label:'주간 회의'});
  await expect(page.locator('#meetingRoundNo')).toHaveValue('8');
  await expect(page.locator('#meetingTitle')).toHaveValue('주간 회의');
  expect(requests).toBe(0);
});

test('custom name match offers the recent spelling and choosing it fills the round',async({page})=>{
  await signIn(page);
  await showMeetings(page,[{...meeting,series_name:'주간 회의',round_no:3}]);
  await page.locator('#newMeetingBtn').click();
  await page.locator('#meetingNameSelect').selectOption('__other__');
  await page.locator('#meetingTitle').fill(' 주간회의 ');
  await expect(page.locator('#meetingNameMatch')).toContainText('같은 이름이 있습니다: 주간 회의');
  await page.locator('#meetingNameUseMatch').click();
  await expect(page.locator('#meetingNameSelect')).toHaveValue('주간 회의');
  await expect(page.locator('#meetingRoundNo')).toHaveValue('4');
});

test('empty meeting list opens a visible custom name input',async({page})=>{
  await signIn(page);await showMeetings(page,[]);
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingTitle')).toBeVisible();
});

test('edit can replace a meeting name with an existing choice',async({page})=>{
  await signIn(page);
  const rows=[meeting,{...meeting,id:'other-name',series_name:'통일할 회의',title:'통일할 회의',meeting_at:'2026-09-18T10:00:00Z'}];
  await showMeetings(page,rows);
  let saved=null;
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>{
    if(route.request().method()==='PATCH'){saved=route.request().postDataJSON();return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:meeting.id}])})}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)});
  });
  await openMeetingResult(page,'meeting-1');
  await mrdMenu(page,'edit');
  await page.locator('#mrdEditNameSelect').selectOption({label:'통일할 회의'});
  await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>saved).not.toBeNull();
  expect(saved.title).toBe('통일할 회의');expect(saved.series_name).toBe('통일할 회의');
});

});
// MEET-결과정리 ②: 8색 하나를 밝은·어두운 화면에 같이 쓰던 것을, 화면마다 16색(같은 칸은 같은 색 계열)으로 나눴다.
// 각 화면의 16색이 아래 기준(빨강 아님·바탕 대비 3:1·회색과 구별·서로 색차 20 이상)을 모두 지킨다.
for(const dark of [false,true])test(`meeting palette has 16 distinct non-red colors visible on ${dark?'dark':'light'} surfaces`,async()=>{
  const P=tokenPalette(dark);
  expect(P).toHaveLength(16);
  expect(P.every(Boolean)).toBe(true);
  expect(new Set(P).size).toBe(16);
  const lin=c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4};
  const parts=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const lum=hex=>{const [r,g,b]=parts(hex).map(lin);return .2126*r+.7152*g+.0722*b};
  const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  const hue=hex=>{const [r,g,b]=parts(hex).map(v=>v/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(!d)return null;const h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;return (h*60+360)%360};
  const lab=hex=>{const [r,g,b]=parts(hex).map(lin),f=t=>t>.008856?Math.cbrt(t):7.787*t+16/116,x=(r*.4124+g*.3576+b*.1805)/.95047,y=r*.2126+g*.7152+b*.0722,z=(r*.0193+g*.1192+b*.9505)/1.08883;return [116*f(y)-16,500*(f(x)-f(y)),200*(f(y)-f(z))]};
  const dE=(a,b)=>{const A=lab(a),B=lab(b);return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2])};
  for(const color of P){
    const h=hue(color);
    expect(h,color).not.toBeNull();
    expect(h>=40&&h<=320,`${color} hue ${h}`).toBe(true);
    for(const surface of dark?['#1f2933','#121212','#1f1f1b','#292924']:['#ffffff','#fffefa','#f7f5ee','#f3f1ea'])expect(contrast(color,surface),`${color} on ${surface}`).toBeGreaterThanOrEqual(3);
    expect(dE(color,'#cfd6dc'),`${color} vs neutral`).toBeGreaterThan(30);
  }
  for(let i=0;i<P.length;i++)for(let j=i+1;j<P.length;j++)expect(dE(P[i],P[j]),`${P[i]} ${P[j]}`).toBeGreaterThanOrEqual(20);
});

// UI-PC회의: PC(≥1024)의 [+ 회의 결과]·열은 meeting-columns.spec.mjs와 add-button-placement.spec.mjs 1440이 본다.
for(const width of [320,360,390,768,1000]){
  // UI-선택표시통일: 폰(760px 이하)의 [+ 회의]는 다른 탭과 같은 동그란 [+](하단 탭 위)이고 카드 안에는 없다.
  test(`meeting filter stays usable and add button sits in the list card at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:800});
    await signIn(page);
    // UI-전수디자인점검 F01: 회의명·사업영역 칩 줄은 없고, 칸 칩 줄 끝 작은 [거르기 ▾](32px) 하나. 칩 줄은 44px(누르는 범위), 버튼은 줄 안 오른쪽 끝.
    const bar=page.locator('#meetingsView .report-kind-bar');
    const select=page.locator('#reportKindFilter'),filter=reportFilterButton(page),button=page.locator('#newMeetingBtn');
    await expect(page.locator('#meetingTypeFilter,#reportAreaFilter,#meetingsView .meeting-toolbar')).toHaveCount(0);
    await expect(button).toBeVisible();await expect(filter).toBeVisible();
    const head=page.locator('#meetingsListCard .add-list-head');
    const [b,s,h,btn,f]=await Promise.all([bar.boundingBox(),select.boundingBox(),head.boundingBox(),button.boundingBox(),filter.boundingBox()]);
    expect(s.height).toBeCloseTo(44,0);
    expect(s.x).toBeCloseTo(b.x,0);
    expect(s.x+s.width).toBeLessThanOrEqual(f.x);
    expect(f.x+f.width).toBeCloseTo(b.x+b.width,0);
    expect(f.height).toBeCloseTo(32,0);expect(f.y+f.height/2).toBeCloseTo(s.y+s.height/2,0);
    expect(b.height).toBeCloseTo(44,0);
    expect(await select.locator('[role=radio]').first().evaluate(el=>el.getBoundingClientRect().height)).toBe(32);
    // ⋯은 [목록|달력|사진]과 같은 머리 줄의 오른쪽 끝(혼자 둘째 줄을 차지하지 않음).
    const [views,more]=await Promise.all([page.locator('#reportViewFilter').boundingBox(),page.locator('#reportMore').boundingBox()]);
    expect(more.y+more.height/2).toBeCloseTo(views.y+views.height/2,0);expect(more.x+more.width).toBeCloseTo(h.x+h.width,0);
    if(width<=760){
      expect(await button.evaluate(el=>getComputedStyle(el).position)).toBe('fixed');expect(btn.width).toBe(36);expect(btn.height).toBe(36);
      await expect(button).toHaveAttribute('aria-label','사업 보고 등록');
    }else{
      expect(btn.height).toBeCloseTo(32,0);/* BIZ-버튼줄정리: 채운 [+ 사업 보고]는 작고 낮게 32px, 그 오른쪽 줄 끝이 ⋯ */
      const more=await page.locator('#reportMore').boundingBox();
      expect(more.x+more.width).toBeCloseTo(h.x+h.width,0);
      expect(btn.x+btn.width).toBeLessThanOrEqual(more.x);
      expect(btn.y).toBeGreaterThanOrEqual(h.y);
      expect(btn.y+btn.height).toBeLessThanOrEqual(h.y+h.height);
      expect(await button.evaluate(el=>el.scrollWidth<=el.clientWidth&&getComputedStyle(el).whiteSpace==='nowrap')).toBe(true);
    }
    const row=page.locator('#meetingList .meeting-list-row').first();
    const fit=await row.evaluate(el=>{const main=el.querySelector('.meeting-list-main').getBoundingClientRect(),box=el.getBoundingClientRect(),cs=getComputedStyle(el);return {row:box.height,content:main.height+parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom)+parseFloat(cs.borderTopWidth)}});
    expect(Math.abs(fit.row-fit.content)).toBeLessThanOrEqual(1);
    // UI-디자인기준 3/3: 13px name + 12px metadata (line height 1.4), 9px row padding, first row without a line, at least 44px.
    expect(fit.row).toBeCloseTo(13*1.4+12*1.4+2+18,0);expect(fit.row).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

test.describe('meeting list legacy rows below PC width',()=>{
test.use({viewport:{width:900,height:900}});
test('meeting list filters title-only and series-only legacy rows by the displayed meeting name',async({page})=>{
  await signIn(page);
  const rows=[
    {...meeting,id:'title-only',title:'제목만 회의',series_name:null,round_no:null},
    {...meeting,id:'series-only',title:'',series_name:'계열명만 회의',round_no:2},
    {...meeting,id:'different',title:'33차 기존 제목',series_name:'기존 회의 계열',round_no:33}
  ];
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)}));
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect(page.locator('#meetingList h3')).toHaveText(['기존 회의 계열','계열명만 회의','제목만 회의']);// 시각이 같으면 차수 큰 쪽이 위(MEET-폰순서, PC와 같은 기준)
  await pickReportFilter(page,'name',{label:'제목만 회의'});
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(1);
  await expect(page.locator('#meetingList .meeting-list-row p')).not.toContainText('차');
});
});

// MTG-고치기바로: 아래는 사업 보고 상세 창(폰·중간 폭)의 시험이다. PC(≥1024)는 상세가 세 번째 칸에 붙어 창이 없다(meeting-columns·meeting-inline-edit).
test.describe('meeting detail window below PC width',()=>{
test.use({viewport:{width:900,height:900}});
test('meeting detail shows one canonical heading while retaining a distinct legacy title in metadata',async({page})=>{
  await signIn(page);
  await openMeetingResult(page,'meeting-1');
  await expect(page.locator('#mrdTitle')).toHaveText('궤도협의회');
  await expect(page.locator('#mrdMeta')).toContainText('기존 제목: 접근성 회의');
  await expect(page.locator('#mrdMeta')).toContainText('1차');
  await expect(page.locator('#mrdMeta')).not.toContainText('궤도협의회');
});

test('meeting detail does not repeat a new meeting name when title and series name are equal',async({page})=>{
  await signIn(page);
  const fresh={...meeting,title:'궤도협의회 집행위원회',series_name:'궤도협의회 집행위원회',round_no:8};
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([fresh])}));
  await openMeetingResult(page,'meeting-1');
  await expect(page.locator('#mrdTitle')).toHaveText('궤도협의회 집행위원회');
  await expect(page.locator('#mrdMeta')).not.toContainText('궤도협의회 집행위원회');
  await expect(page.locator('#mrdMeta')).toContainText('8차');
});

test('meeting detail dialog exposes semantics, Escape close, and trigger focus restore',async({page})=>{
  await signIn(page);
  // 폰·중간 폭은 목록 줄, PC 3단(MEET-결과3단)은 오른쪽 머리 ⋯ → [수정]. 창을 닫으면 누른 줄(PC는 ⋯)로 돌아간다.
  const row=page.locator('#meetingList [data-mrd-meeting="meeting-1"]'),more=page.locator('#meetingList [data-meeting-more="meeting-1"]');
  await expect(row.or(more).first()).toBeVisible();
  const pc=!(await row.count()),trigger=pc?more:row;
  await trigger.focus();
  await trigger.click();
  if(pc)await page.locator('#mcolMenu [data-meeting-menu="edit"]').click();
  const modal=page.locator('#meetingRoundDetailModal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('role','dialog');
  await expect(modal).toHaveAttribute('aria-modal','true');
  await expect(modal).toHaveAttribute('aria-labelledby','mrdTitle');
  await expect(page.locator('#mrdClose')).toHaveAttribute('aria-label','닫기');
  await expect(page.locator('#mrdClose')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveClass(/hidden/);
  await expect(trigger).toBeFocused();
});

test('meeting edit preserves legacy name fields when the user does not rename the meeting',async({page})=>{
  await signIn(page);
  let saved=null;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    if(route.request().method()==='PATCH'){
      saved=route.request().postDataJSON();
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:meeting.id}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  await openMeetingResult(page,'meeting-1');
  await expect(page.locator('#mrdResult')).toHaveText('원문 첫 줄\n원문 둘째 줄');
  await expect(page.locator('#mrdSpecialSection')).toBeVisible();
  await mrdMenu(page,'edit');
  await expect(page.locator('#mrdEditSeries')).toHaveCount(0);
  await expect(page.locator('#mrdEditTitle')).toHaveValue('궤도협의회');
  await expect(page.locator('#mrdEditAt')).toHaveValue('2026-09-17T19:00');
  await expect(page.locator('#mrdEditProject option[value="child"]')).toContainText('↳');
  const raw='  수정 원문 첫 줄\n둘째 줄\n마지막 줄  ';
  await page.locator('#mrdEditTranscript').fill(raw);
  await page.locator('#mrdEditNotes').fill('수정 특이사항\n둘째 줄');
  await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>saved).not.toBeNull();
  expect(saved.transcript_text).toBe(raw);
  expect(saved.notes).toBe('수정 특이사항\n둘째 줄');
  expect(saved.meeting_at).toBe('2026-09-17T10:00:00.000Z');
  expect(saved).not.toHaveProperty('title');
  expect(saved).not.toHaveProperty('series_name');
  expect(saved).not.toHaveProperty('decisions');
  expect(saved).not.toHaveProperty('location');
  expect(saved).not.toHaveProperty('attendee_count');
});

test('renaming a legacy meeting normalizes title and series_name to the one user-visible name',async({page})=>{
  await signIn(page);
  let saved=null;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    if(route.request().method()==='PATCH'){
      saved=route.request().postDataJSON();
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:meeting.id}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  await openMeetingResult(page,'meeting-1');
  await mrdMenu(page,'edit');
  await page.locator('#mrdEditNameSelect').selectOption('__other__');
  await page.locator('#mrdEditTitle').fill('궤도협의회 집행위원회');
  await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>saved).not.toBeNull();
  expect(saved.title).toBe('궤도협의회 집행위원회');
  expect(saved.series_name).toBe('궤도협의회 집행위원회');
});

test('round number remains optional on edit',async({page})=>{
  await signIn(page);
  let saved=null;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    if(route.request().method()==='PATCH'){
      saved=route.request().postDataJSON();
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:meeting.id}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  await openMeetingResult(page,'meeting-1');
  await mrdMenu(page,'edit');
  await page.locator('#mrdEditRound').fill('');
  await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>saved).not.toBeNull();
  expect(saved.round_no).toBeNull();
});

test('empty special notes stay hidden in meeting detail',async({page})=>{
  await signIn(page);
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...meeting,notes:''}])}));
  await openMeetingResult(page,'meeting-1');
  await expect(page.locator('#mrdSpecialSection')).toBeHidden();
});

test('legacy structured decisions remain visible only as fallback when old meetings have no raw result',async({page})=>{
  await signIn(page);
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...meeting,transcript_text:null,decisions:'기존 결정 기록'}])}));
  await openMeetingResult(page,'meeting-1');
  await expect(page.locator('#mrdResult')).toContainText('[기존 회의결과 기록]');
  await expect(page.locator('#mrdResult')).toContainText('기존 결정 기록');
});

test('meeting edit does not report success when RLS updates zero rows',async({page})=>{
  await signIn(page);
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    const data=route.request().method()==='PATCH'?[]:[meeting];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await openMeetingResult(page,'meeting-1');
  await mrdMenu(page,'edit');
  await page.locator('#mrdSaveEdit').click();
  await expect(page.locator('#mrdEditStatus')).toContainText('저장 결과를 확인하지 못했습니다.');
  await expect(page.locator('#mrdEditStatus')).not.toHaveClass(/ok/);
  await expect(page.locator('#mrdEditStatus').getByRole('button',{name:'저장 결과 확인',exact:true})).toBeVisible();
  await expect(page.locator('#mrdEditNotes')).toHaveValue(meeting.notes);
  await expect(page.locator('#mrdEditTranscript')).toHaveValue(meeting.transcript_text);
  await expect(page.locator('#mrdEditor')).toBeVisible();
});

test('closing a meeting ignores its late detail response',async({page})=>{
  await signIn(page);
  let release;
  const held=new Promise(resolve=>{release=resolve});
  let requested=false;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    requested=true;
    await held;
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  await openMeetingResult(page,'meeting-1');
  await expect.poll(()=>requested).toBe(true);
  await page.locator('#mrdClose').evaluate(button=>button.click());
  release();
  await expect(page.locator('#meetingRoundDetailModal')).toHaveClass(/hidden/);
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('aria-hidden','true');
});

test('closing a meeting during a delayed follow-up save does not reopen its detail',async({page})=>{
  await signIn(page);
  let release,posted=false;
  const held=new Promise(resolve=>{release=resolve});
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    if(action==='create'){posted=true;await held}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(action==='linked'?{tasks:[]}:{ok:true,task:{id:'google-new'}})});
  });
  await openMeetingResult(page,'meeting-1');
  await page.locator('#mrdAddTask').click();
  await page.locator('#mrdTaskTitle').fill('후속 자료 정리');
  await page.locator('#mrdTaskSave').click();
  await expect.poll(()=>posted).toBe(true);
  await closeMeetingResult(page);
  release();
  await expect(page.locator('#meetingRoundDetailModal')).toHaveClass(/hidden/);
  await page.waitForTimeout(100);
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('aria-hidden','true');
});

test('repeated meeting follow-up save sends one Google create',async({page})=>{
  await signIn(page);
  let creates=0,release;
  const held=new Promise(resolve=>{release=resolve}),tasks=[];
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    if(action==='linked')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks})});
    if(action==='create'){
      creates++;
      await held;
      tasks.push({id:'google-once',taskListId:'@default',title:route.request().postDataJSON().title,status:'needsAction'});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  });
  await openMeetingResult(page,'meeting-1');
  await page.locator('#mrdAddTask').click();
  await page.locator('#mrdTaskTitle').fill('후속');
  await page.locator('#mrdTaskSave').click();
  await expect.poll(()=>creates).toBeGreaterThanOrEqual(1);
  // UI-회의결과창정리: 제목 옆 작은 +가 입력 한 줄을 닫고 다시 연다.
  await page.locator('#mrdAddTask').click();
  await expect(page.locator('#mrdTaskForm')).toBeHidden();
  await page.locator('#mrdAddTask').click();
  await page.locator('#mrdTaskTitle').fill('후속 변경');
  await expect(page.locator('#mrdTaskSave')).toBeDisabled();
  await page.locator('#mrdTaskSave').evaluate(button=>button.click());
  await page.waitForTimeout(150);
  const createsBeforeRelease=creates;
  release();
  await expect(page.locator('#mrdTasks [data-mrd-task="google-once"]')).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(createsBeforeRelease).toBe(1);
  expect(creates).toBe(1);
});

test('meeting detail waits for a task screen completion and rereads it on reopening',async({page})=>{
  await signIn(page);
  const due=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10)+'T00:00:00Z';
  let status='needsAction',toggleStarted=false,linkedReads=0,linkedCompleted=0,release;
  const held=new Promise(resolve=>{release=resolve});
  const task=()=>({id:'meeting-follow-up',taskListId:'@default',taskListTitle:'내 할 일',title:'후속',status,due,completed:status==='completed'?new Date().toISOString():null});
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    if(action==='overview')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:true,authorized:true,tasks:[task()]})});
    if(action==='linked'){linkedReads++;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks:[task()]})});linkedCompleted++;return}
    if(action==='toggle'){
      toggleStarted=true;
      await held;
      status='completed';
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,task:task()})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  await clickView(page,'tasks');
  await expect(page.locator('#gtTaskBody [data-google-task="meeting-follow-up"]')).toBeVisible();
  await page.locator('#gtTaskBody [data-gt-toggle="meeting-follow-up"]').click();
  await expect.poll(()=>toggleStarted).toBe(true);
  await expect(page.locator('#gtTaskBody [data-google-task="meeting-follow-up"]')).toHaveClass(/completed/);
  await clickView(page,'meetings');
  linkedReads=0;
  await openMeetingResult(page,'meeting-1');
  await page.waitForTimeout(150);
  const readsBeforeSave=linkedReads;
  release();
  await expect(page.locator('#mrdTasks [data-mrd-task="meeting-follow-up"]')).toHaveClass(/completed/);
  expect(readsBeforeSave).toBe(0);
  await closeMeetingResult(page);
  const previousReads=linkedReads,previousCompleted=linkedCompleted;
  await openMeetingResult(page,'meeting-1');
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
  await expect.poll(()=>linkedCompleted).toBeGreaterThan(previousCompleted);
  await expect(page.locator('#mrdTasks [data-mrd-task="meeting-follow-up"]')).toHaveClass(/completed/);
  await expect.poll(()=>linkedReads).toBeGreaterThan(previousReads);
});

test('meeting detail can undo a completion while the immediate Google save is in flight',async({page})=>{
  await signIn(page);
  let status='needsAction',release;
  const held=new Promise(resolve=>{release=resolve}),toggles=[];
  const task=()=>({id:'meeting-follow-up',taskListId:'@default',title:'시험 후속',status,completed:status==='completed'?new Date().toISOString():null});
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    if(action==='linked')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks:[task()]})});
    if(action==='toggle'){
      const body=route.request().postDataJSON();toggles.push(body.completed);
      if(body.completed)await held;
      status=body.completed?'completed':'needsAction';
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,task:task()})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:true,authorized:true,tasks:[task()]})});
  });
  await openMeetingResult(page,'meeting-1');
  const row=page.locator('#mrdTasks [data-mrd-task="meeting-follow-up"]');
  await expect(row).toBeVisible();
  await row.locator('[data-mrd-task-toggle]').click();
  await expect(row).toHaveClass(/completed/);
  await row.locator('[data-mrd-task-toggle]').click();
  await expect(row).toHaveClass(/pending/);
  release();
  await expect.poll(()=>toggles).toEqual([true,false]);
});

test('meeting detail restores a failed completion and alerts the user',async({page})=>{
  await signIn(page);
  const task={id:'meeting-follow-up',taskListId:'@default',title:'시험 후속',status:'needsAction',completed:null};
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    return route.fulfill({status:action==='toggle'?500:200,contentType:'application/json',body:JSON.stringify(action==='linked'?{tasks:[task]}:action==='toggle'?{error:'Google 저장 실패'}:{connected:true,authorized:true,tasks:[task]})});
  });
  await openMeetingResult(page,'meeting-1');
  const row=page.locator('#mrdTasks [data-mrd-task="meeting-follow-up"]');
  await expect(row).toBeVisible();
  await row.locator('[data-mrd-task-toggle]').click();
  expect(await noticeText(page)).toContain('완료를 저장하지 못해 되돌렸습니다');
  await expect(row).toHaveClass(/pending/);
});

test('meeting detail keeps completed Google follow-ups and supports create, edit, toggle, and confirmed delete without app_tasks',async({page})=>{
  await signIn(page);
  const tasks=[{id:'old-done',taskListId:'@default',title:'완료된 항목',due:'2025-01-01T00:00:00Z',notes:'기존 메모',status:'completed',completed:'2025-01-02T00:00:00Z'}];
  let legacyRequests=0,created=null,updated=null,deleted=null;
  await page.route(`${SB}/rest/v1/app_tasks**`,route=>{legacyRequests++;return route.fulfill({status:200,contentType:'application/json',body:'[]'})});
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>{
    const action=new URL(route.request().url()).searchParams.get('action'),body=route.request().method()==='POST'?route.request().postDataJSON():{};
    if(action==='linked')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks})});
    if(action==='create'){created=body;tasks.push({id:'new-google',taskListId:'@default',title:body.title,due:body.due,notes:body.notes,status:'needsAction'})}
    if(action==='update'){updated=body;Object.assign(tasks.find(t=>t.id===body.task_id),{title:body.title,due:body.due,notes:body.notes})}
    if(action==='toggle'){Object.assign(tasks.find(t=>t.id===body.task_id),{status:body.completed?'completed':'needsAction',completed:body.completed?new Date().toISOString():null})}
    if(action==='delete'){deleted=body;tasks.splice(tasks.findIndex(t=>t.id===body.task_id),1)}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  });
  await openMeetingResult(page,'meeting-1');
  await expect(page.locator('#mrdTasks [data-mrd-task]')).toHaveCount(1);
  await expect(page.locator('#mrdTasks [data-mrd-task="old-done"]')).toHaveClass(/completed/);
  await expect(page.locator('#mrdTasks [data-mrd-task-toggle="old-done"]')).toHaveAttribute('aria-label','완료 취소');
  expect(await page.locator('#mrdTasks [data-mrd-task="old-done"] b').evaluate(el=>getComputedStyle(el).textDecorationLine)).toContain('line-through');
  await page.locator('#mrdAddTask').click();
  await page.locator('#mrdTaskTitle').fill('새 후속');
  await page.locator('#mrdTaskDue').fill('2026-09-30');
  await page.locator('#mrdTaskSave').click();
  await expect(page.locator('#mrdTasks [data-mrd-task]')).toHaveCount(2);
  expect(created).toMatchObject({action:'create',due:'2026-09-30',notes:'',links:[{meeting_id:'meeting-1'},{project_id:'main'}]});
  // 할 일 화면과 같은 ⋯ 메뉴의 [수정]은 같은 입력 한 줄에 올리고, [저장]·[취소]를 보인다.
  await page.locator('#mrdTasks [data-mrd-task-menu="old-done"]').click();
  await page.locator('#mrdTaskMenu [data-mrd-menu-action="edit"]').click();
  await expect(page.locator('#mrdTaskTitle')).toHaveValue('완료된 항목');
  await expect(page.locator('#mrdTaskSave')).toHaveText('저장');
  await expect(page.locator('#mrdTaskCancel')).toBeVisible();
  await page.locator('#mrdTaskTitle').fill('수정된 후속');
  await page.locator('#mrdTaskDue').fill('2026-10-01');
  await page.locator('#mrdTaskSave').click();
  await expect(page.locator('#mrdTasks [data-mrd-task="old-done"]')).toContainText('수정된 후속');
  expect(updated).toMatchObject({action:'update',task_id:'old-done',due:'2026-10-01',notes:'기존 메모'});
  await page.locator('#mrdTasks [data-mrd-task-toggle="old-done"]').click();
  await expect(page.locator('#mrdTasks [data-mrd-task="old-done"]')).toHaveClass(/pending/);
  await page.locator('#mrdTasks [data-mrd-task-toggle="old-done"]').click();
  await expect(page.locator('#mrdTasks [data-mrd-task="old-done"]')).toHaveClass(/completed/);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#mrdTasks [data-mrd-task-menu="new-google"]').click();
  await page.locator('#mrdTaskMenu [data-mrd-menu-action="delete"]').click();
  await expect(page.locator('#mrdTasks [data-mrd-task]')).toHaveCount(1);
  expect(deleted).toMatchObject({action:'delete',task_id:'new-google'});
  expect(legacyRequests).toBe(0);
});

for(const width of [390])test(`meeting Google follow-up row stays usable at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await signIn(page);
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks:[{id:'followup',title:'긴 후속 할 일 제목을 표시하는 항목',status:'completed',completed:'2025-01-01T00:00:00Z',due:'2025-01-02T00:00:00Z',taskListId:'@default'}]})}));
  await openMeetingResult(page,'meeting-1');
  const row=page.locator('#mrdTasks [data-mrd-task="followup"]');
  await expect(row).toBeVisible();
  await expect(row.locator('[data-mrd-task-toggle]')).toBeVisible();
  await expect(row.locator('[data-mrd-task-edit]')).toBeVisible();
  await expect(row.locator('[data-mrd-task-menu]')).toBeVisible();
  // 할 일 화면과 같은 줄: 동그라미 · 이름 · 기한 · ⋯
  await expect(row.locator('.gt-due')).not.toBeEmpty();
  const box=await row.boundingBox(),menu=await row.locator('[data-mrd-task-menu]').boundingBox();
  expect(menu.width).toBeGreaterThanOrEqual(44);expect(menu.height).toBeGreaterThanOrEqual(44);
  expect(menu.y).toBeLessThan(box.y+box.height/2);
  expect(await row.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('Google editor displays and retains meeting links while a meeting-only task stays unlinked to projects',async({page})=>{
  await signIn(page);
  const today=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
  const task={id:'linked-google',taskListId:'@default',taskListTitle:'내 할 일',title:'회의 연결 항목',due:today+'T00:00:00Z',notes:'',status:'needsAction'};
  let update=null,linkChanges=0,unlinkBody=null,projectLinked=true;const actions=[];
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    actions.push(action);
    if(action==='overview')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:true,authorized:true,pending_scope:'all',tasks:[task,{...task,id:'meeting-only'}]})});
    if(action==='links')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({links:projectLinked?[{project_id:'main',status:'confirmed'}]:[],meeting_links:[{meeting_id:'meeting-1',status:'confirmed'}]})});
    if(action==='update'){update=route.request().postDataJSON();Object.assign(task,{title:update.title,notes:update.notes,due:update.due})}
    if(action==='link'||action==='unlink'){linkChanges++;if(action==='unlink'){unlinkBody=route.request().postDataJSON();projectLinked=false}}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,task,links:projectLinked?[{project_id:'main',status:'confirmed'}]:[],meeting_links:[{meeting_id:'meeting-1',status:'confirmed'}]})});
  });
  await clickView(page,'tasks');
  await expect.poll(()=>actions,{timeout:15000}).toContain('overview');
  await expect(page.locator('#gtTaskBody [data-google-task="linked-google"]')).toBeVisible({timeout:15000});
  await page.locator('[data-gt-edit="linked-google"]').click();
  await expect(page.locator('#gtMeetingLinks')).toContainText('사업 보고: 궤도협의회');
  await expect(page.locator('#gtEditLinkBody input[value="p:main"]')).toBeChecked();
  await page.locator('#gtEditNotes').fill('회의 연결을 유지하는 수정');await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>update).not.toBeNull();
  expect(linkChanges).toBe(0);
  await page.locator('[data-gt-edit="linked-google"]').click();
  await expect(page.locator('#gtEditLinkBody input[value="p:main"]')).toBeChecked();
  await page.locator('#gtEditLinkBody input[value="p:main"]').uncheck();
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>unlinkBody).not.toBeNull();
  expect(unlinkBody.links).toEqual([{project_id:'main'}]);
  await expect(page.locator('#gtUnlinked')).toHaveCount(0);
  await expect(page.locator('#gtTaskBody [data-google-task="meeting-only"] .gt-unlinked-badge')).toHaveCount(0);
  expect(actions).not.toContain('unlinked');
});

test('changing a meeting project leaves existing Google follow-up links untouched',async({page})=>{
  await signIn(page);
  let current={...meeting},linkChanges=0,linkedReads=0;
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>{
    if(route.request().method()==='PATCH'){
      const request=route.request(),url=new URL(request.url());
      const matches=url.searchParams.get('id')==='eq.'+current.id&&url.searchParams.get('workspace_id')==='eq.'+current.workspace_id;
      if(matches)current={...current,...request.postDataJSON()};
      return request.headers().prefer?.includes('return=representation')?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(matches?[current]:[])}):route.fulfill({status:204,body:''});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([current])});
  });
  let setLinksCalls=0;
  await page.route(`${SB}/rest/v1/rpc/app_meeting_set_links`,route=>{setLinksCalls++;return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'PGRST202',message:'Could not find the function public.app_meeting_set_links'})})});
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    if(action==='link'||action==='unlink')linkChanges++;
    if(action==='linked'){linkedReads++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks:[{id:'existing',title:'기존 후속',status:'needsAction',taskListId:'@default'}]})})}
    return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  await openMeetingResult(page,'meeting-1');
  await expect(page.locator('#mrdTasks [data-mrd-task="existing"]')).toBeVisible();
  // PC 3단(MEET-결과3단)은 오른쪽 결과도 후속 할 일을 읽으므로, 창을 연 뒤의 읽기 수를 기준으로 저장 때 다시 읽지 않는지 본다.
  const readsBeforeSave=linkedReads;expect(readsBeforeSave).toBeGreaterThanOrEqual(1);
  await mrdMenu(page,'edit');
  await page.locator('#mrdEditPlaces').click();await page.locator('#reportPlacesSheet').getByRole('button',{name:/하위/}).first().click();await page.locator('#reportPlacesSheet').getByRole('button',{name:'저장',exact:true}).click();
  await page.locator('#mrdSaveEdit').click();
  await expect(page.locator('#mrdTasks [data-mrd-task="existing"]')).toBeVisible();
  await expect.poll(()=>current.project_id).toBe('child');
  expect(setLinksCalls).toBe(1);
  await expect(page.locator('#mrdEditor')).toBeHidden();
  expect(linkedReads).toBe(readsBeforeSave);
  expect(linkChanges).toBe(0);
});
});

test('meeting integration keeps project auto-selection and one direct render path',async()=>{
  const html=read('app/index.html');
  const loader=read('app/loader-v2.js');
  const views=read('app/view-loader.js');
  const workflow=read('app/task-workflow.js');
  const detail=read('app/meeting-round-detail.js');
  const team=read('app/team.js');
  const css=read('app/styles.css');
  const project=read('app/project-system-v3.js');
  const files=read('supabase/functions/meeting-files/index.ts');

  for(const id of ['meetingRoundNo','meetingTranscript','meetingNotes','meetingFiles','meetingActionList','addMeetingAction','reportFilterBtn'])expect(html).toContain(`id="${id}"`);
  for(const id of ['meetingSeriesName','meetingAutoClassify','meetingDecisions','wfMeetingLocation','wfMeetingAttendees'])expect(html).not.toContain(`id="${id}"`);
  expect(loader).not.toContain('meeting-assignee-picker.js');
  expect(loader).not.toContain('meeting-file-route.js');
  expect(loader).not.toContain('workflow-ai-v3.js');
  expect(loader).toContain("import('./team.js')");
  expect(views).toContain('task-workflow.js');
  expect(views).toContain('meeting-round-detail.js');
  expect(views).toContain('meeting-ui.css');
  expect(workflow).not.toContain('MutationObserver');
  expect(workflow).not.toContain("document.createElement('style')");
  expect(detail).not.toContain('MutationObserver');
  expect(detail).not.toContain("document.createElement('style')");
  expect(detail).not.toContain('mrdEditSeries');
  expect(detail).not.toContain('mrdAiDraft');
  expect(team).toContain('series_name:title');
  expect(team).toContain('transcript_text:transcript');
  expect(team).toContain("uploadFileForMeeting");
  expect(read('app/library-upload.js')).toContain("fd.append('meeting_id',target.id)");
  expect(project).toContain("window.KPTUReportEntry.open({targets:[{kind:'project',id:current.id}]");
  expect(project).toContain('s.value=project.id');
  expect(files).toContain('file.size>100*1024*1024');
  expect(css).toContain("meeting-ui.css");
});
