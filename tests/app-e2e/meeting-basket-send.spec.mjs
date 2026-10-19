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
  await expect(page.locator('#meetingList [data-mrd-meeting]')).toHaveCount(1);
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
  await expect(button).toHaveText('바구니에 담김');
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

test('after a successful send the button is disabled and says it is in the basket; reopening restores it',async({page})=>{
  const f=await setup(page);
  const button=page.locator('#mrdToBasket');
  const keys=async()=>JSON.stringify(await page.context().storageState());
  const before=await keys();
  await button.click();
  await expect(page.locator('#mrdBasketStatus')).toHaveText('바구니에 담았어요.');
  await expect(button).toBeDisabled();await expect(button).toHaveText('바구니에 담김');
  // 선택이 바뀌어도 담긴 표시는 그대로이고 다시 보내지 않는다.
  await select(page,'둘째','베타');
  await expect(button).toBeDisabled();await expect(button).toHaveText('바구니에 담김');
  expect(f.posts).toHaveLength(1);
  // 창을 닫았다 다시 열면 원래대로(기억은 MEET 2단계).
  await page.locator('#mrdClose').click();
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#mrdResult')).toContainText('첫째 줄 알파');
  await expect(button).toBeEnabled();await expect(button).toHaveText('바구니에 담기');
  expect(await keys()).toBe(before);// 브라우저 저장소로 담김 표시를 흉내 내지 않는다.
});

test('a failed send keeps the button pressable; it is disabled only while sending',async({page})=>{
  const f=await setup(page);
  const button=page.locator('#mrdToBasket');
  f.setFail(true);
  await button.click();
  await expect(page.locator('#mrdBasketStatus')).toHaveClass(/error/);
  await expect(button).toBeEnabled();await expect(button).toHaveText('바구니에 담기');
  f.setFail(false);
  await button.click();
  await expect(button).toHaveText('바구니에 담김');await expect(button).toBeDisabled();
  expect(f.posts).toHaveLength(2);
});

test('a slow send disables the button so a second press cannot double post',async({page})=>{
  const f=await setup(page);
  await page.route('**/rest/v1/app_notes',async route=>{if(route.request().method()==='POST')await new Promise(r=>setTimeout(r,600));await route.fallback()});
  const button=page.locator('#mrdToBasket');
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('바구니에 담김');
  expect(f.posts).toHaveLength(1);
});

for(const width of [412,870,1280])test(`edit, delete and basket buttons share the small button size and stay inside the window ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await setup(page);
  const rows=await page.evaluate(()=>['#mrdEdit','#mrdDelete','#mrdToBasket'].map(sel=>{
    const el=document.querySelector(sel),r=el.getBoundingClientRect(),cs=getComputedStyle(el),card=document.querySelector('#meetingRoundDetailModal .modal-card').getBoundingClientRect();
    return {sel,h:Math.round(r.height*10)/10,fontSize:cs.fontSize,fontWeight:cs.fontWeight,radius:cs.borderRadius,padY:cs.paddingTop+'/'+cs.paddingBottom,inside:r.left>=card.left&&r.right<=card.right,cls:el.className};
  }));
  const compact=parseFloat(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ds-compact-height')));
  const compactText=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ds-compact-text').trim());
  for(const r of rows){expect(r.inside,r.sel).toBe(true);expect(r.h,r.sel).toBe(compact);expect(r.fontSize,r.sel).toBe(compactText)}
  for(const r of rows){expect(r.h,r.sel).toBe(rows[0].h);expect(r.fontSize).toBe(rows[0].fontSize);expect(r.fontWeight).toBe(rows[0].fontWeight);expect(r.radius).toBe(rows[0].radius);expect(r.padY).toBe(rows[0].padY);expect(r.cls.split(' ')).toContain('mini')}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  // 터치 영역: 보이는 높이가 44보다 작으면 ::after가 44px까지 넓힌다(기존 규칙).
  for(const sel of ['#mrdEdit','#mrdDelete','#mrdToBasket']){const t=await page.locator(sel).evaluate(el=>{const a=getComputedStyle(el,'::after');return [a.minHeight,a.minWidth]});expect(t).toEqual(['44px','44px'])}
});
