// OPS-새가입알림 ③(S62-25, 명진 11/15 21:04)·OPS-가입자현황(S62-29): 운영자 계정 메뉴 '가입자 현황' → 숫자 한 줄·가입자 표(칸 일곱), 새 가입 알림 줄,
// 내 프로필 폰 알림의 '새 가입' 칩. 이용자(운영자 아님)는 줄·칩이 없고, 주소로 열어도 '운영자만 볼 수 있어요'.
// 서버는 page.route로 흉내 낸다(app_signup_list — 운영자만, phone-push notices — 운영자에게만 signup 줄). 모두 가상 이름.
// 화면 사진: S62-25는 docs/design/screens/s62-25/, 이번 판은 docs/design/screens/s62-29/(S62_29_SHOTS=1, 폰 412·폴드 펼침 880·PC 1280).
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import {serveBuiltShell} from './helpers/built-shell.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

const origin=appOrigin;
const SHOTS=process.env.S62_29_SHOTS?'docs/design/screens/s62-29/':'test-results/';
// OPS-가입자현황(S62-29): 칸 일곱(조직·부서·이름·직책·이메일·가입일·마지막 사용)과 맨 위 숫자 한 줄. 시각은 시험 때 기준(이번 주·7일 판정이 날짜에 안 흔들리게).
// 사진은 docs/design/screens/s62-29/(S62_29_SHOTS=1). 메일은 가상(example.test).
const NOW=Date.now(),ago=h=>new Date(NOW-h*3600000).toISOString();
// '이번 주 새로'는 한국 시각 월요일 0시부터 센다. 월요일 0시~0시 30분에 돌면 '30분 전' 가입이 지난주가 되어 시험이 깨졌다(11/23 00:15 CI).
// 이번 주 가입 한 사람은 '30분 전'과 '이번 주 시작 1분 뒤' 중 늦은 쪽으로 둔다.
const KST_WEEK_START=(()=>{const k=new Date(NOW+9*3600000);const day=(k.getUTCDay()+6)%7;return Date.UTC(k.getUTCFullYear(),k.getUTCMonth(),k.getUTCDate()-day)-9*3600000;})();
const thisWeekAgo=h=>new Date(Math.max(NOW-h*3600000,KST_WEEK_START+60000)).toISOString();
const PEOPLE=[
  {union_name:'가상 노조',department_name:'가상 조직국',name:'가상 사람B',job_title:'국장',email:'person-b@example.test',signed_up_at:thisWeekAgo(0.5),last_seen_at:ago(0.4)},
  {union_name:'가상 노조',department_name:null,name:'가상 사람A',job_title:null,email:'person-a@example.test',signed_up_at:ago(24*20),last_seen_at:ago(30)},
  {union_name:null,department_name:null,name:'이름 없음',job_title:null,email:'new@example.test',signed_up_at:ago(24*25),last_seen_at:null},
  {union_name:'가상 노조',department_name:'가상 정책실',name:'가상 운영자',job_title:'실장',email:'operator@example.test',signed_up_at:ago(24*45),last_seen_at:ago(24*9)}
];
const REF='su:1794741600';
async function boot(page,{operator=false,view='calendar',notices=[]}={}){
  const calls=[];
  await serveBuiltShell(page,origin);
  const user={id:'su-user',email:'su@example.org'},workspace={id:'su-workspace',name:'QA',slug:'qa'};
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**',route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;let data=[];
    calls.push({path,action:url.searchParams.get('action'),body:req.postDataJSON?.()??null});
    if(path==='/auth/v1/token')data={access_token:'qa',refresh_token:'qa-refresh',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,user};
    else if(path==='/auth/v1/user')data=user;
    else if(path==='/rest/v1/app_workspace_members')data=[{workspace_id:workspace.id,user_id:user.id,role:'owner'}];
    else if(path==='/rest/v1/app_workspaces')data=[workspace];
    else if(path==='/rest/v1/app_profiles')data=[{user_id:user.id,display_name:'QA',notify_prefs:null}];
    else if(path==='/rest/v1/rpc/app_my_features')data=operator?['dev_inbox']:[];
    else if(path==='/rest/v1/rpc/app_signup_list'){
      if(!operator)return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'42501',message:'OPERATOR_FEATURE_REQUIRED'})});
      data=PEOPLE;
    }
    else if(path==='/rest/v1/rpc/app_feedback_open_count')data=operator?0:null;
    else if(path==='/functions/v1/phone-push'){
      const a=url.searchParams.get('action');
      data=a==='notices'?{ok:true,items:operator?notices:[]}:a==='recent'?{ok:true,items:[]}:a==='opened'?{ok:true,opened:1}:{ok:true,devices:[]};
    }
    else if(path==='/functions/v1/push-notifications')data={enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'};
    else if(path.startsWith('/functions/'))data={connected:false,enabled:false,tasks:[],events:[],calendars:[]};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(origin+'/app/login/?return='+encodeURIComponent(origin+`/app/?view=${view}`));
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  return calls;
}
const phoneLike=width=>width<=760;
async function openAccount(page,width){
  await page.locator('#appView>.app-topline [data-account-open]:visible,#mobileMenuTab:visible').click();
  const panel=page.locator(phoneLike(width)?'#mobileMenu':'#sidebarAccountPanel');
  await expect(panel).toBeVisible();
  return panel;
}

for(const width of [412,880,1280])test(`운영자: 계정 메뉴 가입자 현황 → 숫자 한 줄·칸 일곱 (${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:860});
  const calls=await boot(page,{operator:true});
  const panel=await openAccount(page,width);
  const entry=panel.locator('[data-signups-open]');
  await expect(entry).toBeVisible();
  await expect(entry).toHaveText('가입자 현황');
  await entry.click();
  await expect(page).toHaveURL(/view=signups/);
  const view=page.locator('#signupsView');
  await expect(view.locator('.su-row')).toHaveCount(4,{timeout:15000});
  await expect(view.locator('.su-count')).toHaveText('전체 4명 · 이번 주 새로 1명 · 최근 7일 쓴 사람 2명');
  const first=view.locator('.su-row').first();
  await expect(first.locator('.su-name')).toHaveText('가상 사람B');
  await expect(first.locator('.su-union')).toHaveText('가상 노조');
  await expect(first.locator('.su-department')).toHaveText('가상 조직국');
  await expect(first.locator('.su-job')).toHaveText('국장');
  await expect(first.locator('.su-email')).toHaveText('person-b@example.test');
  await expect(view.locator('.su-row').nth(2).locator('.su-last')).toHaveText('');
  // 칸은 일곱뿐(기록 내용 칸 없음).
  await expect(first.locator('td')).toHaveCount(7);
  if(!phoneLike(width))await expect(view.locator('thead th')).toHaveText(['조직','부서','이름','직책','이메일','가입일','마지막 사용']);
  else{
    // 폰: 한 사람 두 줄 — 이름 줄 아래에 이메일 줄.
    const nameBox=await first.locator('.su-name').boundingBox(),mailBox=await first.locator('.su-email').boundingBox(),lastBox=await first.locator('.su-last').boundingBox();
    expect(mailBox.y).toBeGreaterThan(nameBox.y+nameBox.height-2);
    expect(Math.abs(lastBox.y-mailBox.y)).toBeLessThan(8);
    await expect(view.locator('thead')).toBeHidden();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`${SHOTS}signups-list-${width}.png`});
  expect(calls.filter(c=>c.path==='/rest/v1/rpc/app_signup_list').every(c=>!c.body||Object.keys(c.body).length===0)).toBe(true);
});

for(const width of [412,1280])test(`운영자: 새 가입 알림 줄 → 누르면 가입자 목록 (${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:860});
  const open=`/work/app/?view=signups&notice=signup.${encodeURIComponent(REF)}`;
  const calls=await boot(page,{operator:true,notices:[{kind:'signup',ref_key:REF,open,text:'새 가입 2명 — 가상 사람B, 가상 사람A'}]});
  const line=page.locator('.kptu-notice-line[data-notice-kind="signup"]');
  await expect(line).toBeVisible({timeout:15000});
  await expect(line.locator('[role="status"]')).toHaveText('새 가입 2명 — 가상 사람B, 가상 사람A');
  await page.screenshot({path:`${SHOTS}signups-notice-${width}.png`});
  await line.locator('[data-notice-act]').click();
  await expect(page.locator('#signupsView .su-row')).toHaveCount(4,{timeout:15000});
  expect(calls.some(c=>c.action==='opened'&&c.body?.kind==='signup'&&c.body?.ref_key===REF)).toBe(true);
});

test('운영자: 내 프로필 폰 알림에 새 가입 칩(기본 켬)',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:412,height:860});
  await boot(page,{operator:true,view:'profile'});
  const chip=page.locator('#psPushPanel [data-ps-push-kind="signup"]');
  await expect(chip).toHaveText('새 가입',{timeout:15000});
  await expect(chip).toHaveAttribute('aria-pressed','true');
  await chip.scrollIntoViewIfNeeded();
  await page.screenshot({path:`${SHOTS}signups-chip-412.png`});
});

test('이용자: 가입자 줄·새 가입 칩·알림 줄 없음, 주소로 열어도 운영자만 한 줄',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1280,height:860});
  await boot(page,{view:'signups'});
  await expect(page.locator('#signupsView [data-wait-empty]')).toHaveText('운영자만 볼 수 있어요',{timeout:15000});
  await expect(page.locator('#signupsView .su-row')).toHaveCount(0);
  await expect(page.locator('.kptu-notice-line[data-notice-kind="signup"]')).toHaveCount(0);
  const panel=await openAccount(page,1280);
  await expect(panel.locator('[data-signups-open]')).toBeHidden();
});
