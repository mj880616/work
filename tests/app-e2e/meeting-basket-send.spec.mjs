import {test,expect} from '@playwright/test';
import {testOrigin} from './helpers/test-origin.mjs';

// MEET-기록보내기 1단계: 회의 결과 읽기 창의 [바구니에 담기]. 합성 자료만 쓴다.
test.use({timezoneId:'Asia/Seoul',hasTouch:true});
const BASE=testOrigin,SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const meeting={
  id:'meeting-1',workspace_id:'meeting-ws',project_id:null,title:'시험 회의',series_name:'시험 회의',round_no:2,
  meeting_at:'2026-09-17T10:00:00Z',notes:'',decisions:'',location:'',attendee_count:1,
  transcript_text:'첫째 줄 알파\n둘째 줄 베타\n셋째 줄 감마',created_by:'meeting-user'
};
async function setup(page,row=meeting){
  const posts=[];let failPost=false;
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
      if(failPost)return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({message:'denied'})});
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
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('meeting@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(1);
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#mrdResult')).not.toBeEmpty();await expect(page.locator('#mrdResult')).not.toHaveText('');
  return {posts,errors,setFail:v=>failPost=v};
}
// 길게 눌러 고른 것과 같은 결과: 결과 칸 안의 글자 범위를 고른다.
const select=(page,from,to)=>page.evaluate(([a,b])=>{
  const node=document.querySelector('#mrdResult').firstChild,text=node.textContent,r=document.createRange();
  r.setStart(node,text.indexOf(a));r.setEnd(node,text.indexOf(b)+b.length);
  const s=getSelection();s.removeAllRanges();s.addRange(r);
},[from,to]);

for(const width of [390,1280])test(`whole result goes to the basket as one memo dated at the meeting ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const f=await setup(page);
  const button=page.locator('#mrdToBasket');
  await expect(button).toBeVisible();await expect(button).toHaveText('바구니에 담기');
  const box=await button.boundingBox();expect(box.height).toBeGreaterThanOrEqual(32);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await button.click();
  await expect(page.locator('#mrdBasketStatus')).toHaveText('바구니에 담았어요.');
  expect(f.posts).toHaveLength(1);
  expect(f.posts[0].workspace_id).toBe('meeting-ws');
  expect(f.posts[0].occurred_at).toBe('2026-09-17T10:00:00.000Z');
  expect(f.posts[0].raw_text).toBe('출처: 시험 회의 2차 회의 (2026-09-17)\n\n첫째 줄 알파\n둘째 줄 베타\n셋째 줄 감마');
  expect(f.errors).toEqual([]);
});

test('selected part only is sent and the label follows the selection',async({page})=>{
  const f=await setup(page);
  const button=page.locator('#mrdToBasket');
  await select(page,'둘째','베타');
  await expect(button).toHaveText('선택한 글 담기');
  await button.click();
  await expect(page.locator('#mrdBasketStatus')).toHaveText('바구니에 담았어요.');
  expect(f.posts).toHaveLength(1);
  expect(f.posts[0].raw_text).toBe('출처: 시험 회의 2차 회의 (2026-09-17)\n\n둘째 줄 베타');
  await expect(button).toHaveText('바구니에 담기');
});

test('selection outside the result box is ignored',async({page})=>{
  const f=await setup(page);
  await page.evaluate(()=>{const s=getSelection(),r=document.createRange();r.selectNodeContents(document.querySelector('#mrdTitle'));s.removeAllRanges();s.addRange(r)});
  await expect(page.locator('#mrdToBasket')).toHaveText('바구니에 담기');
  await page.locator('#mrdToBasket').click();
  await expect(page.locator('#mrdBasketStatus')).toHaveText('바구니에 담았어요.');
  expect(f.posts[0].raw_text).toContain('첫째 줄 알파');
});

test('a very long result is cut to 20,000 characters and says so',async({page})=>{
  const f=await setup(page,{...meeting,transcript_text:'가'.repeat(30000)});
  await page.locator('#mrdToBasket').click();
  await expect(page.locator('#mrdBasketStatus')).toContainText('앞 2만 자까지만');
  expect([...f.posts[0].raw_text]).toHaveLength(20000);
  expect(f.posts[0].raw_text.endsWith('…(뒷부분 잘림)')).toBe(true);
});

test('empty result disables the button and a failed save shows an error without double posting',async({page})=>{
  const f=await setup(page);
  f.setFail(true);
  await page.locator('#mrdToBasket').click();
  await expect(page.locator('#mrdBasketStatus')).toHaveClass(/error/);
  await expect(page.locator('#mrdToBasket')).toBeEnabled();
  expect(f.posts).toHaveLength(1);
  f.setFail(false);
  await page.locator('#mrdToBasket').click();
  await expect(page.locator('#mrdBasketStatus')).toHaveText('바구니에 담았어요.');
  expect(f.posts).toHaveLength(2);
});

test('button is disabled when the meeting has no result text',async({page})=>{
  await setup(page,{...meeting,transcript_text:'',decisions:''});
  await expect(page.locator('#mrdToBasket')).toBeDisabled();
});

test('keyboard can reach and press the button',async({page})=>{
  const f=await setup(page);
  await page.locator('#mrdToBasket').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#mrdBasketStatus')).toHaveText('바구니에 담았어요.');
  expect(f.posts).toHaveLength(1);
});
