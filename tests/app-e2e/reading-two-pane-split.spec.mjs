import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { newsServer } from './helpers/news-server.mjs';
import { checkSplit } from './helpers/split-check.mjs';
// S70-58 READ-두칸보기(사용자 11/26 06:12 "읽을 거리랑 저장한 글 왼쪽 목록 오른쪽 본문 형태로 개편 드래그 폭 조절 가능하게 / 폴드 펼침 이야기임"):
// 칸 나누기 폭(600px~ — 펼친 폴드 기본 화면 약 690px, PC)에서 두 화면 모두 왼쪽 목록 | 오른쪽 글.
// ① 처음 들어오면 맨 위 글이 오른쪽에(저절로 연 글은 읽음으로 치지 않음) ② 다른 글을 누르면 오른쪽만 바뀌고 목록은 그대로
// ③ 가운데 경계를 끌면 폭이 바뀌고 서버(view_prefs.split_ratio.<화면>)에 기억 → 새로고침해도 그대로(공용 checkSplit) ④ 폰 390은 한 칸(누르면 글, 뒤로 = 목록).
// 서버는 흉내, 글·주소는 모두 예시.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const FOLD = [690, 830], PC = [1280, 900];
const id = n => `a7058000-0000-4000-8000-00000000000${n}`;
const BODY = n => `예시 글 ${n}의 첫 문단이에요.\n\n둘째 문단이에요.`;
const rowsOf = () => [1, 2, 3].map(n => ({ id: id(n), workspace_id: 'w', url: `https://example.com/${n}`, title: `예시 저장 글 ${n}`, site: 'example.com',
  saved_at: `2026-11-2${5 - n}T01:00:00Z`, read_at: null, body_state: 'ok', body_at: '2026-11-22T01:00:10Z', business_area_id: null, updated_at: '2026-11-22T01:00:10Z', body: BODY(n) }));

function errorsOf(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
}
async function readingServer(page) {
  const s = { rows: rowsOf(), patches: [] };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table === 'app_reading_items') {
      const rid = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const pick = r => { const { workspace_id, body, ...rest } = r; return (u.searchParams.get('select') || '').includes('body') ? { ...rest, body } : rest; };
      if (method === 'PATCH') { const body = req.postDataJSON?.() || {}; s.patches.push({ id: rid, body }); const r = s.rows.find(x => x.id === rid); if (r) Object.assign(r, body); return ok(r ? [pick(r)] : []); }
      return ok((rid ? s.rows.filter(x => x.id === rid) : s.rows).map(pick));
    }
    if (table === 'app_news_highlights') return ok([]);
    return route.fallback();
  });
  return s;
}
async function goMenu(page, width, name) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: name }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name, exact: true }).click();
}
// 두 칸이 옆으로 나란히(겹치지 않고 위 끝이 같은 줄 근처) 보이는가.
const sideBySide = (page, list, detail) => page.evaluate(([l, d]) => {
  const a = document.querySelector(l).getBoundingClientRect(), b = document.querySelector(d).getBoundingClientRect();
  return a.width > 150 && b.width > 150 && b.left >= a.right - 1 && Math.abs(a.top - b.top) < 80;
}, [list, detail]);
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1);

const rlist = page => page.locator('#readingView [data-rd-list]');
const rdetail = page => page.locator('#readingView [data-rd-detail]');

for (const [width, height] of [FOLD, PC]) {
  test(`저장한 글 두 칸 ${width}: 맨 위 글 오른쪽(읽음 안 침) → 다른 글 누르면 오른쪽만 · 경계 끌기 서버 기억 · 새로고침 유지`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height });
    const errors = errorsOf(page);
    const { prefs } = await openHome(page);
    const s = await readingServer(page);
    await goMenu(page, width, '저장한 글');
    await expect(page.locator('#readingView')).toBeVisible();
    // ① 맨 위 글이 오른쪽에 저절로, 목록은 그대로 보인다. 저절로 연 글은 읽음 저장(read_at) 없음.
    await expect(rdetail(page).locator('.ds-doc-title')).toHaveText('예시 저장 글 1');
    await expect(rlist(page)).toBeVisible();
    await expect(rlist(page).locator(`.rd-row[data-rd-open="${id(1)}"]`)).toHaveClass(/is-open/);
    await expect(rlist(page).locator(`.rd-row[data-rd-open="${id(1)}"]`)).toHaveClass(/is-unread/);
    expect(await sideBySide(page, '#readingView [data-rd-list]', '#readingView [data-rd-detail]')).toBe(true);
    await expect(rdetail(page).locator('[data-rd-back]')).toHaveCount(0);
    await expect(rdetail(page).locator('[data-rd-prose]')).toContainText('예시 글 1의 첫 문단');
    expect(s.patches.filter(x => 'read_at' in x.body)).toEqual([]);
    // ② 둘째 글을 누르면 오른쪽만 바뀐다(목록은 그대로, 누른 글은 읽음).
    await rlist(page).locator(`.rd-row[data-rd-open="${id(2)}"]`).click();
    await expect(rdetail(page).locator('.ds-doc-title')).toHaveText('예시 저장 글 2');
    await expect(rdetail(page).locator('[data-rd-prose]')).toContainText('예시 글 2의 첫 문단');
    await expect(rlist(page)).toBeVisible();
    await expect(rlist(page).locator('.rd-row')).toHaveCount(3);
    await expect.poll(() => s.patches.filter(x => x.id === id(2) && x.body.read_at).length).toBe(1);
    expect(await noSideScroll(page)).toBe(true);
    // ③ 경계: 기본 1/3 → 끌어 절반 → 서버 split_ratio.reading → 새로고침 뒤 그대로 → 두 번 누르면 기본.
    await checkSplit(page, { container: '#readingView .rd-wrap', left: '[data-rd-list]', right: '[data-rd-detail]', name: 'reading', share: 1 / 3, server: prefs,
      reopen: async () => { await expect(page.locator('#readingView')).toBeVisible(); await expect(rdetail(page).locator('.ds-doc-title')).toBeVisible(); } });
    expect(errors).toEqual([]);
  });
}

test('저장한 글 폰 390: 한 칸 — 목록만, 누르면 글(목록 숨음), 뒤로 = 목록', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 860 });
  const errors = errorsOf(page);
  await openHome(page);
  const s = await readingServer(page);
  await goMenu(page, 390, '저장한 글');
  await expect(rlist(page).locator('.rd-row')).toHaveCount(3);
  await expect(rdetail(page)).toBeHidden();
  expect(s.patches).toEqual([]);
  await expect(page.locator('#readingView .rd-wrap > .split-resize-handle')).toHaveCount(0);
  await rlist(page).locator(`.rd-row[data-rd-open="${id(2)}"]`).click();
  await expect(rdetail(page).locator('.ds-doc-title')).toHaveText('예시 저장 글 2');
  await expect(rlist(page)).toBeHidden();
  expect(await noSideScroll(page)).toBe(true);
  await page.goBack();
  await expect(rlist(page)).toBeVisible();
  await expect(rdetail(page)).toBeHidden();
  await expect(page.locator('#readingView')).toBeVisible();
  expect(errors).toEqual([]);
});

const nrow = page => page.locator('#nowPanelAll .now-row');
const ndetail = page => page.locator('#outsideRoot [data-now-detail]');
for (const [width, height] of [FOLD, PC]) {
  test(`읽을 거리 두 칸 ${width}: 맨 위 글 오른쪽 → 다른 글 누르면 오른쪽만 · 경계 끌기 서버 기억 · 새로고침 유지`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height });
    const errors = errorsOf(page);
    const { prefs } = await openHome(page);
    await newsServer(page);
    await goMenu(page, width, '읽을 거리');
    await expect(page.locator('#outsideView')).toBeVisible();
    await expect(nrow(page).first()).toBeVisible();
    // ① 맨 위 글이 오른쪽에 저절로(목록 그대로, 탭 줄도 그대로).
    await expect(nrow(page).first()).toHaveClass(/is-open/);
    await expect(ndetail(page).locator('.nd .ds-doc-title')).toBeVisible();
    await expect(page.locator('#outsideRoot')).toHaveAttribute('data-detail', 'open');
    await expect(page.locator('#nowMain')).toBeVisible();
    await expect(page.locator('#outsideRoot [data-os-tabs]')).toBeVisible();
    expect(await sideBySide(page, '#nowMain', '#outsideRoot [data-now-detail]')).toBe(true);
    await expect(ndetail(page).locator('.nd-back')).toBeHidden();
    // ② 둘째 글을 누르면 오른쪽만 바뀐다.
    const second = nrow(page).nth(1);
    const title = ((await second.locator('.now-open').textContent()) || '').trim();
    await second.locator('.now-open').click();
    await expect(second).toHaveClass(/is-open/);
    await expect(ndetail(page).locator('.nd .ds-doc-title')).toContainText(title.slice(0, 6));
    await expect(page.locator('#nowMain')).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
    // ③ 경계: 기본 PC 3 : 2 · 펼친 폴드 2 : 3 → 끌어 절반 → 서버 split_ratio.now → 새로고침 뒤 그대로 → 두 번 누르면 기본.
    await checkSplit(page, { container: '#outsideRoot', left: '#nowMain', right: '[data-now-detail]', name: 'now', share: width > 760 ? 0.6 : 0.4, server: prefs,
      reopen: async () => { await expect(page.locator('#outsideView')).toBeVisible(); await expect(page.locator('#outsideRoot')).toHaveAttribute('data-detail', 'open'); } });
    expect(errors).toEqual([]);
  });
}

test('읽을 거리 폰 390: 한 칸 — 목록만, 누르면 글 전체(목록 숨음), 뒤로 = 목록', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 860 });
  const errors = errorsOf(page);
  await openHome(page);
  await newsServer(page);
  await goMenu(page, 390, '읽을 거리');
  await expect(nrow(page).first()).toBeVisible();
  await expect(page.locator('#outsideRoot')).toHaveAttribute('data-detail', 'closed');
  await expect(ndetail(page)).toBeHidden();
  await expect(page.locator('#outsideRoot > .split-resize-handle')).toHaveCount(0);
  await nrow(page).first().locator('.now-open').click();
  await expect(ndetail(page).locator('.nd .ds-doc-title')).toBeVisible();
  await expect(page.locator('#nowMain')).toBeHidden();
  expect(await noSideScroll(page)).toBe(true);
  await page.goBack();
  await expect(page.locator('#nowMain')).toBeVisible();
  await expect(page.locator('#outsideRoot')).toHaveAttribute('data-detail', 'closed');
  expect(errors).toEqual([]);
});
