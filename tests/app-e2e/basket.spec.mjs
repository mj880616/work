import {testOrigin} from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import {noteAction} from './helpers/basket-more.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { pickBasketView, expectBasketView, openBasketUpdate } from './helpers/forget-view.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch:true});
async function fixture(page){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const home=await openHome(page),writes=[];
 const notes=[{id:'s',raw_text:'제안 원문',occurred_at:'2026-10-06T05:00:00Z',ai_export_allowed:true},{id:'a',raw_text:' 보관 원문\n ',occurred_at:'2026-10-06T03:00:00Z',archived_at:'2026-10-06',ai_export_allowed:true},{id:'c',raw_text:'확정 원문',occurred_at:'2026-10-06T02:00:00Z',ai_export_allowed:true},{id:'n',raw_text:' 첫 줄\n\n둘째 줄  ',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:false}];
 let denied=false,empty=false,linksDenied=false;
 await page.route(SB+'/rest/v1/app_notes**',async r=>{
  const req=r.request(),u=new URL(req.url());if(req.method()==='GET')return r.fulfill({json:notes.slice(Number(u.searchParams.get('offset')||0),Number(u.searchParams.get('offset')||0)+100)});
  const body=req.postDataJSON();writes.push({method:req.method(),body,url:req.url()});
  if(denied)return r.fulfill({status:403,json:{message:'RLS 거부'}});
  if(empty)return r.fulfill({json:[]});
  if(req.method()==='POST'){const n={id:'new',occurred_at:'2026-10-06T04:00:00Z',...body};notes.unshift(n);return r.fulfill({json:[n]});}
  const n=notes.find(n=>'eq.'+n.id===u.searchParams.get('id'));Object.assign(n,body);return r.fulfill({json:[n]});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>{
  if(!new URL(r.request().url()).searchParams.has('note_id'))return r.fallback();
  if(linksDenied)return r.fulfill({status:403,json:{message:'연결 조회 거부'}});
  return r.fulfill({json:[{note_id:'c',status:'confirmed',project_id:'p',project:{name:'테스트 프로젝트'}},{note_id:'c',status:'confirmed',organization_id:'o',organization:{name:'테스트 조직'}},{note_id:'c',status:'confirmed',document_id:'d',document:null},{note_id:'s',status:'suggested',project_id:'p',project:{name:'제안 프로젝트'}}]});
 });
 return {...home,notes,writes,errors,setDenied:v=>denied=v,setEmpty:v=>empty=v,setLinksDenied:v=>linksDenied=v};
}
async function enter(page,width,count=2){if(width<761){await page.locator('.mobile-tabs [data-view="basket"]').click();}else await page.locator('.app-nav [data-view="basket"]').click();await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-row]')).toHaveCount(count);}
for(const width of [390,1280]){
}
test('basket links failure shows error and retry rather than false unclassified list',async({page})=>{const f=await fixture(page);f.setLinksDenied(true);await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-list-status]')).toHaveText('업데이트를 불러오지 못했어요. 다시 시도해 주세요.');await expect(page.locator('[data-basket-row]')).toHaveCount(0);f.setLinksDenied(false);await page.locator('[data-basket-retry]').click();await expect(page.locator('[data-basket-row]')).toHaveCount(2);});
test('session scope change clears basket content and prevents a delayed response from restoring it',async({page})=>{
 await fixture(page);let release;const pending=new Promise(r=>release=r);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await pending;await r.fulfill({json:[{id:'stale',raw_text:'BASKET_STALE_PRIVATE',occurred_at:'2026-10-06'}]});});
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-list-status] [data-wait]')).toHaveCount(1);
 await page.evaluate(()=>{const rt=window.KPTURuntime;const c=rt.context.read();rt.context.set({...c,user:{...c.user,id:'different'}});window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:rt.session.read()}}));});release();
 await expect(page.locator('[data-basket-row]')).toHaveCount(0);await expect(page.locator('#basketView')).not.toContainText('BASKET_STALE_PRIVATE');
});
test('unsaved detail survives canceled list/Escape dismissal and navigation until explicit discard',async({page})=>{
 await fixture(page);await page.locator('.app-nav [data-view="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await pickBasketView(page,'unclassified');await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');const input=page.locator('[data-basket-text]');await input.fill('수정 중인 원문');
 await page.locator('[data-basket-close]').click();await answerAsk(page,false);await expect(input).toHaveValue('수정 중인 원문');
 await input.press('Escape');await answerAsk(page,false);await expect(input).toHaveValue('수정 중인 원문');
 const address=page.url();await page.evaluate(()=>window.KPTURouter.go('home'));await answerAsk(page,false);await expect(page.locator('#basketView')).toBeVisible();expect(page.url()).toBe(address);await expect(input).toHaveValue('수정 중인 원문');
 await page.locator('[data-basket-close]').click();await answerAsk(page,true);await expect(page.locator('[data-basket-row="n"]')).toBeFocused();await expectBasketView(page,'unclassified');await expect(page.locator('[data-basket-row]')).toHaveCount(2);await page.locator('[data-basket-row="n"]').click();await expect(page.locator('[data-basket-read-text]')).toHaveText(' 첫 줄\n\n둘째 줄  ');await expect(input).toBeHidden();await expect(input).toHaveValue(' 첫 줄\n\n둘째 줄  ');
});
test('opening and saving unchanged CRLF text does not rewrite original or create a false dirty draft',async({page})=>{
 const f=await fixture(page);f.notes.find(n=>n.id==='n').raw_text=' first\r\n\r\nlast \r';await page.locator('.app-nav [data-view="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');await expect(page.locator('[data-basket-text]')).toHaveValue(' first\n\nlast \n');
 expect(await page.evaluate(()=>{const detail={otherDraft:false};window.dispatchEvent(new CustomEvent('kptu:before-reload',{cancelable:true,detail}));return detail.otherDraft;})).toBe(false);
 await page.locator('[data-basket-save]').click();await expect(page.locator('#toast')).toContainText('저장');expect(f.writes).toHaveLength(0);expect(f.notes.find(n=>n.id==='n').raw_text).toBe(' first\r\n\r\nlast \r');
});
const uploadFiles = names => names.map(name=>({name,mimeType:'text/plain',buffer:Buffer.from('fixture file')}));
async function basketUploadFixture(page,f){
 const calls=[];let response=null,release=null;
 await page.route(SB+'/functions/v1/basket-files',async r=>{
  const raw=r.request().postDataBuffer().toString();calls.push(raw);
  if(release)await release;
  if(response && calls.length > (response.after || 0))return r.fulfill({status:response.status,json:{error:'첨부를 저장하지 못했어요.',code:response.code,note_id:'uploaded'}});
  const match=raw.match(/name="note_id"\r\n\r\n([^\r]+)/),id=match?.[1]||'uploaded';
  let n=f.notes.find(n=>n.id===id);if(!n){n={id,raw_text:raw.match(/name="raw_text"\r\n\r\n([\s\S]*?)\r\n--/)?.[1]||'',occurred_at:'2026-10-10T10:00:00Z',ai_export_allowed:true,attachments:[]};f.notes.unshift(n);}
  n.attachments||=[];n.attachments.push({drive_file_id:'file_'+calls.length,file_name:raw.match(/filename="([^"]+)"/)?.[1],size_bytes:12});
  return r.fulfill({json:{ok:true,note_id:id,attachments:n.attachments}});
 });
 return {calls,setError:v=>response=v,setPending:v=>release=v};
}
for(const width of [390,1280]){
 // BIZ-저장먼저닫기 2차(S59-10): 글은 먼저 저장되고 입력칸은 바로 풀린다. 뒤 줄에서 둘째 파일이 실패하면 그 뒤 파일은 보내지 않고, 하단바 위 한 줄에
// '업데이트에 파일 2개 못 올렸어요' + 올라간 것·까닭. 결과를 모르거나(503) 글이 바뀐(409) 실패는 [다시 올리기]가 없고, 나머지는 못 올린 것만 다시 보낸다.
}
// BIZ-저장먼저닫기 2차(S59-10): 글은 쓴 그대로(앞뒤 빈칸·줄바꿈 포함) 먼저 저장되고, 파일은 그 업데이트로 올라간다. 결과를 모르는 실패(503)는
// 하단바 위 한 줄에 남되 다시 보내지 않는다. 입력칸은 잠그지 않으므로 바로 새 업데이트를 쓸 수 있다(옛 잠금·[새 업데이트 입력]은 없앰).
test('basket detail 409 reload preserves existing AI setting and unsaved text until explicit confirmation',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f);await page.locator('.app-nav [data-view="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');await page.locator('[data-basket-text]').fill('미저장 수정');await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['one.txt']));await page.locator('[data-basket-upload]').click();await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toContainText('업데이트에');await expect(page.locator('[data-basket-text]')).toHaveValue('미저장 수정');expect(f.notes.find(n=>n.id==='n').ai_export_allowed).toBe(false);
 u.setError({status:409,code:'note_changed'});await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['conflict.txt']));await page.locator('[data-basket-upload]').click();await expect(page.locator('#uploadDock:not([hidden])')).toContainText('업데이트를 다시 불러');await expect(page.locator('[data-basket-reload]')).toBeVisible();await page.locator('[data-basket-upload]').click();expect(u.calls).toHaveLength(2);
 f.notes.find(n=>n.id==='n').raw_text='외부에서 바뀐 원문';await page.locator('[data-basket-reload]').click();await answerAsk(page,false);await expect(page.locator('[data-basket-text]')).toHaveValue('미저장 수정');await page.locator('[data-basket-reload]').click();await answerAsk(page,true);await expect(page.locator('[data-basket-text]')).toHaveValue('외부에서 바뀐 원문');await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);await expect(page.locator('[data-basket-file]')).toHaveCount(0);expect(u.calls).toHaveLength(2);expect(f.writes).toHaveLength(0);
});
test('basket attachment save invalidates an earlier list read and keeps counts when reopened',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f);await page.locator('.app-nav [data-view="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await page.locator('[data-basket-row="n"]').click();await page.locator('[data-basket-close]').click();
 let release;const pending=new Promise(r=>release=r),old=structuredClone(f.notes);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await pending;return r.fulfill({json:old});});await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-list-status] [data-wait]')).toHaveCount(1);
 await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['fresh.txt']));await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);const linksDone=page.waitForResponse(r=>r.url().includes('app_record_links')&&r.url().includes('note_id'));release();await linksDone;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(page.locator('[data-basket-row-item="n"]')).toContainText('첨부 1개');await page.locator('[data-basket-close]').click();await page.locator('[data-basket-row="n"]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);expect(u.calls).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('basket opening detail invalidates older reads that finish before attachment save',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f);await page.locator('.app-nav [data-view="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await page.locator('[data-basket-row="n"]').click();await page.locator('[data-basket-close]').click();
 let release;const pending=new Promise(r=>release=r),old=structuredClone(f.notes);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await pending;return r.fulfill({json:old});});await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-list-status] [data-wait]')).toHaveCount(1);await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');
 const linksDone=page.waitForResponse(r=>r.url().includes('app_record_links')&&r.url().includes('note_id'));release();await linksDone;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['fresh.txt']));await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);await expect(page.locator('[data-basket-row-item="n"]')).toContainText('첨부 1개');await page.locator('[data-basket-close]').click();await page.locator('[data-basket-row="n"]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);expect(u.calls).toHaveLength(1);expect(f.errors).toEqual([]);
});
// S67-01: 같은 파일 찾기(뒤에서)가 [추가]·올림보다 늦게 끝나면 방금 올린 자기 업데이트 첨부를 찾아낸다. 그때 '이미 있는 자료예요'를 띄우면
// 다음 입력을 가린다(CI에서 다음 [추가]를 막던 흔들림). 찾는 사이 대기에서 나간 파일은 묻지 않는다.
for(const width of [390,1280])test(`basket original link opens the exact suggested or archived note after owner reads ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const f=await fixture(page);
 await page.goto(testOrigin+'/app/?view=basket&note=s');
 await expect(page.locator('[data-basket-text]')).toHaveValue('제안 원문');await expect(page.locator('[data-basket-state]')).toContainText('정리 제안 있음');
 await page.screenshot({path:info.outputPath(`basket3-suggested-${width}.png`),fullPage:true});
 await page.goto(testOrigin+'/app/?view=basket&note=a');await expect(page.locator('[data-basket-text]')).toHaveValue(' 보관 원문\n ');
 await page.goto(testOrigin+'/app/?view=basket&note=foreign');await expect(page.locator('[data-basket-list-status]')).toContainText('업데이트를 찾을 수 없어요');expect(f.writes).toHaveLength(0);
});
// UX-먼저묻고뒤에처리 3차 (2): [첨부 저장]한 파일은 그 업데이트 id로 뒤에서 올라간다. 예전에는 다 올라갈 때까지 상세의 모든 단추·입력과 뒤로가기를 잠갔다.
const toBasket=page=>page.locator('.app-nav [data-view="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();
const fileOf=raw=>raw.match(/filename="([^"]+)"/)?.[1],noteOf=raw=>raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1];
for(const width of [412,1280]){
 test(`basket attachment goes up behind the screen: nothing is locked, the update closes, another opens, the file goes to its own update ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  const f=await fixture(page),u=await basketUploadFixture(page,f);let open;u.setPending(new Promise(r=>open=r));
  await toBasket(page);await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');
  await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['behind.txt']));await page.locator('[data-basket-upload]').click();
  await expect.poll(()=>u.calls.length).toBe(1);
  // 올리는 동안 잠기지 않는다: 고른 파일 줄은 비고, 클립·글 칸·[첨부 저장]을 쓸 수 있고, 올라가는 파일은 이 업데이트의 올리는 줄에 보인다.
  await expect(page.locator('[data-basket-file]')).toHaveCount(0);
  await expect(page.locator('#detailBasketFiles')).toBeEnabled();await expect(page.locator('[data-basket-text]')).toBeEnabled();await expect(page.locator('[data-basket-upload]')).toBeEnabled();
  await expect(page.locator('[data-basket-sent] .up-row')).toContainText('behind.txt');
  if(process.env.CAPTURE_DIR)await page.screenshot({path:`${process.env.CAPTURE_DIR}/basket-attach-${width}.png`});
  // 같은 업데이트를 바꾸는 일만 다 올라갈 때까지 기다리게 한다(서버가 올리는 사이 바뀐 글의 올리기를 거절하므로).
  await page.locator('[data-basket-text]').fill('올리는 중 수정');await page.locator('[data-basket-save]').click();
  await expect(page.locator('[data-basket-status]')).toContainText('첨부를 올리는 중이에요');expect(f.writes).toHaveLength(0);
  await page.locator('[data-basket-text]').fill(' 첫 줄\n\n둘째 줄  ');
  // 읽기 화면 → 목록 → 다른 업데이트. 예전에는 올리는 동안 닫기·뒤로가기를 받지 않았다.
  await page.locator('[data-basket-cancel]').click();await page.locator('[data-basket-close]').click();
  await page.locator('[data-basket-row="s"]').click();await expect(page.locator('[data-basket-read-text]')).toContainText('제안 원문');
  await expect(page.locator('#uploadDock')).toContainText('올리는 중');
  open();
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toContainText('업데이트에 behind.txt 올렸어요'); // UX-알림하나로: 끝은 하단바 위 한 줄 하나
  await expect(page.locator('#kptuNotice:not([hidden])')).toHaveCount(0);
  expect(u.calls).toHaveLength(1);expect(noteOf(u.calls[0])).toBe('n');
  // 보고 있는 다른 업데이트는 그대로이고, 목록의 그 업데이트 줄에 첨부가 붙는다.
  await expect(page.locator('[data-basket-read-text]')).toContainText('제안 원문');await expect(page.locator('[data-basket-attachments] a')).toHaveCount(0);
  await expect(page.locator('[data-basket-row-item="n"]')).toContainText('첨부 1개');
  await page.locator('[data-basket-close]').click();await page.locator('[data-basket-row="n"]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);
  expect(f.errors).toEqual([]);
 });
}
test('basket attachment that did not go up is told by the bottom line, and [다시 업로드] sends only that file to the same update (412)',async({page})=>{
 await page.setViewportSize({width:412,height:1000});
 const f=await fixture(page),u=await basketUploadFixture(page,f);let open;u.setPending(new Promise(r=>open=r));u.setError({status:400,code:'bad_file',after:1});
 await toBasket(page);await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['one.txt','two.txt']));await page.locator('[data-basket-upload]').click();
 await expect.poll(()=>u.calls.length).toBe(1);
 await page.locator('[data-basket-cancel]').click();await page.locator('[data-basket-close]').click();await expect(page.locator('[data-basket-row="s"]')).toBeVisible();
 open();
 const notice=page.locator('#uploadDock:not([hidden])'); // UX-알림하나로(S59-21): 끝·실패는 하단바 위 한 줄 하나
 await expect(notice).toContainText('업데이트에 one.txt 올렸어요 · 1개 못 올렸어요');
 await expect(page.locator('#kptuNotice:not([hidden])')).toHaveCount(0);
 if(process.env.CAPTURE_DIR)await page.screenshot({path:`${process.env.CAPTURE_DIR}/update-attach-fail-412.png`});
 u.setError(null);await notice.getByRole('button',{name:'못 올린 파일 다시 업로드'}).click();
 await expect(notice).toContainText('업데이트에 two.txt 올렸어요');
 expect(u.calls.map(fileOf)).toEqual(['one.txt','two.txt','two.txt']);expect(u.calls.map(noteOf)).toEqual(['n','n','n']); // 올라간 파일은 다시 보내지 않는다
 await expect(page.locator('[data-basket-row-item="n"]')).toContainText('첨부 2개');
});
// 줄 선 묶음은 차례가 왔을 때의 첨부 목록에서 시작한다: 예전 코드는 고를 때의 목록으로 화면을 그려, 둘째가 올라가는 동안(실패하면 다시 읽을 때까지)
// 앞서 올라간 첨부가 사라졌다. 올리는 동안 큰 창 수정은 열지 않고(연 때의 판으로만 저장하므로 올리기가 끝나면 거절된다), 최신화는 예전 잠금 때처럼 막는다.
test('basket attachments in line keep what already went up on screen; the big editor and a refresh wait for the line (412)',async({page})=>{
 await page.setViewportSize({width:412,height:1000});
 const f=await fixture(page),u=await basketUploadFixture(page,f);let openFirst,openSecond;u.setPending(new Promise(r=>openFirst=r));
 const reloadAllowed=()=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:before-reload',{cancelable:true,detail:{projectDraft:false,otherDraft:false}})));
 await toBasket(page);await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');
 expect(await reloadAllowed()).toBe(true);
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['one.txt']));await page.locator('[data-basket-upload]').click();
 await expect.poll(()=>u.calls.length).toBe(1);
 expect(await reloadAllowed()).toBe(false); // 새로 고치면 줄에 선 파일이 알림 없이 사라진다
 await page.locator('[data-basket-big-write]').click();
 await expect(page.locator('[data-basket-status]')).toContainText('첨부를 올리는 중이에요');await expect(page.locator('#edWindow:not(.hidden)')).toHaveCount(0);
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['two.txt']));await expect(page.locator('[data-basket-file]')).toContainText('two.txt');
 await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-file]')).toHaveCount(0);
 // 첫 파일만 끝내고, 둘째는 붙잡아 둔 뒤 실패시킨다.
 u.setPending(new Promise(r=>openSecond=r));u.setError({status:400,code:'bad_file',after:1});openFirst();
 await expect.poll(()=>u.calls.length).toBe(2);
 await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);
 await page.waitForTimeout(200);await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1); // 둘째가 올라가는 동안에도 첫 첨부는 그대로
 expect(await reloadAllowed()).toBe(false);
 openSecond();
 await expect(page.locator('#uploadDock:not([hidden])')).toContainText('못 올렸어요'); // UX-알림하나로: 하단바 위 한 줄 하나
 await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1); // 둘째가 실패해도 첫 첨부는 남는다
 expect(u.calls.map(fileOf)).toEqual(['one.txt','two.txt']);expect(u.calls.map(noteOf)).toEqual(['n','n']);
 expect(await reloadAllowed()).toBe(true); // 줄이 끝났으면 막지 않는다(못 올린 파일은 알림 [다시])
});
// 올리는 중인 업데이트는 줄 ⋯ 메뉴뿐 아니라 줄 단추로 눌러도 같은 잠금이다: 묻는 창을 띄우지 않고 까닭을 말한다.
// FORGET-업무노트: 줄 단추 [노트로] 자리는 [업무 노트에] — 노트에 아무것도 더하지 않고 까닭을 말한다.
test('basket row button [업무 노트에] also waits while that update\'s attachment goes up (1280)',async({page})=>{
 await page.setViewportSize({width:1280,height:1000});
 const f=await fixture(page),u=await basketUploadFixture(page,f);let open;u.setPending(new Promise(r=>open=r));
 await toBasket(page);await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['one.txt']));await page.locator('[data-basket-upload]').click();
 await expect.poll(()=>u.calls.length).toBe(1);
 await page.locator('[data-basket-cancel]').click();await page.locator('[data-basket-close]').click();
 // 줄 단추 [노트로]는 마우스가 있는 PC에서만 줄에 보인다(ui-standard.css: 좁은 창·마우스 없음이면 ⋯ 안). 이 시험 브라우저는 마우스 없음으로 잡히므로 그 단추의 누름을 직접 보낸다.
 await page.locator('[data-nbx-row="u:n"] [data-nbx-act="note-work"]').dispatchEvent('click');
 await expect(page.locator('[data-basket-list-status]')).toContainText('첨부를 올리는 중이에요');
 await expect(page.locator('.kptu-ask')).toHaveCount(0);await expect(page.locator('[data-basket-row="n"]')).toBeVisible();
 open();
 await expect(page.locator('[data-basket-row-item="n"]')).toContainText('첨부 1개');
 expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
test('basket attachments saved while the first goes up wait in the same line and reach the same update (412)',async({page})=>{
 await page.setViewportSize({width:412,height:1000});
 const f=await fixture(page),u=await basketUploadFixture(page,f);let open;u.setPending(new Promise(r=>open=r));
 await toBasket(page);await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['one.txt']));await page.locator('[data-basket-upload]').click();
 await expect.poll(()=>u.calls.length).toBe(1);
 // 올리는 중에 더 고르고 [첨부 저장]: 거절하지 않고 받아 두고, 앞 파일이 끝난 뒤에 보낸다.
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['two.txt']));await expect(page.locator('[data-basket-file]')).toContainText('two.txt');
 await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-file]')).toHaveCount(0);
 await page.waitForTimeout(300);expect(u.calls).toHaveLength(1);
 open();
 await expect(page.locator('[data-basket-attachments] a')).toHaveCount(2);
 expect(u.calls.map(fileOf)).toEqual(['one.txt','two.txt']);expect(u.calls.map(noteOf)).toEqual(['n','n']);
 await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toContainText('업데이트에');
 expect(f.errors).toEqual([]);
});
