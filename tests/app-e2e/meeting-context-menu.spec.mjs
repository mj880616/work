import {test,expect} from '@playwright/test';
import {testOrigin} from './helpers/test-origin.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {openMeetingResult} from './helpers/meeting-open.mjs';

// MTG-우클릭안됨(요청함 11/09 18:05): PC 사업 보고 창(세 번째 칸에 붙은 화면·팝업 둘 다) 안 어디를 우클릭해도
// 제목 줄 ⋯ 메뉴([수정][종류 바꾸기][삭제])가 누른 자리에 뜬다. 후속 할 일 줄처럼 자기 ⋯가 있는 줄은 그 줄 메뉴,
// 입력칸·링크·글자를 고른 상태는 브라우저 메뉴(공용 context-menu.js 규칙). 합성 자료만 쓴다.
test.use({timezoneId:'Asia/Seoul'});
const BASE=testOrigin,SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const meeting={id:'meeting-1',workspace_id:'meeting-ws',project_id:null,title:'시험 회의',series_name:'시험 회의',round_no:2,
  meeting_at:'2026-09-17T10:00:00Z',notes:'회의록 전문 첫 줄\n회의록 전문 둘째 줄',decisions:'',location:'',attendee_count:1,
  transcript_text:Array.from({length:30},(_,i)=>`결과 본문 ${i+1}번째 줄 — 합성 문장`).join('\n'),created_by:'meeting-user',activity_kind:'meeting'};
const tasks=[{id:'t1',title:'가상 후속 일 하나',status:'needsAction'},{id:'t2',title:'가상 후속 일 둘',status:'needsAction'}];
async function setup(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),u=new URL(req.url()),path=u.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'a',refresh_token:'r',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'meeting-user'}});
    if(path==='/auth/v1/user')return ok({id:'meeting-user',email:'meeting@example.org',user_metadata:{display_name:'QA'}});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'meeting-ws',user_id:'meeting-user',role:'owner',email:'meeting@example.org',workspace:{id:'meeting-ws',name:'QA'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'meeting-ws',name:'QA'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'meeting-user',display_name:'QA'}]);
    if(path==='/rest/v1/app_meetings')return ok([meeting]);
    if(path==='/functions/v1/google-tasks'&&u.searchParams.get('action')==='linked')return ok({connected:true,authorized:true,tasks});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(`${BASE}/app/?view=meetings`)}`);
  await signInWithSession(page,'meeting@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await openMeetingResult(page,'meeting-1');
  const modal=page.locator('#meetingRoundDetailModal');
  await expect(modal.locator('#mrdResult')).toContainText('결과 본문 1번째 줄');
  await expect(modal.locator('[data-mrd-task]')).toHaveCount(2);
  return {errors,modal};
}
// 우클릭한 자리 근처에 메뉴가 떴는지(누른 자리에 뜸).
async function nearPointer(menu,x,y){const b=await menu.boundingBox();expect(b).not.toBeNull();expect(Math.abs(b.x-x)<=b.width+16).toBe(true);expect(b.y).toBeGreaterThanOrEqual(y-b.height-16);expect(b.y).toBeLessThanOrEqual(y+16)}

for(const width of [884,1440])test(`PC ${width}: 사업 보고 창 본문 어디를 우클릭해도 제목 줄 ⋯ 메뉴, 할 일 줄은 그 줄 메뉴`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const {errors,modal}=await setup(page);
  const menu=page.locator('#mrdMoreMenu');
  // 결과 본문(긴 글) 가운데, 회의록 전문, 후속 할 일 칸의 빈 곳.
  for(const sel of ['#mrdResult','#mrdSpecial','#mrdTasksHead']){
    const spot=modal.locator(sel);await spot.scrollIntoViewIfNeeded();
    const b=await spot.boundingBox();const x=Math.round(b.x+Math.min(b.width-4,60)),y=Math.round(b.y+Math.min(b.height/2,40));
    await page.mouse.click(x,y,{button:'right'});
    await expect(menu,sel).toBeVisible();
    await expect(menu.locator('button')).toHaveText(['수정','종류 바꾸기','삭제']);
    await nearPointer(menu,x,y);
    await page.keyboard.press('Escape');await expect(menu).toBeHidden();
  }
  // 자기 ⋯가 있는 후속 할 일 줄은 그 줄 메뉴.
  await modal.locator('[data-mrd-task="t2"] .mrd-task-main').click({button:'right'});
  await expect(page.locator('#mrdTaskMenu')).toBeVisible();await expect(menu).toBeHidden();
  await page.keyboard.press('Escape');await expect(page.locator('#mrdTaskMenu')).toBeHidden();
  // 글자를 고른 상태에서는 브라우저 메뉴(우리 메뉴 안 뜸).
  await modal.locator('#mrdResult').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r)});
  await modal.locator('#mrdResult').click({button:'right'});
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});

// UI-PC손맛묶음 ①(요청함 11/10): 사업 보고 화면에서 보고 창(오른쪽 칸) 밖 — 주 줄 [‹][›]·주 이름 — 을 우클릭하면
// 보고 창 ⋯([수정][종류 바꾸기][삭제])가 뜨지 않는다. 그 자리는 화면 머리줄 ⋯(사업 보고 더 보기, data-ctx="screen") 메뉴.
test('PC 1280: 보고 창 밖(주 줄 [›]·주 이름) 우클릭은 보고 메뉴가 아니라 화면 메뉴',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  const {errors}=await setup(page);
  const menu=page.locator('#mrdMoreMenu');
  for(const sel of ['.report-week-label','.report-week-count']){
    const spot=page.locator(`#meetingsView ${sel}`).first();
    await expect(spot,sel).toBeVisible();
    await spot.click({button:'right'});
    await expect(menu,sel).toBeHidden();
    await expect(page.locator('#reportMore'),sel).toHaveAttribute('aria-expanded','true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#reportMore')).toHaveAttribute('aria-expanded','false');
  }
  expect(errors).toEqual([]);
});
