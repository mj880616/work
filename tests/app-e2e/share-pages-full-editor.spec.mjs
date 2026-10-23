// SHARE-전체편집: a share page that is one 글 block (every new page) is a full writing screen over the whole content area —
// thin top line (‹ · 초안/게시 · 프로젝트 · 링크 · 저장), the editor's button row stuck under it, a big title, then the text.
// No old block frames. Saving with [저장] or Ctrl/Cmd+S, '저장 안 됨', asking before leaving. Pages with old blocks keep the
// block editor. Mock Supabase only.
import {test, expect} from '@playwright/test';
import {clickView} from './helpers/shell-navigation.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const user = {id:'full-user', email:'full@example.org', user_metadata:{display_name:'전체 편집 QA'}};
const WS = 'full-workspace';
const para = text => ({type:'paragraph', attrs:{style:'body2'}, content:[{type:'text', text}]});
const DOC_PAGE = {id:'page-doc', title:'글 페이지', status:'draft', project_id:null, updated_at:'2026-10-21T01:00:00.000Z',
  blocks:[{type:'doc', doc:{v:'ed1', doc:{type:'doc', content:[para('처음 글')]}}}]};
const OLD_PAGE = {id:'page-old', title:'옛 블록 페이지', status:'published', project_id:null, updated_at:'2026-10-21T01:00:00.000Z',
  blocks:[{type:'summary', text:'3차 교섭 결렬'}, {type:'stages', title:'', items:[{name:'요구안'}, {name:'교섭'}], current:1}]};

function mockApp(page, state) {
  state.writes = [];
  return page.route(SB + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const ok = (data, status = 200) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token:'f-access', refresh_token:'f-refresh', expires_in:3600, expires_at:Math.floor(Date.now() / 1000) + 3600, user});
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id:WS, user_id:user.id, role:'owner', workspace:{id:WS, slug:'f', name:'웹2'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id:WS, name:'웹2'}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id:user.id, display_name:'QA'}]);
    if (path === '/rest/v1/app_share_pages') {
      if (method === 'GET') { const id = url.searchParams.get('id')?.replace(/^eq\./, ''); return ok(id ? state.pages.filter(p => p.id === id) : state.pages); }
      const body = request.postDataJSON();
      state.writes.push({method, body});
      if (method === 'POST') { const row = {id:'page-' + (state.pages.length + 1), ...body, updated_at:'2026-10-22T01:00:00.000Z'}; delete row.workspace_id; state.pages.push(row); return ok([row], 201); }
      if (method === 'PATCH') { const id = url.searchParams.get('id').replace(/^eq\./, ''), row = state.pages.find(p => p.id === id); Object.assign(row, body); return ok([row]); }
    }
    if (path === '/rest/v1/app_share_page_links') return ok([]);
    if (path === '/functions/v1/google-calendar') return ok({connected:false, enabled:false, selected:[], calendars:[], events:[]});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}
async function signIn(page, state) {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await mockApp(page, state);
  await page.goto(loginEntry(testOrigin + '/app/'));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout:20000});
  await clickView(page, 'pages');
  return errors;
}
const OLD_FRAME = '[data-sp-block],.sp-vblock,.sp-block,.sp-canvas,.sp-canvas-cap,[data-sp-add-block],[data-sp-done],[data-sp-cancel],[data-sp-move],[data-sp-block-del],.sp-save-row,section.sp-links';

for (const width of [1280, 1440, 390]) test('a new page fills the content area as one writing screen with no old block frames ' + width, async ({page}) => {
  await page.setViewportSize({width, height:900});
  const state = {pages:[]};
  const errors = await signIn(page, state);
  await page.getByRole('button', {name:'새 공유 페이지', exact:true}).click();
  const editor = page.locator('[data-sp-editor]');
  await expect(editor).toHaveClass(/is-full/);
  await expect(editor.locator('[data-sp-title]')).toBeFocused();
  const box = editor.getByRole('textbox', {name:'본문', exact:true});
  await expect(box).toBeVisible();
  await expect(editor.locator(OLD_FRAME)).toHaveCount(0);
  await expect(page.locator('#web1BoardLegacy')).toBeHidden();
  // Width: the editor takes (almost) all of the content area, and the text box nearly all of the editor.
  const m = await page.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    return {view:r('#pagesView'), editor:r('[data-sp-editor]'), text:r('.sp-full-doc .ed-input'), title:r('[data-sp-title]'), top:r('.sp-topline'), bar:r('.sp-full-doc .ed-bar'),
      nav:document.querySelector('#appNav')?.getBoundingClientRect(), vw:innerWidth, vh:innerHeight};
  });
  expect(m.editor.width / m.view.width).toBeGreaterThanOrEqual(0.98);
  expect(m.text.width / m.editor.width).toBeGreaterThanOrEqual(0.98);
  if (width >= 1024) {
    // Right of the sidebar, to the content area's right edge.
    expect(m.editor.left).toBeGreaterThanOrEqual(m.nav.right);
    expect(m.vw - m.editor.right).toBeLessThanOrEqual(48);
    expect(m.editor.width).toBeGreaterThanOrEqual(m.vw - m.nav.right - 80);
  } else expect(m.editor.width).toBeGreaterThanOrEqual(m.vw - 24);
  // Top line → button row → title → text, and the text reaches the bottom of the screen.
  expect(m.top.bottom).toBeLessThanOrEqual(m.bar.top + 1);
  expect(m.bar.bottom).toBeLessThanOrEqual(m.title.top + 1);
  expect(m.title.bottom).toBeLessThanOrEqual(m.text.top + 1);
  expect(m.top.height).toBeLessThanOrEqual(48);
  expect(m.text.bottom).toBeGreaterThanOrEqual(m.vh - (width < 761 ? 120 : 48));
  // Small top-line buttons (UI-버튼기준): 32px seen (‹ is a plain letter button).
  for (const h of await editor.locator('.sp-topline button:visible:not(.sp-back)').evaluateAll(list => list.map(b => Math.round(b.getBoundingClientRect().height))))
    expect(h).toBeLessThanOrEqual(32);
  const tools = editor.locator('.ed-tools');
  if (width >= 1280) {
    // PC: every row button on one row, no sideways scroll bar; [⋯] holds only its own less used buttons (ED-기본기보강).
    expect(await tools.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await expect(editor.locator('.ed-more-menu [data-ed-moved]')).toHaveCount(0);
    await expect(tools.getByRole('button', {name:'다시하기', exact:true})).toBeVisible();
    // The project and 링크 sit on the top line.
    await expect(editor.locator('[data-sp-project]')).toBeVisible();
    await expect(editor.getByRole('button', {name:'링크', exact:true})).toBeVisible();
    await expect(editor.getByRole('button', {name:'프로젝트·링크', exact:true})).toBeHidden();
  } else {
    // Phone: ‹ · 상태 · ⋯ · 저장; the button row is the grouped one (ED-서식줄묶음): it fits one line, with no bar and no sideways swipe.
    expect(await tools.evaluate(el => getComputedStyle(el).scrollbarWidth)).toBe('none');
    expect(await tools.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await expect(tools.getByRole('button', {name:'글자 서식 고르기', exact:true})).toBeVisible();
    await expect(editor.locator('[data-sp-project]')).toBeHidden();
    await editor.getByRole('button', {name:'프로젝트·링크', exact:true}).click();
    await expect(editor.locator('[data-sp-project]')).toBeVisible();
    await expect(editor.getByRole('button', {name:'링크', exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor.locator('[data-sp-project]')).toBeHidden();
    await expect(editor.getByRole('button', {name:'프로젝트·링크', exact:true})).toBeFocused();
    await editor.locator('[data-sp-title]').click();
  }
  // Write a long text: the page grows and the button row stays stuck under the top line.
  await page.keyboard.type('긴 글 페이지');
  await page.keyboard.press('Enter');
  for (let i = 1; i <= 40; i++) await page.keyboard.type(`${i}번째 줄 한글 입력\n`);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const stuck = await page.evaluate(() => ({top:document.querySelector('.sp-topline').getBoundingClientRect(), bar:document.querySelector('.sp-full-doc .ed-bar').getBoundingClientRect(), y:scrollY}));
  expect(stuck.y).toBeGreaterThan(300);
  expect(Math.round(stuck.top.top)).toBe(0);
  expect(Math.abs(stuck.bar.top - stuck.top.bottom)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('저장: [저장], Ctrl+S and Cmd+S save in place; 저장 안 됨 shows only while there are unsaved changes; leaving asks', async ({page}) => {
  await page.setViewportSize({width:1280, height:900});
  const state = {pages:[structuredClone(DOC_PAGE)]};
  const errors = await signIn(page, state);
  await page.locator('.sp-row').first().click();
  const editor = page.locator('[data-sp-editor]');
  await expect(editor).toHaveClass(/is-full/);
  // An existing page opens with the cursor in the text.
  const box = editor.getByRole('textbox', {name:'본문', exact:true});
  await expect(box).toBeFocused();
  const unsaved = editor.locator('[data-sp-dirty]');
  await expect(unsaved).toBeHidden();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' 더함');
  await expect(unsaved).toHaveText('저장 안 됨');
  await expect(unsaved).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장했어요');
  await expect(unsaved).toBeHidden();
  expect(state.writes.map(w => w.method)).toEqual(['PATCH']);
  expect(state.pages[0].blocks[0].doc.doc.content[0].content[0].text).toBe('처음 글 더함');
  // Still the same editor, cursor in place: typing goes on and undo still works.
  await expect(box).toBeFocused();
  await page.keyboard.type('!');
  await expect(unsaved).toBeVisible();
  await page.keyboard.press('Meta+s');
  await expect(unsaved).toBeHidden();
  expect(state.pages[0].blocks[0].doc.doc.content[0].content[0].text).toBe('처음 글 더함!');
  await editor.locator('.ed-tools').getByRole('button', {name:'되돌리기', exact:true}).click();
  await expect(box).not.toContainText('!');
  await expect(unsaved).toBeVisible();
  // Title and status changes count too; [저장] saves them.
  await editor.locator('[data-sp-title]').fill('글 페이지 고침');
  await editor.locator('[data-sp-set-status="published"]').click();
  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('게시 중이에요');
  expect(state.pages[0]).toMatchObject({title:'글 페이지 고침', status:'published'});
  await expect(unsaved).toBeHidden();
  // Leaving with unsaved changes asks first (the existing confirm), and the browser asks before closing the tab.
  await box.click();
  await page.keyboard.type(' 쓰는 중');
  expect(await page.evaluate(() => { const e = new Event('beforeunload', {cancelable:true}); window.dispatchEvent(e); return e.defaultPrevented; })).toBe(true);
  page.once('dialog', d => { expect(d.message()).toContain('저장하지 않은 내용'); d.dismiss(); });
  await editor.getByRole('button', {name:'공유 페이지 목록으로', exact:true}).click();
  await expect(editor).toBeVisible();
  page.once('dialog', d => d.accept());
  await editor.getByRole('button', {name:'공유 페이지 목록으로', exact:true}).click();
  await expect(editor).toBeHidden();
  await expect(page.locator('#web1BoardLegacy')).toBeVisible();
  expect(state.writes).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('링크 opens a small window on the top line; Esc closes it and focus goes back', async ({page}) => {
  await page.setViewportSize({width:1280, height:900});
  const state = {pages:[structuredClone(DOC_PAGE)]};
  const errors = await signIn(page, state);
  await page.locator('.sp-row').first().click();
  const editor = page.locator('[data-sp-editor]');
  const panel = editor.getByRole('dialog', {name:'링크'});
  await expect(panel).toBeHidden();
  const open = editor.getByRole('button', {name:'링크', exact:true});
  await open.click();
  await expect(panel).toBeVisible();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toContainText('게시 상태일 때만');
  await expect(panel.locator('[data-sp-link-label]')).toBeFocused();
  // Small: well inside the screen, not a big card.
  const box = await panel.boundingBox();
  expect(box.width).toBeLessThanOrEqual(460);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(open).toBeFocused();
  // A press outside closes it too.
  await open.click();
  await expect(panel).toBeVisible();
  await editor.locator('[data-sp-title]').click();
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});

test('narrow PC (1024): format buttons that do not fit go under [⋯] with no sideways scroll bar', async ({page}) => {
  await page.setViewportSize({width:1024, height:800});
  const state = {pages:[structuredClone(DOC_PAGE)]};
  const errors = await signIn(page, state);
  await page.locator('.sp-row').first().click();
  const editor = page.locator('[data-sp-editor]');
  const tools = editor.locator('.ed-tools'), more = tools.getByRole('button', {name:'서식 더 보기', exact:true});
  await expect(more).toBeVisible();
  expect(await tools.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' 더함');
  await more.click();
  await editor.getByRole('group', {name:'서식 더 보기'}).getByRole('button', {name:'되돌리기', exact:true}).click();
  await expect(editor.getByRole('textbox', {name:'본문', exact:true})).toHaveText('처음 글');
  expect(errors).toEqual([]);
});

test('a page with old blocks keeps the block editor; [새 편집기로 바꾸기] is still there', async ({page}) => {
  await page.setViewportSize({width:1280, height:900});
  const state = {pages:[structuredClone(OLD_PAGE)]};
  const errors = await signIn(page, state);
  await page.locator('.sp-row').first().click();
  const editor = page.locator('[data-sp-editor]');
  await expect(editor).not.toHaveClass(/is-full/);
  await expect(editor.locator('.sp-vblock')).toHaveCount(2);
  await expect(editor.getByRole('button', {name:'새 편집기로 바꾸기', exact:true})).toBeVisible();
  await expect(editor.getByRole('button', {name:'+ 글', exact:true})).toBeVisible();
  await editor.getByRole('button', {name:'1번째 블록 한 줄 현황 고치기', exact:true}).click();
  await editor.getByLabel('1번째 블록 한 줄 현황 글', {exact:true}).fill('4차 교섭 예정');
  await editor.getByRole('button', {name:'1번째 블록 한 줄 현황 고치기 완료', exact:true}).click();
  // Ctrl+S saves here too.
  await page.keyboard.press('Control+s');
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장했어요');
  expect(state.pages[0].blocks.map(b => b.type)).toEqual(['summary', 'stages']);
  expect(state.pages[0].blocks[0].text).toBe('4차 교섭 예정');
  await expect(editor).not.toHaveClass(/is-full/);
  expect(errors).toEqual([]);
});
