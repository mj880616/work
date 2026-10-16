import {testOrigin} from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import {openBasketMore} from './helpers/basket-more.mjs';
// MD-표시보완: 연달아 나오는 그림은 칩 하나(누르기 전 외부 요청 0건), 강조 상자, ChatGPT 공유 링크 카드(정확한 도메인만),
// [ChatGPT용 요청 복사], 붙여 넣은 HTML 문서 → .html 첨부, .html 첨부를 칸막이 iframe(parent·top·저장소·네트워크 불가)으로 보기.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch:true});
const SHARE='https://chatgpt.com/share/670f1a2b-3c4d-8e9f-a0b1-c2d3e4f5a6b7';
const RICH=[
 '# 답변 정리',
 '![도식 1](https://images.example/1.png)',
 '![도식 2](https://images.example/2.png)',
 '![도식 3](https://images.example/3.png)',
 '',
 '> [!NOTE]',
 '> 참고할 점',
 '',
 '> [!WARNING]',
 '> 조심할 점',
 '',
 `원본: ${SHARE}`,
 `가짜: https://chatgpt.com.evil.example/share/670f1a2b-3c4d-8e9f-a0b1-c2d3e4f5a6b7`,
].join('\n');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
// Tries every way out of the frame, then reports what it could reach. Also asks for outside tools that must not load.
const PROBE=`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>카드</title>
<link rel="stylesheet" href="https://fonts.example/font.css"><script src="https://cdn.example/lib.js"></script>
<style>.card{border:2px solid #345;border-radius:12px;padding:16px;margin:8px;height:700px}</style></head>
<body><div class="card" id="card">카드 모양 <svg width="40" height="40"><circle cx="20" cy="20" r="18" fill="teal"/></svg>
<img src="https://images.example/inside.png" alt="밖 그림"><img src="data:image/png;base64,${PNG.toString('base64')}" alt="안 그림"></div>
<form action="https://evil.example/form" method="post" target="_top"><button id="send">보내기</button></form>
<button id="leave" onclick="location.href='about:blank'">떠나기</button>
<script>
window.__brokenTool.init();
</script>
<script>
(async function(){
 var r={};
 function t(name,fn){try{r[name]=String(fn())}catch(e){r[name]='blocked:'+e.name}}
 t('parent',function(){return parent.document.title});
 t('top',function(){return top.location.href});
 t('parentGlobal',function(){parent.__frameHacked=1;return parent.__frameHacked});
 t('storage',function(){return localStorage.length});
 t('session',function(){return sessionStorage.length});
 t('cookie',function(){return document.cookie});
 t('origin',function(){return String(origin)});
 try{await fetch('https://evil.example/fetch');r.fetch='ok'}catch(e){r.fetch='blocked'}
 try{await fetch('${SB}/rest/v1/app_notes');r.supabase='ok'}catch(e){r.supabase='blocked'}
 try{var w=window.open('https://evil.example/popup');r.popup=w?'opened':'blocked'}catch(e){r.popup='blocked'}
 parent.postMessage({type:'web2-test-probe',result:r},'*');
})();
</script></body></html>`;

async function fixture(page,{notes,htmlReply}={}){
 const seen={requested:[],cspBlocked:[],errors:[],sbFromFrame:[],uploads:[],htmlCalls:[]};
 // Playwright reports a request the page's CSP refused (failure "csp"); such a request never reaches the network.
 Object.defineProperty(seen,'external',{get:()=>seen.requested.filter(url=>!seen.cspBlocked.includes(url))});
 page.on('requestfailed',request=>{if(request.failure()?.errorText==='csp')seen.cspBlocked.push(request.url());});
 page.on('pageerror',e=>seen.errors.push(e.message));
 page.on('request',request=>{
  const url=new URL(request.url());
  if(url.protocol==='data:'||url.protocol==='about:')return;
  if(url.origin!==testOrigin&&url.origin!==SB)seen.requested.push(request.url());
  if(url.origin===SB&&request.frame()!==page.mainFrame())seen.sbFromFrame.push(request.url());
 });
 await openHome(page);
 // Pre-existing on main, outside this change: mobile-swipe-navigation.js adds will-change:transform to the view panel on
 // touchstart, and at some scroll offsets the page then jumps 64px between finger-down and finger-up, so the tap lands
 // elsewhere. Reported separately; held off here so these taps test the new buttons themselves.
 await page.addStyleTag({content:'.kptu-swipe-panel{will-change:auto!important}'});
 await page.route('https://images.example/**',r=>r.fulfill({contentType:'image/png',body:PNG}));
 await page.route(SB+'/rest/v1/app_notes**',r=>r.request().method()==='GET'?r.fulfill({json:notes}):r.fulfill({status:500,json:{}}));
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 await page.route(SB+'/functions/v1/document-actions',r=>{const body=r.request().postDataJSON();seen.htmlCalls.push(body);return htmlReply?htmlReply(r,body):r.fulfill({status:500,json:{}});});
 await page.route(SB+'/functions/v1/basket-files',r=>{
  const form=r.request().postDataBuffer().toString();seen.uploads.push(form);
  return r.fulfill({json:{ok:true,note_id:'pasted',attachments:[{drive_file_id:'html_1',file_name:/filename="([^"]+)"/.exec(form)?.[1]||'x.html',mime_type:'text/html',size_bytes:100}]}});
 });
 return seen;
}
async function press(page,locator,width){
 await expect(locator).toBeVisible();
 if(width<761){await locator.evaluate(el=>el.scrollIntoView({block:'center'}));const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();
}

for(const width of [390,1280]){
 test(`image chip loads nothing until pressed, callouts and the ChatGPT share card ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const seen=await fixture(page,{notes:[{id:'rich',raw_text:RICH,occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:true,attachments:[]}]});
  const detail=page.locator('[data-basket-detail]'),read=detail.locator('[data-basket-read-text]');
  await press(page,page.locator('#homeView [data-goto="basket"]'),width);
  await press(page,page.locator('[data-basket-row="rich"]'),width);
  await expect(read).toHaveClass(/md-body/);
  const chip=read.locator('button.md-image-chip');
  await expect(chip).toHaveCount(1);await expect(chip).toHaveText('🖼 이미지 3개');await expect(chip).toHaveAttribute('aria-expanded','false');
  await expect(read.locator('img')).toHaveCount(0);await expect(read.locator('.md-image-list')).toBeHidden();
  // Callouts.
  await expect(read.locator('blockquote.md-callout-note .md-callout-title')).toHaveText('참고');
  await expect(read.locator('blockquote.md-callout-warning .md-callout-title')).toHaveText('경고');
  await expect(read.locator('blockquote.md-callout-warning')).toContainText('조심할 점');
  // One share card for the exact domain only; the look-alike is not a card.
  const cards=detail.locator('[data-basket-share] a.md-share-card');
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute('href',SHARE);await expect(cards).toHaveAttribute('target','_blank');await expect(cards).toHaveAttribute('rel','noopener noreferrer');
  await expect(cards).toContainText('ChatGPT 원본 보기');
  const box=await cards.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);
  await page.waitForTimeout(300);
  expect(seen.external).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  // Pressing the chip loads exactly those pictures; pressing again folds them.
  await press(page,chip,width);
  await expect(chip).toHaveAttribute('aria-expanded','true');
  await expect(read.locator('.md-image-list img')).toHaveCount(3);
  await expect.poll(()=>read.locator('.md-image-list img').evaluateAll(list=>list.every(img=>img.complete&&img.naturalWidth===1))).toBe(true);
  expect([...seen.external].sort()).toEqual([1,2,3].map(n=>`https://images.example/${n}.png`));
  expect(await read.locator('.md-image-list img').first().getAttribute('referrerpolicy')).toBe('no-referrer');
  await page.screenshot({path:info.outputPath(`chatgpt-read-${width}.png`),fullPage:true});
  await press(page,chip,width);
  await expect(read.locator('.md-image-list')).toBeHidden();
  expect(seen.errors).toEqual([]);
 });

 test(`pasted ChatGPT HTML becomes a .html attachment and shows in a sandbox that reaches nothing ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const reply=(route,body)=>route.fulfill({json:{ok:true,file_name:'chatgpt-20261006-1000.html',size:PROBE.length,html:PROBE}});
  const notes=[{id:'pasted',raw_text:'📄 ChatGPT HTML',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:true,attachments:[{drive_file_id:'html_1',file_name:'chatgpt-20261006-1000.html',mime_type:'text/html',size_bytes:PROBE.length}]}];
  const seen=await fixture(page,{notes,htmlReply:reply});
  await page.evaluate(()=>{window.__copied=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>{window.__copied=text;return Promise.resolve();}}});});
  await press(page,page.locator('#homeView [data-goto="basket"]'),width);
  // [ChatGPT용 요청 복사] copies the fixed request.
  await openBasketMore(page);await press(page,page.locator('[data-chatgpt-request-copy]'),width);
  await expect.poll(()=>page.evaluate(()=>window.__copied)).toBe('위 답변을 외부 라이브러리·폰트·이미지 주소 없이 인라인 CSS와 인라인 SVG만 쓴 HTML 파일 하나로 만들어 줘. 카드·표·도식 모양을 살려 줘.');
  await expect(page.locator('#toast')).toContainText('복사했어요');
  // Pasting a whole document into the basket input turns it into an attachment and leaves a short mark.
  const quick=page.locator('#basketView [data-home-quick]'),input=quick.locator('[data-quick-input]');
  await input.fill('오늘 받은 답변\n');
  await input.evaluate(el=>el.setSelectionRange(el.value.length,el.value.length));
  const pasted=await input.evaluate((el,html)=>{const data=new DataTransfer();data.setData('text/plain','설명\n\n```html\n'+html+'\n```\n끝');const ev=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});el.dispatchEvent(ev);return ev.defaultPrevented;},PROBE);
  expect(pasted).toBe(true);
  await expect(input).toHaveValue('오늘 받은 답변\n설명\n📄 ChatGPT HTML\n끝');
  await expect(quick.locator('[data-basket-file]')).toHaveCount(1);
  await expect(quick.locator('[data-basket-file] b')).toHaveText(/^chatgpt-\d{8}-\d{4}\.html$/);
  // A short fragment is pasted as ordinary text.
  const plain=await input.evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','<div>조각</div>');const ev=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});el.dispatchEvent(ev);return ev.defaultPrevented;});
  expect(plain).toBe(false);
  await press(page,quick.locator('[data-quick-save]'),width);
  await expect.poll(()=>seen.uploads.length).toBe(1);
  expect(seen.uploads[0]).toMatch(/filename="chatgpt-\d{8}-\d{4}\.html"\r\nContent-Type: text\/html/);
  expect(seen.uploads[0]).toContain('name="raw_text"\r\n\r\n오늘 받은 답변\r\n설명\r\n📄 ChatGPT HTML\r\n끝');
  expect(seen.uploads[0]).toContain('<div class="card" id="card">');

  // The reading screen shows the attachment in a sandboxed frame.
  const probe=page.evaluate(()=>new Promise(resolve=>addEventListener('message',e=>{if(e.data?.type==='web2-test-probe')resolve(e.data.result);})));
  await press(page,page.locator('[data-basket-row="pasted"]'),width);
  const view=page.locator('[data-basket-html-view="html_1"]'),frame=view.locator('iframe.html-frame-view');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute('sandbox','allow-scripts');
  await expect(frame).toHaveAttribute('referrerpolicy','no-referrer');
  expect(seen.htmlCalls).toEqual([{action:'html-view',note_id:'pasted',drive_file_id:'html_1'}]);
  const inner=page.frameLocator('[data-basket-html-view="html_1"] iframe');
  await expect(inner.locator('#card')).toContainText('카드 모양');
  const result=await probe;
  expect(result.parent).toMatch(/^blocked:/);
  expect(result.top).toMatch(/^blocked:/);
  expect(result.parentGlobal).toMatch(/^blocked:/);
  expect(result.storage).toMatch(/^blocked:/);
  expect(result.session).toMatch(/^blocked:/);
  expect(result.cookie).toMatch(/^blocked:/);
  expect(result.origin).toBe('null');
  expect(result.fetch).toBe('blocked');expect(result.supabase).toBe('blocked');expect(result.popup).toBe('blocked');
  expect(await page.evaluate(()=>window.__frameHacked)).toBeUndefined();
  // The inline-only policy: data: pictures show, outside pictures/fonts/scripts never load.
  expect(await inner.locator('img[alt="안 그림"]').evaluate(img=>img.naturalWidth)).toBe(1);
  expect(await inner.locator('img[alt="밖 그림"]').evaluate(img=>img.naturalWidth)).toBe(0);
  // Height follows the content (the card is 700px tall).
  await expect.poll(async()=>(await frame.boundingBox()).height).toBeGreaterThan(700);
  // A form aimed at the outside does nothing.
  await inner.locator('#send').click();
  await page.waitForTimeout(300);
  expect(seen.external).toEqual([]);expect(seen.sbFromFrame).toEqual([]);
  // The outside font, script and picture the page asked for were refused by the frame policy.
  expect([...seen.cspBlocked].sort()).toEqual(['https://cdn.example/lib.js','https://fonts.example/font.css','https://images.example/inside.png']);
  await expect(frame).toHaveCount(1);
  // [크게 보기] covers the screen; Escape returns.
  const big=view.getByRole('button',{name:'크게 보기'});
  await press(page,big,width);
  const full=view.locator('.html-frame-full');await expect(full).toHaveCount(1);
  const area=await full.boundingBox();expect(area.width).toBeGreaterThanOrEqual(width-1);expect(area.height).toBeGreaterThanOrEqual(899);
  await page.screenshot({path:info.outputPath(`chatgpt-html-full-${width}.png`)});
  await page.keyboard.press('Escape');await expect(view.locator('.html-frame-full')).toHaveCount(0);
  // A page that navigates itself away is closed; [다시 보기] opens the original again.
  await inner.locator('#leave').click();
  await expect(view.locator('iframe')).toHaveCount(0);
  await expect(view.locator('.html-frame-note')).toContainText('다른 주소로 이동하려 해서 닫았어요');
  await press(page,view.getByRole('button',{name:'다시 보기'}),width);
  await expect(page.frameLocator('[data-basket-html-view="html_1"] iframe').locator('#card')).toContainText('카드 모양');
  // Web2 itself keeps working; the only page errors are the sandboxed page's own broken tool.
  await press(page,page.locator('[data-basket-close]'),width);
  await expect(page.locator('[data-basket-row="pasted"]')).toBeVisible();
  expect(seen.external).toEqual([]);expect(seen.sbFromFrame).toEqual([]);
  expect(seen.errors.filter(message=>!message.includes("reading 'init'"))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}

test('an older server, a refused page and a page over 2MB show a notice instead of a frame',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 const file=(id,size=100)=>({drive_file_id:id,file_name:`${id}.html`,mime_type:'text/html',size_bytes:size});
 const notes=[{id:'n',raw_text:'',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:true,attachments:[file('old'),file('big',2*1024*1024+1),file('refused')]}];
 const seen=await fixture(page,{notes,htmlReply:(route,body)=>body.drive_file_id==='old'?route.fulfill({status:400,json:{error:'document_id가 필요합니다.'}}):route.fulfill({status:400,json:{error:'Drive 원본이 휴지통에 있습니다.',code:'DRIVE_FILE_TRASHED'}})});
 await page.locator('#homeView [data-goto="basket"]').click();
 await page.locator('[data-basket-row="n"]').click();
 await expect(page.locator('[data-basket-html-view="old"]')).toContainText('HTML 보기 서버가 아직 준비되지 않았어요');
 await expect(page.locator('[data-basket-html-view="big"]')).toContainText('2MB보다 큰 HTML은 화면으로 보지 않아요');
 await expect(page.locator('[data-basket-html-view="refused"]')).toContainText('Drive 원본이 휴지통에 있습니다.');
 await expect(page.locator('[data-basket-html-views] iframe')).toHaveCount(0);
 expect(seen.htmlCalls.map(call=>call.drive_file_id).sort()).toEqual(['old','refused']);
 // No share card when the memo has no share link.
 await expect(page.locator('[data-basket-share]')).toBeHidden();
});

test('a pasted HTML document over 2MB is not attached',async({page})=>{
 await page.setViewportSize({width:1280,height:900});
 await fixture(page,{notes:[]});
 const quick=page.locator('#homeView [data-home-quick]'),input=quick.locator('[data-quick-input]');
 const prevented=await input.evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','<!doctype html><p>'+'가'.repeat(700000)+'</p>');const ev=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});el.dispatchEvent(ev);return ev.defaultPrevented;});
 expect(prevented).toBe(true);
 await expect(quick.locator('[data-quick-status]')).toContainText('2MB를 넘어');
 await expect(quick.locator('[data-basket-file]')).toHaveCount(0);
 await expect(input).toHaveValue('');
});
