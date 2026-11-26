// S69-BM 저장 버튼(북마클릿)과 저장 창(app/save/): PC 크롬 즐겨찾기 막대 버튼 → 작은 WORK ON+ 창 → 기존 저장한 글 넣기 길(app_reading_items) → '저장됨 ✓' → 창 닫힘.
// 로그인 상태 저장·이미 있음·로그인 안 됨 → 로그인 뒤 이어서 저장·http(s) 아닌 주소 거절·[취소]·폰 크기에서 버튼 줄 없음·화면 글자에 옛 이름 없음.
// 버튼 코드는 javascript: 주소를 누르는 대신 같은 한 줄(bookmarkletLine)을 글 페이지에서 그대로 실행해 본다. 글·주소는 모두 예시, 서버는 흉내.
import { test, expect } from '@playwright/test';
import { testOrigin } from './helpers/test-origin.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { bookmarkletLine } from '../../app/save-bookmarklet-model.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const SAVE = testOrigin + '/app/save/';
const NEW = 'a6900000-0000-4000-8000-000000000001', OLD = 'a6900000-0000-4000-8000-000000000002';
const ARTICLE = 'http://news.example.test/2026/a?x=1';
const user = { id: 'save-test', email: 'save@example.org' };
const saveUrl = (u, t = '') => SAVE + '?u=' + encodeURIComponent(u) + '&t=' + encodeURIComponent(t);

async function server(target, { existing = [] } = {}) {
  const s = { rows: existing.map(r => ({ ...r })), posts: [], deletes: [], imports: 0 };
  await target.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/auth/v1/token') return ok({ access_token: 'save-access', refresh_token: 'save-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
    if (p === '/auth/v1/user') return ok(user);
    if (p === '/rest/v1/app_workspace_members') return ok([{ workspace_id: 'w', role: 'owner', workspace: { id: 'w', name: 'QA', slug: 'qa' } }]);
    if (p === '/functions/v1/note-import') { s.imports += 1; return ok({ ok: true, state: 'failed', reason: 'failed', blocks: [] }); }
    if (p === '/rest/v1/app_reading_items') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const url = (u.searchParams.get('url') || '').replace(/^eq\./, '');
      if (method === 'POST') {
        const body = req.postDataJSON();
        s.posts.push(body);
        if (s.rows.some(r => r.url === body.url)) return ok({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
        const row = { id: NEW, saved_at: '2026-11-24T02:00:00Z', read_at: null, body_state: 'pending', body_at: null, business_area_id: null, updated_at: '2026-11-24T02:00:00Z', ...body };
        s.rows.unshift(row);
        return ok([row], 201);
      }
      if (method === 'DELETE') { s.deletes.push({ id, search: decodeURIComponent(u.search) }); s.rows = s.rows.filter(r => r.id !== id); return route.fulfill({ status: 204 }); }
      return ok(s.rows.filter(r => (!url || r.url === url) && (!id || r.id === id)));
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  return s;
}
const msg = page => page.locator('[data-sv-msg]');
// 먼저 로그인해 둔다(로그인 화면 → 저장 창으로 돌아옴, 주소가 없으니 아무것도 넣지 않음).
async function signedIn(page) {
  await page.goto(testOrigin + '/app/login/?return=' + encodeURIComponent(SAVE));
  await signInWithSession(page, user.email);
  await page.waitForURL(u => u.pathname === '/app/save/');
  await expect(msg(page)).toHaveText('저장할 글 주소를 받지 못했어요');
}
const fakeArticle = (context, html) => context.route('http://news.example.test/**', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));

test('로그인 안 됨 → 이 창에서 로그인 → 이어서 저장, 다시 열면 바로 저장(로그인 상태)', async ({ page, context }) => {
  const s = await server(context);
  await page.goto(saveUrl('https://news.example.com/one', ' 예시 기사 하나 '));
  await page.waitForURL(u => u.pathname === '/app/login/');
  await signInWithSession(page, user.email);
  await page.waitForURL(u => u.pathname === '/app/save/');
  await expect(msg(page)).toHaveText('저장됨 ✓');
  expect(s.posts).toEqual([{ workspace_id: 'w', url: 'https://news.example.com/one', title: '예시 기사 하나', site: 'news.example.com' }]);
  await expect(page.locator('[data-sv-title]')).toHaveText('예시 기사 하나');
  // 저장 창은 원문 받기를 시작하지 않는다(저장한 글 화면이 열릴 때 기존 길로 받는다).
  expect(s.imports).toBe(0);
  // 같은 브라우저에서 다른 글: 로그인 화면 없이 바로 저장.
  await page.goto(saveUrl('https://news.example.com/two', '둘'));
  await expect(msg(page)).toHaveText('저장됨 ✓');
  expect(page.url()).toContain('/app/save/');
  expect(s.posts.map(p => p.url)).toEqual(['https://news.example.com/one', 'https://news.example.com/two']);
  // 화면 글자에 옛 이름이 없다.
  const text = await page.evaluate(() => document.title + ' ' + document.body.innerText);
  expect(text).toContain('WORK ON+');
  expect(text).not.toMatch(/Web2|웹2/i);
});

test('이미 있는 글은 이미 저장됨, [취소]는 방금 넣은 줄만 지운다', async ({ page, context }) => {
  const s = await server(context, { existing: [{ id: OLD, url: 'https://news.example.com/old', title: '옛 글', site: 'news.example.com', saved_at: '2026-11-20T00:00:00Z', read_at: null, body_state: 'ok' }] });
  await signedIn(page);
  await page.goto(saveUrl('https://news.example.com/old', '옛 글'));
  await expect(msg(page)).toHaveText('이미 저장됨');
  await expect(page.locator('[data-sv-act="cancel"]')).toHaveCount(0);
  await page.goto(saveUrl('https://news.example.com/new', '새 글'));
  await expect(msg(page)).toHaveText('저장됨 ✓');
  await page.locator('[data-sv-act="cancel"]').click();
  await expect(msg(page)).toHaveText('취소했어요');
  expect(s.deletes).toHaveLength(1);
  expect(s.deletes[0].id).toBe(NEW);
  expect(s.deletes[0].search).toContain('workspace_id=eq.w');
  expect(s.rows.map(r => r.id)).toEqual([OLD]);
});

test('http·https가 아닌 주소는 서버에 보내지 않고 거절', async ({ page, context }) => {
  const s = await server(context);
  for (const bad of ['javascript:alert(1)', 'file:///etc/hosts', 'chrome://settings', '']) {
    await page.goto(saveUrl(bad, 'x'));
    await expect(msg(page)).toHaveText(bad ? 'http·https 주소만 저장할 수 있어요' : '저장할 글 주소를 받지 못했어요');
    await expect(msg(page)).toHaveClass(/is-bad/);
    expect(new URL(page.url()).pathname).toBe('/app/save/');
  }
  expect(s.posts).toHaveLength(0);
});

test('다른 페이지 틀 안에서는 저장하지 않는다', async ({ page, context }) => {
  const s = await server(context);
  await signedIn(page);
  // 틀 페이지는 시험 서버 주소의 흉내 페이지(다른 주소에서 사설 주소를 틀로 부르면 브라우저가 먼저 막아 저장 창 검사까지 가지 않는다).
  await context.route(testOrigin + '/frame-test.html', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><title>틀</title><iframe src="${saveUrl('https://news.example.com/f', 'f')}"></iframe>` }));
  await page.goto(testOrigin + '/frame-test.html');
  await expect(page.frameLocator('iframe').locator('[data-sv-msg]')).toHaveText('이 창에서는 저장할 수 없어요');
  expect(s.posts).toHaveLength(0);
});

test('버튼 한 줄을 글 페이지에서 실행 → 작은 창이 떠 저장하고 닫힌다', async ({ page, context }) => {
  const s = await server(context);
  await signedIn(page);
  await fakeArticle(context, '<!doctype html><title>예시 &amp; 기사</title><p>본문</p>');
  await page.goto(ARTICLE);
  const line = bookmarkletLine(SAVE);
  const popupWait = context.waitForEvent('page');
  await page.evaluate(code => { (0, eval)(code); }, line.replace(/^javascript:/, ''));
  const popup = await popupWait;
  const closed = popup.waitForEvent('close', { timeout: 15000 });
  await expect(msg(popup)).toHaveText('저장됨 ✓');
  expect(new URL(popup.url()).searchParams.get('u')).toBe(ARTICLE);
  expect(s.posts).toEqual([{ workspace_id: 'w', url: 'https://news.example.test/2026/a?x=1', title: '예시 & 기사', site: 'news.example.test' }]);
  // 창은 연 글 페이지와 끊겨 있다.
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await closed;
});

async function openReadingAdd(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await page.route(SB + '/rest/v1/app_reading_items**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '저장한 글', exact: true }).click();
  await expect(page.locator('#readingView')).toBeVisible();
  await page.locator('[data-screen-tools] [data-rd-add]:visible').click(); // S71-26: ＋는 화면 이름 줄 찾기 오른쪽(폰 앱 머리 줄·PC 맨 위 줄)
  await expect(page.locator('#readingView input.rd-url')).toBeVisible();
}

test('PC 저장한 글 [+ 추가]: 끌어 놓기용 링크와 [한 줄 복사]', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: testOrigin });
  await openReadingAdd(page, 1280);
  const bm = page.locator('#readingView [data-rd-bm]');
  await expect(bm).toBeVisible();
  const link = bm.locator('a[data-rd-bm-link]');
  await expect(link).toHaveText('WORK ON+ 저장');
  await expect(link).toHaveAttribute('href', bookmarkletLine(SAVE));
  // 이 화면에서 링크를 눌러도 실행하지 않는다(창이 뜨지 않음).
  let popups = 0;
  context.on('page', () => { popups += 1; });
  await link.click();
  await page.waitForTimeout(300);
  expect(popups).toBe(0);
  await bm.getByRole('button', { name: '한 줄 복사' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(bookmarkletLine(SAVE));
  // 크고 굵은 버튼 없음: 한 줄 높이.
  const box = await bm.boundingBox();
  expect(box.height).toBeLessThan(40);
});

test('폰 크기에서는 버튼 줄을 만들지 않는다', async ({ page }) => {
  await openReadingAdd(page, 412);
  await expect(page.locator('#readingView [data-rd-bm]')).toHaveCount(0);
  await expect(page.locator('#readingView a[href^="javascript:"]')).toHaveCount(0);
});
