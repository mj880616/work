// UPDATE-운영자전용기록업데이트소식 PR3(시안 PR 2638 + 사용자 11/15 13:37): 이용자 '업데이트 소식'·운영자 보내기.
// - 이용자: 계정 메뉴 '업데이트 소식' → 운영자가 보낸 소식만(서버 app_update_news_list). 점·숫자·새 소식 창 없음. 열면 읽음만 남김(app_update_news_seen).
// - 운영자: 업데이트 기록 줄마다 [보내기] → 그 기록 글이 채워진 창('폰에서 볼 것'은 기본 빼기, 넣기 고를 수 있음, 다른 기록 묶기) → 서버 save.
// 서버는 page.route로 흉내 낸다. 화면 사진은 docs/design/screens/s62-19/에 남긴다(폰 412·폴드 펼침 880·PC 1280).
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import {serveBuiltShell} from './helpers/built-shell.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

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

for(const width of [412,880,1280])test(`운영자: 기록 줄 [보내기] → 글 채워진 창(폰에서 볼 것 기본 빼기·묶기) → 서버로 (${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const calls=await boot(page,{operator:true,view:'updates'});
  const view=page.locator('#updatesView');
  await expect(view.locator('.rn-note')).toHaveCount(4,{timeout:15000});
  await expect(view.locator('.un-cut')).toContainText('이용자에게 보이는 시작 날짜 11/20');
  const sent=view.locator('.un-sent');
  if(width<900)await sent.locator('summary').click();
  await expect(sent.locator('.un-item').first()).toContainText('읽음 7/9');
  await expect(sent.locator('.un-cutline')).toContainText('여기부터 위만 이용자에게 보임');
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

test('운영자: 보낸 소식 [수정]·[거두기]·시작 날짜 바꾸기',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1280,height:900});
  const calls=await boot(page,{operator:true,view:'updates'});
  const sent=page.locator('#updatesView .un-sent');
  await expect(sent.locator('.un-item').first()).toBeVisible({timeout:15000});
  await sent.locator('[data-un-edit="n2"]').click();
  const modal=page.locator('#updateNewsSend');
  await expect(modal.getByLabel('제목(선택)')).toHaveValue('구글 드라이브 사진·파일');
  await modal.getByRole('button',{name:'수정',exact:true}).click();
  await expect(modal).toHaveCount(0);
  expect(calls.find(c=>c.path.endsWith('app_update_news_save')).body.p_id).toBe('n2');
  await sent.locator('[data-un-withdraw="n1"]').click();
  await page.getByRole('button',{name:'거두기',exact:true}).last().click();
  await expect.poll(()=>calls.some(c=>c.path.endsWith('app_update_news_withdraw')&&c.body.p_id==='n1')).toBe(true);
  await page.locator('#updatesView .un-cut [data-un-start]').click();
  const start=page.locator('#updateNewsStart');
  await start.getByLabel('시작 날짜').fill('2026-11-25');
  await start.getByRole('button',{name:'바꾸기',exact:true}).click();
  await expect.poll(()=>calls.find(c=>c.path.endsWith('app_update_news_set_start'))?.body).toEqual({p_start:'2026-11-25'});
});

// S68-14(사용자 11/22 "업데이트 기록 보낸 후 거둬들일 수가 없음"): 기록 줄 [보냄]을 누르면 확인 → 그 기록이 든 소식을 거두고 [보내기]로 돌아간다.
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
  await expect(view.locator('.un-sent .un-item.is-withdrawn')).toHaveCount(1);
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

// UPDATE-소식안보임(요청함 11/16): 시작 날짜가 없으면 아무 소식도 이용자에게 안 보인다(서버 규칙). 운영자 화면이 한 줄로 알리고, 보낼 때 오늘로 같이 정한다.
for(const width of [412,880,1280])test(`운영자: 시작 날짜 없음 → 안내 줄·[시작 날짜 정하기], 보내기 창에서 오늘로 같이 정하기 (${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const calls=await boot(page,{operator:true,view:'updates',startOn:null});
  const view=page.locator('#updatesView');
  await expect(view.locator('.rn-note')).toHaveCount(4,{timeout:15000});
  await expect(view.locator('.un-cut')).toContainText('이용자에게 보이는 시작 날짜 정하지 않음');
  const notice=view.locator('[data-un-notice]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('시작 날짜가 없어 이용자에게 아직 안 보여요');
  await expect(notice.getByRole('button',{name:'시작 날짜 정하기'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`${SHOTS}operator-no-start-${width}.png`});
  // [시작 날짜 정하기] → 오늘이 채워진 창, 버튼 '정하기'
  const today=await page.evaluate(()=>new Date(Date.now()+9*3600*1000).toISOString().slice(0,10));
  await notice.getByRole('button',{name:'시작 날짜 정하기'}).click();
  const start=page.locator('#updateNewsStart');
  await expect(start.getByLabel('시작 날짜')).toHaveValue(today);
  await start.getByRole('button',{name:'취소'}).click();
  await expect(start).toHaveCount(0);
  // 기록 줄 [보내기] → 창에 안내 줄 + '오늘부터 보이게 시작 날짜도 정하기'(기본 켬) → 보내면 save 다음 set_start(오늘)
  await view.locator('.rn-note').nth(2).locator('[data-rn-send]').click();
  const modal=page.locator('#updateNewsSend');
  await expect(modal.locator('[data-un-notice="send"]')).toHaveText('시작 날짜가 없어 이용자에게 아직 안 보여요');
  const box=modal.locator('[data-un-send-start]');
  await expect(box).toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`${SHOTS}operator-send-no-start-${width}.png`});
  await modal.getByRole('button',{name:'보내기',exact:true}).click();
  await expect(modal).toHaveCount(0);
  await expect.poll(()=>calls.find(c=>c.path.endsWith('app_update_news_set_start'))?.body).toEqual({p_start:today});
  const order=calls.map(c=>c.path.split('/').pop());
  expect(order.indexOf('app_update_news_save')).toBeLessThan(order.indexOf('app_update_news_set_start'));
});

test('운영자: 시작 날짜 없음에서 칸을 끄고 보내면 시작 날짜는 그대로',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1280,height:900});
  const calls=await boot(page,{operator:true,view:'updates',startOn:null});
  await page.locator('#updatesView [data-un-write]').click();
  const modal=page.locator('#updateNewsSend');
  await modal.locator('textarea').fill('· 시험 소식');
  await modal.locator('[data-un-send-start]').uncheck();
  await modal.getByRole('button',{name:'보내기',exact:true}).click();
  await expect(modal).toHaveCount(0);
  await expect.poll(()=>calls.some(c=>c.path.endsWith('app_update_news_save'))).toBe(true);
  expect(calls.some(c=>c.path.endsWith('app_update_news_set_start'))).toBe(false);
});

test('운영자: 시작 날짜 앞 소식이 있으면 개수 안내, 수정 창에는 시작 날짜 칸 없음',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:412,height:900});
  await boot(page,{operator:true,view:'updates'});
  const notice=page.locator('#updatesView [data-un-notice]');
  await expect(notice).toContainText('보낸 소식 1개는 시작 날짜 앞이라 이용자에게 안 보여요',{timeout:15000});
  await page.locator('#updatesView .un-sent summary').click();
  await page.locator('#updatesView [data-un-edit="n2"]').click();
  const modal=page.locator('#updateNewsSend');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-un-send-start]')).toHaveCount(0);
});

// S68-46 UPDATE-소식자동(사용자 11/23 12:37 "업데이트 기록 기본 자동으로 보내고 수동으로는 회수 가능하게"):
// 새 기록은 서버가 자동으로 보낸다(운영자 화면은 누르지 않아도 [보냄]). 보낸 소식 목록에 '자동' 표시, 거둔 것은 '거둠' + [다시 보내기].
// 자동 소식은 기록 파일 이름으로 맞춘다 — 같은 날 기록이 늦게 들어와 순번이 밀려도 맞는 줄이 [보냄].
const AUTO_NOTES={schema:1,current:'11/23-3',notes:[
  {...note('11/23-3','2026-11-23',['새 기록 줄 하나']),file:'20261123-1300-new'},
  {...note('11/23-2','2026-11-23',['늦게 들어온 기록']),file:'20261123-1230-late'},
  {...note('11/23-1','2026-11-23',['옛 기록']),file:'20261123-1000-old'}
]};
const AUTO_ITEM={id:'a1',title:null,lines:['새 기록 줄 하나'],sources:['11/23-2'],source_files:['20261123-1300-new'],auto:true,sent_at:'2026-11-23T05:00:00Z',edited_at:null,reads:1,withdrawn_at:null};
for(const width of [412,1280])test(`운영자: 자동으로 나간 기록은 처음부터 [보냄]·'자동' 표시, 목록에서 거두기 → [다시 보내기] (${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const calls=await boot(page,{operator:true,view:'updates',notes:AUTO_NOTES,sources:[[],[]],extra:[AUTO_ITEM]});
  const view=page.locator('#updatesView');
  await expect(view.locator('.rn-note')).toHaveCount(3,{timeout:15000});
  const first=view.locator('.rn-note').nth(0).locator('[data-rn-send]'),second=view.locator('.rn-note').nth(1).locator('[data-rn-send]');
  await expect(first).toHaveText('보냄');
  await expect(second).toHaveText('보내기','순번(11/23-2)이 같아도 다른 파일이면 안 나간 기록');
  await expect(view.locator('.rn-note').nth(2).locator('[data-rn-send]')).toHaveText('보내기');
  const sent=view.locator('.un-sent');
  if(width<900)await sent.locator('summary').click();
  const row=sent.locator('.un-item').filter({hasText:'새 기록 줄 하나'});
  await expect(row.locator('.un-date',{hasText:'자동'})).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`${SHOTS}operator-auto-${width}.png`});
  await row.locator('[data-un-withdraw="a1"]').click();
  await page.getByRole('button',{name:'거두기',exact:true}).last().click();
  await expect.poll(()=>calls.filter(c=>c.path.endsWith('app_update_news_withdraw')).map(c=>c.body.p_id)).toEqual(['a1']);
  const pulled=sent.locator('.un-item.is-withdrawn').filter({hasText:'새 기록 줄 하나'});
  await expect(pulled.locator('.un-date',{hasText:'거둠'})).toHaveCount(1);
  await expect(first).toHaveText('다시 보내기');
  // 목록의 [다시 보내기] → 확인 → 서버 resend → 다시 보낸 상태([보냄]·거두기 버튼).
  await pulled.locator('[data-un-resend="a1"]').click();
  await expect(page.locator('.kptu-ask-text')).toHaveText('이 소식을 다시 보낼까요? 이용자 화면에 다시 보여요.');
  await page.getByRole('button',{name:'다시 보내기',exact:true}).last().click();
  await expect.poll(()=>calls.filter(c=>c.path.endsWith('app_update_news_resend')).map(c=>c.body)).toEqual([{p_id:'a1'}]);
  await expect(first).toHaveText('보냄');
  await expect(sent.locator('[data-un-withdraw="a1"]')).toBeVisible();
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
