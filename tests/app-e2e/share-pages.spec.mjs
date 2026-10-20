// SHARE-현장공유 PR 2: Web2 "공유 페이지" editor (mock Supabase) and the Web1 reader (mock share-page-read).
import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {clickView} from './helpers/shell-navigation.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ORIGIN = 'http://127.0.0.1:8123';
const app = ORIGIN + '/app/';
const user = {id:'share-user', email:'share@example.org', user_metadata:{display_name:'공유 QA'}};
const WS = 'share-workspace';
const TOKEN = 'a'.repeat(32) + 'b'.repeat(32);

function mockApp(page, state) {
  state.requests = [];
  return page.route(SB + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const ok = (data, status = 200) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token:'share-access', refresh_token:'share-refresh', expires_in:3600, expires_at:Math.floor(Date.now() / 1000) + 3600, user});
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id:WS, user_id:user.id, role:'owner', workspace:{id:WS, slug:'share', name:'웹2'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id:WS, name:'웹2'}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id:user.id, display_name:'공유 QA'}]);
    if (path === '/rest/v1/app_spaces') return ok([{id:'proj-1', workspace_id:WS, name:'민자철도 교섭', status:'active', owner_id:user.id, created_by:user.id, metadata:{project_system:'v2', management_version:2}}]);
    if (path === '/rest/v1/app_share_pages') {
      state.requests.push({method, url:url.search, body:request.postDataJSON?.() ?? null});
      if (method === 'GET') {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        expect(url.searchParams.get('workspace_id')).toBe('eq.' + WS);
        return ok(id ? state.pages.filter(p => p.id === id) : state.pages);
      }
      if (method === 'POST') {
        const body = request.postDataJSON();
        const row = {id:'page-' + (state.pages.length + 1), ...body, updated_at:'2026-10-20T01:00:00.000Z'};
        delete row.workspace_id;
        state.pages.push(row);
        return ok([row], 201);
      }
      if (method === 'PATCH') {
        const id = url.searchParams.get('id').replace(/^eq\./, ''), row = state.pages.find(p => p.id === id);
        Object.assign(row, request.postDataJSON());
        return ok([row]);
      }
    }
    if (path === '/rest/v1/app_share_page_links') {
      const select = url.searchParams.get('select');
      state.requests.push({method, url:url.search, link:true, select});
      if (method === 'GET') {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        if (select === 'token') { state.tokenReads = (state.tokenReads || 0) + 1; return ok(state.links.filter(l => l.id === id).map(l => ({token:l.token}))); }
        // Lists never ask for the link value.
        expect(select).not.toContain('token');
        return ok(state.links.filter(l => 'eq.' + l.page_id === url.searchParams.get('page_id')).map(({token, ...rest}) => rest));
      }
      if (method === 'POST') {
        const body = request.postDataJSON();
        expect(Object.keys(body).sort()).toEqual(['expires_at', 'label', 'page_id', 'workspace_id']);
        const row = {id:'link-' + (state.links.length + 1), token:TOKEN, created_at:'2026-10-20T02:00:00.000Z', disabled_at:null, ...body};
        state.links.push(row);
        const {token, ...visible} = row;
        return ok([visible], 201);
      }
      if (method === 'PATCH') {
        const id = url.searchParams.get('id').replace(/^eq\./, ''), row = state.links.find(l => l.id === id);
        Object.assign(row, request.postDataJSON());
        const {token, ...visible} = row;
        return ok([visible]);
      }
    }
    if (path === '/rest/v1/main_project_archive_state') return ok([]);
    if (path === '/functions/v1/google-calendar') return ok({connected:false, enabled:false, selected:[], calendars:[], events:[]});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}
async function signIn(page) {
  await page.goto(loginEntry(app));
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout:20000});
}

for (const width of [390, 1280]) test('make a share page: blocks, move, save, link make/copy/off, legacy cards folded ' + width, async ({page, context}) => {
  await page.setViewportSize({width, height:900});
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin:ORIGIN});
  const state = {pages:[], links:[]};
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const logs = []; page.on('console', m => logs.push(m.text()));
  await mockApp(page, state);
  await signIn(page);
  await clickView(page, 'pages');
  const root = page.locator('#sharePagesRoot');
  await expect(root.getByRole('heading', {name:'내 공유 페이지'})).toBeVisible();
  await expect(root).toContainText('아직 만든 공유 페이지가 없어요');
  // S7: the old five cards stay, folded under "이전 페이지".
  const legacy = page.locator('#web1BoardLegacy');
  await expect(legacy.locator(':scope > summary')).toHaveText('이전 페이지');
  await expect(legacy).not.toHaveAttribute('open', '');
  await expect(page.locator('#web1BoardActive .w1b-card')).toHaveCount(5);
  await expect(page.locator('#web1BoardActive .w1b-card').first()).toBeHidden();

  await root.getByRole('button', {name:'새 공유 페이지', exact:true}).click();
  const editor = page.locator('[data-sp-editor]');
  await expect(editor).toBeVisible();
  await expect(editor.locator('[data-sp-block]')).toHaveCount(1);
  await editor.locator('[data-sp-title]').fill('민자철도 교섭 현황');
  await editor.getByLabel('1번째 블록 한 줄 현황 글',{exact:true}).fill('3차 교섭 결렬, 조정 신청 예정');
  await editor.getByRole('button', {name:'+ 진행 단계', exact:true}).click();
  await editor.getByLabel('진행 단계 1번째 줄 단계 이름',{exact:true}).fill('요구안 확정');
  await editor.getByRole('button', {name:'2번째 블록 진행 단계에 줄 추가', exact:true}).click();
  await editor.getByLabel('진행 단계 2번째 줄 단계 이름',{exact:true}).fill('교섭');
  await editor.locator('[data-sp-block="1"] input[type="radio"]').nth(1).check();
  await editor.getByRole('button', {name:'+ 자료·링크', exact:true}).click();
  await editor.getByLabel('자료·링크 1번째 줄 이름',{exact:true}).fill('요구안');
  await editor.getByLabel('자료·링크 1번째 줄 주소 (https://…)',{exact:true}).fill('https://drive.google.com/file/d/x/view');
  // Move the links block above the stages block, then back down once to check both directions.
  await editor.getByRole('button', {name:'3번째 블록 자료·링크 위로', exact:true}).click();
  await expect(editor.locator('[data-sp-block]').nth(1)).toHaveAttribute('data-sp-type', 'links');
  await expect(editor.getByRole('button', {name:'2번째 블록 자료·링크 위로', exact:true})).toBeFocused();
  await expect(editor.getByRole('button', {name:'1번째 블록 한 줄 현황 위로', exact:true})).toBeDisabled();
  await editor.getByRole('button', {name:'2번째 블록 자료·링크 아래로', exact:true}).click();
  await editor.getByRole('button', {name:'2번째 블록 진행 단계 위로', exact:true}).click();
  expect(await editor.locator('[data-sp-block]').evaluateAll(n => n.map(x => x.dataset.spType))).toEqual(['stages', 'summary', 'links']);
  // Delete then re-add a block (an empty block goes without asking).
  await editor.getByRole('button', {name:'+ 일정', exact:true}).click();
  await editor.getByRole('button', {name:'4번째 블록 일정 지우기', exact:true}).click();
  await expect(editor.locator('[data-sp-block]')).toHaveCount(3);
  await editor.locator('[data-sp-project]').selectOption('proj-1');
  await editor.locator('[data-sp-set-status="published"]').click();
  await expect(editor.locator('[data-sp-set-status="published"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.locator('[data-sp-links]')).toContainText('한 번 저장한 뒤');
  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장했어요. 게시 중이에요.');
  const saved = state.pages[0];
  expect(saved.title).toBe('민자철도 교섭 현황');
  expect(saved.status).toBe('published');
  expect(saved.project_id).toBe('proj-1');
  expect(saved.blocks).toEqual([
    {type:'stages', title:'', items:[{name:'요구안 확정'}, {name:'교섭'}], current:1},
    {type:'summary', text:'3차 교섭 결렬, 조정 신청 예정'},
    {type:'links', title:'', items:[{label:'요구안', url:'https://drive.google.com/file/d/x/view'}]},
  ]);
  const post = state.requests.find(r => r.method === 'POST' && !r.link);
  expect(post.body.workspace_id).toBe(WS);

  // Links: label required, then make, copy (token read only on demand), off.
  await editor.getByRole('button', {name:'링크 만들기', exact:true}).click();
  await expect(editor.locator('[data-sp-link-status]')).toContainText('이름표를 입력');
  await editor.locator('[data-sp-link-label]').fill('○○지부');
  await editor.getByRole('button', {name:'링크 만들기', exact:true}).click();
  await expect(editor.locator('[data-sp-link-status]')).toContainText('"○○지부" 링크를 만들었어요');
  expect(state.links[0]).toMatchObject({label:'○○지부', expires_at:null, page_id:saved.id, workspace_id:WS});
  await expect(editor.locator('.sp-link')).toContainText('기한 없음');
  // The link value never appears on screen.
  expect(await page.content()).not.toContain(TOKEN);
  expect(state.tokenReads || 0).toBe(0);
  await editor.getByRole('button', {name:'○○지부 링크 복사', exact:true}).click();
  await expect(editor.locator('[data-sp-link-status]')).toContainText('링크를 복사했어요');
  expect(state.tokenReads).toBe(1);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://work.bokdoong.com/work/share/#t=' + TOKEN);
  expect(await page.content()).not.toContain(TOKEN);
  expect(logs.join('\n')).not.toContain(TOKEN);
  page.once('dialog', d => d.accept());
  await editor.getByRole('button', {name:'○○지부 링크 끄기', exact:true}).click();
  await expect(editor.locator('[data-sp-link-status]')).toContainText('링크를 껐어요');
  expect(state.links[0].disabled_at).toBeTruthy();
  await expect(editor.locator('.sp-link')).toContainText('꺼짐');
  await expect(editor.getByRole('button', {name:'○○지부 링크 복사', exact:true})).toBeDisabled();

  // An expiry date is the end of that Korean day.
  await editor.locator('[data-sp-link-label]').fill('△△지회');
  await editor.locator('[data-sp-link-expiry]').fill('2099-01-31');
  await editor.getByRole('button', {name:'링크 만들기', exact:true}).click();
  await expect(editor.locator('.sp-link')).toHaveCount(2);
  expect(state.links[1].expires_at).toBe('2099-01-31T23:59:59+09:00');

  // Back to the list: the page shows with its state.
  await editor.locator('[data-sp-close]').click();
  await expect(root.locator('.sp-row')).toHaveCount(1);
  await expect(root.locator('.sp-row')).toContainText('민자철도 교섭 현황');
  await expect(root.locator('.sp-row')).toContainText('게시');
  // Re-open and edit: PATCH with the version guard.
  await root.locator('.sp-row').click();
  await expect(editor.locator('[data-sp-title]')).toHaveValue('민자철도 교섭 현황');
  await expect(editor.locator('.sp-link')).toHaveCount(2);
  await editor.locator('[data-sp-set-status="draft"]').click();
  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('아직 초안');
  const patch = state.requests.filter(r => r.method === 'PATCH' && !r.link).at(-1);
  expect(patch.url).toContain('updated_at=eq.');
  expect(state.pages[0].status).toBe('draft');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('unsaved editor asks before leaving and Back closes it first', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  const state = {pages:[], links:[]};
  await mockApp(page, state);
  await signIn(page);
  await clickView(page, 'pages');
  await page.getByRole('button', {name:'새 공유 페이지', exact:true}).click();
  await page.locator('[data-sp-title]').fill('쓰던 글');
  page.once('dialog', d => d.dismiss());
  await page.locator('[data-sp-close]').click();
  await expect(page.locator('[data-sp-editor]')).toBeVisible();
  page.once('dialog', d => d.accept());
  await page.goBack();
  await expect(page.locator('[data-sp-editor]')).toBeHidden();
  await expect(page.locator('#pagesView')).toBeVisible();
  expect(state.pages).toEqual([]);
});

test('a bad link address is not saved', async ({page}) => {
  const state = {pages:[], links:[]};
  await mockApp(page, state);
  await signIn(page);
  await clickView(page, 'pages');
  await page.getByRole('button', {name:'새 공유 페이지', exact:true}).click();
  await page.locator('[data-sp-title]').fill('주소 검사');
  await page.getByRole('button', {name:'+ 자료·링크', exact:true}).click();
  await page.getByLabel('자료·링크 1번째 줄 이름',{exact:true}).fill('나쁜 링크');
  await page.getByLabel('자료·링크 1번째 줄 주소 (https://…)',{exact:true}).fill('javascript:alert(1)');
  await page.getByRole('button', {name:'저장', exact:true}).click();
  await expect(page.locator('[data-sp-status-line]')).toContainText('http:// 또는 https://');
  expect(state.pages).toEqual([]);
});

// ── Web1 reader ──
const READ = SB + '/functions/v1/share-page-read';
const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
const samplePage = {title:'민자철도 교섭 현황 ' + XSS, blocks:[
  {type:'summary', text:'3차 교섭 결렬 ' + XSS},
  {type:'stages', title:'', items:[{name:'요구안'}, {name:'교섭'}, {name:'조정'}], current:1},
  {type:'schedule', title:'다가오는 일정', items:[{date:'10/24', text:'조정 신청'}, {date:'10/31', text:'집회 ' + XSS}]},
  {type:'issues', title:'', items:[{title:'인력 충원', body:'2인1조 보장 ' + XSS}]},
  {type:'links', title:'', items:[{label:'요구안 PDF', url:'https://drive.google.com/file/d/x/view'}, {label:'나쁜 링크', url:'javascript:alert(1)'}, {label:'데이터', url:'data:text/html,hi'}]},
  {type:'updates', title:'', items:[{date:'10/19', text:'교섭 결렬'}]},
]};
async function openReader(page, {hash = '#t=' + TOKEN, reply} = {}) {
  const calls = [];
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route(SB + '/**', async route => {
    const request = route.request();
    calls.push({url:request.url(), method:request.method(), body:request.postData(), headers:request.headers()});
    if (request.url() !== READ) return route.abort();
    return reply(route);
  });
  await page.goto(ORIGIN + '/share/' + hash);
  return {calls, errors};
}

test('Web1 reader draws the page as text only, with noindex and no stored link value', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  const {calls, errors} = await openReader(page, {reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('POST');
  expect(JSON.parse(calls[0].body)).toEqual({token:TOKEN});
  expect(calls[0].headers.referer).toBeUndefined();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  // Summary on the green bar, stage bar with the current step marked.
  const summary = page.locator('.sr-summary');
  await expect(summary).toHaveText(samplePage.blocks[0].text);
  const tokens = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return {primary:s.getPropertyValue('--kptu-primary').trim()}; });
  expect(tokens.primary).toBe('#5c6a35');
  await expect(summary).toHaveCSS('background-color', 'rgb(92, 106, 53)');
  await expect(page.locator('.sr-stage')).toHaveCount(3);
  await expect(page.locator('.sr-stage[aria-current="step"]')).toHaveText('교섭');
  await expect(page.locator('.sr-stage.is-done')).toHaveCount(1);
  await expect(page.locator('.sr-schedule h2')).toHaveText('다가오는 일정');
  await expect(page.locator('.sr-table tr')).toHaveCount(2);
  await expect(page.locator('.sr-issue-title')).toHaveText('인력 충원');
  // Only the https link is drawn, opened safely.
  const links = page.locator('.sr-link');
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute('href', 'https://drive.google.com/file/d/x/view');
  await expect(links).toHaveAttribute('rel', /noopener/);
  await expect(links).toHaveAttribute('target', '_blank');
  await expect(page.locator('.sr-update')).toHaveCount(1);
  await expect(page.locator('.sr-update')).toHaveCSS('border-left-style', 'solid');
  await expect(page.locator('.sr-foot')).toHaveText('링크를 받은 사람만 볼 수 있는 페이지');
  // XSS strings are plain text: no element was made from them and nothing ran.
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(page.locator('#sharePage img, #sharePage script')).toHaveCount(0);
  await expect(page.locator('.sr-issue-body')).toContainText('<img src=x');
  // The link value lives only in the address bar.
  // Nothing is kept in the browser (cookies or per-origin storage); the source check below covers the session kind too.
  const kept = await page.context().storageState();
  expect(kept.cookies).toEqual([]);
  expect(kept.origins).toEqual([]);
  expect(await page.content()).not.toContain(TOKEN);
  expect(await page.title()).toBe(samplePage.title + ' · 공유 페이지');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('Web1 reader is a narrow centre column on PC', async ({page}) => {
  await page.setViewportSize({width:1440, height:900});
  await openReader(page, {reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toBeVisible();
  const box = await page.locator('#sharePage').boundingBox();
  expect(box.width).toBeLessThanOrEqual(640);
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(2);
});

for (const [name, setup] of [
  ['404', {reply:route => route.fulfill({status:404, contentType:'application/json', body:'{"error":"not_found"}'})}],
  ['network error', {reply:route => route.abort('failed')}],
  ['server error', {reply:route => route.fulfill({status:503, contentType:'application/json', body:'{"error":"unavailable"}'})}],
  ['bad answer', {reply:route => route.fulfill({status:200, contentType:'application/json', body:'{"ok":true,"page":{"title":5}}'})}],
]) test('Web1 reader shows the same closed-link notice on ' + name, async ({page}) => {
  const {calls} = await openReader(page, setup);
  await expect(page.locator('h1.sr-title')).toHaveText('열 수 없는 링크예요');
  await expect(page.locator('.sr-closed')).toContainText('다시 받아 주세요');
  expect(calls).toHaveLength(1);
});

for (const hash of ['', '#t=short', '#t=' + 'A'.repeat(64), '#x=' + TOKEN, '#t=' + TOKEN + 'aa']) test('Web1 reader never calls the server for a malformed address ' + JSON.stringify(hash), async ({page}) => {
  const {calls} = await openReader(page, {hash, reply:route => route.fulfill({status:200, body:'{}'})});
  await expect(page.locator('h1.sr-title')).toHaveText('열 수 없는 링크예요');
  expect(calls).toHaveLength(0);
});

test('Web1 reader source draws server content with textContent only and keeps no link value', () => {
  const source = readFileSync('share/share.js', 'utf8');
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'console.', 'eval(', 'new Function', 'document.cookie']) expect(source, sink).not.toContain(sink);
  expect(source).not.toMatch(new RegExp(['local', 'session'].map(k => k + 'Storage').concat(['index' + 'edDB', 'caches\\s*\\.']).join('|')));
  const html = readFileSync('share/index.html', 'utf8');
  expect(html).toMatch(/<meta name="robots" content="noindex,nofollow,noarchive">/);
  expect(html).toMatch(/Content-Security-Policy/);
  expect(html).not.toMatch(/og:|twitter:|canonical/);
});
