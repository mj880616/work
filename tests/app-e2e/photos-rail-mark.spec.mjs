import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S71-64 ② 시안 B(사용자 11/26 22:38·22:39 "B"): 넘기는 동안 화면 오른쪽 끝에서 폭 1/6 가로 줄 + 그 왼쪽 '2018년 3월' 이름표,
// 멈추면 1초쯤 뒤 사라짐, 막대를 끄는 동안에도 보임(가만히 있어도), 연도 글자 사이가 붙어 보이지 않음(글자 사이 8px 이상).
// 폰 390·PC 1280. 가짜 사진 칸(1x1 그림)과 지어낸 Supabase 응답만 쓴다. 시계는 2026-10-06 KST.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const pad = n => String(n).padStart(2, '0');
const newest = (a, b) => b.taken_at.localeCompare(a.taken_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
// years해 동안, 해마다 1·6·12월에 사진(해에 따라 장수 1~3장 — 사진이 적은 해가 몰리게).
// crowd: 2015년 이전 해는 사진이 많아(달마다 30장 더) 최근 해 눈금이 막대 위쪽에 몰린다(스크린샷의 붙어 보이던 모양).
function makeMedia(years, crowd = false) {
  const out = [];
  for (let y = 0; y < years; y++) {
    const year = 2026 - y;
    for (const m of [12, 6, 1]) {
      if (year === 2026 && m > 10) continue;
      const n = 1 + ((y + m) % 3) + (crowd && year < 2015 ? 30 : 0);
      for (let i = 0; i < n; i++) { const day = `${year}-${pad(m)}-${pad(10 + i)}`; out.push({ id: `P${year}${pad(m)}${i}`, name: 'p.jpg', day, taken_at: `${day}T0${i + 1}:00:00.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null }); }
    }
  }
  return out;
}
async function fixture(page, { width, years, crowd = false }) {
  const media = makeMedia(years, crowd);
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await openHome(page);
  await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'library') {
      const c = body.cursor;
      const list = media.filter(m => !c || m.taken_at < c.t || (m.taken_at === c.t && m.id < c.id)).sort(newest);
      const items = list.slice(0, body.limit), more = list.length > body.limit;
      return r.fulfill({ json: { items, next_cursor: more ? { t: items.at(-1).taken_at, id: items.at(-1).id } : null, indexing: false } });
    }
    if (body.action === 'months') {
      const months = {};
      for (const m of media) months[m.day.slice(0, 7)] = (months[m.day.slice(0, 7)] || 0) + 1;
      return r.fulfill({ json: { months, total: media.length } });
    }
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
}
async function openPhotos(page, width) {
  if (width <= 760) {
    // S68-37: 저장된 메뉴 순서가 없는 계정은 [사진]이 기본 하단바 칸, 순서를 저장한 계정은 [메뉴] 창 칸이다.
    if (await page.locator('.mobile-tabs [data-view="photos"]').isVisible()) await page.locator('.mobile-tabs [data-view="photos"]').click();
    else { await page.locator('#mobileMenuTab').click(); await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click(); }
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const root = page => page.locator('#photosRoot');
const railOf = page => root(page).locator('[data-photos-rail]');
const box = async loc => (await loc.boundingBox());

for (const [width, touch] of [[390, true], [1280, false]]) {
  test.describe(`사진 위치 줄 ${width}`, () => {
    test.use({ hasTouch: touch, isMobile: touch });
    test('넘기는 동안 오른쪽 1/6 가로 줄·연월 이름표, 멈추면 사라짐, 막대 끄는 동안에도 보임', async ({ page }) => {
      await fixture(page, { width, years: 10 });
      await openPhotos(page, width);
      const rail = railOf(page), mark = rail.locator('[data-photos-rail-mark]'), chip = rail.locator('[data-photos-rail-bubble]');
      await expect(root(page).locator('[data-photos-day]').first()).toBeVisible();
      await expect(mark).toBeHidden({ timeout: 4000 });
      // 마지막 스크롤 시각과 줄이 사라진 시각을 화면 안에서 잰다(시험 부하와 상관없이).
      await mark.evaluate(el => {
        const t = window.__railMark = { scroll: 0, hid: 0 };
        window.addEventListener('scroll', () => { t.scroll = performance.now(); t.hid = 0; }, { capture: true, passive: true });
        new MutationObserver(() => { if (el.hidden) t.hid = performance.now(); }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
      });
      // 넘기면 줄과 이름표가 뜬다.
      await page.mouse.move(width / 2, 500);
      await page.mouse.wheel(0, 500);
      await expect(mark).toBeVisible();
      await expect(chip).toBeVisible();
      await expect(chip).toHaveText(/^\d{4}년 \d{1,2}월$/);
      // 이름표 = 맨 위 줄 아래 처음 보이는 날의 연월(머리 줄이 스크롤로 올라가 있으면 화면 맨 위 기준).
      const want = await page.evaluate(() => {
        const h = document.querySelector('[data-sf-tools="photos"]')?.closest('.mobile-shell-header, .app-topline');
        const edge = Math.max(0, h && h.getClientRects().length ? h.getBoundingClientRect().bottom : 0);
        const d = [...document.querySelectorAll('#photosRoot [data-photos-day]')].find(x => x.getBoundingClientRect().bottom > edge + 1);
        const [y, m] = d.dataset.photosDay.split('-'); return `${y}년 ${Number(m)}월`;
      });
      await expect(chip).toHaveText(want);
      const vw = page.viewportSize().width;
      const m = await box(mark), c = await box(chip);
      expect(Math.abs(m.width - vw / 6)).toBeLessThanOrEqual(3);          // 화면 폭 1/6
      expect(Math.abs(m.x + m.width - vw)).toBeLessThanOrEqual(1);       // 오른쪽 끝에 붙음
      expect(m.height).toBeGreaterThanOrEqual(3); expect(m.height).toBeLessThanOrEqual(4);
      expect(c.x + c.width).toBeLessThanOrEqual(m.x + 1);                // 줄 바로 왼쪽
      expect(m.x - (c.x + c.width)).toBeLessThanOrEqual(8);
      expect(Math.abs((c.y + c.height / 2) - (m.y + m.height / 2))).toBeLessThanOrEqual(2); // 같은 높이
      expect(c.height).toBeLessThanOrEqual(24);                          // 사진을 덜 가리는 작은 칩
      // 줄 높이 = 손잡이 가운데.
      const th = await box(rail.locator('[data-photos-rail-thumb]'));
      expect(Math.abs((th.y + th.height / 2) - (m.y + m.height / 2))).toBeLessThanOrEqual(2);
      // 멈추면 1초쯤 뒤 사라진다(막대 손잡이보다 먼저).
      await expect(mark).toBeHidden({ timeout: 3000 });
      const gap = await page.evaluate(() => window.__railMark.hid - window.__railMark.scroll);
      expect(gap).toBeGreaterThanOrEqual(900); expect(gap).toBeLessThanOrEqual(2000);
      await expect(chip).toBeHidden();
      // 막대를 끄는 동안: 가만히 있어도(1.5초) 줄·이름표가 그대로, 놓으면 1초쯤 뒤 사라짐.
      await page.mouse.wheel(0, 1);
      await expect(rail).toHaveClass(/is-awake/);
      const r = await box(rail), t = await box(rail.locator('[data-photos-rail-thumb]'));
      const x = r.x + r.width - 10;
      await page.mouse.move(x, t.y + t.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, r.y + r.height * 0.5, { steps: 6 });
      await expect(mark).toBeVisible();
      await expect(chip).toHaveText(/^\d{4}년 \d{1,2}월$/);
      const m2 = await box(mark);
      expect(Math.abs(m2.y + m2.height / 2 - (r.y + r.height * 0.5))).toBeLessThanOrEqual(3); // 손가락 높이
      await page.waitForTimeout(1500);
      await expect(mark).toBeVisible();
      await expect(chip).toBeVisible();
      await page.mouse.up();
      await expect(mark).toBeHidden({ timeout: 4000 });
    });
    test('연도 표 글자 사이가 붙어 보이지 않음(26년 자료, 글자 사이 8px 이상)', async ({ page }) => {
      await fixture(page, { width, years: 26, crowd: true });
      await openPhotos(page, width);
      const rail = railOf(page);
      await expect(rail).toBeVisible();
      const labels = await rail.locator('.photos-rail-year').all();
      expect(labels.length).toBeGreaterThan(1);
      const boxes = [];
      for (const l of labels) boxes.push(await box(l));
      boxes.sort((a, b) => a.y - b.y);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].y - (boxes[i - 1].y + boxes[i - 1].height)).toBeGreaterThanOrEqual(8);
    });
  });
}
