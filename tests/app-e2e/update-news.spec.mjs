// UPDATE-운영자전용기록업데이트소식 PR3(시안 PR 2638 + 명진 11/15 13:37): 이용자 '업데이트 소식'·운영자 보내기.
// - 이용자: 계정 메뉴 '업데이트 소식' → 운영자가 보낸 소식만(서버 app_update_news_list). 점·숫자·새 소식 창 없음. 열면 읽음만 남김(app_update_news_seen).
// - 운영자: 업데이트 기록 줄마다 [보내기] → 그 기록 글이 채워진 창('폰에서 볼 것'은 기본 빼기, 넣기 고를 수 있음, 다른 기록 묶기) → 서버 save.
// 서버는 page.route로 흉내 낸다. 화면 사진은 docs/design/screens/s62-19/에 남긴다(폰 412·폴드 펼침 880·PC 1280).
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import {serveBuiltShell} from './helpers/built-shell.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import {screenFind,screenFindLocator,screenTools} from './helpers/screen-find.mjs';

const origin=appOrigin;
const SHOTS=process.env.S62_19_SHOTS?'docs/design/screens/s62-19/':'test-results/';
const note=(v,date,changes,checks=[])=>({v,date,changes,checks});
const NOTES={schema:1,current:'11/15-3',notes:[
  note('11/15-3','2026-11-15',['사진 화면에 내 구글 드라이브 칸이 생겼어요','메뉴에 [파일]이 생겼어요'],['사진 열어 보기']),
  note('11/15-2','2026-11-15',['PC 프로그램 이름이 바뀌었어요']),
  note('11/15-1','2026-11-15',['게시판 글을 날짜순으로 모아 보여 줘요']),
  note('11/14-9','2026-11-14',['주간 보고 표에서 자리 바꾸기 손잡이가 줄 맨 왼쪽으로 모였어요'])
]};
const ITEMS=[
  {id:'n2',title:'구글 드라이브 사진·파일',lines:['사진 화면에 내 구글 드라이브 칸이 생겼어요(각자 자기 드라이브만 보여요)','메뉴에 [파일]이 생겼어요. 내 구글 드라이브 파일을 볼 수 있어요'],sent_at:'2026-11-21T01:00:00Z',edited_at:null},
  {id:'n1',title:'PC 프로그램 새 이름',lines:['윈도우 PC 프로그램 이름이 바뀌었어요','로그인 화면에서 내려받을 수 있어요'],sent_at:'2026-11-20T02:00:00Z',edited_at:null}
];
async function boot(page,{operator=false,view='calendar',items=ITEMS,startOn='2026-11-20',sources=[['11/15-3'],['11/15-2']],notes=NOTES,extra=[]}={}){
  const calls=[],withdrawn=new Set(),resent=new Set();
  await serveBuiltShell(page,origin);
  const user={id:'un-user',email:'un@example.org'},workspace={id:'un-workspace',name:'QA',slug:'qa'};
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**',route=>{
    const req=route.request(),path=new URL(req.url()).pathname;let data=[];
    if(path.startsWith('/rest/v1/rpc/app_update_news')||path==='/rest/v1/rpc/app_release_notes_read')calls.push({path,body:req.postDataJSON?.()??null});
    if(path==='/auth/v1/token')data={access_token:'qa',refresh_token:'qa-refresh',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,user};
    else if(path==='/auth/v1/user')data=user;
    else if(path==='/rest/v1/app_workspace_members')data=[{workspace_id:workspace.id,user_id:user.id,role:'owner'}];
    else if(path==='/rest/v1/app_workspaces')data=[workspace];
    else if(path==='/rest/v1/app_profiles')data=[{user_id:user.id,display_name:'QA'}];
    else if(path==='/rest/v1/rpc/app_my_features')data=operator?['dev_inbox']:[];
    else if(path==='/rest/v1/rpc/app_update_news_list')data=items;
    else if(path==='/rest/v1/rpc/app_update_news_seen')data=items.length;
    else if(path==='/rest/v1/rpc/app_release_notes_read'||path.startsWith('/rest/v1/rpc/app_update_news_')&&path!=='/rest/v1/rpc/app_update_news_list'&&path!=='/rest/v1/rpc/app_update_news_seen'){
      if(!operator)return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'42501',message:'OPERATOR_FEATURE_REQUIRED'})});
      if(path==='/rest/v1/rpc/app_release_notes_read')data=notes;
      else if(path==='/rest/v1/rpc/app_update_news_admin')data={start_on:startOn,users:9,items:[{...items[0],sources:sources[0],reads:7,withdrawn_at:null},{...items[1],sources:sources[1],reads:9,withdrawn_at:null},...extra,{id:'n0',title:null,lines:['시작 날짜 전 소식'],sources:[],sent_at:'2026-11-10T01:00:00Z',reads:0,withdrawn_at:null}].map(item=>withdrawn.has(item.id)?{...item,withdrawn_at:'2026-11-22T05:00:00Z'}:item.withdrawn_at&&resent.has(item.id)?{...item,withdrawn_at:null}:item)};
      else if(path==='/rest/v1/rpc/app_update_news_save')data='n3';
      else if(path==='/rest/v1/rpc/app_update_news_withdraw'){withdrawn.add(req.postDataJSON()?.p_id);resent.delete(req.postDataJSON()?.p_id);data=true}
      else if(path==='/rest/v1/rpc/app_update_news_resend'){const id=req.postDataJSON()?.p_id;withdrawn.delete(id);resent.add(id);data=true}
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

for(const width of [412,880,1280])test(`이용자: 메뉴 › 업데이트 소식에 보낸 소식만, 점·숫자 없음, 열면 읽음 (${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:860});
  const calls=await boot(page);
  const panel=await openAccount(page,width);
  const entry=panel.locator('[data-whatsnew-open]');
  await expect(entry).toBeVisible();
  await expect(entry).toHaveText('업데이트 소식');
  await expect(panel.locator('[data-updates-open]')).toBeHidden();
  await entry.click();
  const view=page.locator('#whatsnewView');
  await expect(view).toBeVisible({timeout:15000});
  await expect(page).toHaveURL(/view=whatsnew/);
  const rows=view.locator('.un-item');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator('.un-title')).toHaveText('구글 드라이브 사진·파일');
  await expect(rows.first().locator('.un-date')).toHaveText('11/21');
  await expect(rows.first().locator('.un-lines li')).toHaveCount(2);
  await expect.poll(()=>calls.some(c=>c.path.endsWith('app_update_news_seen'))).toBe(true);
  expect(calls.some(c=>c.path.endsWith('app_release_notes_read'))).toBe(false);
  // 새 소식 알림 없음: 점·숫자·창 어디에도
  await expect(page.locator('.un-dot,[data-new-dot],#versionNotice')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`${SHOTS}user-whatsnew-${width}.png`});
  await page.goBack();
  await expect(page.locator('#calendarView')).toBeVisible();
});

test('이용자: 소식이 없으면 한 줄',async({page})=>{
  await boot(page,{view:'whatsnew',items:[]});
  await expect(page.locator('#whatsnewView [data-wait-empty]')).toHaveText('아직 소식이 없어요',{timeout:15000});
});

for(const width of [390,880,1280])test(`운영자: 기록 줄 [보내기] → 글 채워진 창(폰에서 볼 것 기본 빼기·묶기) → 서버로 (${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const calls=await boot(page,{operator:true,view:'updates'});
  const view=page.locator('#updatesView');
  await expect(view.locator('.rn-note')).toHaveCount(4,{timeout:15000});
  // S71-31: 기록에서 나간 소식(n2·n1)은 기록 줄 버튼이 맡고, 목록 위에는 기록 줄에 없는 소식(직접 쓴 n0)만 줄로.
  const loose=view.locator('[data-un-admin] .un-item');
  await expect(loose).toHaveCount(1);
  await expect(loose.first()).toContainText('시작 날짜 전 소식');
  await expect(loose.first()).toContainText('읽음 0/9');
  // S67-73: 보낸 기록은 버튼 자체가 [보냄], 안 보낸 기록은 [보내기]. 따로 붙는 '보냄' 꼬리표는 없다.
  // S68-14: [보냄]도 누를 수 있다(누르면 거두기).
  await expect(view.locator('.rn-note').first().locator('[data-rn-send]')).toHaveText('보냄');
  await expect(view.locator('.rn-note').first().locator('[data-rn-send]')).toBeEnabled();
  await expect(view.locator('.rn-note').first().locator('[data-rn-send]')).toHaveAttribute('aria-label','11/15-3 이용자에게 보냄 · 눌러서 거두기');
  await expect(view.locator('.rn-note').nth(2).locator('[data-rn-send]')).toHaveText('보내기');
  await expect(view.locator('.rn-note').nth(2).locator('[data-rn-send]')).toBeEnabled();
  await expect(view.locator('span.rn-sent')).toHaveCount(0);
  await page.screenshot({path:`${SHOTS}operator-updates-${width}.png`});
  // [보내기]는 줄을 펼치지 않고 창을 연다.
  const third=view.locator('.rn-note').nth(2);
  await third.locator('[data-rn-send]').click();
  await expect(third).not.toHaveAttribute('open','');
  const modal=page.locator('#updateNewsSend');
  await expect(modal).toBeVisible();
  const area=modal.locator('textarea');
  await expect(area).toHaveValue('· 게시판 글을 날짜순으로 모아 보여 줘요');
  await modal.locator('.un-adder').selectOption('11/15-3');
  await expect(area).toHaveValue('· 게시판 글을 날짜순으로 모아 보여 줘요\n· 사진 화면에 내 구글 드라이브 칸이 생겼어요\n· 메뉴에 [파일]이 생겼어요');
  await modal.getByLabel("'폰에서 볼 것' 줄도 같이 보내기").check();
  await expect(area).toHaveValue(/사진 열어 보기$/);
  await modal.getByLabel("'폰에서 볼 것' 줄도 같이 보내기").uncheck();
  await modal.getByLabel('제목(선택)').fill('사진·파일');
  await area.fill('· 사진 화면에 내 구글 드라이브 칸이 생겼어요\n· 메뉴에 [파일]이 생겼어요\n\n');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`${SHOTS}operator-send-${width}.png`});
  await modal.getByRole('button',{name:'보내기',exact:true}).click();
  await expect(modal).toHaveCount(0);
  const save=calls.find(c=>c.path.endsWith('app_update_news_save'));
  expect(save.body).toEqual({p_id:null,p_title:'사진·파일',p_lines:['사진 화면에 내 구글 드라이브 칸이 생겼어요','메뉴에 [파일]이 생겼어요'],p_sources:['11/15-1','11/15-3']});
});

// S71-31 RELNOTE-머리줄정리(명진 11/26 "이용자에게 보이는 시작날짜랑 바꾸기 삭제 불필요" / "보낸 소식 260 이용자에게 보이는 그대로도 삭제"
// / "낱말로 찾기랑 직접 쓰기 한줄로 / 낱말로 찾기는 찾기로"): 시작 날짜 줄·[바꾸기]·접히는 '보낸 소식 N' 줄이 없고, 찾기·[+]는 맨 위 줄 하나.
for(const width of [390,1280])test(`운영자: 위쪽 시작 날짜 줄·'보낸 소식' 줄 없음 · 맨 위 한 줄 [찾기][+] · 찾기로 목록 걸러짐 · [+]로 직접 쓰기 (${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const calls=await boot(page,{operator:true,view:'updates'});
  const view=page.locator('#updatesView');
  await expect(view.locator('.rn-note')).toHaveCount(4,{timeout:15000});
  // (가) 시작 날짜 줄·[바꾸기]·안내 줄 없음, (나) '보낸 소식 N · 이용자에게 보이는 그대로' 줄 없음
  await expect(view.getByText('이용자에게 보이는 시작 날짜')).toHaveCount(0);
  await expect(view.getByText('시작 날짜 정하기')).toHaveCount(0);
  await expect(view.getByText('이용자에게 보이는 그대로')).toHaveCount(0);
  await expect(view.getByText(/^보낸 소식/)).toHaveCount(0);
  await expect(view.locator('summary.un-sent-head,[data-un-start],[data-un-notice],.un-cutline')).toHaveCount(0);
  await expect(view.getByRole('button',{name:'바꾸기'})).toHaveCount(0);
  // 화면 안 찾기 칸·[+ 직접 쓰기] 글자 단추 없음
  await expect(view.locator('input')).toHaveCount(0);
  await expect(view.locator('[data-un-write]')).toHaveCount(0);
  // 맨 위 줄 하나: 찾기 + [+](맨 오른쪽, 이름 '직접 쓰기')
  const add=screenTools(page).getByRole('button',{name:'직접 쓰기',exact:true});
  await expect(add).toBeVisible();
  await expect(add).toHaveText('');
  if(width<600)await expect(screenFindLocator(page)).toBeHidden();
  const find=await screenFind(page);
  await expect(find).toHaveAttribute('placeholder','업데이트 기록에서 찾기');
  const line=await page.evaluate(()=>{
    const f=document.querySelector(innerWidth>760?'#gsTopInput':'#gsScreenInput').getBoundingClientRect(),a=document.querySelector('[data-sf-tools="updates"] [data-un-write]').getBoundingClientRect();
    const mid=r=>r.top+r.height/2;
    return {same:Math.abs(mid(f)-mid(a))<=4,right:a.left>=f.right-1,size:[Math.round(a.width),Math.round(a.height)]};
  });
  expect(line.same,'찾기 칸과 [+]가 한 줄').toBe(true);
  expect(line.right,'[+]가 찾기 오른쪽').toBe(true);
  expect(line.size).toEqual([32,32]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`${SHOTS}s71-31-head-${width}.png`});
  // 찾기: 글자 넣으면 목록이 걸러진다
  await find.fill('게시판');
  await expect(view.locator('.rn-note')).toHaveCount(1);
  await expect(view.locator('.rn-note .rn-ver')).toHaveText('11/15-1');
  await expect(view.locator('.rn-count')).toHaveText('찾은 기록 1개');
  await find.fill('');
  await expect(view.locator('.rn-note')).toHaveCount(4);
  // [+] → 직접 쓰기 창(시작 날짜 칸 없음) → 보내면 save만, 시작 날짜는 부르지 않는다
  await add.click();
  const modal=page.locator('#updateNewsSend');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-un-send-start],[data-un-notice]')).toHaveCount(0);
  await modal.locator('textarea').fill('· 시험 소식');
  await modal.getByRole('button',{name:'보내기',exact:true}).click();
  await expect(modal).toHaveCount(0);
  await expect.poll(()=>calls.find(c=>c.path.endsWith('app_update_news_save'))?.body).toEqual({p_id:null,p_title:null,p_lines:['시험 소식'],p_sources:[]});
  expect(calls.some(c=>c.path.endsWith('app_update_news_set_start'))).toBe(false);
});

test('운영자: 기록 줄에 없는 소식(직접 쓴 것) 줄의 [수정]·[거두기]는 그대로',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1280,height:900});
  const calls=await boot(page,{operator:true,view:'updates'});
  const box=page.locator('#updatesView [data-un-admin]');
  await expect(box.locator('.un-item').first()).toBeVisible({timeout:15000});
  await box.locator('[data-un-edit="n0"]').click();
  const modal=page.locator('#updateNewsSend');
  await expect(modal.locator('textarea')).toHaveValue('· 시작 날짜 전 소식');
  await modal.getByRole('button',{name:'수정',exact:true}).click();
  await expect(modal).toHaveCount(0);
  expect(calls.find(c=>c.path.endsWith('app_update_news_save')).body.p_id).toBe('n0');
  await box.locator('[data-un-withdraw="n0"]').click();
  await page.getByRole('button',{name:'거두기',exact:true}).last().click();
  await expect.poll(()=>calls.some(c=>c.path.endsWith('app_update_news_withdraw')&&c.body.p_id==='n0')).toBe(true);
  await expect(box.locator('.un-item.is-withdrawn [data-un-resend="n0"]')).toBeVisible();
});

// S68-14(명진 11/22 "업데이트 기록 보낸 후 거둬들일 수가 없음"): 기록 줄 [보냄]을 누르면 확인 → 그 기록이 든 소식을 거두고 [보내기]로 돌아간다.
for(const width of [412,1280])test(`운영자: 기록 줄 [보냄] → 확인 → 거두기, 취소하면 그대로 (${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:900});
  const calls=await boot(page,{operator:true,view:'updates'});
  const view=page.locator('#updatesView');
  const btn=view.locator('.rn-note').nth(1).locator('[data-rn-send]');
  await expect(btn).toHaveText('보냄',{timeout:15000});
  // 취소하면 서버를 부르지 않고 그대로.
  await btn.click();
  const ask=page.locator('.kptu-ask-text');
  await expect(ask).toHaveText('이 소식을 거둘까요? 이용자 화면에서 사라져요.');
  await expect(page.locator('.kptu-ask-note')).toHaveCount(0);
  await page.getByRole('button',{name:'취소',exact:true}).last().click();
  await expect(ask).toHaveCount(0);
  expect(calls.some(c=>c.path.endsWith('app_update_news_withdraw'))).toBe(false);
  await expect(btn).toHaveText('보냄');
  await expect(view.locator('.rn-note').nth(1)).not.toHaveAttribute('open','');
  // 거두기 → 서버 함수 하나(n1) → [보내기]로.
  await btn.click();
  await page.getByRole('button',{name:'거두기',exact:true}).last().click();
  await expect.poll(()=>calls.filter(c=>c.path.endsWith('app_update_news_withdraw')).map(c=>c.body.p_id)).toEqual(['n1']);
  // S68-46: 거둔 기록은 [다시 보내기](새로 쓰는 [보내기]가 아님).
  await expect(btn).toHaveText('다시 보내기');
  await expect(btn).toHaveAttribute('aria-label','11/15-2 거둔 소식 다시 보내기');
  // 기록에서 나간 소식은 목록 위 줄로 따로 나오지 않는다(기록 줄 버튼 하나가 맡음).
  await expect(view.locator('[data-un-admin] [data-un-resend="n1"]')).toHaveCount(0);
});

test('운영자: 여러 기록을 묶어 보낸 소식은 [보냄] 확인 창에 같이 거둬지는 기록 수',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:880,height:900});
  const calls=await boot(page,{operator:true,view:'updates',sources:[['11/15-3','11/15-1','11/14-9'],['11/15-2']]});
  const view=page.locator('#updatesView');
  const btn=view.locator('.rn-note').nth(2).locator('[data-rn-send]');
  await expect(btn).toHaveText('보냄',{timeout:15000});
  await btn.click();
  await expect(page.locator('.kptu-ask-note')).toHaveText('같이 보낸 기록 2개도 함께 거둬져요');
  await page.getByRole('button',{name:'거두기',exact:true}).last().click();
  await expect.poll(()=>calls.filter(c=>c.path.endsWith('app_update_news_withdraw')).map(c=>c.body.p_id)).toEqual(['n2']);
  for(const i of [0,2,3])await expect(view.locator('.rn-note').nth(i).locator('[data-rn-send]')).toHaveText('다시 보내기');
  await expect(view.locator('.rn-note').nth(1).locator('[data-rn-send]')).toHaveText('보냄');
});

// S68-46 UPDATE-소식자동(명진 11/23 12:37 "업데이트 기록 기본 자동으로 보내고 수동으로는 회수 가능하게"):
// 새 기록은 서버가 자동으로 보낸다(운영자 화면은 누르지 않아도 [보냄]). 거두기·다시 보내기는 기록 줄 버튼 하나(S71-31부터 따로 '보낸 소식' 목록 없음).
// 자동 소식은 기록 파일 이름으로 맞춘다 — 같은 날 기록이 늦게 들어와 순번이 밀려도 맞는 줄이 [보냄].
const AUTO_NOTES={schema:1,current:'11/23-3',notes:[
  {...note('11/23-3','2026-11-23',['새 기록 줄 하나']),file:'20261123-1300-new'},
  {...note('11/23-2','2026-11-23',['늦게 들어온 기록']),file:'20261123-1230-late'},
  {...note('11/23-1','2026-11-23',['옛 기록']),file:'20261123-1000-old'}
]};
const AUTO_ITEM={id:'a1',title:null,lines:['새 기록 줄 하나'],sources:['11/23-2'],source_files:['20261123-1300-new'],auto:true,sent_at:'2026-11-23T05:00:00Z',edited_at:null,reads:1,withdrawn_at:null};
for(const width of [412,1280])test(`운영자: 자동으로 나간 기록은 처음부터 [보냄], 기록 줄에서 거두기 → [다시 보내기] → [보냄] (${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const calls=await boot(page,{operator:true,view:'updates',notes:AUTO_NOTES,sources:[[],[]],extra:[AUTO_ITEM]});
  const view=page.locator('#updatesView');
  await expect(view.locator('.rn-note')).toHaveCount(3,{timeout:15000});
  const first=view.locator('.rn-note').nth(0).locator('[data-rn-send]'),second=view.locator('.rn-note').nth(1).locator('[data-rn-send]');
  await expect(first).toHaveText('보냄');
  await expect(second).toHaveText('보내기','순번(11/23-2)이 같아도 다른 파일이면 안 나간 기록');
  await expect(view.locator('.rn-note').nth(2).locator('[data-rn-send]')).toHaveText('보내기');
  // 자동 소식은 기록 줄이 맡으므로 목록 위 줄로 나오지 않는다(직접 쓴 n0만).
  await expect(view.locator('[data-un-admin] .un-item').filter({hasText:'새 기록 줄 하나'})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`${SHOTS}operator-auto-${width}.png`});
  await first.click();
  await page.getByRole('button',{name:'거두기',exact:true}).last().click();
  await expect.poll(()=>calls.filter(c=>c.path.endsWith('app_update_news_withdraw')).map(c=>c.body.p_id)).toEqual(['a1']);
  await expect(first).toHaveText('다시 보내기');
  await first.click();
  await expect(page.locator('.kptu-ask-text')).toHaveText('이 소식을 다시 보낼까요? 이용자 화면에 다시 보여요.');
  await page.getByRole('button',{name:'다시 보내기',exact:true}).last().click();
  await expect.poll(()=>calls.filter(c=>c.path.endsWith('app_update_news_resend')).map(c=>c.body)).toEqual([{p_id:'a1'}]);
  await expect(first).toHaveText('보냄');
  expect(calls.some(c=>c.path.endsWith('app_update_news_save')),'자동 기록은 운영자가 따로 보내지 않는다').toBe(false);
});

test('운영자: 기록 줄 [다시 보내기] → 확인 → 그 소식만 다시 보내고, 취소하면 그대로',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:880,height:900});
  const calls=await boot(page,{operator:true,view:'updates',notes:AUTO_NOTES,sources:[[],[]],extra:[{...AUTO_ITEM,withdrawn_at:'2026-11-23T06:00:00Z'}]});
  const btn=page.locator('#updatesView .rn-note').nth(0).locator('[data-rn-send]');
  await expect(btn).toHaveText('다시 보내기',{timeout:15000});
  await btn.click();
  await page.getByRole('button',{name:'취소',exact:true}).last().click();
  expect(calls.some(c=>c.path.endsWith('app_update_news_resend'))).toBe(false);
  await expect(page.locator('#updateNewsSend')).toHaveCount(0);
  await btn.click();
  await page.getByRole('button',{name:'다시 보내기',exact:true}).last().click();
  await expect.poll(()=>calls.filter(c=>c.path.endsWith('app_update_news_resend')).map(c=>c.body.p_id)).toEqual(['a1']);
  await expect(btn).toHaveText('보냄');
});

test('이용자: 다시 보내기·자동 소식 함수는 운영자만(서버가 거절), 이용자 화면에는 기록 이름이 없다',async({page})=>{
  await boot(page,{view:'whatsnew',items:[{id:'a1',title:null,lines:['새 기록 줄 하나'],sent_at:'2026-11-23T05:00:00Z',edited_at:null}]});
  const view=page.locator('#whatsnewView');
  await expect(view.locator('.un-item')).toHaveCount(1,{timeout:15000});
  await expect(view.locator('.un-title')).toHaveText('새 기록 줄 하나');
  await expect(view.locator('[data-un-resend],[data-un-withdraw],[data-rn-send]')).toHaveCount(0);
  const status=await page.evaluate(()=>window.KPTURuntime.api('/rest/v1/rpc/app_update_news_resend',{method:'POST',body:{p_id:'a1'},singleFlight:false}).then(()=>'ok',e=>'refused'));
  expect(status).toBe('refused');
});
