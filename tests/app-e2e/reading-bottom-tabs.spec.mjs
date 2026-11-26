// S68-48 READ-보기탭아래(명진 11/23 12:42 "안읽음 전체 밑줄도 다른 버튼 있는 메뉴처럼 하단 가운데 정렬"):
// 저장한 글 [안 읽음 n][전체][밑줄]은 위쪽 칩 줄이 아니라 공용 ⑤ 보기 바꾸기(.ds-seg). 자리는 노트 보기 탭과 같은 공용 폰 전환 줄 규칙 —
// 폰(390·412)·펼친 폴드(700, 폰 틀) 하단바 바로 위 가운데(목록 마지막 줄을 가리지 않음, 좌우 밀기로 넘김), PC 틀(904·1280) 제목 줄 오른쪽.
// 글·주소는 모두 예시. 서버는 흉내(표는 owner RLS REST).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const id = n => `a6848000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function readingServer(page) {
  // 안 읽은 글 24개 + 읽은 글 1개(목록이 화면보다 길게 — 마지막 줄 가림 확인용).
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: id(i + 1), url: `https://example.com/${i + 1}`, title: `예시 글 ${i + 1}`, site: 'example.com',
    saved_at: `2026-11-2${i % 3}T0${i % 9}:00:00Z`, read_at: i === 24 ? '2026-11-21T02:00:00Z' : null, body_state: 'ok',
    body_at: '2026-11-21T01:00:10Z', business_area_id: null, updated_at: '2026-11-21T01:00:10Z',
  }));
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname !== '/rest/v1/app_reading_items') return route.fallback();
    const one = (u.searchParams.get('id') || '').replace(/^eq\./, '');
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.method() === 'PATCH') { const r = rows.find(x => x.id === one); if (r) Object.assign(r, req.postDataJSON()); return ok(r ? [r] : []); }
    const sel = (u.searchParams.get('select') || '').includes('body');
    return ok((one ? rows.filter(x => x.id === one) : rows).map(r => (sel ? { ...r, body: '예시 본문이에요.' } : r)));
  });
}

async function openReading(page, width) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await readingServer(page);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '저장한 글', exact: true }).click();
  await expect(page.locator('#readingView')).toBeVisible();
  const list = page.locator('#readingView [data-rd-list]');
  // S70-24: 처음은 [전체] — 25줄.
  await expect(list.locator('.rd-row')).toHaveCount(25);
  return { errors, list };
}
const box = async l => { const b = await l.boundingBox(); expect(b).not.toBeNull(); return b; };
async function swipe(locator, dx) {
  await locator.evaluate((el, { dx }) => {
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 12);
    const tc = (type, cx) => { const t = new Touch({ identifier: 1, target: el, clientX: cx, clientY: y }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] })); };
    tc('touchstart', x); for (let i = 1; i <= 10; i++) tc('touchmove', x + dx * i / 10); tc('touchend', x + dx);
  }, { dx });
}

for (const width of [390, 412, 700]) {
  test(`저장한 글 보기 탭 ${width}: 하단바 바로 위 가운데 · 공용 ⑤ · 위쪽 칩 줄 없음 · 마지막 줄 안 가림 · 밀어서 넘김`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, list } = await openReading(page, width);
    const sw = list.locator('.rd-switch');
    await expect(sw).toHaveClass(/(^|\s)ds-seg(\s|$)/);
    await expect(sw.locator('button.ds-seg-btn[data-filter-value]')).toHaveText(['전체', '안 읽음 24', '밑줄', '메모']);
    await expect(sw).toHaveAttribute('aria-label', '저장한 글 보기');
    await expect(list.locator('.rd-chips, .filter-chips')).toHaveCount(0);
    expect(await sw.evaluate(e => getComputedStyle(e).position)).toBe('fixed');
    const s = await box(sw), tabs = await box(page.locator('.mobile-tabs'));
    expect(Math.abs(s.x + s.width / 2 - width / 2), '가운데').toBeLessThan(4);
    expect(s.y + s.height, '하단바 바로 위').toBeLessThanOrEqual(tabs.y + 1);
    expect(tabs.y - (s.y + s.height), '하단바에 붙음').toBeLessThan(8);
    // 전환 줄 몫(--kptu-switch-dock)이 잡혀 목록 끝 여백이 생긴다 — 맨 끝으로 내리면 마지막 줄이 탭 줄 위에서 끝난다.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kptu-switch-dock').trim())).not.toBe('0px');
    const last = list.locator('.rd-row').last();
    await page.evaluate(() => { const v = document.getElementById('readingView'); v.scrollTop = v.scrollHeight; window.scrollTo(0, document.documentElement.scrollHeight); document.scrollingElement.scrollTop = 1e6; });
    await expect(async () => { const r = await box(last), s2 = await box(sw); expect(r.y + r.height).toBeLessThanOrEqual(s2.y + 1); }).toPass({ timeout: 5000 });
    // [+ 추가]는 머리 줄 그대로.
    await expect(list.locator('.rd-head .rd-add')).toBeVisible();
    // 탭을 누르면 바뀌고, 목록(머리줄)을 좌우로 밀면 옆 탭.
    await sw.locator('[data-filter-value="unread"]').click();
    await expect(list.locator('.rd-row')).toHaveCount(24);
    await swipe(list.locator('.rd-head'), -160);
    await expect(sw.locator('[data-filter-value="marks"]')).toHaveAttribute('aria-checked', 'true');
    await swipe(list.locator('.rd-head'), 160);
    await swipe(list.locator('.rd-head'), 160);
    await expect(sw.locator('[data-filter-value="all"]')).toHaveAttribute('aria-checked', 'true');
    if (process.env.S68_48_SHOTS) await page.screenshot({ path: `${process.env.S68_48_SHOTS}/reading-${width}.png` });
    // 글을 열면(폰은 목록 대신) 탭 줄도 없다.
    await list.locator('.rd-row').first().click();
    await expect(page.locator('#readingView [data-rd-detail]')).toBeVisible();
    await expect(sw).toBeHidden();
    expect(errors).toEqual([]);
  });
}

for (const width of [904, 1280]) {
  // S70-40b ④ READ-목록머리(명진 11/25 "추천대로" ② (가)): PC 틀은 위 줄에 화면 이름이 있어 머리 줄 제목이 없다 — 탭이 맨 앞, ＋가 줄 끝.
  test(`저장한 글 보기 탭 ${width}: PC 틀은 머리 줄 맨 앞(제목 없음, ＋ 앞), 따로 칩 줄 없음`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, list } = await openReading(page, width);
    const sw = list.locator('.rd-head > .rd-switch');
    await expect(sw).toBeVisible();
    await expect(sw).toHaveClass(/(^|\s)ds-seg(\s|$)/);
    expect(await sw.evaluate(e => getComputedStyle(e).position)).not.toBe('fixed');
    await expect(list.locator('.rd-chips, .filter-chips')).toHaveCount(0);
    await expect(list.locator('.rd-head .rd-title')).toHaveCount(0);
    const s = await box(sw), add = await box(list.locator('.rd-head .rd-add')), head = await box(list.locator('.rd-head'));
    expect(Math.abs((s.y + s.height / 2) - (add.y + add.height / 2)), '머리 줄 한 줄').toBeLessThan(4);
    expect(s.x - head.x).toBeLessThanOrEqual(1);
    expect(s.x + s.width).toBeLessThanOrEqual(add.x + 1);
    await sw.locator('[data-filter-value="unread"]').click();
    await expect(list.locator('.rd-row')).toHaveCount(24);
    if (process.env.S68_48_SHOTS) await page.screenshot({ path: `${process.env.S68_48_SHOTS}/reading-${width}.png` });
    expect(errors).toEqual([]);
  });
}
