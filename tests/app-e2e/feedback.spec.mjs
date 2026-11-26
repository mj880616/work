// FEEDBACK-의견보내기 PR5(사용자 11/15 18:13 '가'): 계정 메뉴 맨 아래 '의견 보내기'(모두) · 운영자 '받은 의견'.
// 서버는 page.route로 흉내 낸다(보내기 app_feedback_send — 보낸 사람은 서버가 정함, 읽기 app_feedback_* — 운영자만).
// 화면 사진은 docs/design/screens/s62-19/에 남긴다(폰 412·폴드 펼침 880·PC 1280).
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import {serveBuiltShell} from './helpers/built-shell.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

const origin=appOrigin;
const SHOTS=process.env.S62_19_SHOTS?'docs/design/screens/s62-19/':'test-results/';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64');
const ITEMS=[
  {id:'f2',email:'user-a@example.test',created_at:'2026-11-15T09:10:00Z',screen:'사진',device:'fold',client:'app',version:'abc123',body:'사진 화면에서 별표가 안 눌려요.\n두 번 눌러야 돼요.',photos:1,done_at:null},
  {id:'f1',email:'user-b@example.test',created_at:'2026-11-15T08:00:00Z',screen:'홈',device:'phone',client:'browser',version:'',body:'홈 입력칸 글자가 작아요',photos:0,done_at:null}
];
async function boot(page,{operator=false,view='calendar'}={}){
  const calls=[];
  await serveBuiltShell(page,origin);
  const user={id:'fb-user',email:'fb@example.org'},workspace={id:'fb-workspace',name:'QA',slug:'qa'};
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**',route=>{
    const req=route.request(),path=new URL(req.url()).pathname;let data=[];
    if(path.startsWith('/rest/v1/rpc/app_feedback'))calls.push({path,body:req.postDataJSON?.()??null});
    if(path==='/auth/v1/token')data={access_token:'qa',refresh_token:'qa-refresh',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,user};
    else if(path==='/auth/v1/user')data=user;
    else if(path==='/rest/v1/app_workspace_members')data=[{workspace_id:workspace.id,user_id:user.id,role:'owner'}];
    else if(path==='/rest/v1/app_workspaces')data=[workspace];
    else if(path==='/rest/v1/app_profiles')data=[{user_id:user.id,display_name:'QA'}];
    else if(path==='/rest/v1/rpc/app_my_features')data=operator?['dev_inbox']:[];
    else if(path==='/rest/v1/rpc/app_feedback_send')data='f3';
    else if(path.startsWith('/rest/v1/rpc/app_feedback_')){
      if(!operator)return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'42501',message:'OPERATOR_FEATURE_REQUIRED'})});
      if(path.endsWith('app_feedback_list'))data=ITEMS;
      else if(path.endsWith('app_feedback_open_count'))data=2;
      else if(path.endsWith('app_feedback_photo'))data={mime:'image/png',data:PNG.toString('base64')};
      else data=true;
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

for(const width of [412,880,1280])test(`이용자: 메뉴 맨 아래 의견 보내기 → 글·사진·자동 정보 → 서버로, 받은 의견 줄 없음 (${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:860});
  const calls=await boot(page);
  const panel=await openAccount(page,width);
  await expect(panel.locator('[data-feedback-inbox]')).toBeHidden();
  const entry=panel.locator('[data-feedback-open]');
  await expect(entry).toBeVisible();
  // 설정 줄 맨 끝(S68-36): 이용자에게는 의견 보내기 다음에 보이는 줄이 로그아웃뿐(운영 줄은 운영자만).
  expect(await entry.evaluate(b=>{const rows=[...b.closest('.account-panel,#mobileAccountGroup').querySelectorAll('.account-action')].filter(el=>el.getClientRects().length);return rows.slice(rows.indexOf(b)+1).map(el=>el.textContent.trim());})).toEqual(['로그아웃']);
  await entry.click();
  const modal=page.locator('#feedbackModal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('운영팀만 봐요');
  await expect(modal.locator('.fb-auto')).toContainText(`함께 보내는 정보: 일정 · ${width<=760?'폰':width<=1100?'폴드':'PC'} · 브라우저 · 판 300`);
  await modal.getByRole('button',{name:'보내기',exact:true}).click();
  await expect(modal.locator('[data-sfm-status]')).toHaveText('보낼 글을 써 주세요');
  await modal.getByLabel('의견').fill('  사진 화면에서 별표가 안 눌려요  ');
  await modal.getByLabel('사진·화면 캡처 붙이기').setInputFiles({name:'shot.png',mimeType:'image/png',buffer:PNG});
  await expect(modal.locator('.fb-thumb img')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`${SHOTS}feedback-send-${width}.png`});
  await modal.getByRole('button',{name:'보내기',exact:true}).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByText('보냈어요, 고맙습니다')).toBeVisible();
  const send=calls.find(c=>c.path.endsWith('app_feedback_send'));
  expect(send.body.p_body).toBe('사진 화면에서 별표가 안 눌려요');
  expect(send.body.p_context).toEqual({screen:'일정',device:width<=760?'phone':width<=1100?'fold':'pc',client:'browser',version:'300'});
  expect(send.body.p_photos).toHaveLength(1);
  expect(send.body.p_photos[0].mime).toBe('image/jpeg');
  expect(Object.keys(send.body).sort()).toEqual(['p_body','p_context','p_photos']);
  expect(calls.some(c=>/list|open_count|photo$|done/.test(c.path))).toBe(false);
});

test('이용자: 받은 의견 주소로 열어도 운영자만 한 줄',async({page})=>{
  await boot(page,{view:'feedback'});
  await expect(page.locator('#feedbackView [data-wait-empty]')).toHaveText('운영자만 볼 수 있어요',{timeout:15000});
});

test('이용자: 하루 상한이면 한 줄 안내, 창은 열린 채',async({page})=>{
  await boot(page);
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/rest/v1/rpc/app_feedback_send',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'54000',message:'FEEDBACK_DAILY_LIMIT'})}));
  const panel=await openAccount(page,1280);
  await panel.locator('[data-feedback-open]').click();
  const modal=page.locator('#feedbackModal');
  await modal.getByLabel('의견').fill('한 줄');
  await modal.getByRole('button',{name:'보내기',exact:true}).click();
  await expect(modal.locator('[data-sfm-status]')).toHaveText('오늘은 더 보낼 수 없어요. 내일 다시 보내 주세요');
  await expect(modal).toBeVisible();
});

for(const width of [412,880,1280])test(`운영자: 받은 의견 n → 목록·사진·처리함 (${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:860});
  const calls=await boot(page,{operator:true});
  const panel=await openAccount(page,width);
  const inbox=panel.locator('[data-feedback-inbox]');
  await expect(inbox).toBeVisible();
  await expect(inbox.locator('[data-feedback-count]')).toHaveText('2');
  await inbox.click();
  const view=page.locator('#feedbackView');
  await expect(view.locator('.fb-item')).toHaveCount(2,{timeout:15000});
  await expect(page).toHaveURL(/view=feedback/);
  const first=view.locator('.fb-item').first();
  await expect(first.locator('.fb-name')).toHaveText('user-a@example.test'); // S68-58: 보낸 사람은 이메일주소(이름 없음)
  await expect(first.locator('.fb-meta')).toContainText('사진 · 폴드 · 앱 · 판 abc123');
  await expect(first.locator('.fb-body')).toHaveText('사진 화면에서 별표가 안 눌려요.\n두 번 눌러야 돼요.');
  await first.getByRole('button',{name:'사진 1'}).click();
  await expect(first.locator('img.fb-img')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`${SHOTS}feedback-inbox-${width}.png`});
  await first.getByRole('button',{name:'처리함'}).click();
  await expect.poll(()=>calls.find(c=>c.path.endsWith('app_feedback_done'))?.body).toEqual({p_id:'f2',p_done:true});
  await view.getByRole('button',{name:'처리함',exact:true}).first().isVisible();
  await view.locator('[data-fb-filter="done"]').click();
  await expect.poll(()=>calls.filter(c=>c.path.endsWith('app_feedback_list')).at(-1)?.body).toEqual({p_state:'done'});
});
