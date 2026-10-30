// SHARE-페이지삭제: ⋯ (right-click on a PC) → [보관] keeps the record (status 'archived', 5 seconds of [되돌리기]) and moves the page
// to the small folded '보관함 n' under the list; there ⋯ → [되살리기] (back as a draft) or [삭제].
// TRASH-다른삭제: [삭제] (list or 보관함) asks once and sends a DELETE that the DB turns into 'in the trash' (보관함 and 휴지통 are separate);
// the 5-second [되돌리기] brings it back through app_trash_restore; the permanent delete (share-page-media purge_page) is not on this screen.
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
      if (method === 'DELETE') {
        // The DB trigger answers a DELETE by moving the row to the trash (it leaves the screen's reads; nothing is removed).
        const row = state.pages.find(p => p.id === eq(url, 'id'));
        if (row) { state.trash = [...(state.trash || []), {...row, deleted_status:row.status, deleted_at:'2026-10-27T01:00:00Z'}]; state.pages = state.pages.filter(p => p !== row); }
        return route.fulfill({status:204, body:''});
      }
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
    if (state.trashMissing && path.startsWith('/rest/v1/rpc/app_trash_')) return ok({code:'22023', message:'TRASH_KIND_UNKNOWN'}, 400);
    if (path === '/rest/v1/rpc/app_trash_list') {
      const kind = request.postDataJSON?.()?.p_kind;
      return ok(kind === 'share_page' ? (state.trash || []).map(p => ({kind:'share_page', id:p.id, workspace_id:WS, title:p.title, prev_status:p.deleted_status, deleted_at:p.deleted_at, file_count:0, link_count:0})) : []);
    }
    if (path === '/rest/v1/rpc/app_trash_restore') {
      const body = request.postDataJSON?.() ?? {};
      state.restores = [...(state.restores || []), body];
      const row = (state.trash || []).find(p => p.id === body.p_id);
      if (!row) return ok({code:'P0002', message:'TRASH_NOT_FOUND'}, 400);
      state.trash = state.trash.filter(p => p !== row);
      const {deleted_status, deleted_at, ...back} = row; state.pages.push({...back, status:deleted_status});
      return ok({ok:true, kind:'share_page', id:row.id, restored:1});
    }
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
  await expect(boxLine).toHaveCount(0); // DOMAIN-④ E2: 옛 Web1 카드 5개가 없어 빈 보관함 줄은 그리지 않는다.
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
  await expect(menu.getByRole('button')).toHaveText(['되살리기', '삭제']);
  await menu.getByRole('button', {name:'되살리기', exact:true}).click();
  await expect(list.locator('li')).toHaveCount(2);
  await expect(boxLine).toHaveCount(0);
  await expect(page.locator('#sharePagesRoot [data-sp-list-status]')).toContainText('초안으로 되살렸어요');
  expect(state.pages.find(p => p.id === 'page-1').status).toBe('draft');
  await expect(list.locator('[data-sp-open="page-1"] .sp-pill')).toHaveText('초안');
  expect(errors).toEqual([]);
});

for (const width of [390, 1280]) test('삭제: one confirmation, the page goes to the 휴지통 and not for good (list and 보관함); 되돌리기 brings it back ' + width, async ({page}) => {
  const state = {pages:[...PAGES(), {id:'page-3', title:'보관한 페이지', status:'archived', project_id:null, updated_at:'2026-10-20T03:00:00.000Z'}]};
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openList(page, width, state);
  const list = page.locator('#sharePagesRoot .sp-list-view > .sp-list');
  const boxLine = page.locator('#sharePagesRoot details.sp-box');
  const menu = page.locator('#spRowMenu');
  const status = page.locator('#sharePagesRoot [data-sp-list-status]');
  const deletes = () => state.requests.filter(r => r.method === 'DELETE');
  await expect(list.locator('li')).toHaveCount(2);
  await expect(boxLine.locator('summary')).toHaveText('보관함 1');

  // Cancel: nothing sent.
  let message = '';
  page.once('dialog', d => { message = d.message(); void d.dismiss(); });
  await list.locator('[data-sp-row-menu="page-2"]').click();
  await menu.getByRole('button', {name:'삭제', exact:true}).click();
  await expect.poll(() => message).toContain('공유 페이지를 휴지통으로 옮길까요');
  expect(deletes()).toHaveLength(0);

  // Draft from the list: one confirmation, leaves the list, in the trash (not purged), 5 seconds of [되돌리기].
  page.once('dialog', d => void d.accept());
  await list.locator('[data-sp-row-menu="page-2"]').click();
  await menu.getByRole('button', {name:'삭제', exact:true}).click();
  await expect(list.locator('li')).toHaveCount(1);
  expect(deletes()).toHaveLength(1);
  expect(deletes()[0].search).toContain('id=eq.page-2');
  expect((state.trash || []).map(p => p.id)).toEqual(['page-2']);
  expect(state.purges || []).toHaveLength(0);
  const notice = page.locator('.kptu-undo-notice');
  await expect(notice).toContainText('휴지통으로 옮겼어요');
  await notice.getByRole('button', {name:'되돌리기'}).click();
  await expect(notice).toContainText('되돌렸습니다');
  await expect(list.locator('li')).toHaveCount(2);
  expect(state.restores.at(-1)).toEqual({p_kind:'share_page', p_id:'page-2'});
  expect(state.pages.find(p => p.id === 'page-2')).toMatchObject({status:'draft'});

  // A published page: the question says the link stops and opens again on 되돌리기.
  page.once('dialog', d => { message = d.message(); void d.accept(); });
  await list.locator('[data-sp-row-menu="page-1"]').click();
  await menu.getByRole('button', {name:'삭제', exact:true}).click();
  await expect.poll(() => message).toContain('같은 링크가 다시 열립니다');
  await expect(list.locator('li')).toHaveCount(1);

  // From the 보관함: also the trash, and the 보관함 line goes away.
  await boxLine.locator('summary').click();
  page.once('dialog', d => void d.accept());
  await boxLine.locator('[data-sp-box-menu="page-3"]').click();
  await menu.getByRole('button', {name:'삭제', exact:true}).click();
  await expect(boxLine).toHaveCount(0);
  expect((state.trash || []).map(p => p.id).sort()).toEqual(['page-1', 'page-3']);
  expect(state.trash.find(p => p.id === 'page-3').deleted_status).toBe('archived');
  expect(state.purges || []).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('삭제: before the DB knows the 공유 페이지 휴지통 nothing is sent ("준비 중")', async ({page}) => {
  const state = {pages:PAGES(), trashMissing:true};
  await openList(page, 390, state);
  const list = page.locator('#sharePagesRoot .sp-list-view > .sp-list');
  page.once('dialog', d => void d.accept());
  await list.locator('[data-sp-row-menu="page-2"]').click();
  await page.locator('#spRowMenu').getByRole('button', {name:'삭제', exact:true}).click();
  await expect(page.locator('#sharePagesRoot [data-sp-list-status]')).toContainText('휴지통은 준비 중입니다');
  await expect(list.locator('li')).toHaveCount(2);
  expect(state.requests.filter(r => r.method === 'DELETE')).toHaveLength(0);
});
