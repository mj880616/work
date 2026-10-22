// SHARE-편집폭(2026-10-22 요청): PC 공유 페이지 편집 화면의 '받는 사람에게 보이는 모양' 칸은 오른쪽 가장자리를 끌어 폭을 바꾼다
// (공용 app/split-resize.js 한쪽 끌기). 편집 화면에만 적용, 받는 사람이 보는 Web1 공유 페이지(640px)는 그대로.
// 기본 폭은 예전(640px)보다 넓고, 바꾼 폭은 이 기기에 기억, 두 번 누르면 기본, 키보드, 사이드바 숨김에도 비율 유지.
import {test, expect} from '@playwright/test';
import {clickView} from './helpers/shell-navigation.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ORIGIN = testOrigin;
const user = {id:'width-user', email:'width@example.org', user_metadata:{display_name:'폭 QA'}};
const WS = 'width-workspace';
const TOKEN = 'd'.repeat(64);
const PAGE = {id:'page-w', title:'폭 조절 시험', status:'published', project_id:null, updated_at:'2026-10-20T01:00:00.000Z', blocks:[
  {type:'summary', text:'편집 칸 폭 조절 시험용 한 줄 현황'},
  {type:'updates', title:'', items:[{date:'10/19', text:'교섭 결렬'}]},
]};

function mockApp(page, state) {
  return page.route(SB + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const ok = data => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token:'w-access', refresh_token:'w-refresh', expires_in:3600, expires_at:Math.floor(Date.now() / 1000) + 3600, user});
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id:WS, user_id:user.id, role:'owner', workspace:{id:WS, slug:'w', name:'웹2'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id:WS, name:'웹2'}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id:user.id, display_name:'QA'}]);
    if (path === '/rest/v1/app_share_pages') {
      if (method === 'GET') { const id = url.searchParams.get('id')?.replace(/^eq\./, ''); return ok(id ? state.pages.filter(p => p.id === id) : state.pages); }
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
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await mockApp(page, {pages:[structuredClone(PAGE)]});
  await page.goto(loginEntry(ORIGIN + '/app/'));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout:20000});
  await clickView(page, 'pages');
  await page.locator('.sp-row').first().click();
  const editor = page.locator('[data-sp-editor]');
  await expect(editor.locator('.sp-vblock')).toHaveCount(PAGE.blocks.length);
  return {editor, errors};
}
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const stored = page => page.evaluate(() => localStorage.getItem('kptu-split-ratio:share-edit'));
// Box widths of the editor and its canvas (the dashed 'what the reader sees' box).
const measure = (editor) => editor.evaluate(el => {
  const c = el.querySelector('.sp-canvas').getBoundingClientRect(), e = el.getBoundingClientRect(), s = getComputedStyle(el);
  const inner = e.width - (parseFloat(s.paddingLeft) || 0) - (parseFloat(s.paddingRight) || 0);
  return {canvas:c.width, inner, ratio:c.width / inner, left:c.left, right:c.right};
});
async function dragTo(page, handle, x) {
  const b = await handle.boundingBox(), y = b.y + Math.min(b.height / 2, 120);
  await page.mouse.move(b.x + b.width / 2, y); await page.mouse.down();
  await page.mouse.move((b.x + b.width / 2 + x) / 2, y, {steps:4}); await page.mouse.move(x, y, {steps:4}); await page.mouse.up(); await settle(page);
}
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

for (const width of [1280, 1440, 1920]) {
  test(`PC ${width}: 편집 칸 오른쪽 가장자리 끌기·기억·두 번 눌러 기본·키보드·사이드바 숨김, 받는 화면 폭 그대로`, async ({page, browser}) => {
    const {editor, errors} = await openEditor(page, width);
    const handle = editor.locator(':scope > .split-resize-handle');
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAttribute('role', 'separator');
    await expect(handle).toHaveAttribute('aria-valuenow', '85');
    await settle(page);

    // 기본 폭은 예전 640px보다 넓다(오른쪽이 비지 않게).
    let m = await measure(editor);
    expect(m.canvas).toBeGreaterThan(700);
    expect(Math.abs(m.ratio - 0.85)).toBeLessThan(0.02);
    expect(await stored(page)).toBeNull();
    // 경계선은 칸 오른쪽 가장자리 안쪽에 붙는다.
    const hb = await handle.boundingBox();
    expect(Math.abs(hb.x + hb.width - m.right)).toBeLessThan(3);
    // 설정·링크 칸은 기존 폭(760px)을 지킨다.
    expect((await editor.locator('.sp-settings').boundingBox()).width).toBeLessThanOrEqual(761);

    // 끌기: 60%로 좁힘 → 기억.
    await dragTo(page, handle, m.left + m.inner * 0.6);
    m = await measure(editor); expect(Math.abs(m.ratio - 0.6)).toBeLessThan(0.02);
    await expect(handle).toHaveAttribute('aria-valuenow', '60');
    expect(Math.abs(Number(await stored(page)) - 0.6)).toBeLessThan(0.02);
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // 사이드바 숨김: 편집 칸이 넓어져도 고른 비율을 지킨다.
    const before = m; await page.locator('[data-nav-toggle]').click();
    await expect(page.locator('#appView')).toHaveClass(/nav-collapsed/); await settle(page);
    m = await measure(editor); expect(m.canvas).toBeGreaterThan(before.canvas + 20); expect(Math.abs(m.ratio - 0.6)).toBeLessThan(0.02);
    await page.locator('[data-nav-toggle]').click(); await expect(page.locator('#appView')).not.toHaveClass(/nav-collapsed/); await settle(page);

    // 다시 열어도(목록 → 같은 글) 같은 폭.
    await editor.locator('[data-sp-close]').click();
    await page.locator('.sp-row').first().click();
    await expect(editor.locator('.sp-vblock')).toHaveCount(PAGE.blocks.length); await settle(page);
    m = await measure(editor); expect(Math.abs(m.ratio - 0.6)).toBeLessThan(0.02);

    // 끝까지: 왼쪽으로는 최소 480px, 오른쪽으로는 편집 칸 가득.
    await dragTo(page, handle, 5); m = await measure(editor); expect(m.canvas).toBeGreaterThanOrEqual(479); expect(m.canvas).toBeLessThan(490);
    await dragTo(page, handle, width + 40); m = await measure(editor); expect(m.ratio).toBeGreaterThan(0.98);
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // 두 번 누르면 기본 폭, 기억도 지운다.
    await handle.dblclick(); await settle(page);
    m = await measure(editor); expect(Math.abs(m.ratio - 0.85)).toBeLessThan(0.02);
    await expect(handle).toHaveAttribute('aria-valuenow', '85'); expect(await stored(page)).toBeNull();

    // 키보드: 초점 → ←로 2%씩, Home은 최소 폭, End는 가득.
    await handle.focus(); await expect(handle).toBeFocused();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
    await settle(page); m = await measure(editor); expect(Math.abs(m.ratio - 0.75)).toBeLessThan(0.02);
    expect(Math.abs(Number(await stored(page)) - 0.75)).toBeLessThan(0.02);
    await page.keyboard.press('ArrowRight'); await settle(page);
    expect(Math.abs((await measure(editor)).ratio - 0.77)).toBeLessThan(0.02);
    await page.keyboard.press('Home'); await settle(page); expect((await measure(editor)).canvas).toBeLessThan(490);
    await page.keyboard.press('End'); await settle(page); expect((await measure(editor)).ratio).toBeGreaterThan(0.98);

    // 받는 사람이 보는 화면(Web1 공유 페이지)은 폭이 그대로(640px 이하), 이 기기의 편집 폭 설정과 무관하다.
    const reader = await browser.newPage();
    await reader.setViewportSize({width, height:900});
    await mockApp(reader, {pages:[structuredClone(PAGE)]});
    await reader.goto(ORIGIN + '/share/#t=' + TOKEN);
    await expect(reader.locator('h1.sr-title')).toHaveText(PAGE.title);
    const wrap = await reader.locator('.sr-wrap').first().boundingBox();
    expect(wrap.width).toBeLessThanOrEqual(640.5);
    expect(await reader.evaluate(() => localStorage.getItem('kptu-split-ratio:share-edit'))).toBeNull();
    await reader.close();
    expect(errors).toEqual([]);
  });
}

test('1024 아래(태블릿·폰)에는 경계선이 없고 편집 칸 폭은 예전 그대로', async ({page}) => {
  const {editor, errors} = await openEditor(page, 900);
  await expect(editor.locator(':scope > .split-resize-handle:visible')).toHaveCount(0);
  expect((await measure(editor)).canvas).toBeLessThanOrEqual(640.5);
  await page.setViewportSize({width:390, height:800}); await settle(page);
  await expect(page.locator('.split-resize-handle:visible')).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('저장소가 막혀도 기본 폭으로 그리고 끌기는 된다(기억만 없음)', async ({page}) => {
  await page.addInitScript(() => {
    const deny = () => { throw new DOMException('blocked', 'SecurityError'); };
    const s = Storage.prototype, get = s.getItem, set = s.setItem, rm = s.removeItem;
    s.getItem = function (k) { return String(k).startsWith('kptu-split-ratio:') ? deny() : get.call(this, k); };
    s.setItem = function (k, v) { return String(k).startsWith('kptu-split-ratio:') ? deny() : set.call(this, k, v); };
    s.removeItem = function (k) { return String(k).startsWith('kptu-split-ratio:') ? deny() : rm.call(this, k); };
  });
  const {editor, errors} = await openEditor(page, 1280);
  const handle = editor.locator(':scope > .split-resize-handle'); await expect(handle).toBeVisible(); await settle(page);
  let m = await measure(editor); expect(Math.abs(m.ratio - 0.85)).toBeLessThan(0.02);
  await dragTo(page, handle, m.left + m.inner * 0.65); m = await measure(editor); expect(Math.abs(m.ratio - 0.65)).toBeLessThan(0.02);
  await handle.dblclick(); await settle(page); expect(Math.abs((await measure(editor)).ratio - 0.85)).toBeLessThan(0.02);
  expect(errors).toEqual([]);
});
