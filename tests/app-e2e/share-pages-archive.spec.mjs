// SHARE-페이지삭제: ⋯ (right-click on a PC) → [보관] keeps the record (status 'archived', 5 seconds of [되돌리기]) and moves the page
// to the small folded '보관함 n' under the list; there ⋯ → [되살리기] (back as a draft) or [완전히 삭제]. [삭제] (list or 보관함) asks
// once and calls share-page-media purge_page (the server removes photo files, then the page); a failure keeps the page.
import {test, expect} from '@playwright/test';
import {clickView} from './helpers/shell-navigation.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const app = testOrigin + '/app/';
const user = {id:'share-user', email:'share@example.org', user_metadata:{display_name:'공유 QA'}};
const WS = 'share-workspace';
const eq = (url, key) => (url.searchParams.get(key) || '').replace(/^eq\./, '');

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
    if (path === '/rest/v1/app_share_pages') {
      state.requests.push({method, search:url.search, body:request.postDataJSON?.() ?? null});
      if (method === 'GET') {
        const f = url.searchParams.get('status') || '';
        return ok(state.pages.filter(p => f === 'neq.archived' ? p.status !== 'archived' : f === 'eq.archived' ? p.status === 'archived' : true));
      }
      if (method === 'PATCH') {
        const row = state.pages.find(p => p.id === eq(url, 'id'));
        const statusParam = url.searchParams.get('status') || '';
        const statusOk = !statusParam || (statusParam.startsWith('neq.') ? row?.status !== statusParam.slice(4) : row?.status === eq(url, 'status'));
        if (!row || !statusOk || (url.searchParams.get('updated_at') && eq(url, 'updated_at') !== row.updated_at)) return ok([]);
        Object.assign(row, request.postDataJSON());
        return ok([row]);
      }
    }
    if (path === '/rest/v1/main_project_archive_state') return ok([]);
    if (path === '/functions/v1/share-page-media') {
      const body = request.postDataJSON?.() ?? null;
      state.purges = [...(state.purges || []), body];
      if (state.purgeFail) return ok({error:'unavailable', removed:0, failed:1}, 503);
      state.pages = state.pages.filter(p => p.id !== body?.page_id);
      return ok({ok:true, removed:0});
    }
    if (path === '/functions/v1/google-calendar') return ok({connected:false, enabled:false, selected:[], calendars:[], events:[]});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

const PAGES = () => [
  {id:'page-1', title:'민자철도 교섭 현황', status:'published', project_id:null, updated_at:'2026-10-22T03:00:00.000Z'},
  {id:'page-2', title:'메모용 초안', status:'draft', project_id:null, updated_at:'2026-10-21T03:00:00.000Z'},
];
async function openList(page, width, state) {
  await page.setViewportSize({width, height:900});
  await mockApp(page, state);
  await page.goto(loginEntry(app));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout:20000});
  await clickView(page, 'pages');
}

for (const width of [390, 1280]) test('보관: confirm, leaves the list for the 보관함, undo; 보관함 되살리기 comes back as a draft ' + width, async ({page}) => {
  const state = {pages:PAGES()};
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openList(page, width, state);
  const list = page.locator('#sharePagesRoot .sp-list-view > .sp-list');
  const boxLine = page.locator('#sharePagesRoot details.sp-box');
  await expect(list.locator('li')).toHaveCount(2);
  await expect(boxLine).toHaveCount(0);
  const gets = state.requests.filter(r => r.method === 'GET').map(r => r.search);
  expect(gets.some(s => s.includes('status=neq.archived'))).toBe(true);
  expect(gets.some(s => s.includes('status=eq.archived'))).toBe(true);
  const menu = page.locator('#spRowMenu');

  // Cancel: nothing is sent.
  let message = '';
  page.once('dialog', d => { message = d.message(); void d.dismiss(); });
  await list.locator('[data-sp-row-menu="page-1"]').click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button')).toHaveText(['보관', '삭제']);
  await menu.getByRole('button', {name:'보관', exact:true}).click();
  await expect.poll(() => message).toContain('링크로 보던 사람도 더 이상 볼 수 없어요');
  expect(state.requests.filter(r => r.method === 'PATCH')).toHaveLength(0);

  // Published page: confirm → archived (record kept), leaves the list, the 보관함 line shows 1, undo within 5 seconds.
  page.once('dialog', d => void d.accept());
  await list.locator('[data-sp-row-menu="page-1"]').click();
  await menu.getByRole('button', {name:'보관', exact:true}).click();
  await expect(list.locator('li')).toHaveCount(1);
  await expect(boxLine.locator('summary')).toHaveText('보관함 1');
  expect(await boxLine.evaluate(n => n.open)).toBe(false);
  const archived = state.requests.filter(r => r.method === 'PATCH');
  expect(archived).toHaveLength(1);
  expect(archived[0].body.status).toBe('archived');
  expect(Object.keys(archived[0].body).sort()).toEqual(['status', 'updated_at']);
  expect(state.requests.some(r => r.method === 'DELETE')).toBe(false);
  const notice = page.locator('.kptu-undo-notice');
  await expect(notice).toContainText('링크도 열리지 않아요');
  await notice.getByRole('button', {name:'되돌리기'}).click();
  await expect(notice).toContainText('되돌렸어요');
  await expect(list.locator('li')).toHaveCount(2);
  await expect(boxLine).toHaveCount(0);
  expect(state.pages.find(p => p.id === 'page-1')).toMatchObject({status:'published', updated_at:'2026-10-22T03:00:00.000Z'});

  // Keep it again (PC: right-click on the line opens the same menu), then 보관함 ⋯ → 되살리기 = draft, back in the list.
  page.once('dialog', d => void d.accept());
  if (width >= 761) await list.locator('[data-sp-open="page-1"]').click({button:'right'});
  else await list.locator('[data-sp-row-menu="page-1"]').click();
  await menu.getByRole('button', {name:'보관', exact:true}).click();
  await expect(boxLine.locator('summary')).toHaveText('보관함 1');
  await boxLine.locator('summary').click();
  const kept = boxLine.locator('li');
  await expect(kept).toHaveCount(1);
  await expect(kept).toContainText('민자철도 교섭 현황');
  await kept.locator('[data-sp-box-menu="page-1"]').click();
  await expect(menu.getByRole('button')).toHaveText(['되살리기', '완전히 삭제']);
  await menu.getByRole('button', {name:'되살리기', exact:true}).click();
  await expect(list.locator('li')).toHaveCount(2);
  await expect(boxLine).toHaveCount(0);
  await expect(page.locator('#sharePagesRoot [data-sp-list-status]')).toContainText('초안으로 되살렸어요');
  expect(state.pages.find(p => p.id === 'page-1').status).toBe('draft');
  await expect(list.locator('[data-sp-open="page-1"] .sp-pill')).toHaveText('초안');
  expect(errors).toEqual([]);
});

for (const width of [390, 1280]) test('삭제: one confirmation, the server removes it for good (list and 보관함); a failure keeps the page ' + width, async ({page}) => {
  const state = {pages:[...PAGES(), {id:'page-3', title:'보관한 페이지', status:'archived', project_id:null, updated_at:'2026-10-20T03:00:00.000Z'}]};
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openList(page, width, state);
  const list = page.locator('#sharePagesRoot .sp-list-view > .sp-list');
  const boxLine = page.locator('#sharePagesRoot details.sp-box');
  const menu = page.locator('#spRowMenu');
  const status = page.locator('#sharePagesRoot [data-sp-list-status]');
  await expect(list.locator('li')).toHaveCount(2);
  await expect(boxLine.locator('summary')).toHaveText('보관함 1');

  // Cancel: nothing sent.
  let message = '';
  page.once('dialog', d => { message = d.message(); void d.dismiss(); });
  await list.locator('[data-sp-row-menu="page-2"]').click();
  await menu.getByRole('button', {name:'삭제', exact:true}).click();
  await expect.poll(() => message).toContain('페이지·링크·사진이 모두 지워지고 되살릴 수 없어요');
  expect(state.purges || []).toHaveLength(0);

  // Server failure: the page stays and the line says pressing again finishes it.
  state.purgeFail = true;
  page.once('dialog', d => void d.accept());
  await list.locator('[data-sp-row-menu="page-2"]').click();
  await menu.getByRole('button', {name:'삭제', exact:true}).click();
  await expect(status).toContainText('남은 것부터 지워요');
  await expect(list.locator('li')).toHaveCount(2);

  // Success from the list: gone, no undo notice, no browser REST delete.
  state.purgeFail = false;
  page.once('dialog', d => void d.accept());
  await list.locator('[data-sp-row-menu="page-2"]').click();
  await menu.getByRole('button', {name:'삭제', exact:true}).click();
  await expect(list.locator('li')).toHaveCount(1);
  await expect(status).toContainText('완전히 삭제했어요');
  await expect(page.locator('.kptu-undo-notice')).toHaveCount(0);
  expect(state.purges.at(-1)).toEqual({action:'purge_page', page_id:'page-2'});

  // From the 보관함.
  await boxLine.locator('summary').click();
  page.once('dialog', d => void d.accept());
  await boxLine.locator('[data-sp-box-menu="page-3"]').click();
  await menu.getByRole('button', {name:'완전히 삭제', exact:true}).click();
  await expect(boxLine).toHaveCount(0);
  expect(state.purges.at(-1)).toEqual({action:'purge_page', page_id:'page-3'});
  expect(state.requests.some(r => r.method === 'DELETE')).toBe(false);
  expect(errors).toEqual([]);
});
