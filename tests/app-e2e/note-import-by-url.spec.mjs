import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { edWin, edWinText } from './helpers/note-editor.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// NOTE-주소로 가져오기 2단계(화면, 설계 docs/design/note-import-by-url.md 2절·9절, 시안 docs/design/mockups/note-import-by-url.html 안 A).
// 새 노트 창 제목 아래 주소 칸 [주소 | 가져오기]: 누르면 '주소만' 든 노트 줄이 바로 생기고(창은 닫힘), 글은 뒤에서 읽어 제목·본문·원문 링크를 채운다.
// 실패하면 노트는 주소만 남고 안내 한 줄 + [다시 시도][주소만 두기]. 서버(Edge note-import)는 흉내 낸 것이고 글·이름·주소는 모두 가짜(example.com)다.
// 폰 412 · 폴드 884 · PC 1280.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at='2026-10-03T01:00:00Z';
const URL1='https://news.example.com/article/2026/10/05/1234',URL2='https://blog.example.com/post/77';
const TITLE='예시 지역 교통 계획, 주민 의견 수렴 시작';
const article=url=>({ok:true,state:'ok',reason:null,url,title:TITLE,site:'예시일보',author:'예시 기자',published_at:'2026-10-05T03:00:00Z',lang:'ko',chars:120,truncated:false,blocks:[
 {t:'p',text:'예시 지역의 교통 계획 초안이 공개되고 주민 의견 수렴이 시작됐다.'},
 {t:'h',text:'예시 소제목'},
 {t:'p',text:'둘째 문단 <script>window.__niHacked=1</script><img src=x onerror="window.__niHacked=2"> 끝.'},
 {t:'quote',text:'인용한 말도 예시다.'}]});
const failed=(url,reason)=>({ok:true,state:'failed',reason,url,title:null,site:null,author:null,published_at:null,lang:null,blocks:[],chars:0,truncated:false});

async function fixture(page,width,{reply=article}={}){
 await page.setViewportSize({width,height:900});
 const notes=[
  {id:'n-old',workspace_id:'w',kind:'note',title:'읽을 글 모음',raw_text:'예시 메모',occurred_at:at,created_at:at,updated_at:'2026-10-03T02:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null},
  {id:'n-old2',workspace_id:'w',kind:'note',title:'장보기 목록',raw_text:'예시 목록',occurred_at:at,created_at:at,updated_at:'2026-10-02T02:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null}];
 const writes=[],calls=[],errors=[],gates=[],other=[];let stamp=10,active=0,maxActive=0,next=reply;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await openHome(page); // 시각은 도우미 기본값(2026-10-06 10:00 서울)에 고정된다
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams,method=req.method();
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'))&&(!q.get('updated_at')||'eq.'+row.updated_at===q.get('updated_at'));
  if(method==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:notes.filter(pick).slice(Number(q.get('offset')||0)).map(x=>structuredClone(x))});}
  if(method==='POST'){const body=req.postDataJSON();writes.push({method,body});const row={id:'imp-'+writes.filter(w=>w.method==='POST').length,occurred_at:at,created_at:at,updated_at:`2026-10-06T01:00:${String(stamp++).padStart(2,'0')}Z`,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null,...body};notes.unshift(row);return r.fulfill({status:201,json:[structuredClone(row)]});}
  if(method==='PATCH'){const body=req.postDataJSON();writes.push({method,query:Object.fromEntries(q),body});const hit=notes.filter(pick);for(const row of hit){Object.assign(row,body);if(body.updated_at)row.updated_at=`2026-10-06T01:01:${String(stamp++).padStart(2,'0')}Z`;}return r.fulfill({json:hit.map(x=>structuredClone(x))});}
  return r.fulfill({status:500,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 // 가져온 노트로는 AI·공유·발송 쪽 서버를 부르지 않는다: 불리면 여기 적힌다.
 await page.route(u=>u.origin===SB&&/^\/functions\/v1\/(ai-assist|note-ai-title|page-share|telegram)/.test(u.pathname),r=>{other.push(new URL(r.request().url()).pathname+' '+(r.request().postData()||''));return r.fulfill({json:{ok:false}});});
 await page.route(SB+'/functions/v1/note-import',async r=>{
  const req=r.request(),body=req.postDataJSON(),n=calls.length;
  calls.push({body,auth:/^Bearer .+/.test(req.headers().authorization||''),method:req.method()});
  active++;maxActive=Math.max(maxActive,active);
  if(gates[n])await gates[n].wait;
  active--;
  const out=next(body.url,n);
  return out.status?r.fulfill({status:out.status,json:out.json}):r.fulfill({json:out});
 });
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await openKindMenu(page,'note');const kind=basketKindButton(page,'note');await expect(kind).toBeVisible();await kind.click();
 await expect(page.locator('[data-note-row="n-old"]')).toBeVisible();
 // hold(n): n번째 서버 요청을 붙잡아 둔다. 돌려준 함수를 부르면 답한다.
 const hold=n=>{let open;gates[n]={wait:new Promise(res=>{open=res;})};return open;};
 return {notes,writes,calls,errors,other,hold,setReply:fn=>{next=fn;},max:()=>maxActive};
}
const noFrameWidth=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
// 화면 사진(CAPTURE_DIR을 줄 때만): 떠 있는 작은 알림이 글을 가리지 않게 사라진 뒤 찍는다.
const shot=async(page,name)=>{if(!process.env.CAPTURE_DIR)return;await page.locator('#kptuNotice:not([hidden])').waitFor({state:'hidden'});await page.screenshot({path:`${process.env.CAPTURE_DIR}/${name}.png`});};
async function openWindow(page){
 await page.locator('[data-note-list] [data-quick-big]').click();
 const win=edWin(page);await expect(win).toBeVisible();
 await expect(win.locator('[data-edw-url]')).toBeVisible();
 return win;
}

for(const width of [412,884,1280]){
 test(`주소를 넣고 [가져오기]: 노트 줄이 바로 생기고, 끝나면 제목·본문·원문 링크가 채워진다 ${width}`,async({page})=>{
  const f=await fixture(page,width),release=f.hold(0);
  if(width!==884)await shot(page,`before-list-${width}`);
  const win=await openWindow(page);
  // 주소 칸은 제목 칸 아래·본문 위에 있고, 채운 주 버튼은 [저장] 하나다([가져오기]는 작은 버튼).
  const titleBox=await win.locator('[data-edw-title]').boundingBox(),urlBox=await win.locator('[data-edw-url]').boundingBox(),textBox=await edWinText(page).boundingBox();
  expect(urlBox.y).toBeGreaterThan(titleBox.y);expect(textBox.y).toBeGreaterThan(urlBox.y);
  await expect(win.locator('[data-edw-import-run]')).toHaveText('가져오기');
  await expect(win.locator('[data-edw-import-run]')).toHaveClass(/secondary/);
  await win.locator('[data-edw-url]').fill(URL1);
  expect(await noFrameWidth(page)).toBe(true);
  if(width!==884)await shot(page,`after-window-${width}`);
  await win.locator('[data-edw-import-run]').click();
  // 창은 닫히고 노트 줄이 바로 생긴다(서버는 아직 답하지 않았다).
  await expect(edWin(page)).toHaveCount(0);
  const row=page.locator('[data-note-row="imp-1"]');
  await expect(row).toBeVisible();await expect(row).toContainText('news.example.com에서 가져오는 중');
  expect(f.writes).toHaveLength(1);
  const made=f.writes[0].body;
  expect(made).toMatchObject({kind:'note',title:'news.example.com',raw_text:URL1,ai_export_allowed:false});
  expect(made.metadata.source).toEqual({url:URL1,state:'fetching'});
  // 서버에 보낸 것은 주소 하나뿐(작업공간·사용자 값 없음), 로그인 머리와 함께.
  await expect.poll(()=>f.calls.length).toBe(1);
  expect(f.calls[0]).toEqual({body:{url:URL1},auth:true,method:'POST'});
  if(width!==884)await shot(page,`after-busy-${width}`);
  // 가져오는 중에 그 노트를 열면: 원문 링크는 이미 보이고 본문 자리는 회색 빈 줄.
  await row.click();
  const detail=page.locator('[data-note-detail]'),src=detail.locator('[data-note-source]');
  await expect(src.locator('[data-ni-busy]')).toContainText('가져오는 중');
  await expect(src.locator('a.ni-src-link')).toHaveAttribute('href',URL1);
  await expect(src.locator('kptu-wait')).toHaveCount(1);
  await expect(detail.locator('[data-basket-read-text]')).toBeHidden();
  if(width!==884&&process.env.CAPTURE_DIR){await page.waitForTimeout(600);await shot(page,`after-busy-open-${width}`);} // 회색 빈 줄은 0.4초 뒤에 보인다(공용 기다림 표시)
  release();
  // 끝: 열어 둔 노트가 그 자리에서 채워진다(공용 작은 알림).
  expect(await noticeText(page)).toBe('글을 가져왔어요.');
  await expect(src.locator('[data-ni-busy]')).toHaveCount(0);
  await expect(src.locator('a.ni-src-link')).toHaveAttribute('href',URL1);
  await expect(src.locator('a.ni-src-link')).toHaveAttribute('rel','noopener noreferrer');
  await expect(src.locator('.ni-src-name')).toHaveText('예시일보 · news.example.com/article/2026/10/05/1234');
  await expect(src.locator('.ni-src-day')).toHaveText('10. 6. 가져옴');
  await expect(src.locator('.ni-by')).toHaveText('예시 기자 · 2026. 10. 5.');
  const body=detail.locator('[data-basket-read-text]');
  await expect(body).toBeVisible();
  await expect(body).toContainText('예시 지역의 교통 계획 초안이 공개되고');
  await expect(body.locator('.ed-h2')).toHaveText('예시 소제목');
  await expect(body.locator('blockquote')).toContainText('인용한 말도 예시다.');
  // 서버가 준 글은 글자로만: 꺾쇠가 든 글이 그대로 글자로 보이고, script·img는 만들어지지 않는다.
  await expect(body).toContainText('<script>window.__niHacked=1</script>');
  expect(await body.locator('script,img').count()).toBe(0);
  expect(await page.evaluate(()=>window.__niHacked)).toBeUndefined();
  // 저장: 제목·글자·저장 모양·원문 정보를 한 번에, 읽은 판에만.
  const patch=f.writes.find(w=>w.method==='PATCH');
  expect(patch.query).toMatchObject({id:'eq.imp-1',kind:'eq.note',updated_at:'eq.2026-10-06T01:00:10Z'});
  expect(patch.body.title).toBe(TITLE);
  expect(patch.body.raw_text).toContain('둘째 문단 <script>');
  expect(patch.body.metadata.source).toEqual({url:URL1,state:'ok',site:'예시일보',author:'예시 기자',published_at:'2026-10-05T03:00:00.000Z',fetched_at:'2026-10-06T01:00:00.000Z'});
  expect(JSON.stringify(patch.body.doc)).not.toMatch(/"image"|"link"/);
  expect(f.writes).toHaveLength(2);
  expect(await noFrameWidth(page)).toBe(true);
  if(width!==884)await shot(page,`after-ok-${width}`);
  // 목록으로 돌아가면 줄 제목이 글 제목이다.
  if(width<761)await detail.locator('[data-note-back]').click();else await page.goBack();
  await expect(detail).toBeHidden();
  await expect(row).toContainText(TITLE);await expect(row).not.toContainText('가져오는 중');
  // 가져온 글로 AI·공유·발송 쪽을 부르지 않았다.
  expect(f.other).toEqual([]);expect(f.errors).toEqual([]);
 });

 test(`가져오지 못하면 노트는 주소만 남고 안내 줄이 뜬다: [다시 시도] · [주소만 두기] ${width}`,async({page})=>{
  const f=await fixture(page,width,{reply:url=>failed(url,'timeout')});
  const win=await openWindow(page);
  await win.locator('[data-edw-url]').fill(URL1);await win.locator('[data-edw-url]').press('Enter');
  await expect(edWin(page)).toHaveCount(0);
  expect(await noticeText(page)).toBe('사이트가 답하지 않아요. 잠시 뒤 다시 시도해 주세요.');
  const row=page.locator('[data-note-row="imp-1"]');
  await expect(row).toContainText('news.example.com');await expect(row).not.toContainText('가져오는 중');
  await row.click();
  const detail=page.locator('[data-note-detail]'),src=detail.locator('[data-note-source]'),warn=src.locator('.ni-warn');
  await expect(warn).toContainText('사이트가 답하지 않아요. 잠시 뒤 다시 시도해 주세요.');
  await expect(detail.locator('[data-basket-read-text]')).toHaveText(URL1);
  await expect(src.locator('a.ni-src-link')).toHaveAttribute('href',URL1);
  await expect(src.locator('.ni-src-day')).toHaveCount(0);
  // 빨간 큰 오류 창이 아니라 작은 한 줄이다.
  expect((await warn.boundingBox()).height).toBeLessThan(width<500?100:60);
  await expect(page.locator('dialog[open],.modal:not(.hidden)')).toHaveCount(0);
  expect(await noFrameWidth(page)).toBe(true);
  if(width!==884)await shot(page,`after-fail-${width}`);
  expect(f.writes.at(-1).body.metadata.source).toMatchObject({url:URL1,state:'failed',reason:'timeout'});
  // [다시 시도]: 같은 노트에 다시 가져온다(노트를 새로 만들지 않는다).
  f.setReply(article);
  await warn.locator('[data-ni-retry]').click();
  await expect(src.locator('.ni-src-day')).toHaveText('10. 6. 가져옴');
  await expect(src.locator('.ni-warn')).toHaveCount(0);
  await expect(detail.locator('[data-basket-read-text]')).toContainText('예시 지역의 교통 계획 초안이 공개되고');
  expect(f.calls.map(c=>c.body)).toEqual([{url:URL1},{url:URL1}]);
  expect(f.writes.filter(w=>w.method==='POST')).toHaveLength(1);
  expect(f.errors).toEqual([]);
 });
}

test('사이트가 읽기를 막았으면 [다시 시도] 없이 [주소만 두기]만: 누르면 안내 줄이 사라지고 다시 열어도 없다',async({page})=>{
 const f=await fixture(page,412,{reply:url=>failed(url,'robots')});
 const win=await openWindow(page);
 await win.locator('[data-edw-url]').fill(URL1);await win.locator('[data-edw-import-run]').click();
 const row=page.locator('[data-note-row="imp-1"]');await expect(row).toBeVisible();
 expect(await noticeText(page)).toBe('가져오지 못했어요. 이 사이트가 읽기를 막아 두었어요.');
 await row.click();
 const detail=page.locator('[data-note-detail]'),warn=detail.locator('.ni-warn');
 await expect(warn).toContainText('가져오지 못했어요. 이 사이트가 읽기를 막아 두었어요.');
 await expect(warn.locator('[data-ni-retry]')).toHaveCount(0);
 await warn.locator('[data-ni-keep]').click();
 await expect(detail.locator('.ni-warn')).toHaveCount(0);
 await expect(detail.locator('a.ni-src-link')).toHaveAttribute('href',URL1);
 await expect(detail.locator('[data-basket-read-text]')).toHaveText(URL1);
 expect(f.writes.at(-1).body.metadata.source).toEqual({url:URL1,state:'failed',reason:'robots',fetched_at:'2026-10-06T01:00:00.000Z',kept:true});
 // 수정이 아니다: updated_at은 건드리지 않는다.
 expect(f.writes.at(-1).body.updated_at).toBeUndefined();
 await detail.locator('[data-note-back]').click();await row.click();
 await expect(detail.locator('a.ni-src-link')).toBeVisible();await expect(detail.locator('.ni-warn')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});

test('하루 횟수를 넘기면(429) 노트는 주소만 남고 "오늘은 더 가져올 수 없어요"',async({page})=>{
 const f=await fixture(page,412,{reply:()=>({status:429,json:{ok:false,error:'DAILY_LIMIT'}})});
 const win=await openWindow(page);
 await win.locator('[data-edw-url]').fill(URL1);await win.locator('[data-edw-import-run]').click();
 const row=page.locator('[data-note-row="imp-1"]');await expect(row).toBeVisible();
 expect(await noticeText(page)).toBe('오늘은 더 가져올 수 없어요. 내일 다시 해 주세요.');
 await row.click();
 await expect(page.locator('[data-note-detail] .ni-warn')).toContainText('오늘은 더 가져올 수 없어요. 내일 다시 해 주세요.');
 expect(f.writes.at(-1).body.metadata.source).toMatchObject({state:'failed',reason:'daily_limit'});
 expect(f.errors).toEqual([]);
});

test('http 주소·빈 칸은 보내지 않고 바로 알린다',async({page})=>{
 const f=await fixture(page,412);
 const win=await openWindow(page);
 await win.locator('[data-edw-import-run]').click();
 await expect(win.locator('.ed-window-status')).toHaveText('주소를 넣어 주세요.');
 await win.locator('[data-edw-url]').fill('http://news.example.com/a');await win.locator('[data-edw-import-run]').click();
 await expect(win.locator('.ed-window-status')).toHaveText('http 주소는 가져올 수 없어요. https로 시작하는 주소를 넣어 주세요.');
 await expect(win.locator('[data-edw-url]')).toHaveValue('http://news.example.com/a');
 expect(f.calls).toEqual([]);expect(f.writes).toEqual([]);
 await expect(edWin(page)).toBeVisible();
});

test('쓰던 글이 있으면 창은 그대로 두고, 가져오는 중에 또 눌러도 거절하지 않고 줄 세운다(한 번에 하나)',async({page})=>{
 const f=await fixture(page,1280),first=f.hold(0),second=f.hold(1);
 await page.locator('[data-note-list] [data-quick-input]').fill('내가 쓰던 메모');
 const win=await openWindow(page);
 await win.locator('[data-edw-url]').fill(URL1);await win.locator('[data-edw-import-run]').click();
 await expect(win.locator('.ed-window-status')).toContainText('가져오는 중이에요');
 await expect(win.locator('[data-edw-url]')).toHaveValue('');
 await expect(win.locator('[data-edw-import-run]')).toBeEnabled();
 await win.locator('[data-edw-url]').fill(URL2);await win.locator('[data-edw-import-run]').click();
 // 노트 둘은 바로 만들어지고, 서버 읽기는 앞의 것이 끝나야 다음 것을 시작한다.
 await expect.poll(()=>f.writes.filter(w=>w.method==='POST').length).toBe(2);
 await expect.poll(()=>f.calls.length).toBe(1);
 await expect(edWin(page)).toBeVisible();await expect(edWinText(page)).toContainText('내가 쓰던 메모');
 first();
 await expect.poll(()=>f.calls.length).toBe(2);
 second();
 await expect.poll(()=>f.notes.filter(n=>n.metadata?.source?.state==='ok').length).toBe(2);
 expect(f.calls.map(c=>c.body.url)).toEqual([URL1,URL2]);expect(f.max()).toBe(1);
 expect(f.notes.find(n=>n.id==='imp-2').metadata.source.url).toBe(URL2);
 // 쓰던 글은 그대로 창에 남아 있다(가져온 글은 따로 노트).
 await expect(edWinText(page)).toContainText('내가 쓰던 메모');
 expect(f.errors).toEqual([]);
});

test('다른 화면으로 옮겨도 끝까지 가져오고, 끝나면 작은 알림에 [보기]',async({page})=>{
 const f=await fixture(page,412),release=f.hold(0);
 const win=await openWindow(page);
 await win.locator('[data-edw-url]').fill(URL1);await win.locator('[data-edw-import-run]').click();
 await expect(page.locator('[data-note-row="imp-1"]')).toBeVisible();
 await page.evaluate(()=>window.KPTURouter.go('home'));
 await expect(page.locator('#homeView')).toBeVisible();
 release();
 const notice=page.locator('#kptuNotice:not([hidden])');
 await expect(notice.locator('.kptu-notice-text')).toHaveText('글을 가져왔어요.');
 expect(f.notes.find(n=>n.id==='imp-1')).toMatchObject({title:TITLE});
 await notice.getByRole('button',{name:'보기'}).click();
 await expect(page.locator('[data-note-detail] a.ni-src-link')).toHaveAttribute('href',URL1);
 await expect(page.locator('[data-note-detail] [data-basket-read-text]')).toContainText('예시 지역의 교통 계획 초안이 공개되고');
 expect(f.errors).toEqual([]);
});

test('가져오는 동안 본문을 수정한 노트는 가져온 글로 덮지 않는다',async({page})=>{
 const f=await fixture(page,412),release=f.hold(0);
 const win=await openWindow(page);
 await win.locator('[data-edw-url]').fill(URL1);await win.locator('[data-edw-import-run]').click();
 await expect(page.locator('[data-note-row="imp-1"]')).toBeVisible();
 // 다른 기기에서 그사이 본문을 수정한 것처럼 서버 쪽 노트를 바꾼다.
 const note=f.notes.find(n=>n.id==='imp-1');note.raw_text=URL1+'\n내가 덧붙인 생각';note.updated_at='2026-10-06T01:00:59Z';
 release();
 expect(await noticeText(page)).toBe('그사이 노트를 수정해서 가져온 글을 넣지 않았어요.');
 expect(note.raw_text).toBe(URL1+'\n내가 덧붙인 생각');expect(note.title).toBe('news.example.com');
 expect(f.writes.filter(w=>w.method==='PATCH'&&'raw_text' in w.body)).toEqual([]);
 expect(f.errors).toEqual([]);
});
