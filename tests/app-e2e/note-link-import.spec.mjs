import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// NOTE-링크원문: 폰 공유·빠른 입력 등으로 만든 '링크만 든 노트'도 원문을 가져온다 — 자동으로 가져오지 않고 노트 위 작은 한 줄로 묻는다
// ('원문을 가져올까요? [가져오기] [괜찮아요]', 기본은 안 가져옴). [가져오기]는 새 노트 창 주소 칸(#2371)과 같은 한 길(note-import.js)이다.
// 글이 있는 노트는 ⋯ [원문 가져오기]로, 쓴 글을 덮지 않고 아래에 붙인다. 서버(Edge note-import)는 흉내 낸 것이고 글·이름·주소는 모두 가짜(example.com)다.
// 폰 412 · 폴드 884 · PC 1280.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at='2026-10-03T01:00:00Z';
const URL1='https://news.example.com/mnews/article/001/0000000001',URL2='https://blog.example.com/post/77';
const TITLE='예시 지역 교통 계획, 주민 의견 수렴 시작';
const article=url=>({ok:true,state:'ok',reason:null,url,title:TITLE,site:'예시일보',author:'예시 기자',published_at:'2026-10-05T03:00:00Z',lang:'ko',chars:80,truncated:false,blocks:[
 {t:'p',text:'예시 지역의 교통 계획 초안이 공개되고 주민 의견 수렴이 시작됐다.'},
 {t:'p',text:'둘째 문단도 예시다.'}]});
const failed=(url,reason)=>({ok:true,state:'failed',reason,url,title:null,site:null,author:null,published_at:null,lang:null,blocks:[],chars:0,truncated:false});
const row=(id,title,raw_text,extra={})=>({id,workspace_id:'w',kind:'note',title,raw_text,occurred_at:at,created_at:at,updated_at:'2026-10-03T02:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null,...extra});

// 노트 표(app_notes)와 note-import를 흉내 낸다. 쓰기는 writes, 서버 가져오기 요청은 calls에 남는다.
async function fixture(page,width,{reply=article,notes:start=null,beforeLoad=null}={}){
 await page.setViewportSize({width,height:900});
 const notes=start??[
  row('n-link','공유한 기사 제목',URL1,{updated_at:'2026-10-03T03:00:00Z'}),
  row('n-mine','내 메모',`내가 쓴 생각 한 줄\n${URL2}`),
  row('n-plain','장보기 목록','예시 목록',{updated_at:'2026-10-02T02:00:00Z'})];
 const writes=[],calls=[],errors=[],gates=[];let stamp=10,next=reply;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 const install=async()=>{
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
   const req=r.request(),q=new URL(req.url()).searchParams,method=req.method();
   const pick=x=>(!q.get('kind')||'eq.'+x.kind===q.get('kind'))&&(!q.get('id')||'eq.'+x.id===q.get('id'))&&(!q.get('updated_at')||'eq.'+x.updated_at===q.get('updated_at'));
   if(method==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:notes.filter(pick).slice(Number(q.get('offset')||0)).map(x=>structuredClone(x))});}
   if(method==='POST'){const body=req.postDataJSON();writes.push({method,body});const made={...row('new-'+writes.filter(w=>w.method==='POST').length,'',''),updated_at:`2026-10-06T01:00:${String(stamp++).padStart(2,'0')}Z`,...body};notes.unshift(made);return r.fulfill({status:201,json:[structuredClone(made)]});}
   if(method==='PATCH'){const body=req.postDataJSON();writes.push({method,query:Object.fromEntries(q),body});const hit=notes.filter(pick);for(const x of hit){Object.assign(x,body);if(body.updated_at)x.updated_at=`2026-10-06T01:01:${String(stamp++).padStart(2,'0')}Z`;}return r.fulfill({json:hit.map(x=>structuredClone(x))});}
   return r.fulfill({status:500,json:{}});
  });
  await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
  await page.route(SB+'/functions/v1/note-import',async r=>{
   const req=r.request(),body=req.postDataJSON(),n=calls.length;
   calls.push({body,auth:/^Bearer .+/.test(req.headers().authorization||'')});
   if(gates[n])await gates[n].wait;
   const out=next(body.url,n);
   return out.status?r.fulfill({status:out.status,json:out.json}):r.fulfill({json:out});
  });
 };
 await openHome(page,{features:[],beforeLoad:async()=>{await install();if(beforeLoad)await beforeLoad();}});
 const hold=n=>{let open;gates[n]={wait:new Promise(res=>{open=res;})};return open;};
 return {notes,writes,calls,errors,hold,setReply:fn=>{next=fn;}};
}
async function openNotes(page){
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await openKindMenu(page,'note');const kind=basketKindButton(page,'note');await expect(kind).toBeVisible();await kind.click();
}
async function openNote(page,id){
 const r=page.locator(`[data-note-row="${id}"]`);await expect(r).toBeVisible();await r.click();
 const detail=page.locator('[data-note-detail]');await expect(detail).toBeVisible();
 return detail;
}
async function back(page,width){
 const detail=page.locator('[data-note-detail]');
 if(width<761)await detail.locator('[data-note-back]').click();else await page.goBack();
 await expect(detail).toBeHidden();
}
const noFrameWidth=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const shot=async(page,name)=>{if(!process.env.CAPTURE_DIR)return;await page.locator('#kptuNotice:not([hidden])').waitFor({state:'hidden'});await page.screenshot({path:`${process.env.CAPTURE_DIR}/${name}.png`});};
const ask=detail=>detail.locator('[data-note-source] [data-ni-ask]');

for(const width of [412,884,1280]){
 test(`링크만 든 노트: 위에 '원문을 가져올까요?' 한 줄 → [가져오기]면 원문이 채워지고 제목은 그대로 ${width}`,async({page})=>{
  const f=await fixture(page,width),release=f.hold(0);
  await openNotes(page);
  const detail=await openNote(page,'n-link');
  // 묻기만 한다: 열었다고 가져오지 않는다.
  await expect(ask(detail)).toBeVisible();
  await expect(ask(detail)).toContainText('원문을 가져올까요?');
  await expect(ask(detail).locator('button')).toHaveText(['가져오기','괜찮아요']);
  await expect(ask(detail).locator('[data-ni-ask-go]')).toHaveClass(/secondary/);
  await expect(detail.locator('[data-basket-read-text]')).toHaveText(URL1);
  // 큰 확인 창이 아니라 작은 한 줄.
  expect((await ask(detail).boundingBox()).height).toBeLessThan(width<500?80:48);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(f.calls).toEqual([]);expect(f.writes).toEqual([]);
  expect(await noFrameWidth(page)).toBe(true);
  await shot(page,`link-ask-${width}`);
  await ask(detail).locator('[data-ni-ask-go]').click();
  // 원문 정보를 '가져오는 중'으로 남기고(고치기가 아니라 updated_at 그대로), 서버에는 주소 하나만.
  await expect.poll(()=>f.calls.length).toBe(1);
  expect(f.calls[0]).toEqual({body:{url:URL1},auth:true});
  const mark=f.writes.find(w=>w.method==='PATCH');
  expect(mark.body.metadata.source).toEqual({url:URL1,state:'fetching'});
  expect(mark.body.updated_at).toBeUndefined();
  await expect(detail.locator('[data-ni-busy]')).toContainText('가져오는 중');
  await expect(ask(detail)).toHaveCount(0);
  release();
  expect(await noticeText(page)).toBe('글을 가져왔어요.');
  const src=detail.locator('[data-note-source]'),body=detail.locator('[data-basket-read-text]');
  await expect(src.locator('a.ni-src-link')).toHaveAttribute('href',URL1);
  await expect(src.locator('.ni-src-day')).toHaveText('10. 6. 가져옴');
  await expect(body).toContainText('예시 지역의 교통 계획 초안이 공개되고');
  await expect(body).not.toContainText(URL1);
  // 저장: 읽은 판에만, 공유 앱이 준 제목은 그대로, 가져온 글이 든 노트는 AI 재료에서 뺀다.
  const save=f.writes.filter(w=>w.method==='PATCH').at(-1);
  expect(save.query).toMatchObject({id:'eq.n-link',kind:'eq.note'});
  expect(save.body.title).toBe('공유한 기사 제목');
  expect(save.body.ai_export_allowed).toBe(false);
  expect(save.body.metadata.source).toMatchObject({url:URL1,state:'ok',site:'예시일보'});
  expect(f.writes.filter(w=>w.method==='POST')).toHaveLength(0);
  expect(await noFrameWidth(page)).toBe(true);
  await shot(page,`link-done-${width}`);
  expect(f.errors).toEqual([]);
 });
}

test('[괜찮아요]: 링크만 남고, 다시 열어도 묻지 않는다(서버에 남김, 가져오기 요청 없음)',async({page})=>{
 const f=await fixture(page,412);
 await openNotes(page);
 let detail=await openNote(page,'n-link');
 await ask(detail).locator('[data-ni-ask-no]').click();
 await expect(ask(detail)).toHaveCount(0);
 await expect(detail.locator('[data-note-source]')).toBeHidden();
 await expect(detail.locator('[data-basket-read-text]')).toHaveText(URL1);
 const w=f.writes.at(-1);
 expect(w.method).toBe('PATCH');expect(w.body.metadata.link_import).toBe('no');expect(w.body.updated_at).toBeUndefined();
 await back(page,412);
 detail=await openNote(page,'n-link');
 await expect(detail.locator('[data-basket-read-text]')).toHaveText(URL1);
 await expect(ask(detail)).toHaveCount(0);
 // 묻지 않아도 ⋯에는 [원문 가져오기]가 있다(마음이 바뀌면).
 await detail.locator('[data-note-more]').click();
 await expect(page.locator('#noteDocMenu [data-note-import]')).toHaveText('원문 가져오기');
 expect(f.calls).toEqual([]);
 expect(f.errors).toEqual([]);
});

test('가져오지 못하면 링크만 남고 [다시 시도][주소만 두기] — [다시 시도]로 채워진다',async({page})=>{
 const f=await fixture(page,412,{reply:url=>failed(url,'timeout')});
 await openNotes(page);
 const detail=await openNote(page,'n-link');
 await ask(detail).locator('[data-ni-ask-go]').click();
 expect(await noticeText(page)).toBe('사이트가 답하지 않아요. 잠시 뒤 다시 시도해 주세요.');
 const warn=detail.locator('.ni-warn');
 await expect(warn).toContainText('사이트가 답하지 않아요');
 await expect(warn.locator('[data-ni-retry]')).toBeVisible();await expect(warn.locator('[data-ni-keep]')).toBeVisible();
 await expect(detail.locator('[data-basket-read-text]')).toHaveText(URL1);
 await shot(page,'link-fail-412');
 f.setReply(article);
 await warn.locator('[data-ni-retry]').click();
 await expect(detail.locator('[data-basket-read-text]')).toContainText('예시 지역의 교통 계획 초안이 공개되고');
 await expect(detail.locator('.ni-warn')).toHaveCount(0);
 expect(f.calls.map(c=>c.body)).toEqual([{url:URL1},{url:URL1}]);
 expect(f.errors).toEqual([]);
});

for(const width of [412,1280]){
 test(`글이 있는 노트: ⋯ [원문 가져오기] — 쓴 글은 그대로 두고 아래에 붙인다 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await openNotes(page);
  const detail=await openNote(page,'n-mine');
  // 글이 있는 노트에는 묻는 줄이 없다(⋯에서 고른다).
  await expect(ask(detail)).toHaveCount(0);
  await detail.locator('[data-note-more]').click();
  const item=page.locator('#noteDocMenu [data-note-import]');
  await expect(item).toHaveText('원문 가져오기');
  await item.click();
  expect(await noticeText(page)).toBe('글을 가져왔어요.');
  const body=detail.locator('[data-basket-read-text]');
  await expect(body).toContainText('내가 쓴 생각 한 줄');
  await expect(body).toContainText('예시 지역의 교통 계획 초안이 공개되고');
  await expect(detail.locator('[data-note-source] a.ni-src-link')).toHaveAttribute('href',URL2);
  expect(f.calls.map(c=>c.body)).toEqual([{url:URL2}]);
  const save=f.writes.filter(w=>w.method==='PATCH').at(-1);
  expect(save.body.title).toBe('내 메모');
  expect(save.body.raw_text.startsWith(`내가 쓴 생각 한 줄\n${URL2}\n\n`)).toBe(true);
  expect(save.body.raw_text).toContain('둘째 문단도 예시다.');
  expect(save.body.doc).toBeUndefined();
  expect(await noFrameWidth(page)).toBe(true);
  await shot(page,`link-append-${width}`);
  expect(f.errors).toEqual([]);
 });
}

test('링크가 없는 노트의 ⋯에는 [원문 가져오기]가 없다',async({page})=>{
 const f=await fixture(page,412);
 await openNotes(page);
 const detail=await openNote(page,'n-plain');
 await expect(ask(detail)).toHaveCount(0);
 await detail.locator('[data-note-more]').click();
 await expect(page.locator('#noteDocMenu')).toBeVisible();
 await expect(page.locator('#noteDocMenu [data-note-import]')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});

test.describe('폰 공유로 만든 링크 노트',()=>{
 const ANDROID='Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.10';
 test.use({userAgent:ANDROID,viewport:{width:412,height:915}});
 test('공유 창 [저장] → 링크만 든 노트 → 열면 묻는 줄 → [가져오기]로 채워진다',async({page})=>{
  const list={id:'ShareTargetId_0123456789ab',subject:'공유 앱이 준 기사 제목',text:URL1,target:'note',items:[]};
  await page.addInitScript(list=>{
   const listeners=[];window.__shareList=list;
   window.KPTUAppShell={postMessage(message){if(String(message).startsWith('share:get:')&&window.__shareList){const reply='share:list:'+JSON.stringify(window.__shareList);window.__shareList=null;setTimeout(()=>listeners.forEach(fn=>fn({data:reply})),0);}},addEventListener(type,fn){if(type==='message')listeners.push(fn);}};
  },list);
  const f=await fixture(page,412,{notes:[row('n-plain','장보기 목록','예시 목록')],beforeLoad:()=>page.route(SB+'/rest/v1/app_note_folders**',r=>r.fulfill({json:[]}))});
  const dialog=page.locator('#shareTargetDialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'저장'}).tap();
  await expect(dialog).toBeHidden();
  expect(await noticeText(page)).toBe('노트에 넣었어요');
  await page.locator('#kptuNotice:not([hidden])').waitFor({state:'hidden'});
  // 공유로 저장할 때는 가져오지 않는다(묻기만).
  const made=f.writes.find(w=>w.method==='POST');
  expect(made.body).toMatchObject({title:'공유 앱이 준 기사 제목',raw_text:URL1});
  expect(made.body.metadata?.source).toBeUndefined();
  expect(f.calls).toEqual([]);
  await openNotes(page);
  const detail=await openNote(page,'new-1');
  await expect(ask(detail)).toContainText('원문을 가져올까요?');
  await ask(detail).locator('[data-ni-ask-go]').click();
  expect(await noticeText(page)).toBe('글을 가져왔어요.');
  await expect(detail.locator('[data-basket-read-text]')).toContainText('예시 지역의 교통 계획 초안이 공개되고');
  expect(f.writes.filter(w=>w.method==='PATCH').at(-1).body.title).toBe('공유 앱이 준 기사 제목');
  expect(f.calls.map(c=>c.body)).toEqual([{url:URL1}]);
  expect(f.errors).toEqual([]);
 });
});
