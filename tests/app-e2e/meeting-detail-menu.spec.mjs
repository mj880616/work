import {test,expect} from '@playwright/test';
import {testOrigin} from './helpers/test-origin.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import {openMeetingResult} from './helpers/meeting-open.mjs';

// MTG-보고창정리: 사업 보고 상세 창 - 정리함에 담기·안내문이 없고(MEET-기록보내기 1단계의 담기 기능을 걷어냄), 수정·칸 바꾸기·삭제는 제목 줄 ⋯ 메뉴 하나. 합성 자료만 쓴다.
test.use({timezoneId:'Asia/Seoul',hasTouch:true});
const BASE=testOrigin,SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const meeting={
  id:'meeting-1',workspace_id:'meeting-ws',project_id:null,title:'시험 회의',series_name:'시험 회의',round_no:2,
  meeting_at:'2026-09-17T10:00:00Z',notes:'',decisions:'',location:'',attendee_count:1,
  transcript_text:'첫째 줄 알파\n둘째 줄 베타\n셋째 줄 감마',created_by:'meeting-user'
};
async function setup(page,row=meeting){
  const posts=[];
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'a',refresh_token:'r',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'meeting-user'}});
    if(path==='/auth/v1/user')return ok({id:'meeting-user',email:'meeting@example.org',user_metadata:{display_name:'QA'}});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'meeting-ws',user_id:'meeting-user',role:'owner',email:'meeting@example.org',workspace:{id:'meeting-ws',name:'QA'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'meeting-ws',name:'QA'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'meeting-user',display_name:'QA'}]);
    if(path==='/rest/v1/app_meetings')return ok([row]);
    if(path==='/rest/v1/app_notes'&&method==='POST'){
      const body=req.postDataJSON();posts.push(body);
      return ok([{id:'new-note',...body}]);
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const returnTo=`${BASE}/app/?view=meetings`;
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(returnTo)}`);
  await signInWithSession(page,'meeting@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  // MEET-결과3단: 폰·중간 폭은 목록 줄, PC는 오른쪽 결과의 ⋯ → [수정]으로 같은 결과 창을 연다.
  await openMeetingResult(page,'meeting-1');
  return {posts,errors};
}

for(const width of [412,870,1280])test(`no basket button or guide text, one ⋯ menu inside the window ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const f=await setup(page);
  const modal=page.locator('#meetingRoundDetailModal');
  await expect(page.locator('#mrdResult')).toContainText('첫째 줄 알파');
  await expect(modal.locator('#mrdToBasket,#mrdBasketStatus,#mrdEdit,#mrdKind,#mrdDelete')).toHaveCount(0);
  await expect(modal).not.toContainText('정리함에 담');await expect(modal).not.toContainText('글을 길게 눌러 고르면');await expect(modal).not.toContainText('자료실 올리기 창이 열리고');
  const more=modal.locator('#mrdMore');await expect(more).toBeVisible();await expect(more).toHaveAttribute('aria-haspopup','true');
  const inside=await page.evaluate(()=>{const b=document.querySelector('#mrdMore').getBoundingClientRect(),c=document.querySelector('#meetingRoundDetailModal .modal-card').getBoundingClientRect();return b.left>=c.left&&b.right<=c.right&&b.top>=c.top});
  expect(inside).toBe(true);
  await more.click();
  const menu=modal.locator('#mrdMoreMenu');await expect(menu.locator('button')).toHaveText(['수정','칸 바꾸기','삭제']);
  const box=await menu.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(more).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.posts).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('keyboard opens the ⋯ menu and [수정] opens the editor',async({page})=>{
  await page.setViewportSize({width:412,height:900});// 팝업(폰) 쪽 초점 순서를 본다. PC는 세 번째 칸에 붙어 팝업이 없다.
  const f=await setup(page);
  await expect(page.locator('#mrdClose')).toBeFocused();// 창이 열린 뒤 처음 초점이 자리 잡은 다음에 ⋯로 옮긴다
  await page.locator('#mrdMore').focus();await expect(page.locator('#mrdMore')).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.locator('#mrdMoreMenu')).toBeVisible();
  await page.locator('#mrdMoreMenu [data-mrd-more="edit"]').click();
  await expect(page.locator('#mrdEditor')).toBeVisible();await expect(page.locator('#mrdMore')).toBeHidden();
  expect(f.errors).toEqual([]);
});

test('no result text means no result section',async({page})=>{
  await setup(page,{...meeting,transcript_text:'',decisions:''});
  await expect(page.locator('#mrdResultSection')).toBeHidden();await expect(page.locator('#mrdTextHead')).toBeHidden();
});
test('old decisions-only record still shows its old record',async({page})=>{
  await setup(page,{...meeting,transcript_text:'',decisions:'옛 결정'});
  await expect(page.locator('#mrdResult')).toContainText('[기존 회의결과 기록]');await expect(page.locator('#mrdResultSection')).toBeVisible();
});
