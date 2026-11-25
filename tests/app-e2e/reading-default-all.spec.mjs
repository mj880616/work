// S70-24 READ-저장한글기본전체(명진 11/25 11:11 "이거 전체를 기본으로 / 안읽음이 아니라 / 탭 누르면 전체가 나오는",
// 11:12 "여기 메뉴랑 밑에 줄이랑 여백 없어서 답답함"):
// 메뉴 [저장한 글] → 늘 [전체](처음·다른 탭 갔다가 다시 눌러도), 탭 차례 [전체]가 맨 앞, 주소에 ?tab=marks로 들어오면 [밑줄].
// 보기 탭이 든 머리줄과 목록 첫 줄 사이 간격은 공용 간격 값(theme-tokens.css --ds-view-tabs-below = --ds-chip-row-above) 이상.
// 글·주소는 모두 예시. 서버는 흉내(표는 owner RLS REST).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const id = n => `a7024000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 안 읽은 글 1개 + 읽은 글 2개: [안 읽음]이면 한 줄, [전체]면 세 줄.
const ROWS = [1, 2, 3].map(n => ({
  id: id(n), url: `https://example.com/${n}`, title: `예시 글 ${n}`, site: 'example.com', saved_at: `2026-11-2${n}T01:00:00Z`,
  read_at: n === 3 ? null : '2026-11-24T02:00:00Z', body_state: 'ok', body_at: '2026-11-21T01:00:10Z', business_area_id: null, updated_at: '2026-11-21T01:00:10Z',
}));

async function readingServer(page) {
  await page.route(SB + '/rest/v1/app_reading_items**', route => {
    const u = new URL(route.request().url()), one = (u.searchParams.get('id') || '').replace(/^eq\./, '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(one ? ROWS.filter(r => r.id === one) : ROWS) });
  });
}
const list = page => page.locator('#readingView [data-rd-list]');
const tabs = page => list(page).locator('.rd-switch [data-filter-value]');
const tab = (page, v) => list(page).locator(`.rd-switch [data-filter-value="${v}"]`);
async function menuReading(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '저장한 글', exact: true }).click();
  await expect(page.locator('#readingView')).toBeVisible();
}
// 다른 화면으로(홈). 메뉴 모양과 상관없이 라우터로 옮긴다 — 보는 것은 다시 [저장한 글] 메뉴를 눌렀을 때의 보기.
async function toHome(page) {
  await page.evaluate(() => window.KPTURouter.go('home'));
  await expect(page.locator('#homeView')).toBeVisible();
}

for (const [label, width] of [['pc-1280', 1280], ['phone-390', 390]]) {
  test(`저장한 글 기본 보기 [전체] · 탭 맨 앞 · 다시 누르면 [전체] · 머리줄 아래 공용 간격 (${label})`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 860 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openHome(page);
    await readingServer(page);
    await menuReading(page, width);
    // 처음: [전체]가 골라져 있고 전체 글(세 줄)이 보인다. 탭 차례는 [전체]가 맨 앞.
    await expect(tabs(page)).toHaveText(['전체', '안 읽음 1', '밑줄', '메모']);
    await expect(tab(page, 'all')).toHaveAttribute('aria-checked', 'true');
    await expect(list(page).locator('.rd-row')).toHaveCount(3);
    expect(new URL(page.url()).searchParams.get('tab')).toBeNull();

    // 머리줄(보기 탭 줄) 아래 끝과 목록 첫 줄 위 끝 사이 간격 ≥ 공용 간격 값.
    const gap = await page.evaluate(() => {
      const head = document.querySelector('#readingView [data-rd-list] .rd-head'), rows = document.querySelector('#readingView [data-rd-list] .rd-rows');
      const want = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ds-chip-row-above'));
      return { gap: rows.getBoundingClientRect().top - head.getBoundingClientRect().bottom, want };
    });
    expect(gap.want).toBeGreaterThan(0);
    expect(gap.gap).toBeGreaterThanOrEqual(gap.want - 0.5);

    // 다른 탭([안 읽음])으로 갔다가 메뉴를 다시 누르면 [전체].
    await tab(page, 'unread').click();
    await expect(tab(page, 'unread')).toHaveAttribute('aria-checked', 'true');
    await expect(list(page).locator('.rd-row')).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get('tab')).toBe('unread');
    await menuReading(page, width);
    await expect(tab(page, 'all')).toHaveAttribute('aria-checked', 'true');
    await expect(list(page).locator('.rd-row')).toHaveCount(3);

    // 다른 화면에 갔다가 메뉴로 다시 들어와도 [전체].
    await tab(page, 'marks').click();
    await expect(tab(page, 'marks')).toHaveAttribute('aria-checked', 'true');
    await toHome(page);
    await menuReading(page, width);
    await expect(tab(page, 'all')).toHaveAttribute('aria-checked', 'true');
    await expect(list(page).locator('.rd-row')).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test(`주소에 ?tab=marks로 들어오면 [밑줄] 보기 (${label})`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 860 });
    await openHome(page, { query: '?view=reading&tab=marks', beforeLoad: () => readingServer(page) });
    await expect(page.locator('#readingView')).toBeVisible();
    await expect(tab(page, 'marks')).toHaveAttribute('aria-checked', 'true');
    await expect(tabs(page)).toHaveText(['전체', '안 읽음 1', '밑줄', '메모']);
  });
}
