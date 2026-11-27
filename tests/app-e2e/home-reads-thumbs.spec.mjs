import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noticeText } from './helpers/small-notice.mjs';
import { start as newsStart, openNews } from './helpers/news-server.mjs';
// HOME-읽을거리평가(사용자 2026-11-28 07:04 "홈화면 읽을 거리 왼쪽 스와이프 할 땐 엄지척 엄지다운 버튼 추가 학습해서 추후 추천에 반영"):
// 홈 '읽을 만한 글'·읽을 거리 줄을 왼쪽으로 밀면 맨 왼쪽 평가 칸(위 [좋아요]·아래 [별로예요]). 누르면 서버 표 app_read_ratings에 한 값(지우고 넣기),
// 다시 열어도(새로 고침 포함) 눌린 상태, 같은 단추를 다시 누르면 취소(지우기만). 줄은 목록에서 빠지지 않는다. PC는 우클릭 메뉴 맨 앞 [좋아요]·[별로예요](눌린 것은 ✓).
// 가짜 서버만 쓴다(글·매체 모두 가짜). 시계: 2026-10-06 19:30 KST(home-reads-swipe.spec.mjs와 같음).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const EVENING = '2026-10-06T10:30:00Z';
const uid = n => `00000000-0000-4000-8000-00000000000${n}`;
const READS = [1, 2, 3].map(n => ({ id: uid(n), title: `가상 소식 ${n}`, what: `가상 일 ${n}`, why: `담당 가상지부 ${n}`, source: '가상신문', at: '2026-10-06T00:10:00Z', url: `https://news.example.test/${n}` }));
const ROW = { day: '2026-10-06', reads: READS, reads_at: '2026-10-06T10:00:00Z', suggests: [], suggests_at: null, suggests_done: [] };

// 평가 표 흉내: 작업공간 'w'의 줄만. 고치기(PATCH)는 없다 — 지우기·넣기만 받는다(DB 권한과 같음).
async function ratingsServer(page, store) {
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_read_ratings', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method();
    store.calls.push({ method, query: decodeURIComponent(new URL(req.url()).search), body: method === 'POST' ? req.postDataJSON() : null });
    expect(q.get('workspace_id') ?? 'eq.w').toBe('eq.w');
    if (method === 'GET') return r.fulfill({ json: [...store.rows.values()].map(x => ({ ...x })) });
    if (method === 'DELETE') {
      const col = q.has('news_article_id') ? 'news_article_id' : 'outside_article_id', id = (q.get(col) || '').replace(/^eq\./, '');
      store.rows.delete(`${col}:${id}`); return r.fulfill({ status: 204 });
    }
    if (method === 'POST') {
      const b = req.postDataJSON();
      expect(b.workspace_id).toBe('w');
      expect(Object.keys(b).sort()).toEqual([b.news_article_id ? 'news_article_id' : 'outside_article_id', 'rating', 'workspace_id'].sort());
      const col = b.news_article_id ? 'news_article_id' : 'outside_article_id', key = `${col}:${b[col]}`;
      if (store.rows.has(key)) return r.fulfill({ status: 409, json: { code: '23505' } });
      store.rows.set(key, { news_article_id: b.news_article_id ?? null, outside_article_id: b.outside_article_id ?? null, rating: b.rating });
      return r.fulfill({ status: 201, body: '' });
    }
    throw new Error('평가 표는 고치지 않는다: ' + method);
  });
}

async function bootHome(page, width, height, store) {
  await page.setViewportSize({ width, height });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const beforeLoad = async () => {
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/ai-assist', async r => {
      let body = null; try { body = r.request().postDataJSON(); } catch { body = null; }
      if (body?.kind !== 'home_day_picks') return r.fallback();
      return r.fulfill({ json: { ok: true, kind: 'home_day_picks', day: body.day, picks: ROW } });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_home_day_picks', r => r.fulfill({ json: [ROW] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_news_article_of', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && (u.pathname === '/rest/v1/app_news_items' || u.pathname === '/rest/v1/app_now_signals'), r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_news_marks', r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback());
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_reading_items', r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback());
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_news_now_signals', r => r.fulfill({ status: 201, body: '' }));
    await ratingsServer(page, store);
  };
  await openHome(page, { beforeLoad, now: EVENING });
  return { errors };
}
const item = (page, n) => page.locator(`#journalRoot [data-journal-read="${uid(n)}"]`);
async function swipe(locator, dx) {
  await expect(async () => {
    await expect(locator).toBeVisible();
    const sent = await locator.evaluate((el, { dx }) => {
      if (!el.isConnected) return false;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
      fire('pointerdown', x); for (let i = 1; i <= 10; i++) fire('pointermove', x + dx * i / 10); fire('pointerup', x + dx);
      return true;
    }, { dx });
    expect(sent).toBe(true);
  }).toPass({ timeout: 10000 });
}
async function touchTap(locator) {
  await locator.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, bubbles: true });
  await locator.dispatchEvent('click');
}
// 왼쪽으로 밀어 평가 칸을 연다(그사이 목록이 다시 그려져 칸이 닫혔으면 다시 민다) → 칸 둘을 돌려준다.
async function openRate(page, scope, row) {
  const like = scope.locator('.row-swipe-pair [data-row-swipe-key="like"]'), dislike = scope.locator('.row-swipe-pair [data-row-swipe-key="dislike"]');
  await expect(async () => { await swipe(row, -60); await expect(like).toBeVisible({ timeout: 1000 }); }).toPass({ timeout: 15000 });
  return { like, dislike };
}
const closeOpen = async (page, row) => { await touchTap(row); await expect(page.locator('.row-swipe-pair')).toHaveCount(0); };

test('폰 412 홈: 밀면 맨 왼쪽 평가 칸 → [좋아요] 저장·다시 열어도(새로 고침) 눌림 → 다시 누르면 취소, [별로예요]로 바꾸기, 줄은 그대로', async ({ page }) => {
  test.setTimeout(120000);
  const store = { rows: new Map(), calls: [] };
  const f = await bootHome(page, 412, 900, store);
  const root = page.locator('#journalRoot');
  let cells = await openRate(page, root, item(page, 1));
  // 칸 순서: [평가][저장][숨기기], 평가 칸은 그림만(이름은 aria-label), 처음에는 눌리지 않음.
  await expect(root.locator('.row-swipe-ends > *')).toHaveCount(3);
  await expect(root.locator('.row-swipe-ends > :first-child')).toHaveClass(/row-swipe-pair/);
  await expect(cells.like).toHaveAttribute('aria-label', '좋아요');
  await expect(cells.dislike).toHaveAttribute('aria-label', '별로예요');
  await expect(cells.like).toHaveAttribute('aria-pressed', 'false');
  await expect(cells.dislike).toHaveAttribute('aria-pressed', 'false');
  const box = await cells.like.boundingBox(), down = await cells.dislike.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(60); expect(down.y).toBeGreaterThan(box.y); // 위·아래로 포갠 한 칸
  expect(store.calls.filter(c => c.method !== 'GET')).toEqual([]); // 밀기만으로는 쓰지 않는다

  await touchTap(cells.like);
  await expect.poll(() => store.rows.get(`news_article_id:${uid(1)}`)?.rating).toBe(1);
  expect(await noticeText(page)).toBe('좋아요 — 다음 추천에 반영해요');
  await expect(item(page, 1)).toBeVisible(); // 평가는 줄을 빼지 않는다
  cells = await openRate(page, root, item(page, 1));
  await expect(cells.like).toHaveAttribute('aria-pressed', 'true');
  await closeOpen(page, item(page, 1));

  // 새로 고침해도 서버 값 그대로(기기 저장 없음).
  await page.reload();
  await expect(item(page, 1)).toBeVisible();
  cells = await openRate(page, root, item(page, 1));
  await expect(cells.like).toHaveAttribute('aria-pressed', 'true');
  await expect(cells.dislike).toHaveAttribute('aria-pressed', 'false');
  // 다른 단추 = 바꾸기(지우고 넣기).
  store.calls.length = 0;
  await touchTap(cells.dislike);
  await expect.poll(() => store.rows.get(`news_article_id:${uid(1)}`)?.rating).toBe(-1);
  expect(store.calls.map(c => c.method)).toEqual(['DELETE', 'POST']);
  expect(await noticeText(page)).toBe('별로예요 — 비슷한 글은 덜 추천해요');
  cells = await openRate(page, root, item(page, 1));
  await expect(cells.dislike).toHaveAttribute('aria-pressed', 'true');
  await expect(cells.like).toHaveAttribute('aria-pressed', 'false');
  // 같은 단추 다시 = 취소(지우기만).
  store.calls.length = 0;
  await touchTap(cells.dislike);
  await expect.poll(() => store.rows.size).toBe(0);
  expect(store.calls.map(c => c.method)).toEqual(['DELETE']);
  expect(await noticeText(page)).toBe('별로예요를 취소했어요');
  cells = await openRate(page, root, item(page, 1));
  await expect(cells.dislike).toHaveAttribute('aria-pressed', 'false');
  await expect(cells.like).toHaveAttribute('aria-pressed', 'false');
  await closeOpen(page, item(page, 1));
  await expect(page.locator('#journalRoot [data-journal-read]:visible')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
});

test('PC 1280 홈: 우클릭 메뉴 맨 앞 [좋아요][별로예요] → 누르면 저장, 다시 열면 ✓, 다시 누르면 취소; 마우스 올림 단추는 그대로', async ({ page }) => {
  test.setTimeout(90000);
  const store = { rows: new Map([[`news_article_id:${uid(2)}`, { news_article_id: uid(2), outside_article_id: null, rating: -1 }]]), calls: [] };
  const f = await bootHome(page, 1280, 900, store);
  const menu = page.locator('#rowMenu');
  const openMenu = async n => { await item(page, n).locator('.journal-read-title').click({ button: 'right' }); await expect(menu).toBeVisible(); };
  await expect(item(page, 1).locator('[data-now-act]')).toHaveCount(2); // PC 마우스 올림 단추 [저장][숨기기] 그대로
  await openMenu(1);
  await expect(menu.locator('[data-row-item]')).toHaveText(['좋아요', '별로예요', '저장', '숨기기']);
  await menu.locator('[data-row-item="like"]').click();
  await expect.poll(() => store.rows.get(`news_article_id:${uid(1)}`)?.rating).toBe(1);
  await openMenu(1);
  await expect(menu.locator('[data-row-item]')).toHaveText(['좋아요 ✓', '별로예요', '저장', '숨기기']);
  await menu.locator('[data-row-item="like"]').click();
  await expect.poll(() => store.rows.has(`news_article_id:${uid(1)}`)).toBe(false);
  expect(await noticeText(page)).toBe('좋아요를 취소했어요');
  await openMenu(1);
  await expect(menu.locator('[data-row-item]')).toHaveText(['좋아요', '별로예요', '저장', '숨기기']);
  await page.keyboard.press('Escape');
  // 서버에 이미 있던 평가(다른 기기)도 처음 열 때부터 보인다.
  await openMenu(2);
  await expect(menu.locator('[data-row-item]')).toHaveText(['좋아요', '별로예요 ✓', '저장', '숨기기']);
  await page.keyboard.press('Escape');
  await expect(item(page, 1)).toBeVisible();
  await expect(item(page, 2)).toBeVisible();
  expect(store.calls.some(c => c.method === 'PATCH')).toBe(false);
  expect(f.errors).toEqual([]);
});

test('폰 412 읽을 거리: 같은 평가 칸(맨 왼쪽) + [수정][저장][숨기기], [별로예요] 저장·다시 열어도 눌림·다시 누르면 취소', async ({ page }) => {
  test.setTimeout(120000);
  const store = { rows: new Map(), calls: [] };
  const { errors } = await newsStart(page, 412);
  await ratingsServer(page, store);
  await openNews(page, 412);
  const root = page.locator('#newsRoot'), row = root.locator('[data-nc-item="c1"]');
  await expect(row).toBeVisible();
  let cells = await openRate(page, root, row);
  await expect(root.locator('.row-swipe-ends > *')).toHaveCount(4);
  await expect(root.locator('[data-row-swipe-act="end"] .row-swipe-tx')).toHaveText(['수정', '저장', '숨기기']);
  await touchTap(cells.dislike);
  await expect.poll(() => store.rows.get('news_article_id:c1')?.rating).toBe(-1);
  await expect(row).toBeVisible();
  cells = await openRate(page, root, row);
  await expect(cells.dislike).toHaveAttribute('aria-pressed', 'true');
  await touchTap(cells.dislike);
  await expect.poll(() => store.rows.size).toBe(0);
  cells = await openRate(page, root, row);
  await expect(cells.dislike).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
