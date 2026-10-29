// SHARE-보관함·HTML공유 (docs/design/share-html-pages.md): [+ HTML] → file → preview (sandboxed frame) → title · link name · 기한 →
// [저장하고 링크 켜기]; the list line shows HTML · ● 공유 중; ⋯ 링크 끄기 · 새 파일로 바꾸기 (same link). The share page shows the file
// in its own sandboxed frame (share/frame.html). In both places the file cannot read the sign-in (localStorage), cookies or the
// page around it, while its own scripts and a CDN library run. Phone 412 · fold 884 · PC 1440.
import {test, expect} from '@playwright/test';
import {clickView} from './helpers/shell-navigation.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const READ = SB + '/functions/v1/share-page-read';
const CDN = 'https://cdn.jsdelivr.net/npm/fake-chart@1.0.0/dist/chart.min.js';
const app = testOrigin + '/app/';
const user = {id:'html-user', email:'html@example.org', user_metadata:{display_name:'HTML QA'}};
const WS = 'html-workspace';
const HASH = 'ab'.repeat(32);
const CODE = 'k7q2m9xa';
const eq = (url, key) => (url.searchParams.get(key) || '').replace(/^eq\./, '');

// The file: an inline script draws a "graph", a CDN library adds a line, and probes try to reach what must stay out of reach.
const FILE = (mark = '첫 판') => `<!doctype html><html><head><meta charset="utf-8"><title>민자철도 그래프</title>
<script src="${CDN}"></script></head><body>
<h1 id="mark">${mark}</h1><canvas id="c" width="120" height="40"></canvas><p id="graph"></p><p id="cdn"></p><pre id="probe"></pre>
<script>
var g=document.getElementById('c').getContext('2d');g.fillRect(0,0,60,20);document.getElementById('graph').textContent='graph ok';
document.getElementById('cdn').textContent=window.fakeChart?'cdn ok':'cdn missing';
function probe(f){try{var v=f();return 'open:'+String(v).slice(0,80);}catch(e){return 'blocked';}}
var r={
 storage:probe(function(){return localStorage.length+JSON.stringify(Object.keys(localStorage));}),
 parentStorage:probe(function(){return parent.localStorage.length;}),
 cookie:probe(function(){return document.cookie;}),
 parentDoc:probe(function(){return parent.document.title;}),
 topHref:probe(function(){return top.location.href;})
};
document.getElementById('probe').textContent=JSON.stringify(r);
</script></body></html>`;

function mockApp(page, state) {
  state.requests = [];
  return page.route(SB + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const ok = (data, status = 200) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token:'html-secret-access', refresh_token:'html-refresh', expires_in:3600, expires_at:Math.floor(Date.now() / 1000) + 3600, user});
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id:WS, user_id:user.id, role:'owner', workspace:{id:WS, slug:'html', name:'웹2'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id:WS, name:'웹2'}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id:user.id, display_name:'HTML QA'}]);
    const body = (() => { try { return request.postDataJSON(); } catch { return null; } })();
    if (path.startsWith('/rest/v1/app_share_')) state.requests.push({method, path, search:url.search, body});
    if (path === '/rest/v1/app_share_pages') {
      if (method === 'POST') { const row = {id:'html-1', ...body, updated_at:'2026-10-29T01:00:00Z'}; state.pages.push(row); return ok([{id:row.id}], 201); }
      if (method === 'PATCH') { const row = state.pages.find(p => p.id === eq(url, 'id')); if (row) Object.assign(row, body); return route.fulfill({status:204, body:''}); }
      const f = url.searchParams.get('status') || '';
      return ok(state.pages.filter(p => f === 'neq.archived' ? p.status !== 'archived' : f === 'eq.archived' ? p.status === 'archived' : true));
    }
    if (path === '/rest/v1/app_share_page_html') {
      if (method === 'POST') { state.versions.push({page_id:body.page_id, html:body.html}); return route.fulfill({status:201, body:''}); }
      if (url.searchParams.get('select') === 'html') return ok(state.versions.filter(v => v.page_id === eq(url, 'page_id')).slice(-1).map(v => ({html:v.html})));
      return ok(state.versions.map(v => ({page_id:v.page_id})));
    }
    if (path === '/rest/v1/app_share_page_links') {
      if (method === 'POST') { state.links.push({page_id:body.page_id, token_hash:HASH, expires_at:body.expires_at, disabled_at:null}); return ok([{token_hash:HASH}], 201); }
      if (method === 'PATCH') { for (const l of state.links) if (l.page_id === eq(url, 'page_id')) l.disabled_at = body.disabled_at; return route.fulfill({status:204, body:''}); }
      return ok(state.links.filter(l => !url.searchParams.get('page_id') || l.page_id === eq(url, 'page_id')));
    }
    if (path === '/rest/v1/app_share_page_slugs') {
      if (method === 'POST') { state.slugs.push({token_hash:body.token_hash, slug_name:body.slug_name, slug_code:CODE}); return ok([{slug_name:body.slug_name, slug_code:CODE}], 201); }
      return ok(state.slugs);
    }
    if (path === '/rest/v1/main_project_archive_state') return ok([]);
    if (path === '/functions/v1/google-calendar') return ok({connected:false, enabled:false, selected:[], calendars:[], events:[]});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}
const cdnRoute = page => page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({status:200, contentType:'application/javascript', body:'window.fakeChart={ok:true};'}));
async function expectSealed(frame) {
  await expect(frame.locator('#graph')).toHaveText('graph ok');
  await expect(frame.locator('#cdn')).toHaveText('cdn ok');
  const probe = JSON.parse(await frame.locator('#probe').textContent());
  expect(probe).toEqual({storage:'blocked', parentStorage:'blocked', cookie:'blocked', parentDoc:'blocked', topHref:'blocked'});
}

for (const width of [412, 884, 1440]) test('HTML 공유 페이지: 올리기·미리 보기(격리)·링크 켜기·끄기·새 파일로 바꾸기 ' + width, async ({page}) => {
  const state = {pages:[], versions:[], links:[], slugs:[]};
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({width, height:900});
  await cdnRoute(page);
  await mockApp(page, state);
  await page.goto(loginEntry(app));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout:20000});
  await clickView(page, 'pages');
  const root = page.locator('#sharePagesRoot');
  // The sign-in is in this app's storage; the file must not reach it.
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toContain('html-secret-access');

  // One 보관함 only (the old five Web1 pages inside), no '이전 페이지' fold.
  await expect(root.locator('details.sp-box > summary')).toHaveText('보관함 5');
  await expect(page.locator('#pagesView details#web1BoardLegacy')).toHaveCount(0);

  await root.getByRole('button', {name:'새 HTML 공유 페이지'}).click();
  const modal = page.locator('#shareHtmlModal');
  await expect(modal).toBeVisible();
  // Over 5MB is refused before anything is sent.
  await modal.locator('[data-sh-file]').setInputFiles({name:'big.html', mimeType:'text/html', buffer:Buffer.alloc(5 * 1024 * 1024 + 1, 'a')});
  await expect(modal.locator('[data-sh-status]')).toHaveText('5MB까지 올릴 수 있어요.');
  await modal.locator('[data-sh-file]').setInputFiles({name:'graph.html', mimeType:'text/html', buffer:Buffer.from(FILE())});
  const frameEl = modal.locator('iframe[data-sh-frame]');
  await expect(frameEl).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms');
  expect(await frameEl.getAttribute('sandbox')).not.toContain('allow-same-origin');
  await expectSealed(page.frameLocator('#shareHtmlModal iframe[data-sh-frame]'));
  // Title from the file's <title>; the link name is typed (Korean title gives no name).
  await expect(modal.locator('[data-sh-title]')).toHaveValue('민자철도 그래프');
  await expect(modal.locator('.sh-url')).toContainText('bokdoong.com/s/');
  await modal.locator('[data-sh-name]').fill('Graph Test!');
  await expect(modal.locator('[data-sh-name]')).toHaveValue('graphtest');
  await modal.locator('[data-sh-name]').fill('graph-test');
  expect(state.requests).toEqual(expect.not.arrayContaining([expect.objectContaining({method:'POST'})]));
  await modal.getByRole('button', {name:'저장하고 링크 켜기'}).click();
  await expect(modal.locator('[data-sh-link]')).toHaveText(`https://bokdoong.com/s/graph-test-${CODE}`);
  const posts = state.requests.filter(r => r.method !== 'GET');
  expect(posts.map(r => `${r.method} ${r.path}`)).toEqual([
    'POST /rest/v1/app_share_pages', 'POST /rest/v1/app_share_page_html', 'POST /rest/v1/app_share_page_links',
    'POST /rest/v1/app_share_page_slugs', 'PATCH /rest/v1/app_share_page_links', 'PATCH /rest/v1/app_share_pages']);
  expect(posts[0].body).toMatchObject({workspace_id:WS, title:'민자철도 그래프', blocks:[], status:'draft'});
  expect(posts[2].body).toEqual({workspace_id:WS, page_id:'html-1', label:'', expires_at:null});
  // The random letters come from the DB only.
  expect(posts[3].body).toEqual({workspace_id:WS, token_hash:HASH, slug_name:'graph-test'});
  expect(posts[5].body).toMatchObject({status:'published'});
  await modal.locator('[data-sh-close]').click();
  await expect(modal).toBeHidden();

  // The list line: title · HTML · ● 공유 중; pressing it shows the preview again (same sealed frame).
  const line = root.locator('.sp-list-view > .sp-list li', {hasText:'민자철도 그래프'});
  await expect(line.locator('.sp-kind')).toHaveText('HTML');
  await expect(line.locator('[data-sp-html-state]')).toHaveText('● 공유 중');
  await line.locator('.sp-row').click();
  await expectSealed(page.frameLocator('#shareHtmlModal iframe[data-sh-frame]'));
  await modal.locator('[data-sh-close]').click();

  // ⋯ 링크 끄기 → 링크 꺼짐 (the page and file stay).
  await line.locator('.sp-row-more').click();
  const menu = page.locator('#spRowMenu');
  await expect(menu.getByRole('button')).toHaveText(['링크 복사', '새 파일로 바꾸기', '링크 끄기', '보관함으로', '삭제']);
  await menu.getByRole('button', {name:'링크 끄기'}).click();
  await expect(line.locator('[data-sp-html-state]')).toHaveText('링크 꺼짐');
  expect(state.links.every(l => l.disabled_at)).toBe(true);

  // ⋯ 새 파일로 바꾸기: a new version for the same page; no new link or short address.
  await line.locator('.sp-row-more').click();
  await menu.getByRole('button', {name:'새 파일로 바꾸기'}).click();
  await modal.locator('[data-sh-file]').setInputFiles({name:'graph2.html', mimeType:'text/html', buffer:Buffer.from(FILE('둘째 판'))});
  await expect(page.frameLocator('#shareHtmlModal iframe[data-sh-frame]').locator('#mark')).toHaveText('둘째 판');
  await modal.getByRole('button', {name:'바꾸기'}).click();
  await expect(modal.locator('[data-sh-status]')).toHaveText('새 파일로 바꿨어요. 링크는 그대로예요.');
  expect(state.versions.map(v => v.page_id)).toEqual(['html-1', 'html-1']);
  expect(state.links).toHaveLength(1); expect(state.slugs).toHaveLength(1);
  await modal.locator('[data-sh-close]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

for (const width of [412, 1440]) test('공유 화면: 짧은 주소로 HTML 파일이 격리 칸에서 열리고, 꺼진 링크는 안 열림 ' + width, async ({page}) => {
  const errors = [], consoleErrors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.setViewportSize({width, height:900});
  await cdnRoute(page);
  let open = true, html = FILE();
  const asked = [];
  await page.route(SB + '/**', route => {
    const request = route.request();
    if (request.url() !== READ) return route.abort();
    asked.push(request.postDataJSON());
    return open
      ? route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:{kind:'html', title:'민자철도 그래프', html}})})
      : route.fulfill({status:404, contentType:'application/json', body:JSON.stringify({error:'not_found'})});
  });
  // A value at this site's storage (e.g. an old Web1 sign-in) must stay out of the file's reach too.
  await page.goto(testOrigin + '/share/');
  await page.evaluate(() => localStorage.setItem('sb-share-test', 'work-secret'));
  await page.goto(testOrigin + `/share/?s=graph-test-${CODE}`);
  // ?s= moves after # at once (a reload does not send it again).
  await expect.poll(() => page.evaluate(() => location.search + '|' + location.hash)).toBe(`|#s=graph-test-${CODE}`);
  const frame = page.locator('iframe.sr-html-frame');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms');
  await expectSealed(page.frameLocator('iframe.sr-html-frame'));
  await expect(page).toHaveTitle('민자철도 그래프 · 공유 페이지');
  expect(asked[0]).toEqual({slug:`graph-test-${CODE}`});
  const box = await frame.boundingBox();
  expect(box.width).toBeGreaterThan(width * 0.9);
  // A new file on the same link: the same address shows it.
  html = FILE('둘째 판');
  await page.reload();
  await expect(page.frameLocator('iframe.sr-html-frame').locator('#mark')).toHaveText('둘째 판');
  // The link is off: the same "can't open" card, no frame.
  open = false;
  await page.reload();
  await expect(page.locator('.sr-closed')).toContainText('열 수 없는 링크예요');
  await expect(page.locator('iframe.sr-html-frame')).toHaveCount(0);
  // frame.html opened directly (not sandboxed) draws nothing.
  await page.goto(testOrigin + '/share/frame.html');
  await page.evaluate(() => window.postMessage({type:'kptu-share-html', html:'<p id="x">ran</p>'}, '*'));
  await expect(page.locator('#x')).toHaveCount(0);
  expect(consoleErrors.filter(t => /Content Security Policy/i.test(t))).toEqual([]);
  expect(errors).toEqual([]);
});
