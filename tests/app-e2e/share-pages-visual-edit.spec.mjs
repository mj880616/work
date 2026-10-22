// SHARE-보이는편집: the Web2 share page editor shows the blocks exactly as the Web1 reader draws them, and turns one
// block at a time into its input fields in place. Mock Supabase only; storage path is the existing owner REST.
import {test, expect} from '@playwright/test';
import {clickView} from './helpers/shell-navigation.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ORIGIN = testOrigin;
const user = {id:'visual-user', email:'visual@example.org', user_metadata:{display_name:'보이는 편집 QA'}};
const WS = 'visual-workspace';
const TOKEN = 'c'.repeat(64);
const PAGE = {id:'page-1', title:'○○민자철도 교섭 현황', status:'published', project_id:null, updated_at:'2026-10-20T01:00:00.000Z', blocks:[
  {type:'summary', text:'3차 교섭 결렬, 10월 말 조정 신청 예정'},
  {type:'stages', title:'', items:[{name:'요구안 확정'}, {name:'교섭'}, {name:'조정'}], current:1},
  {type:'schedule', title:'다가오는 일정', items:[{date:'10/24', text:'조정 신청'}, {date:'10/31', text:'집회'}]},
  {type:'issues', title:'', items:[{title:'인력 충원', body:'2인 1조 보장\n결원 즉시 충원'}]},
  {type:'links', title:'', items:[{label:'요구안 PDF', url:'https://example.org/demand.pdf'}]},
  {type:'updates', title:'', items:[{date:'10/19', text:'교섭 결렬'}]},
]};
const TYPES = PAGE.blocks.map(b => b.type);

function mockApp(page, state) {
  state.patches = [];
  return page.route(SB + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const ok = (data, status = 200) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token:'v-access', refresh_token:'v-refresh', expires_in:3600, expires_at:Math.floor(Date.now() / 1000) + 3600, user});
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id:WS, user_id:user.id, role:'owner', workspace:{id:WS, slug:'v', name:'웹2'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id:WS, name:'웹2'}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id:user.id, display_name:'QA'}]);
    if (path === '/rest/v1/app_share_pages') {
      expect(url.searchParams.get('workspace_id')).toBe('eq.' + WS);
      if (method === 'GET') { const id = url.searchParams.get('id')?.replace(/^eq\./, ''); return ok(id ? state.pages.filter(p => p.id === id) : state.pages); }
      if (method === 'PATCH') {
        const body = request.postDataJSON();
        state.patches.push({url:url.search, body});
        if (state.failNext) { state.failNext = false; return route.fulfill({status:503, contentType:'application/json', body:'{"message":"unavailable"}'}); }
        const row = state.pages[0];
        Object.assign(row, body, {updated_at:'2026-10-21T0' + state.patches.length + ':00:00.000Z'});
        return ok([row]);
      }
      return ok([]);
    }
    if (path === '/rest/v1/app_share_page_links') return ok([]);
    if (path === '/functions/v1/share-page-read') return ok({ok:true, page:{title:state.pages[0].title, blocks:state.pages[0].blocks}});
    if (path === '/functions/v1/google-calendar') return ok({connected:false, enabled:false, selected:[], calendars:[], events:[]});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}
async function openEditor(page, width) {
  await page.setViewportSize({width, height:900});
  const state = {pages:[structuredClone(PAGE)]};
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await mockApp(page, state);
  await page.goto(loginEntry(ORIGIN + '/app/'));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout:20000});
  await clickView(page, 'pages');
  await page.locator('.sp-row').first().click();
  const editor = page.locator('[data-sp-editor]');
  await expect(editor.locator('.sp-vblock')).toHaveCount(PAGE.blocks.length);
  return {state, editor, errors};
}
// The drawn blocks (reader: children of #srMain after the title; editor: the inert drawing in each shown block).
const readerBlocks = page => page.locator('#srMain > :not(h1)').evaluateAll(nodes => nodes.map(n => n.outerHTML));
const editorBlocks = editor => editor.locator('.sp-vblock > [inert]').evaluateAll(nodes => nodes.map(n => { const c = n.cloneNode(true); c.removeAttribute('inert'); return c.outerHTML; }));
const LOOK = ['.sr-summary', '.sr-stage.is-current .sr-stage-mark', '.sr-schedule .sr-h', '.sr-date', '.sr-issue', '.sr-issue-body', '.sr-link', '.sr-update'];
const looks = (scope, selectors) => scope.evaluate((root, list) => list.map(sel => {
  const n = root.querySelector(sel); if (!n) return null;
  const s = getComputedStyle(n), r = n.getBoundingClientRect();
  return {sel, bg:s.backgroundColor, color:s.color, size:s.fontSize, weight:s.fontWeight, line:s.lineHeight, pad:s.padding, radius:s.borderRadius, border:s.borderLeft, white:s.whiteSpace, width:Math.round(r.width)};
}), selectors);

for (const width of [390, 1280]) test('editor shows each block exactly as the reader draws it ' + width, async ({page, browser}) => {
  const {editor, errors} = await openEditor(page, width);
  expect(await editor.locator('.sp-vblock').evaluateAll(n => n.map(x => x.dataset.spType))).toEqual(TYPES);
  // No input field until a block is pressed.
  await expect(editor.locator('[data-sp-blocks] :is(input,textarea)')).toHaveCount(0);
  await expect(editor.locator('[data-sp-title]')).toHaveValue(PAGE.title);
  await expect(editor.locator('[data-sp-title]')).toHaveClass(/sr-title/);
  const inEditor = await editorBlocks(editor);
  const editorLook = await looks(editor.locator('.sp-canvas-page'), LOOK);
  const titleSize = await editor.locator('[data-sp-title]').evaluate(n => getComputedStyle(n).fontSize);
  // The reader at the same width, with the same saved page.
  const reader = await browser.newPage();
  await reader.setViewportSize({width, height:900});
  await mockApp(reader, {pages:[structuredClone(PAGE)]});
  await reader.goto(ORIGIN + '/share/#t=' + TOKEN);
  await expect(reader.locator('h1.sr-title')).toHaveText(PAGE.title);
  expect(inEditor).toEqual(await readerBlocks(reader));
  const readerLook = await looks(reader.locator('#srMain'), LOOK);
  // Same colours, type and spacing. Widths match up to tablet width (both 640px columns); on a phone the editor sits inside the app frame.
  const strip = list => list.map(({width:w, ...rest}) => rest);
  expect(strip(editorLook)).toEqual(strip(readerLook));
  // SHARE-편집폭: from 1024px the editor box is wider than the reader's 640px column (draggable); the reader itself stays 640px.
  if (width > 760 && width < 1024) expect(editorLook.map(x => x.width)).toEqual(readerLook.map(x => x.width));
  if (width >= 1024) editorLook.forEach((x, i) => expect(x.width).toBeGreaterThanOrEqual(readerLook[i].width));
  expect(titleSize).toBe(await reader.locator('h1.sr-title').evaluate(n => getComputedStyle(n).fontSize));
  // Links in the editor drawing do not open (the block is one [고치기] button) and are out of the Tab order.
  await expect(editor.locator('.sp-vblock .sr-link')).toHaveAttribute('href', 'https://example.org/demand.pdf');
  expect(await editor.locator('.sp-vblock .sr-link').evaluate(a => a.closest('[inert]') !== null)).toBe(true);
  await reader.close();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

for (const width of [390, 1280]) test('press a block to edit it in place, then 완료 or 취소 ' + width, async ({page}) => {
  const {state, editor, errors} = await openEditor(page, width);
  // Press the schedule block: only that block becomes fields, at the same place.
  await editor.getByRole('button', {name:'3번째 블록 일정 고치기', exact:true}).click();
  const open = editor.locator('[data-sp-block="2"]');
  await expect(open).toHaveClass(/is-editing/);
  await expect(editor.locator('.sp-block.is-editing')).toHaveCount(1);
  await expect(editor.locator('.sp-vblock')).toHaveCount(5);
  await expect(editor.getByLabel('3번째 블록 제목', {exact:true})).toBeFocused();
  await expect(editor.getByLabel('3번째 블록 제목', {exact:true})).toHaveValue('다가오는 일정');
  await editor.getByLabel('일정 2번째 줄 내용', {exact:true}).fill('본사 앞 집회');
  await editor.getByRole('button', {name:'3번째 블록 일정에 줄 추가', exact:true}).click();
  await editor.getByLabel('일정 3번째 줄 날짜', {exact:true}).fill('11/7');
  await editor.getByLabel('일정 3번째 줄 내용', {exact:true}).fill('결의대회');
  await editor.getByRole('button', {name:'3번째 블록 일정 고치기 완료', exact:true}).click();
  // Back to the reader look with the new rows; focus returns to the block.
  await expect(editor.locator('.sp-block.is-editing')).toHaveCount(0);
  await expect(editor.locator('[data-sp-block="2"] .sr-table tr')).toHaveCount(3);
  await expect(editor.locator('[data-sp-block="2"] .sr-table')).toContainText('결의대회');
  await expect(editor.getByRole('button', {name:'3번째 블록 일정 고치기', exact:true})).toBeFocused();

  // 취소 puts back what the block was when it was opened.
  await editor.getByRole('button', {name:'1번째 블록 한 줄 현황 고치기', exact:true}).click();
  await editor.getByLabel('1번째 블록 한 줄 현황 글', {exact:true}).fill('지우면 안 되는 글?');
  await editor.getByRole('button', {name:'1번째 블록 한 줄 현황 고친 것 취소', exact:true}).click();
  await expect(editor.locator('[data-sp-block="0"] .sr-summary')).toHaveText(PAGE.blocks[0].text);

  // Keyboard: Tab to a block, Enter opens it, Esc finishes it keeping what was typed.
  await editor.getByRole('button', {name:'2번째 블록 진행 단계 고치기', exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(editor.getByLabel('2번째 블록 제목', {exact:true})).toBeFocused();
  await editor.locator('[data-sp-block="1"] input[type="radio"]').nth(2).check();
  await editor.getByLabel('2번째 블록 제목', {exact:true}).focus();
  await page.keyboard.press('Escape');
  await expect(editor.getByRole('button', {name:'2번째 블록 진행 단계 고치기', exact:true})).toBeFocused();
  await expect(editor.locator('[data-sp-block="1"] .sr-stage[aria-current="step"]')).toHaveText('조정');

  // Opening another block finishes the open one (nothing typed is lost).
  await editor.getByRole('button', {name:'6번째 블록 업데이트 기록 고치기', exact:true}).click();
  await editor.getByLabel('업데이트 기록 1번째 줄 내용', {exact:true}).fill('교섭 결렬, 조정 신청 결정');
  await editor.getByRole('button', {name:'4번째 블록 쟁점·요구 고치기', exact:true}).click();
  await expect(editor.locator('[data-sp-block="5"] .sr-update-text')).toHaveText('교섭 결렬, 조정 신청 결정');
  await expect(editor.locator('[data-sp-block="3"]')).toHaveClass(/is-editing/);

  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장했어요');
  const saved = state.pages[0].blocks;
  expect(saved[2]).toEqual({type:'schedule', title:'다가오는 일정', items:[{date:'10/24', text:'조정 신청'}, {date:'10/31', text:'본사 앞 집회'}, {date:'11/7', text:'결의대회'}]});
  expect(saved[0]).toEqual(PAGE.blocks[0]);
  expect(saved[1].current).toBe(2);
  expect(saved[5].items[0].text).toBe('교섭 결렬, 조정 신청 결정');
  expect(state.patches[0].url).toContain('updated_at=eq.');
  // After saving every block shows as it will look.
  await expect(editor.locator('.sp-block.is-editing')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('[+ 블록] between blocks, ⋯ move and delete, saved in the shown order', async ({page}) => {
  const {state, editor, errors} = await openEditor(page, 390);
  // Insert a 진행 단계 between the 1st and 2nd block: it opens in place.
  await editor.getByLabel('1번째와 2번째 블록 사이에 블록 넣기', {exact:true}).click();
  await editor.getByRole('button', {name:'1번째 블록 다음에 쟁점·요구 넣기', exact:true}).click();
  await expect(editor.locator('[data-sp-block="1"]')).toHaveClass(/is-editing/);
  await expect(editor.locator('[data-sp-block="1"]')).toHaveAttribute('data-sp-type', 'issues');
  await expect(editor.getByLabel('2번째 블록 제목', {exact:true})).toBeFocused();
  await editor.getByLabel('쟁점·요구 1번째 줄 쟁점', {exact:true}).fill('안전 인력');
  await editor.getByRole('button', {name:'2번째 블록 쟁점·요구 고치기 완료', exact:true}).click();
  await expect(editor.locator('[data-sp-block="1"] .sr-issue-title')).toHaveText('안전 인력');
  // The ⋯ menu moves a shown block; it stays open on the moved block for the next press.
  await editor.getByLabel('2번째 블록 쟁점·요구 메뉴', {exact:true}).click();
  await editor.getByRole('button', {name:'2번째 블록 쟁점·요구 아래로', exact:true}).click();
  await expect(editor.locator('[data-sp-block="2"]')).toHaveAttribute('data-sp-type', 'issues');
  await expect(editor.getByRole('button', {name:'3번째 블록 쟁점·요구 아래로', exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor.getByLabel('3번째 블록 쟁점·요구 메뉴', {exact:true})).toBeFocused();
  // Delete a block with content asks first.
  await editor.getByLabel('6번째 블록 자료·링크 메뉴', {exact:true}).click();
  page.once('dialog', d => d.dismiss());
  await editor.getByRole('button', {name:'6번째 블록 자료·링크 지우기', exact:true}).click();
  await expect(editor.locator('[data-sp-block]')).toHaveCount(7);
  page.once('dialog', d => d.accept());
  await editor.getByRole('button', {name:'6번째 블록 자료·링크 지우기', exact:true}).click();
  await expect(editor.locator('[data-sp-block]')).toHaveCount(6);
  await expect(editor.getByRole('button', {name:'6번째 블록 업데이트 기록 고치기', exact:true})).toBeFocused();
  // Add at the end with the bottom bar: opens there.
  await editor.getByRole('button', {name:'+ 한 줄 현황', exact:true}).click();
  await expect(editor.locator('[data-sp-block="6"]')).toHaveClass(/is-editing/);
  await editor.getByLabel('7번째 블록 한 줄 현황 글', {exact:true}).fill('끝 요약');
  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장했어요');
  expect(state.pages[0].blocks.map(b => b.type)).toEqual(['summary', 'stages', 'issues', 'schedule', 'issues', 'updates', 'summary']);
  expect(state.pages[0].blocks[2]).toEqual({type:'issues', title:'', items:[{title:'안전 인력', body:''}]});
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('a failed save keeps the open block and what was typed', async ({page}) => {
  const {state, editor, errors} = await openEditor(page, 1280);
  await editor.getByRole('button', {name:'1번째 블록 한 줄 현황 고치기', exact:true}).click();
  await editor.getByLabel('1번째 블록 한 줄 현황 글', {exact:true}).fill('저장 실패해도 남는 글');
  state.failNext = true;
  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장하지 못했어요. 글은 그대로 있으니');
  await expect(editor.locator('[data-sp-block="0"]')).toHaveClass(/is-editing/);
  await expect(editor.getByLabel('1번째 블록 한 줄 현황 글', {exact:true})).toHaveValue('저장 실패해도 남는 글');
  expect(state.pages[0].blocks[0].text).toBe(PAGE.blocks[0].text);
  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장했어요');
  expect(state.pages[0].blocks[0].text).toBe('저장 실패해도 남는 글');
  await expect(editor.locator('[data-sp-block="0"] .sr-summary')).toHaveText('저장 실패해도 남는 글');
  expect(state.patches).toHaveLength(2);
  expect(errors).toEqual([]);
});
