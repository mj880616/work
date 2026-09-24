import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const BASE='http://127.0.0.1:8123';
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
    if(path==='/auth/v1/token')return ok({access_token:'meeting-access',refresh_token:'meeting-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
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
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('meeting@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#meetingsView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
}

test('meeting create modal exposes only the simplified final fields and the canonical save owner',async({page})=>{
  await signIn(page);
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  for(const id of ['meetingTitle','meetingAt','meetingProject','meetingSeriesName','meetingRoundNo','meetingTranscript','meetingNotes','meetingFiles','meetingActionList'])await expect(page.locator('#'+id)).toBeAttached();
  await expect(page.locator('#meetingFiles')).toHaveAttribute('multiple','');
  await expect(page.locator('.meeting-action-row')).toHaveCount(1);
  await expect(page.locator('.meeting-action-assignee,#mrdTaskAssignee,#taskAssignee')).toHaveCount(0);
  await expect(page.locator('#meetingAutoClassify,#meetingDecisions,#wfMeetingLocation,#wfMeetingAttendees')).toHaveCount(0);
  await expect(page.locator('#meetingProject option[value="main"]')).toHaveCount(1);
  await expect(page.locator('#meetingProject option[value="child"]')).toHaveCount(1);
  const saveOwner=await page.locator('#saveMeetingBtn').evaluate(el=>String(el.onclick||''));
  expect(saveOwner).toContain('meetingTranscript');
  expect(saveOwner).not.toContain('wfMeetingLocation');
  expect(saveOwner).not.toContain('meetingDecisions');
});

test('meeting list is compact and filters by meeting type',async({page})=>{
  await signIn(page);
  await expect(page.locator('#meetingTypeFilter')).toBeVisible();
  await expect(page.locator('#meetingTypeFilter option')).toContainText(['회의유형 전체','궤도협의회','유형 미지정']);
  await page.locator('#meetingTypeFilter').selectOption({label:'궤도협의회'});
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(1);
  await expect(page.locator('#meetingList .meeting-list-row')).toContainText('접근성 회의');
  await expect(page.locator('#meetingList .meeting-list-row')).not.toContainText('과거 회의실');
  const box=await page.locator('#meetingList .meeting-list-row').boundingBox();
  expect(box.height).toBeLessThanOrEqual(90);
});

test('meeting detail dialog exposes semantics, Escape close, and trigger focus restore',async({page})=>{
  await signIn(page);
  const trigger=page.locator('[data-mrd-meeting="meeting-1"]');
  await trigger.focus();
  await trigger.click();
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

test('meeting detail prioritizes raw result, hides legacy fields, and preserves raw line breaks on edit',async({page})=>{
  await signIn(page);
  let saved=null;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    if(route.request().method()==='PATCH'){
      saved=route.request().postDataJSON();
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:meeting.id}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#mrdResult')).toHaveText('원문 첫 줄\n원문 둘째 줄');
  await expect(page.locator('#mrdSpecialSection')).toBeVisible();
  await expect(page.locator('#mrdSpecial')).toHaveText('특이사항 기록');
  await expect(page.locator('#mrdAiDraft')).toHaveCount(0);
  await page.locator('#mrdEdit').click();
  await expect(page.locator('#mrdEditLocation,#mrdEditAttendees,#mrdEditDecisions')).toHaveCount(0);
  await expect(page.locator('#mrdEditTranscript')).toHaveValue('원문 첫 줄\n원문 둘째 줄');
  const raw='  수정 원문 첫 줄\n둘째 줄\n마지막 줄  ';
  await page.locator('#mrdEditTranscript').fill(raw);
  await page.locator('#mrdEditNotes').fill('수정 특이사항\n둘째 줄');
  await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>saved).not.toBeNull();
  expect(saved.transcript_text).toBe(raw);
  expect(saved.notes).toBe('수정 특이사항\n둘째 줄');
  expect(saved).not.toHaveProperty('decisions');
  expect(saved).not.toHaveProperty('location');
  expect(saved).not.toHaveProperty('attendee_count');
});

test('empty special notes stay hidden in meeting detail',async({page})=>{
  await signIn(page);
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...meeting,notes:''}])}));
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#mrdSpecialSection')).toBeHidden();
});

test('legacy structured decisions remain visible only as fallback when old meetings have no raw result',async({page})=>{
  await signIn(page);
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...meeting,transcript_text:null,decisions:'기존 결정 기록'}])}));
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#mrdResult')).toContainText('[기존 회의결과 기록]');
  await expect(page.locator('#mrdResult')).toContainText('기존 결정 기록');
});

test('meeting edit does not report success when RLS updates zero rows',async({page})=>{
  await signIn(page);
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    const data=route.request().method()==='PATCH'?[]:[meeting];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await page.locator('#mrdEdit').click();
  await page.locator('#mrdSaveEdit').click();
  await expect(page.locator('#mrdEditStatus')).toContainText('수정 권한을 확인하지 못했습니다.');
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
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
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
  await page.route(`${SB}/rest/v1/app_tasks**`,async route=>{
    if(route.request().method()==='POST'){posted=true;await held}
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await page.locator('#mrdAddTask').click();
  await page.locator('#mrdTaskTitle').fill('후속 자료 정리');
  await page.locator('#mrdTaskSave').click();
  await expect.poll(()=>posted).toBe(true);
  await page.locator('#mrdClose').click();
  release();
  await expect(page.locator('#meetingRoundDetailModal')).toHaveClass(/hidden/);
  await page.waitForTimeout(100);
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('aria-hidden','true');
});

test('meeting UI has one direct render path and no active meeting AI execution path',async()=>{
  const html=read('app/index.html');
  const loader=read('app/loader-v2.js');
  const views=read('app/view-loader.js');
  const workflow=read('app/task-workflow.js');
  const detail=read('app/meeting-round-detail.js');
  const team=read('app/team.js');
  const css=read('app/styles.css');
  const files=read('supabase/functions/meeting-files/index.ts');

  for(const id of ['meetingSeriesName','meetingRoundNo','meetingTranscript','meetingNotes','meetingFiles','meetingActionList','addMeetingAction','meetingTypeFilter'])expect(html).toContain(`id="${id}"`);
  for(const id of ['meetingAutoClassify','meetingDecisions','wfMeetingLocation','wfMeetingAttendees'])expect(html).not.toContain(`id="${id}"`);
  expect(loader).not.toContain('meeting-assignee-picker.js');
  expect(loader).not.toContain('meeting-file-route.js');
  expect(loader).not.toContain('workflow-ai-v3.js');
  expect(views).toContain('task-workflow.js?v=9');
  expect(views).toContain('meeting-round-detail.js?v=13');
  expect(workflow).not.toContain('MutationObserver');
  expect(workflow).not.toContain("document.createElement('style')");
  expect(detail).not.toContain('MutationObserver');
  expect(detail).not.toContain("document.createElement('style')");
  expect(detail).not.toContain('mrdAiDraft');
  expect(team).toContain('transcript_text:transcript');
  expect(team).toContain("/functions/v1/meeting-files");
  expect(files).toContain('file.size>100*1024*1024');
  expect(css).toContain("meeting-ui.css?v=8");
});
