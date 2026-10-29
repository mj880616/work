// SHARE-현장공유 PR 2: Web2 "공유 페이지" editor (mock Supabase) and the Web1 reader (mock share-page-read).
import {test, expect} from '@playwright/test';
import {existsSync, readFileSync} from 'node:fs';
import {clickView} from './helpers/shell-navigation.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ORIGIN = testOrigin;
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
        if (url.searchParams.get('status') === 'eq.archived') return ok(state.pages.filter(p => p.status === 'archived'));
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

for (const width of [390, 1280]) test('make a share page on the full screen: save, link make/copy/off, legacy cards folded ' + width, async ({page, context}) => {
  await page.setViewportSize({width, height:900});
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin:ORIGIN});
  const state = {pages:[], links:[]};
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const logs = []; page.on('console', m => logs.push(m.text()));
  await mockApp(page, state);
  await signIn(page);
  await clickView(page, 'pages');
  const root = page.locator('#sharePagesRoot');
  await expect(root.getByRole('heading', {name:'공유 페이지', exact:true})).toHaveCount(1);
  await expect(root.locator('.sp-empty')).toHaveText('공유 페이지 없음');
  // SHARE-보관함·HTML공유: the old five cards stay, in the one folded '보관함 n' (no '이전 페이지'·'지나간 업무 · 사업' folds).
  const legacy = root.locator('details.sp-box');
  await expect(legacy.locator(':scope > summary')).toHaveText('보관함 5');
  await expect(page.locator('#pagesView')).not.toContainText('이전 페이지');
  await expect(page.locator('#pagesView')).not.toContainText('지나간 업무');
  await expect(legacy.locator(':scope > summary')).toHaveCSS('list-style-type','none');
  expect(await legacy.locator(':scope > summary').evaluate(e=>getComputedStyle(e,'::before').content)).toBe('"▸"');
  await legacy.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(legacy).toHaveAttribute('open','');
  expect(await legacy.locator(':scope > summary').evaluate(e=>getComputedStyle(e,'::before').content)).toBe('"▾"');
  await page.keyboard.press('Enter');
  await expect(legacy).not.toHaveAttribute('open', '');
  await expect(page.locator('#web1BoardActive .w1b-card')).toHaveCount(5);
  await expect(page.locator('#web1BoardActive .w1b-card').first()).toBeHidden();

  await root.getByRole('button', {name:'새 공유 페이지', exact:true}).click();
  const editor = page.locator('[data-sp-editor]');
  await expect(editor).toBeVisible();
  // SHARE-전체편집: a new page is the full writing screen (one 글 block, no block frames), the cursor in the title.
  await expect(editor).toHaveClass(/is-full/);
  await expect(editor.locator('[data-sp-block],[data-sp-add-block],.sp-canvas')).toHaveCount(0);
  await expect(editor.locator('[data-sp-title]')).toBeFocused();
  await page.keyboard.type('민자철도 교섭 현황');
  await page.keyboard.press('Enter');
  await expect(editor.getByRole('textbox', {name:'본문', exact:true})).toBeFocused();
  await page.keyboard.type('3차 교섭 결렬, 조정 신청 예정');
  // Project: on the top line on PC, under ⋯ on a phone.
  if (width < 761) await editor.getByRole('button', {name:'사업영역·링크', exact:true}).click();
  await editor.locator('[data-sp-project]').selectOption('proj-1');
  await editor.locator('[data-sp-set-status="published"]').click();
  await expect(editor.locator('[data-sp-set-status="published"]')).toHaveAttribute('aria-pressed', 'true');
  if (width < 761) await editor.getByRole('button', {name:'사업영역·링크', exact:true}).click();
  await editor.getByRole('button', {name:'링크', exact:true}).click();
  const linksPanel = editor.getByRole('dialog', {name:'링크'});
  await expect(linksPanel.locator('[data-sp-links]')).toContainText('한 번 저장한 뒤');
  await linksPanel.getByRole('button', {name:'링크 창 닫기', exact:true}).click();
  await expect(linksPanel).toBeHidden();
  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장했어요. 게시 중이에요.');
  const saved = state.pages[0];
  expect(saved.title).toBe('민자철도 교섭 현황');
  expect(saved.status).toBe('published');
  expect(saved.project_id).toBe('proj-1');
  expect(saved.blocks).toEqual([
    {type:'doc', doc:{v:'ed1', doc:{type:'doc', content:[{type:'paragraph', attrs:{style:'body2'}, content:[{type:'text', text:'3차 교섭 결렬, 조정 신청 예정'}]}]}}},
  ]);
  const post = state.requests.find(r => r.method === 'POST' && !r.link);
  expect(post.body.workspace_id).toBe(WS);
  if (width < 761) await editor.getByRole('button', {name:'사업영역·링크', exact:true}).click();
  await editor.getByRole('button', {name:'링크', exact:true}).click();
  await expect(linksPanel).toBeVisible();

  // Links: label is optional (empty case: tests/share-pages-label.test.mjs), then make, copy (token read only on demand), off.
  await expect(editor.locator('[data-sp-link-label]')).toHaveAttribute('placeholder', '비워도 돼요 · 링크를 가진 누구나 봐요');
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
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://work.bokdoong.com/work/share/?t=' + TOKEN);
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
  await linksPanel.getByRole('button', {name:'링크 창 닫기', exact:true}).click();
  await editor.locator('[data-sp-close]').click();
  await expect(root.locator('.sp-row')).toHaveCount(1);
  await expect(root.locator('.sp-row')).toContainText('민자철도 교섭 현황');
  await expect(root.locator('.sp-row')).toContainText('게시');
  // Re-open and edit: PATCH with the version guard.
  await root.locator('.sp-row').click();
  await expect(editor.locator('[data-sp-title]')).toHaveValue('민자철도 교섭 현황');
  await expect(editor).toHaveClass(/is-full/);
  await expect(editor.getByRole('textbox', {name:'본문', exact:true})).toBeFocused();
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

test('old blocks: add, move with the ⋯ menu, delete, saved in the shown order ' , async ({page}) => {
  await page.setViewportSize({width:1280, height:900});
  const state = {pages:[{id:'page-1', title:'옛 블록 페이지', status:'draft', project_id:null, updated_at:'2026-10-20T01:00:00.000Z', blocks:[{type:'summary', text:'3차 교섭 결렬'}]}], links:[]};
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await mockApp(page, state);
  await signIn(page);
  await clickView(page, 'pages');
  await page.locator('#sharePagesRoot .sp-row').first().click();
  const editor = page.locator('[data-sp-editor]');
  // A page with old blocks keeps the block editor (설계 4.2).
  await expect(editor).not.toHaveClass(/is-full/);
  await expect(editor.locator('[data-sp-block]')).toHaveCount(1);
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
  await editor.getByLabel('1번째 블록 한 줄 현황 메뉴', {exact:true}).click();
  await expect(editor.getByRole('button', {name:'1번째 블록 한 줄 현황 위로', exact:true})).toBeDisabled();
  await editor.getByRole('button', {name:'2번째 블록 자료·링크 아래로', exact:true}).click();
  await editor.getByLabel('2번째 블록 진행 단계 메뉴', {exact:true}).click();
  await editor.getByRole('button', {name:'2번째 블록 진행 단계 위로', exact:true}).click();
  expect(await editor.locator('[data-sp-block]').evaluateAll(n => n.map(x => x.dataset.spType))).toEqual(['stages', 'summary', 'links']);
  // Delete then re-add a block (an empty block goes without asking).
  await editor.getByRole('button', {name:'+ 일정', exact:true}).click();
  await editor.getByRole('button', {name:'4번째 블록 일정 지우기', exact:true}).click();
  await expect(editor.locator('[data-sp-block]')).toHaveCount(3);
  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장했어요');
  expect(state.pages[0].blocks).toEqual([
    {type:'stages', title:'', items:[{name:'요구안 확정'}, {name:'교섭'}], current:1},
    {type:'summary', text:'3차 교섭 결렬'},
    {type:'links', title:'', items:[{label:'요구안', url:'https://drive.google.com/file/d/x/view'}]},
  ]);
  await expect(editor).not.toHaveClass(/is-full/);
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
  const state = {pages:[{id:'page-1', title:'주소 검사', status:'draft', project_id:null, updated_at:'2026-10-20T01:00:00.000Z', blocks:[{type:'summary', text:'옛 블록'}]}], links:[]};
  await mockApp(page, state);
  await signIn(page);
  await clickView(page, 'pages');
  await page.locator('#sharePagesRoot .sp-row').first().click();
  await page.getByRole('button', {name:'+ 자료·링크', exact:true}).click();
  await page.getByLabel('자료·링크 1번째 줄 이름',{exact:true}).fill('나쁜 링크');
  await page.getByLabel('자료·링크 1번째 줄 주소 (https://…)',{exact:true}).fill('javascript:alert(1)');
  await page.getByRole('button', {name:'저장', exact:true}).click();
  await expect(page.locator('[data-sp-status-line]')).toContainText('http:// 또는 https://');
  expect(state.requests.filter(r => r.method !== 'GET')).toEqual([]);
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
  // UI-선택표시톤다운: 요약은 꽉 칠한 초록 대신 연한 초록 바탕 + 왼쪽 얇은 초록 선 + 본문 글자색. 지금 단계는 막대로 표시.
  const summary = page.locator('.sr-summary');
  await expect(summary).toHaveText(samplePage.blocks[0].text);
  const tokens = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return {primary:s.getPropertyValue('--kptu-primary').trim(), soft:s.getPropertyValue('--kptu-primary-soft').trim()}; });
  expect(tokens.primary).toBe('#5c6a35');expect(tokens.soft).toBe('#eef0e1');
  await expect(summary).toHaveCSS('background-color', 'rgb(238, 240, 225)');
  await expect(summary).toHaveCSS('box-shadow', 'rgb(92, 106, 53) 2px 0px 0px 0px inset');
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
  await expect(page.locator('#srMain img, #srMain script')).toHaveCount(0);
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

// BUG-공유페이지삼성: on Samsung Internet only the footer showed. Browser ad blockers apply Fanboy's social list, whose
// generic hide rules include "###sharePage" and "##.sharePage"; the page area used to be <main id="sharePage">.
const SOCIAL_HIDE = '#sharePage,.sharePage,.sharepage,#sharePageButtons,.share-page,[id^="share"],[class^="share"]{display:none!important}';
test('Web1 reader stays visible under an ad blocker that hides share widgets', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  // Ad blockers inject their rules with extension rights, past the page CSP; a constructed sheet does the same here.
  await page.addInitScript(css => { const sheet = new CSSStyleSheet(); sheet.replaceSync(css); document.adoptedStyleSheets = [sheet]; }, SOCIAL_HIDE);
  const {errors} = await openReader(page, {reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  // The rule is really in force: an element named like a share widget is hidden.
  expect(await page.evaluate(() => { const p = document.createElement('p'); p.id = 'sharePage'; document.body.append(p); const d = getComputedStyle(p).display; p.remove(); return d; })).toBe('none');
  await expect(page.locator('h1.sr-title')).toBeVisible();
  await expect(page.locator('.sr-summary')).toBeVisible();
  await expect(page.locator('.sr-issue-title')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Web1 reader draws on an older browser without the newer DOM and array helpers', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.addInitScript(() => {
    for (const [owner, key] of [[Element.prototype, 'replaceChildren'], [Document.prototype, 'replaceChildren'], [DocumentFragment.prototype, 'replaceChildren'],
      [Array.prototype, 'at'], [Array.prototype, 'findLast'], [Array.prototype, 'toSorted'], [String.prototype, 'at'], [Object, 'hasOwn'],
      [globalThis, 'structuredClone'], [Promise, 'withResolvers'], [URL, 'parse'], [URL, 'canParse']]) delete owner[key];
  });
  const {errors} = await openReader(page, {reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  await expect(page.locator('.sr-summary')).toHaveText(samplePage.blocks[0].text);
  await expect(page.locator('.sr-stage')).toHaveCount(3);
  await expect(page.locator('.sr-link')).toHaveCount(1);
  expect(await page.title()).toBe(samplePage.title + ' · 공유 페이지');
  expect(errors).toEqual([]);
});

test('Web1 reader keeps the title and other blocks when one block cannot be drawn', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  // The schedule block needs a <table>; make that one element fail the way a missing browser feature would.
  await page.addInitScript(() => {
    const make = Document.prototype.createElement;
    Document.prototype.createElement = function (tag, ...rest) {
      if (String(tag).toLowerCase() === 'table') throw new TypeError('no table here');
      return make.call(this, tag, ...rest);
    };
  });
  const {errors} = await openReader(page, {reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  await expect(page.locator('.sr-summary')).toHaveText(samplePage.blocks[0].text);
  await expect(page.locator('.sr-schedule')).toHaveCount(0);
  const notice = page.locator('.sr-block-error');
  await expect(notice).toHaveCount(1);
  await expect(notice).toHaveText('일정 칸을 표시하지 못했어요. 새로고침하거나 보낸 사람에게 알려 주세요.');
  await expect(notice).toHaveAttribute('role', 'note');
  // Blocks after the failing one still show, in order.
  await expect(page.locator('#srMain > *')).toHaveCount(1 + samplePage.blocks.length);
  await expect(page.locator('#srMain > *').nth(3)).toHaveClass(/sr-block-error/);
  await expect(page.locator('.sr-issue-title')).toHaveText('인력 충원');
  await expect(page.locator('.sr-update')).toHaveCount(1);
  await expect(page.locator('.sr-closed')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Web1 reader is a narrow centre column on PC', async ({page}) => {
  await page.setViewportSize({width:1440, height:900});
  await openReader(page, {reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toBeVisible();
  const box = await page.locator('#srMain').boundingBox();
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

// SHARE-미리보기제목: links copied from Web2 carry ?t= so the Worker can title the preview card. In the browser the value
// moves after # at once (reloads and the page's own file requests no longer send it) and the page reads as before.
test('Web1 reader opens a ?t= link, moves the value after # and reads it once', async ({page}) => {
  const files = [];
  page.on('request', r => { if (r.url().startsWith(ORIGIN)) files.push(r.url()); });
  const {calls, errors} = await openReader(page, {hash:'?t=' + TOKEN, reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('#t=' + TOKEN);
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0].body)).toEqual({token:TOKEN});
  expect(calls[0].headers.referer).toBeUndefined();
  // Only the page address itself carried the value; its scripts and styles did not.
  expect(files.filter(u => u.includes(TOKEN))).toEqual([ORIGIN + '/share/?t=' + TOKEN]);
  expect(errors).toEqual([]);
  await page.reload();
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  expect(new URL(page.url()).search).toBe('');
  expect(calls).toHaveLength(2);
});

for (const search of ['?t=short', '?t=' + 'A'.repeat(64), '?t=' + TOKEN + '&t=' + TOKEN, '?x=' + TOKEN]) test('Web1 reader never calls the server for a malformed ?t= address ' + JSON.stringify(search), async ({page}) => {
  const {calls} = await openReader(page, {hash:search, reply:route => route.fulfill({status:200, body:'{}'})});
  await expect(page.locator('h1.sr-title')).toHaveText('열 수 없는 링크예요');
  expect(calls).toHaveLength(0);
});

test('Web1 reader prefers the # value when an address has both', async ({page}) => {
  const other = 'c'.repeat(64);
  const {calls} = await openReader(page, {hash:'?t=' + other + '#t=' + TOKEN, reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0].body)).toEqual({token:TOKEN});
});

for (const hash of ['', '#t=short', '#t=' + 'A'.repeat(64), '#x=' + TOKEN, '#t=' + TOKEN + 'aa']) test('Web1 reader never calls the server for a malformed address ' + JSON.stringify(hash), async ({page}) => {
  const {calls} = await openReader(page, {hash, reply:route => route.fulfill({status:200, body:'{}'})});
  await expect(page.locator('h1.sr-title')).toHaveText('열 수 없는 링크예요');
  expect(calls).toHaveLength(0);
});

test('Web1 reader source draws server content with textContent only and keeps no link value', () => {
  // SHARE-보이는편집: the blocks are drawn by app/sr-render.mjs (shared with the Web2 editor), so it is checked as reader code.
  const source = ['share/share.js', 'app/sr-render.mjs'].map(file => readFileSync(file, 'utf8')).join('\n');
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'console.', 'eval(', 'new Function', 'document.cookie']) expect(source, sink).not.toContain(sink);
  expect(source).not.toMatch(new RegExp(['local', 'session'].map(k => k + 'Storage').concat(['index' + 'edDB', 'caches\\s*\\.']).join('|')));
  const html = readFileSync('share/index.html', 'utf8');
  expect(html).toMatch(/<meta name="robots" content="noindex,nofollow,noarchive">/);
  expect(html).toMatch(/Content-Security-Policy/);
  // Link previews get one fixed card for every share page: never the link value or anything from the page.
  expect(html).not.toMatch(/canonical/);
  const meta = [...html.matchAll(/<meta (?:property|name)="((?:og|twitter):[a-z:_]+)" content="([^"]*)">/g)].map(m => [m[1], m[2]]);
  expect(Object.fromEntries(meta)).toEqual({
    'og:type':'website', 'og:locale':'ko_KR', 'og:title':'공유 페이지', 'og:description':'링크를 받은 사람만 볼 수 있는 페이지',
    'og:url':'https://work.bokdoong.com/work/share/', 'og:image':'https://work.bokdoong.com/work/app/icons/app-icon-512.png',
    'og:image:width':'512', 'og:image:height':'512',
    'twitter:card':'summary', 'twitter:title':'공유 페이지', 'twitter:description':'링크를 받은 사람만 볼 수 있는 페이지',
  });
  expect(existsSync('app/icons/app-icon-512.png')).toBe(true);
  expect(html).not.toMatch(/#t=/);
  // BUG-공유페이지삼성: ad blockers' social lists hide ids and classes such as #sharePage/.sharePage/.share-…, so the reader
  // names nothing after "share" (the footer outside <main> stayed while the whole page area was hidden).
  const names = [...(html + source).matchAll(/(?:id|class(?:Name)?)\s*=\s*"([^"]*)"|el\('[a-z0-9]+', '([^']*)'/g)].map(m => m[1] || m[2] || '');
  expect(names.length).toBeGreaterThan(10);
  for (const name of names) expect(name, name).not.toMatch(/share/i);
  // Older Samsung Internet (Chromium 7x) cannot parse ?. or ?? and has no replaceChildren: one SyntaxError would stop the page.
  for (const file of ['share/share.js', 'app/sr-render.mjs', 'app/share-pages-model.mjs']) {
    const code = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(code, file).not.toMatch(/\?\.[\w[(]|\?\?|replaceChildren|structuredClone|\.findLast|\.toSorted|\.at\(/);
  }
});
