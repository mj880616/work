import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S70-40b ④ READ-목록머리(docs/design/reading-screens.md 2절 A1·A2·5절 ② (가), 명진 11/25 16:16 "추천대로"):
// 저장한 글 왼쪽 목록 머리 줄 — PC 틀(761px~)은 위 줄(app-topline)에 화면 이름이 보이므로 머리 줄 제목을 빼고 보기 탭 + ＋ 아이콘만.
// 글을 열어 왼쪽 칸이 좁아져도(22em) 머리 줄 안 어떤 칸도 잘리지 않는다(scrollWidth ≤ clientWidth). 안 읽은 글이 없으면 '안 읽음'(0 없음).
// 폰(위 줄 없음)은 앱 머리 줄이 화면 이름을 보이므로(S70-57) 머리 줄 제목은 어느 폭에도 없다. 서버는 흉내, 글·주소는 모두 예시.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ID = 'a7040b00-0000-4000-8000-000000000041';
async function open(page, width, { unread = true } = {}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const rows = [{ id: ID, url: 'https://example.com/a', title: '예시 기사 하나', site: 'example.com', saved_at: '2026-11-22T01:00:00Z', read_at: unread ? null : '2026-11-23T00:00:00Z', body_state: 'ok', body_at: '2026-11-22T01:00:10Z', business_area_id: null, updated_at: '2026-11-22T01:00:10Z', body: '첫 문단이에요.' }];
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
  // S71-26 SAVED-머리한줄: ＋는 화면 이름 줄(찾기 오른쪽)로 가 목록 머리 줄(.rd-head)은 없다 — '머리 줄'은 목록 칸 첫 줄(보기 탭)로 잰다.
  const head = page.locator('#readingView [data-rd-list]');
  await expect(page.locator(`#readingView .rd-row[data-rd-open="${ID}"]`)).toBeVisible();
  return { errors, head };
}
// 머리 줄의 보이는 칸이 하나도 잘리지 않았는지: 제목·탭 묶음은 글자가 넘치지 않고(scrollWidth ≤ clientWidth),
// 탭 하나하나·＋는 머리 줄 상자 안에 다 들어온다(누르는 범위 ::after는 보이는 칸이 아니라 재지 않는다).
const clipped = head => head.evaluate(el => {
  // 폰은 탭 묶음이 하단바 위 공용 전환 줄(position:fixed)로 가므로 머리 줄 칸이 아니다 — 재지 않는다.
  const shown = x => x.getClientRects().length && getComputedStyle(x).display !== 'none' && getComputedStyle(x.closest('.rd-switch') || x).position !== 'fixed';
  const box = el.getBoundingClientRect(), bad = [];
  for (const x of el.querySelectorAll('.rd-title, .rd-switch')) if (shown(x) && x.scrollWidth > x.clientWidth + 1) bad.push('넘침 ' + x.className);
  for (const x of el.querySelectorAll('.rd-switch .ds-seg-btn, .rd-add')) {
    if (!shown(x)) continue;
    const r = x.getBoundingClientRect(), sw = x.closest('.rd-switch')?.getBoundingClientRect() || box;
    if (r.left < Math.max(box.left, sw.left) - 1 || r.right > Math.min(box.right, sw.right) + 1) bad.push('잘림 ' + x.textContent.trim());
  }
  return bad;
});

test('목록 머리 제목 안 잘림 PC 1280: 글을 열어 왼쪽 칸이 좁아도 첫 줄 탭이 잘리지 않고, 제목 대신 위 줄 화면 이름·＋', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, head } = await open(page, 1280);
  await page.locator(`#readingView .rd-row[data-rd-open="${ID}"]`).click();
  await expect(page.locator('#readingView [data-rd-detail]')).toBeVisible();
  await expect(page.locator('#appView>.app-topline')).toContainText('저장한 글');
  await expect(head.locator('.rd-title')).toHaveCount(0);
  expect(await clipped(head)).toEqual([]);
  await expect(head.locator('.rd-head, .rd-add')).toHaveCount(0);
  const add = page.locator('#appView>.app-topline [data-rd-add]');
  await expect(add).toHaveClass(/icon-btn/);
  await expect(add).toHaveAttribute('aria-label', '글 추가');
  await expect(add).toHaveText('＋');
  // 탭이 목록 첫 줄 맨 앞.
  const [hb, sb] = await Promise.all([head.boundingBox(), head.locator('.rd-switch').boundingBox()]);
  expect(sb.x - hb.x).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('목록 머리 폰 390: 화면 이름은 앱 머리 줄 한 번(머리 줄 제목 없음), ＋는 앱 머리 줄, 탭은 하단바 위 전환 줄', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, head } = await open(page, 390);
  await expect(page.locator('.mobile-shell-header [data-mobile-view-name]')).toHaveText('저장한 글');
  await expect(head.locator('.rd-title')).toHaveCount(0);
  expect(await clipped(head)).toEqual([]);
  await expect(head.locator('.rd-head, .rd-add')).toHaveCount(0);
  await expect(page.locator('.mobile-shell-header [data-rd-add]')).toHaveAttribute('aria-label', '글 추가');
  expect(errors).toEqual([]);
});

test('보기 탭: 안 읽은 글이 없으면 숫자 0 없이 [안 읽음]', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await open(page, 1280, { unread: false });
  await expect(page.locator('#readingView .rd-switch [data-filter-value]')).toHaveText(['전체', '안 읽음', '밑줄', '메모']);
  expect(errors).toEqual([]);
});

test('목록 머리 PC 1280: 글 보기 제목은 그대로 보인다(목록 머리 제목만 뺌)', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await open(page, 1280);
  await page.locator(`#readingView .rd-row[data-rd-open="${ID}"]`).click();
  await expect(page.locator('#readingView [data-rd-detail] .rd-title')).toBeVisible();
  await expect(page.locator('#readingView [data-rd-detail] .rd-title')).toHaveText('예시 기사 하나');
  expect(errors).toEqual([]);
});
