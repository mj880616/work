import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S71-26 SAVED-머리한줄(명진 11/26 "+ 하고 돋보기 합칠 수 있지 않을까? ㅋ + 를 돋보기 우측으로.."):
// 저장한 글 ＋(글 추가)는 화면 이름 줄 찾기 오른쪽 맨 끝 — 폰 390은 앱 머리 줄 [W 저장한 글 · 찾기 · ＋], PC 1280은 맨 위 줄 검색 칸 오른쪽.
// ＋ 하나만 있던 목록 머리 줄(.rd-head)은 그리지 않는다(숨김이 아니라 없음). ＋를 누르면 글 저장 칸이 열리고 다시 누르면 닫힌다. 서버는 흉내, 글·주소는 예시.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ID = 'a7040b00-0000-4000-8000-000000000071';
async function open(page, width) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const rows = [{ id: ID, url: 'https://example.com/a', title: '예시 기사 하나', site: 'example.com', saved_at: '2026-11-22T01:00:00Z', read_at: null, body_state: 'ok', body_at: '2026-11-22T01:00:10Z', business_area_id: null, updated_at: '2026-11-22T01:00:10Z', body: '첫 문단이에요.' }];
  await page.route(SB + '/**', async route => {
    const u = new URL(route.request().url()), p = u.pathname, table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    const ok = d => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
    if (table === 'app_reading_items') { const id = (u.searchParams.get('id') || '').replace(/^eq\./, ''); return ok(id ? rows.filter(r => r.id === id) : rows); }
    if (table === 'app_news_highlights') return ok([]);
    return route.fallback();
  });
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '저장한 글', exact: true }).click();
  await expect(page.locator(`#readingView .rd-row[data-rd-open="${ID}"]`)).toBeVisible();
  return errors;
}
const box = async l => (await l.boundingBox());

for (const width of [390, 1280]) {
  test(`저장한 글 ${width}: ＋는 화면 이름 줄 찾기 오른쪽 맨 끝, ＋만 있던 줄 없음, ＋로 글 저장 칸 열림`, async ({ page }) => {
    test.setTimeout(60000);
    const errors = await open(page, width);
    const line = page.locator(width <= 760 ? '#appView>.mobile-shell-header' : '#appView>.app-topline');
    const find = line.locator(width <= 760 ? '[data-screen-find-slot]' : '[data-search-slot]');
    const add = line.locator('[data-screen-tools] [data-rd-add]');
    await expect(add).toBeVisible();
    await expect(add).toHaveAttribute('aria-label', '글 추가');
    await expect(add).toHaveText('＋');
    // 찾기 다음이 ＋: 같은 줄(세로 가운데가 같음), 찾기 오른쪽 끝 ≤ ＋ 왼쪽.
    const [f, a] = await Promise.all([box(find), box(add)]);
    expect(Math.abs((f.y + f.height / 2) - (a.y + a.height / 2)), '한 줄').toBeLessThan(4);
    expect(f.x + f.width).toBeLessThanOrEqual(a.x + 1);
    // 폰은 ＋가 머리 줄 맨 오른쪽 끝(그 오른쪽에 보이는 단추 없음).
    if (width <= 760) expect(await add.evaluate(el => { const r = el.getBoundingClientRect().right; return [...el.closest('header').querySelectorAll('button,a')].filter(b => b.getClientRects().length && b.getBoundingClientRect().left >= r - 1).length; })).toBe(0);
    // 목록 안에는 ＋도, ＋만 있던 머리 줄도 없다(그리지 않음).
    await expect(page.locator('#readingView [data-rd-add]')).toHaveCount(0);
    await expect(page.locator('#readingView .rd-head')).toHaveCount(0);
    // 폰: 화면 이름 줄 바로 아래가 목록 첫 내용(사이에 따로 한 줄이 없다). S70-83: 목록 위 폴더 상자가 있으면 그 상자가 첫 내용.
    if (width <= 760) {
      const [h, r] = await Promise.all([box(line), box(page.locator('#readingView [data-rd-folders] .ft-box, #readingView .rd-row').first())]);
      expect(r.y - (h.y + h.height), '머리 줄과 첫 줄 사이').toBeLessThan(24);
    }
    // ＋ → 글 저장 칸 열림, 다시 ＋ → 닫힘.
    await expect(add).toHaveAttribute('aria-expanded', 'false');
    await add.click();
    await expect(page.locator('#readingView [data-rd-form] input.rd-url')).toBeVisible();
    await expect(add).toHaveAttribute('aria-expanded', 'true');
    await add.click();
    await expect(page.locator('#readingView [data-rd-form]')).toHaveCount(0);
    await expect(add).toHaveAttribute('aria-expanded', 'false');
    expect(errors).toEqual([]);
  });
}

test('저장한 글 ＋는 이 화면에서만: 다른 화면으로 가면 화면 이름 줄에 저장한 글 ＋가 보이지 않는다', async ({ page }) => {
  test.setTimeout(60000);
  await open(page, 390);
  await expect(page.locator('.mobile-shell-header [data-rd-add]')).toBeVisible();
  await page.locator('.mobile-tabs [data-view="home"]').click();
  await expect(page.locator('[data-rd-add]')).toBeHidden();
});
