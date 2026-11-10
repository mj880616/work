import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// HOME-하루채우기 ①(2026-11-09 시안 ④): 홈 [하루] 오늘 한 일 아래 '오늘 사진' 한 줄. 폰 390·폴드 884·PC 1440.
// 가짜 서버만 쓴다: onedrive-photos(연결·그달 사진·사진 바이트), app_diary_stars(별표 하나). 시계는 2026-10-06 10:00 KST(home-entry.mjs).
// 그날 일정 '오전 일정'은 10:00~11:00(home-entry.mjs) — 그 시간에 찍은 사진이 별표 다음.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const WIDTHS = [[390, 844], [884, 1104], [1440, 900]];
const kst = (h, m = 0, s = 0) => new Date(Date.UTC(2026, 9, 6, h - 9, m, s)).toISOString();
const p = (id, taken, name = id + '.jpg') => ({ id, name, taken_at: taken, approx: false });
// 13장: 연속 촬영 B1·B2(1초 사이)는 한 장만 → 12장. 별표 S, 일정 시간 E, 캡처 C.
const DAY = [
  p('A1', kst(8)), p('B1', kst(9, 0, 0)), p('B2', kst(9, 0, 1)), p('E', kst(10, 30)), p('C', kst(9, 30), 'Screenshot_1.png'), p('S', kst(21)),
  ...['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'].map((id, i) => p(id, kst(12 + i))),
];

async function boot(page, width, height) {
  await page.setViewportSize({ width, height });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const writes = [];
  const beforeLoad = async () => {
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'photos') return r.fulfill({ json: { month: body.month, days: body.month === '2026-10' ? { '2026-10-06': DAY } : {}, truncated: false } });
      if (body.action === 'photo-delete') writes.push(body.action); // sync는 일기 화면이 여는 원드라이브 맞추기(쓰기 아님)
      return r.fulfill({ json: {} });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => {
      if (r.request().method() !== 'GET') { writes.push('star'); return r.fulfill({ status: 500, json: {} }); }
      return r.fulfill({ json: [{ source: 'onedrive', item_key: 'S', taken_day: '2026-10-06' }] });
    });
  };
  await openHome(page, { beforeLoad });
  return { errors, writes };
}
const home = page => page.locator('#journalRoot');

for (const [width, height] of WIDTHS) {
  test(`${width}: 오늘 사진 한 줄 — 별표·일정 시간 먼저, 연속 촬영 한 장, 캡처 뒤, 폭만큼 칸 + 마지막 '+n'`, async ({ page }) => {
    const f = await boot(page, width, height);
    const box = home(page).locator('[data-journal-photos]');
    await expect(box).toBeVisible();
    await expect(box.locator('.journal-heading')).toHaveText('오늘 사진');
    await expect(box.locator('[data-journal-photos-count]')).toHaveText('12');
    await expect(box.locator('[data-journal-photos-open]')).toHaveText('사진 보기 ›');
    await expect(box.locator('[data-journal-photo]').first()).toBeVisible();
    // 그려진 뒤 같은 순간에 한 번에 읽는다(칸 수·위치·순서).
    const m = await box.evaluate(el => {
      const strip = el.querySelector('[data-journal-photo-strip]'), s = strip.getBoundingClientRect();
      const cells = [...strip.querySelectorAll('.journal-photo-cell')].map(c => { const r = c.getBoundingClientRect(); return { top: Math.round(r.top), left: r.left, right: r.right, w: Math.round(r.width), key: c.dataset.journalPhotoKey || '', more: c.dataset.ext || '' }; });
      const fill = document.querySelector('#journalRoot [data-journal-fill]'), done = document.querySelector('#journalRoot [data-journal-done-day]'), mat = document.querySelector('#journalRoot [data-journal-materials]');
      return { width: s.width, left: s.left, right: s.right, cells, order: !!(done.compareDocumentPosition(fill) & 4) && !!(fill.compareDocumentPosition(mat) & 4),
        reads: !!el.parentElement.querySelector('[data-journal-reads]:not([hidden])'), suggests: !!el.parentElement.querySelector('[data-journal-suggest]'), docW: document.documentElement.scrollWidth, vw: innerWidth };
    });
    expect(m.order).toBe(true);
    const cols = Math.floor((m.width + 4) / 60);
    expect(m.cells.length).toBe(Math.min(cols, 12));
    expect(new Set(m.cells.map(c => c.top)).size).toBe(1); // 한 줄
    expect(m.cells.every(c => c.w === 56 && c.left >= m.left - 0.5 && c.right <= m.right + 0.5)).toBe(true);
    const shown = m.cells.filter(c => c.key), last = m.cells[m.cells.length - 1];
    if (cols < 12) { expect(last.more).toBe(`+${12 - shown.length}`); expect(shown.length).toBe(cols - 1); }
    else expect(last.more).toBe('');
    expect(shown.map(c => c.key).slice(0, 3)).toEqual(['S', 'E', 'A1'].slice(0, Math.min(3, shown.length)));
    expect(shown.some(c => c.key === 'B2')).toBe(false);
    if (cols >= 12) expect(shown[shown.length - 1].key).toBe('C');
    expect(m.reads || m.suggests).toBe(false); // ②·③는 서버 연결 전이라 칸 없음
    expect(m.docW).toBeLessThanOrEqual(m.vw);
    // 사진 보기 → 그날 일기. 별표·지우기 같은 쓰기 없음.
    await box.locator('[data-journal-photos-open]').click();
    await expect(page.locator('#diaryView')).toBeVisible();
    expect(f.writes).toEqual([]);
    expect(f.errors).toEqual([]);
  });
}

test("HOME-오늘사진빨리: 사진 없는 날은 '그날 사진 0 · 없음', 칸 높이는 사진 한 줄 그대로", async ({ page }) => {
  const f = await boot(page, 390, 844);
  const box = home(page).locator('[data-journal-photos]');
  await expect(box.locator('[data-journal-photo]').first()).toBeVisible();
  const withPhotos = await box.evaluate(el => Math.round(el.getBoundingClientRect().height));
  await home(page).locator('[data-journal-date="2026-10-05"]').click();
  await expect(home(page).locator('[data-journal-title]')).toHaveText('10월 5일 월요일');
  await expect(box).toBeVisible();
  await expect(box.locator('.journal-heading')).toHaveText('그날 사진');
  await expect(box.locator('[data-journal-photos-count]')).toHaveText('0');
  await expect(box.locator('[data-journal-photos-empty]')).toHaveText('없음');
  await expect(box.locator('[data-journal-photo]')).toHaveCount(0);
  expect(await box.evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(withPhotos);
  expect(f.errors).toEqual([]);
});

test('HOME-오늘사진빨리: 홈이 처음 보일 때 오늘 사진 자리가 이미 있고, 사진이 와도 칸 높이·아래 칸 위치가 그대로', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // 홈이 처음 보인 순간(앱 공개 표시)의 '오늘 사진' 자리와 아래 칸 위치를 적어 둔다.
  await page.addInitScript(() => {
    window.addEventListener('kptu:app-ui-ready', () => requestAnimationFrame(() => {
      const box = document.querySelector('#journalRoot [data-journal-photos]'), mat = document.querySelector('#journalRoot [data-journal-materials]');
      window.__atReveal = box && !box.closest('[hidden]') ? { h: Math.round(box.getBoundingClientRect().height), matTop: Math.round(mat.getBoundingClientRect().top - box.getBoundingClientRect().top) } : null;
    }), { once: true });
  });
  let photosAsked = 0;
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'photos') { if (body.month === '2026-10') photosAsked++; await new Promise(res => setTimeout(res, 400)); return r.fulfill({ json: { month: body.month, days: body.month === '2026-10' ? { '2026-10-06': DAY } : {}, truncated: false } }); }
      return r.fulfill({ json: {} });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
  } });
  const box = home(page).locator('[data-journal-photos]');
  await expect(box.locator('[data-journal-photo]').first()).toBeVisible();
  const at = await page.evaluate(() => window.__atReveal);
  expect(at).not.toBeNull();
  const now = await box.evaluate(el => ({ h: Math.round(el.getBoundingClientRect().height), matTop: Math.round(document.querySelector('#journalRoot [data-journal-materials]').getBoundingClientRect().top - el.getBoundingClientRect().top) }));
  expect(now.h).toBe(at.h);
  expect(now.matTop).toBe(at.matTop);
  await page.waitForLoadState('networkidle');
  expect(photosAsked).toBe(1); // 이번 달 목록은 미리 받기와 홈이 한 번만 받는다
});

test('HOME-오늘사진빨리: 홈에서 바로 다른 탭으로 가면 사진 읽기를 멈추고, 돌아오면 이어서 채운다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'photos') { await new Promise(res => setTimeout(res, 800)); return r.fulfill({ json: { month: body.month, days: body.month === '2026-10' ? { '2026-10-06': DAY } : {}, truncated: false } }); }
      return r.fulfill({ json: {} });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
  } });
  await clickView(page, 'calendar');
  await expect(page.locator('#calendarView')).toBeVisible();
  await page.waitForTimeout(1200); // 목록이 온 뒤에도 홈 밖에서는 사진 칸을 채우지 않는다
  expect(await home(page).locator('[data-journal-photo]').count()).toBe(0);
  await clickView(page, 'home');
  await expect(home(page).locator('[data-journal-photo]').first()).toBeVisible();
  await expect(home(page).locator('[data-journal-photos-count]')).toHaveText('12');
  expect(errors).toEqual([]);
});
