import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const app='http://127.0.0.1:8123/app/';
const user={id:'board-user',email:'board@example.org',user_metadata:{display_name:'게시판 QA'}};
const cases=[
  {title:'위험업무 2인1조 법제화',repo:'2in1/index.html',canonical:'https://work.bokdoong.com/work/2in1/',source:'2in1/index.html'},
  {title:'공공기관 인력확충',repo:'workforce/index.html',canonical:'https://work.bokdoong.com/work/workforce/',source:'workforce/index.html'},
  {title:'민자철도 사업 현황',repo:'private-rail/index.html',canonical:'https://work.bokdoong.com/work/private-rail/',source:'private-rail/index.html'},
  {title:'궤도협의회',repo:'rail-council/index.html',canonical:'https://work.bokdoong.com/work/rail-council/',source:'rail-council/index.html'},
  {title:'산별전환 업무 현황',repo:'sanbyeol/index.html',canonical:'https://work.bokdoong.com/work/sanbyeol/',source:'sanbyeol/index.html'}
];

async function mockApp(page,{archived=[]}={}){
  await page.route(SB+'/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'board-access',refresh_token:'board-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'board-workspace',user_id:user.id,role:'owner',workspace:{id:'board-workspace',slug:'board',name:'웹2'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'board-workspace',name:'웹2'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'게시판 QA'}]);
    if(path==='/rest/v1/main_project_archive_state')return ok(archived.map(card_key=>({card_key,archived:true})));
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}
async function signIn(page){
  await page.goto(loginEntry(app));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
}

test('all five Web1 board cards point to deployed repository pages',async()=>{
  for(const item of cases)expect(existsSync(item.repo),item.repo).toBeTruthy();
});

for(const width of [390,1440])test('compact board cards show only their title and retain reader interaction '+width,async({page,browser})=>{
  await page.setViewportSize({width,height:900});
  const baseline=await browser.newPage({viewport:{width,height:900}});
  const mainCSS=execFileSync('git',['show','589d7eee99eeaf88b4b87498d42842aa74d9f401:app/web1-board.css'],{encoding:'utf8'});
  await baseline.route('**/app/web1-board.css?*',route=>route.fulfill({contentType:'text/css',body:mainCSS}));
  for(const p of [page,baseline]){
    await mockApp(p,{archived:['sanbyeol']});
    await p.route('https://raw.githubusercontent.com/mj880616/work/main/**',route=>route.fulfill({contentType:'text/plain; charset=utf-8',body:'<!doctype html><html><body><main id="embeddedBoard">board reader</main></body></html>'}));
    await signIn(p);
    await clickView(p,'pages');
    await expect(p.locator('#pagesView')).toHaveAttribute('data-web1-board-ready','1');
    await p.locator('#web1BoardArchivedWrap summary').click();
  }
  for(const item of cases){
    const selector='[data-web1-board-title="'+item.title+'"]';
    const card=page.locator(selector);
    await expect(card.locator('h3')).toBeVisible();
    await expect(card.locator('h3')).toHaveCSS('font-size','16px');
    await expect(card.locator('h3')).toHaveCSS('margin','0px');
    await expect(card.locator('.w1b-card-top')).toBeHidden();
    await expect(card.locator('p')).toBeHidden();
    await expect(card.locator('.w1b-open')).toBeHidden();
    await expect(card).toHaveAccessibleName(item.title);
    await expect(card).toMatchAriaSnapshot('- button "'+item.title+'"');
    await expect(card).toHaveCSS('padding','14px 16px');
    await expect(card).toHaveCSS('border-radius','12px');
    expect((await card.boundingBox()).height).toBeLessThan((await baseline.locator(selector).boundingBox()).height);
  }
  for(const id of ['web1BoardActive','web1BoardArchived']){
    const grid=page.locator('#'+id);
    await expect(grid).toHaveCSS('gap','10px');
    const columns=await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(width===390?1:2);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);
  const modal=page.locator('#web1BoardDetailModal');
  const first=page.locator('[data-web1-board-title="'+cases[0].title+'"]');
  // Padding is part of the button's activation area, on touch and desktop alike.
  if(width===390){await page.context().newCDPSession(page).then(async session=>{
    const box=await first.boundingBox();
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+4,y:box.y+4}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await session.detach();
  });}else await first.click({position:{x:4,y:4}});
  await expect(modal).toBeVisible();
  await expect(page.frameLocator('#web1BoardDetailFrame').locator('#embeddedBoard')).toHaveText('board reader');
  await page.locator('[data-close-web1-board]').click();
  await expect(modal).toBeHidden();
  await first.focus();await first.press('Enter');await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');await expect(modal).toBeHidden();
  const archived=page.locator('#web1BoardArchived .w1b-card');
  await archived.click({position:{x:4,y:4}});await expect(modal).toBeVisible();
  await page.locator('[data-close-web1-board]').click();await expect(modal).toBeHidden();
  await baseline.close();
});

test('Web2 board renders all five business pages from repository HTML source and returns to the list',async({page})=>{
  await mockApp(page);
  await page.route('https://raw.githubusercontent.com/mj880616/work/main/**',async route=>{
    const url=new URL(route.request().url());
    const source=decodeURIComponent(url.pathname.split('/main/')[1]||'');
    await route.fulfill({
      status:200,
      contentType:'text/plain; charset=utf-8',
      body:'<!doctype html><html><head><title>fixture</title></head><body><main id="embeddedBoard">source '+source+'</main></body></html>'
    });
  });
  await signIn(page);
  await clickView(page,'pages');
  await expect(page.locator('#pagesView')).toBeVisible();
  await expect(page.locator('#web1BoardActive .w1b-card')).toHaveCount(5);

  const modal=page.locator('#web1BoardDetailModal');
  const frame=page.locator('#web1BoardDetailFrame');
  await expect(frame).toHaveAttribute('sandbox',/allow-scripts/);
  await expect(frame).not.toHaveAttribute('sandbox',/allow-same-origin/);
  await expect(frame).toHaveAttribute('sandbox',/allow-popups-to-escape-sandbox/);

  for(const item of cases){
    const card=page.locator('[data-web1-board-title="'+item.title+'"]');
    await expect(card).toHaveAttribute('data-web1-board-href',item.canonical);
    await expect(card).toHaveAttribute('data-web1-board-source',item.source);
    await card.click();
    await expect(modal).toBeVisible();
    await expect(frame).toHaveAttribute('src','about:blank');
    await expect(frame).toHaveAttribute('data-web1-board-canonical',item.canonical);
    await expect(frame).toHaveAttribute('data-web1-board-source',item.source);
    await expect.poll(async()=>await frame.getAttribute('srcdoc')).toContain('<base href="'+item.canonical+'">');
    await expect(page.frameLocator('#web1BoardDetailFrame').locator('#embeddedBoard')).toContainText(item.source);
    await page.locator('[data-close-web1-board]').click();
    await expect(modal).toHaveClass(/hidden/);
    await expect(frame).toHaveAttribute('src','about:blank');
    await expect(frame).not.toHaveAttribute('srcdoc',/.+/);
    await expect(page.locator('#pagesView')).toBeVisible();
  }
});

test('mobile Web1 board detail is a full-screen reader without duplicate visible heading',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await mockApp(page);
  await page.route('https://raw.githubusercontent.com/mj880616/work/main/**',route=>route.fulfill({
    status:200,
    contentType:'text/plain; charset=utf-8',
    body:'<!doctype html><html><body><main id="embeddedBoard">mobile board</main></body></html>'
  }));
  await signIn(page);
  await clickView(page,'pages');
  await page.locator('[data-web1-board-title="위험업무 2인1조 법제화"]').click();

  const modal=page.locator('#web1BoardDetailModal');
  const card=page.locator('#web1BoardDetailModal .w1b-detail-card');
  const head=page.locator('#web1BoardDetailModal .w1b-detail-head');
  const frame=page.locator('#web1BoardDetailFrame');

  await expect(modal).toBeVisible();
  const metrics=await page.evaluate(()=>{
    const modal=document.querySelector('#web1BoardDetailModal');
    const card=document.querySelector('#web1BoardDetailModal .w1b-detail-card');
    const head=document.querySelector('#web1BoardDetailModal .w1b-detail-head');
    const title=document.querySelector('#web1BoardDetailTitle');
    const frame=document.querySelector('#web1BoardDetailFrame');
    const rect=el=>el.getBoundingClientRect();
    return {
      viewport:{width:innerWidth,height:innerHeight},
      modal:rect(modal),card:rect(card),head:rect(head),frame:rect(frame),
      titleDisplay:getComputedStyle(title).display,
      titleWidth:rect(title).width,
      overflow:document.documentElement.scrollWidth-innerWidth
    };
  });
  expect(metrics.card.width).toBeGreaterThanOrEqual(389);
  expect(metrics.card.height/metrics.viewport.height).toBeGreaterThanOrEqual(.95);
  expect(metrics.card.top).toBeLessThanOrEqual(16);
  expect(metrics.frame.height/metrics.viewport.height).toBeGreaterThanOrEqual(.88);
  expect(metrics.titleWidth).toBeLessThanOrEqual(1);
  expect(metrics.overflow).toBeLessThanOrEqual(1);
  await expect(head.locator('[data-close-web1-board]')).toBeVisible();
  await expect(page.frameLocator('#web1BoardDetailFrame').locator('#embeddedBoard')).toContainText('mobile board');
});


test('Web1 board internal links stay in the reader and load the linked repository file',async({page})=>{
  await mockApp(page);
  const requested=[];
  await page.route('https://raw.githubusercontent.com/mj880616/work/main/**',async route=>{
    const url=new URL(route.request().url());
    const source=decodeURIComponent(url.pathname.split('/main/')[1]||'');
    requested.push(source);
    const body=source==='2in1/index.html'
      ? '<!doctype html><html><body><a id="childLink" href="./field-testimony-1002/">하위 페이지</a></body></html>'
      : '<!doctype html><html><body><main id="nestedBoard">하위 원문</main></body></html>';
    await route.fulfill({status:200,contentType:'text/plain; charset=utf-8',body});
  });
  await signIn(page);
  await clickView(page,'pages');
  await page.locator('[data-web1-board-title="위험업무 2인1조 법제화"]').click();
  await page.frameLocator('#web1BoardDetailFrame').locator('#childLink').click();
  await expect(page.frameLocator('#web1BoardDetailFrame').locator('#nestedBoard')).toContainText('하위 원문');
  expect(requested).toContain('2in1/index.html');
  expect(requested).toContain('2in1/field-testimony-1002/index.html');
});

test('Web1 board source failure shows a controlled reader error instead of a browser Not Found page',async({page})=>{
  await mockApp(page);
  await page.route('https://raw.githubusercontent.com/mj880616/work/main/**',route=>route.fulfill({status:404,body:'missing'}));
  await signIn(page);
  await clickView(page,'pages');
  await page.locator('[data-web1-board-title="공공기관 인력확충"]').click();
  const doc=page.frameLocator('#web1BoardDetailFrame');
  await expect(doc.locator('body')).toContainText('본문을 불러오지 못했습니다.');
  await expect(doc.locator('body')).not.toContainText('Not Found');
  await expect(doc.locator('a')).toHaveAttribute('href','https://work.bokdoong.com/work/workforce/');
});

 test('mobile board Back matches clean main reader history',async({page,browser})=>{
  await page.setViewportSize({width:390,height:900});
  const original=await browser.newPage({viewport:{width:390,height:900}});
  const cache=new Map();
  await original.route(/^http:\/\/127\.0\.0\.1:8123\/app\//,route=>{
    let path=new URL(route.request().url()).pathname.slice(1);if(path.endsWith('/'))path+='index.html';
    if(!/\.(css|js|html)$/.test(path))return route.continue();
    if(!cache.has(path))cache.set(path,execFileSync('git',['show','589d7eee99eeaf88b4b87498d42842aa74d9f401:'+path],{encoding:'utf8'}));
    return route.fulfill({contentType:path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html',body:cache.get(path)});
  });
  for(const p of [original,page]){
    await mockApp(p);
    let release;const sourceReady=new Promise(resolve=>{release=resolve});
    await p.route('https://raw.githubusercontent.com/mj880616/work/main/**',async route=>{await sourceReady;await route.fulfill({contentType:'text/plain; charset=utf-8',body:'<!doctype html><html><body><main id="embeddedBoard">board reader</main></body></html>'})});
    await signIn(p);await clickView(p,'pages');
    await p.locator('.w1b-card').first().click();
    const modal=p.locator('#web1BoardDetailModal');
    await expect(modal).toBeVisible();
    await expect.poll(()=>p.evaluate(()=>history.state?.kptuOverlay)).toBe('web1BoardDetailModal');
    await p.evaluate(()=>history.back());
    await expect(modal).toBeHidden();
    await expect(p.locator('#pagesView')).toBeVisible();
    release();
  }
  await original.close();
 });
