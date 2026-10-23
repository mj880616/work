// SHARE-페이지삭제: delete a share page from the list (⋯ → 삭제, right-click on a PC) = keep the record, status 'archived'.
// One confirmation, the line leaves the list, 5 seconds of [되돌리기]. A published page's confirmation also says its link stops.
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
        const hideArchived = url.searchParams.get('status') === 'neq.archived';
        return ok(state.pages.filter(p => !(hideArchived && p.status === 'archived')));
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
    if (path === '/functions/v1/google-calendar') return ok({connected:false, enabled:false, selected:[], calendars:[], events:[]});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

for (const width of [390, 1280]) test('delete a share page from the list: confirm, leaves the list, undo ' + width, async ({page}) => {
  await page.setViewportSize({width, height:900});
  const state = {pages:[
    {id:'page-1', title:'민자철도 교섭 현황', status:'published', project_id:null, updated_at:'2026-10-22T03:00:00.000Z'},
    {id:'page-2', title:'메모용 초안', status:'draft', project_id:null, updated_at:'2026-10-21T03:00:00.000Z'},
  ]};
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await mockApp(page, state);
  await page.goto(loginEntry(app));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout:20000});
  await clickView(page, 'pages');
  const list = page.locator('#sharePagesRoot .sp-list');
  await expect(list.locator('li')).toHaveCount(2);
  // The list asks the server to leave archived pages out.
  expect(state.requests.find(r => r.method === 'GET').search).toContain('status=neq.archived');
  const menu = page.locator('#spRowMenu');

  // Cancel: nothing is sent.
  let message = '';
  page.once('dialog', d => { message = d.message(); void d.dismiss(); });
  await list.locator('[data-sp-row-menu="page-1"]').click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button')).toHaveText(['삭제']);
  await menu.getByRole('button', {name:'삭제', exact:true}).click();
  await expect.poll(() => message).toContain('링크로 보던 사람도 더 이상 볼 수 없어요');
  expect(state.requests.filter(r => r.method === 'PATCH')).toHaveLength(0);
  await expect(list.locator('li')).toHaveCount(2);

  // Published page: confirm → archived (record kept), leaves the list, undo within 5 seconds.
  page.once('dialog', d => void d.accept());
  await list.locator('[data-sp-row-menu="page-1"]').click();
  await menu.getByRole('button', {name:'삭제', exact:true}).click();
  await expect(list.locator('li')).toHaveCount(1);
  await expect(list.locator('[data-sp-open="page-2"]')).toBeVisible();
  const archived = state.requests.filter(r => r.method === 'PATCH');
  expect(archived).toHaveLength(1);
  expect(archived[0].body.status).toBe('archived');
  expect(Object.keys(archived[0].body).sort()).toEqual(['status', 'updated_at']);
  expect(archived[0].search).toContain('status=neq.archived');
  expect(state.pages.find(p => p.id === 'page-1').status).toBe('archived');
  expect(state.requests.some(r => r.method === 'DELETE')).toBe(false);
  const notice = page.locator('.kptu-undo-notice');
  await expect(notice).toContainText('링크도 열리지 않아요');
  await notice.getByRole('button', {name:'되돌리기'}).click();
  await expect(notice).toContainText('되돌렸어요');
  await expect(list.locator('li')).toHaveCount(2);
  expect(state.pages.find(p => p.id === 'page-1')).toMatchObject({status:'published', updated_at:'2026-10-22T03:00:00.000Z'});

  // Draft: the confirmation has no link line. On a PC the same menu opens by right-click on the line.
  let draftMessage = '';
  page.once('dialog', d => { draftMessage = d.message(); void d.accept(); });
  if (width >= 761) await list.locator('[data-sp-open="page-2"]').click({button:'right'});
  else await list.locator('[data-sp-row-menu="page-2"]').click();
  await expect(menu).toBeVisible();
  await menu.getByRole('button', {name:'삭제', exact:true}).click();
  await expect(list.locator('li')).toHaveCount(1);
  expect(draftMessage).toContain('메모용 초안');
  expect(draftMessage).not.toContain('링크');
  expect(state.pages.find(p => p.id === 'page-2').status).toBe('archived');
  expect(errors).toEqual([]);
});
