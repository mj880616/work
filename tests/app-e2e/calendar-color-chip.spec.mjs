// CAL-캘린더색칩(S52-18, 요청함 11/07 14:33 '캘린더 종류 옆에 색상 표시 버튼 크기', 시안 docs/design/mockups/calendar-color-chip.html 'A'):
// 일정 › 구글 캘린더 › '표시할 Google 캘린더'는 캘린더마다 칩 하나(12px 색 점 + 이름). 체크 네모·큰 색 알약·[자동 저장] 버튼은 없다.
// 칩 누르기 = 보이기/숨기기(숨김 = 빈 점·흐린 글자), 색 점 누르기 = 작은 색 고르기 상자(공용 색 칸), 저장 길(preferences)은 그대로.
// 같은 종류 전수: 이름 옆 색 표시는 모두 공용 점(.ui-color-dot, 12px). 폰 390·폴드 884·PC 1280.
import { appOrigin } from './helpers/test-origin.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const APP=`${appOrigin}/app/`;
const CALS=[{id:'primary',summary:'내 캘린더',primary:true,backgroundColor:'#1d4fae'},{id:'cal-org',summary:'조직 캘린더',backgroundColor:'#f2452a'},{id:'cal-family',summary:'가족 캘린더',backgroundColor:'#f6e58a'}];
const EVENT_COLORS={1:{background:'#7986cb'},2:{background:'#33b679'},3:{background:'#8e24aa'}};

async function boot(page,state){
  await installViewPrefsServer(page,{calendar_view:'month'});
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=(d,s=200)=>route.fulfill({status:s,contentType:'application/json',body:JSON.stringify(d??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:state.user});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action')||(method==='POST'?body?.action:'status');
      if(action==='status')return ok({connected:true,enabled:true,email:'e2e@example.org',selected:state.selected,colors:state.colors,eventColors:EVENT_COLORS,calendars:CALS.map(c=>({...c,accessRole:'owner'}))});
      if(action==='events')return ok({events:[],eventColors:EVENT_COLORS});
      if(action==='preferences'){state.posts.push(body);state.selected=body.calendar_ids;state.colors=body.calendar_colors||{};return ok({ok:true})}
      return ok({});
    }
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'ws-1',role:'owner',user_id:state.user.id}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'ws-1',slug:'public-institutions',name:'웹2'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'E2E'}]);
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
  await page.goto(`${APP}login/?return=${encodeURIComponent(APP+'?view=calendar')}`);
  await signInWithSession(page,'e2e@example.org');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await clickView(page,'calendar');
  const panel=page.locator('#googleCalendarPanel');
  await expect(panel).toBeAttached({timeout:10000});
  await expect(page.locator('#googleCalendarList [data-google-cal]')).toHaveCount(3,{timeout:10000});
  if(!await panel.evaluate(p=>p.open))await panel.locator('summary').click();
  await expect(page.locator('#googleCalendarList')).toBeVisible();
}
const newState=()=>({user:{id:'user-1',email:'e2e@example.org',user_metadata:{display_name:'E2E'}},selected:['primary','cal-org'],colors:{},posts:[]});
const chip=(page,id)=>page.locator(`#googleCalendarList [data-google-cal="${id}"]`);
const dotBg=(page,id)=>chip(page,id).locator('.ui-color-dot').evaluate(e=>getComputedStyle(e).backgroundColor);

for(const [name,size] of [['폰',{width:390,height:844}],['폴드',{width:884,height:1000}],['PC',{width:1280,height:900}]]){
  test(`${name} ${size.width}: 표시할 캘린더는 12px 색 점 칩 한 줄, 칩으로 켜고 끄기·점으로 색 바꾸기`,async({page})=>{
    test.setTimeout(60000);
    await page.setViewportSize(size);
    const state=newState();
    await boot(page,state);
    const list=page.locator('#googleCalendarList');
    // 옛 모양이 없다: 체크 네모·브라우저 색 칸·[자동 저장] 버튼.
    await expect(list.locator('input')).toHaveCount(0);
    await expect(page.locator('#saveGooglePrefs')).toHaveCount(0);
    // 칩 = 공용 ④(28px) + 12px 동그란 점, 켜진 칩은 꽉 찬 점.
    const m=await list.locator('[data-google-cal]').evaluateAll(chips=>chips.map(c=>{const r=c.getBoundingClientRect(),d=c.querySelector('.ui-color-dot').getBoundingClientRect();return {cls:c.className,h:Math.round(r.height),top:Math.round(r.top),dw:Math.round(d.width),dh:Math.round(d.height),radius:getComputedStyle(c.querySelector('.ui-color-dot')).borderRadius}}));
    for(const x of m){expect(x.cls).toContain('ds-chip');expect(x.h).toBe(28);expect(x.dw).toBe(12);expect(x.dh).toBe(12);expect(x.radius).toBe('50%')}
    expect(new Set(m.map(x=>x.top)).size,'세 칩이 한 줄').toBe(1);
    await expect(chip(page,'primary')).toHaveAttribute('aria-pressed','true');
    await expect(chip(page,'cal-family')).toHaveAttribute('aria-pressed','false');
    await expect.poll(()=>dotBg(page,'primary')).toBe('rgb(29, 79, 174)');
    await expect.poll(()=>dotBg(page,'cal-family'),'숨긴 캘린더는 빈 점').toBe('rgba(0, 0, 0, 0)');
    // [연결 해제]는 작은 버튼(②, 32px).
    const off=page.locator('#disconnectGoogle');
    await expect(off).toHaveClass(/\bsecondary\b/);
    expect(Math.round((await off.boundingBox()).height)).toBe(32);

    // 칩(이름) 누르기 = 보이기/숨기기 → 저장 길 그대로, 잠깐 '저장됨'.
    await chip(page,'cal-org').locator('.cal-chip-name').click();
    await expect(chip(page,'cal-org')).toHaveAttribute('aria-pressed','false');
    await expect.poll(()=>state.posts.at(-1)?.calendar_ids).toEqual(['primary']);
    await expect(page.locator('#cpSaved')).toHaveText('저장됨');
    await chip(page,'cal-family').locator('.cal-chip-name').click();
    await expect.poll(()=>state.posts.at(-1)?.calendar_ids).toEqual(['primary','cal-family']);
    await expect.poll(()=>dotBg(page,'cal-family')).toBe('rgb(246, 229, 138)');

    // 색 점 누르기 = 작은 색 고르기 상자(공용 색 칸). 고르면 점 색이 바뀌고 calendar_colors로 저장.
    const posts=state.posts.length;
    await chip(page,'primary').locator('.ui-color-dot').click();
    const menu=page.locator('#cpColorMenu');
    await expect(menu).toBeVisible();
    await expect(chip(page,'primary')).toHaveAttribute('aria-pressed','true'); // 점 누르기는 켜고 끄지 않는다
    await expect(menu.locator('.ui-swatch')).toHaveCount(4); // Google 기본 색 + 일정 색 3
    await expect(menu.locator('.ui-swatch[aria-checked="true"]')).toHaveAttribute('data-cp-pick','#1d4fae');
    await menu.locator('[data-cp-pick="#33b679"]').click();
    await expect(menu).toBeHidden();
    await expect.poll(()=>state.posts.length).toBeGreaterThan(posts);
    expect(state.posts.at(-1).calendar_colors.primary).toBe('#33b679');
    await expect.poll(()=>dotBg(page,'primary')).toBe('rgb(51, 182, 121)');
    // 우클릭(폰은 길게 누르기)도 같은 상자.
    await chip(page,'cal-org').click({button:'right'});
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
}

test('같은 종류 전수: 이름 옆 색 표시는 모두 공용 12px 점(.ui-color-dot)',async({page})=>{
  await page.goto(`${APP}login/`);
  await page.addStyleTag({url:`${APP}theme-tokens.css`});
  await page.addStyleTag({url:`${APP}ui-standard.css`});
  await page.addStyleTag({url:`${APP}project-system-v3.css`});
  await page.addStyleTag({url:`${APP}meeting-ui.css`});
  await page.addStyleTag({url:`${APP}filter-chips.css`});
  await page.addStyleTag({url:`${APP}now.css`});
  const sizes=await page.evaluate(()=>{
    const box=document.createElement('div');box.id='appView';
    box.innerHTML='<div id="basketView"><span class="basket-chip"><span class="basket-chip-dot ui-color-dot"></span>A</span></div><div id="meetingList"><span class="mcol-dot ui-color-dot"></span></div><span class="ps3-color-dot ui-color-dot" data-color="green"></span><span class="filter-chip-dot ui-color-dot" style="background-color:#f00"></span><div id="nwMediaPicker"><span class="lu-move-dot ui-color-dot" style="--lu-dot:#0f0"></span></div>';
    document.body.append(box);
    return [...box.querySelectorAll('.ui-color-dot')].map(d=>{const r=d.getBoundingClientRect(),cs=getComputedStyle(d);return {cls:d.classList[0],w:Math.round(r.width),h:Math.round(r.height),radius:cs.borderRadius,bg:cs.backgroundColor}});
  });
  for(const s of sizes){expect([s.cls,s.w,s.h,s.radius]).toEqual([s.cls,12,12,'50%']);expect(s.bg,s.cls+' 색은 화면 규칙 그대로').not.toBe('rgba(0, 0, 0, 0)')}
});
