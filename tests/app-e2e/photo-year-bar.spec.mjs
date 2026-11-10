import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// PHOTO-연도막대겹침(S49-45, 요청함 11/04 17:21·17:22): 오른쪽 날짜 막대(빠른 이동 막대).
// ① 막대는 보기 칩·출처 버튼 줄 아래부터(버튼과 겹치지 않음) ② 연도 글자끼리 겹치지 않음(1년·10년·26년 시험 자료) ③ 누르는 폭·손잡이 높이 44px 이상
// ④ 스크롤하면 손잡이가 나타나고 잠시 뒤 사라짐 ⑤ 끌면 '2025년 10월' 말풍선, 놓으면 그 달로 이동 ⑥ 막대를 누르면 그 자리로 점프, 아래 사진은 열리지 않음.
// 폰 412·펼친 폴드 884·PC 1440. 가짜 사진 칸(1x1 그림)과 지어낸 Supabase 응답만 쓴다. 시계는 2026-10-06 KST.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const pad = n => String(n).padStart(2, '0');
const newest = (a, b) => b.taken_at.localeCompare(a.taken_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
// years해 동안, 해마다 1·6·12월에 사진(해에 따라 장수 1~3장 — 사진이 적은 해가 몰리게).
function makeMedia(years) {
  const out = [];
  for (let y = 0; y < years; y++) {
    const year = 2026 - y;
    for (const m of [12, 6, 1]) {
      if (year === 2026 && m > 10) continue;
      const n = 1 + ((y + m) % 3);
      for (let i = 0; i < n; i++) { const day = `${year}-${pad(m)}-${pad(10 + i)}`; out.push({ id: `P${year}${pad(m)}${i}`, name: 'p.jpg', day, taken_at: `${day}T0${i + 1}:00:00.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null }); }
    }
  }
  return out;
}
async function fixture(page, { width, years }) {
  const media = makeMedia(years);
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
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const root = page => page.locator('#photosRoot');
const railOf = page => root(page).locator('[data-photos-rail]');
const box = async loc => (await loc.boundingBox());
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const [width, touch] of [[412, true], [884, false], [1440, false]]) {
  test.describe(`사진 연도 막대 ${width}`, () => {
    test.use({ hasTouch: touch, isMobile: touch });
    for (const years of [1, 10, 26]) {
      test(`${years}년 자료: 버튼 아래부터·연도 글자 겹침 없음·손잡이 44px`, async ({ page }) => {
        await fixture(page, { width, years });
        await openPhotos(page, width);
        const rail = railOf(page);
        await expect(rail).toBeVisible();
        await expect(root(page).locator('[data-photos-open]').first()).toBeVisible();
        // 위 버튼 줄(출처 버튼 포함) 맨 아래보다 막대 맨 위가 아래.
        const bar = await box(root(page).locator('[data-photos-bar]'));
        const rb = await box(rail);
        expect(rb.y).toBeGreaterThanOrEqual(bar.y + bar.height);
        for (const b of await root(page).locator('.photos-tools button, .photos-tools select').all()) {
          if (!(await b.isVisible())) continue;
          expect(overlap(await box(b), rb)).toBe(false);
        }
        // 연도 글자: 하나 이상, 서로 겹치지 않고, 막대 안.
        const labels = await rail.locator('.photos-rail-year').all();
        expect(labels.length).toBeGreaterThan(0);
        if (years === 1) expect(labels.length).toBe(1);
        const boxes = [];
        for (const l of labels) boxes.push(await box(l));
        for (let i = 0; i < boxes.length; i++) {
          expect(boxes[i].y).toBeGreaterThanOrEqual(rb.y - 1);
          expect(boxes[i].y + boxes[i].height).toBeLessThanOrEqual(rb.y + rb.height + 1);
          for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
        }
        if (years === 26) expect(labels.length).toBeLessThan(26);
        // 손잡이 높이 44px 이상, 막대가 깨어 있을 때 누르는 폭 44px 이상(폰).
        await rail.evaluate(el => el.classList.add('is-awake'));
        expect((await box(rail.locator('[data-photos-rail-thumb]'))).height).toBeGreaterThanOrEqual(44);
        if (touch) expect((await box(rail)).width).toBeGreaterThanOrEqual(44);
      });
    }
    test('스크롤하면 손잡이가 나타났다 사라지고, 끌면 말풍선·놓으면 이동, 누르면 점프, 막대 위에서는 사진이 열리지 않음', async ({ page }) => {
      await fixture(page, { width, years: 10 });
      await openPhotos(page, width);
      const rail = railOf(page), dayEls = root(page).locator('[data-photos-day]');
      await expect(dayEls.first()).toBeVisible();
      // 처음에 잠깐 보였다가 사라진다.
      await expect(rail).not.toHaveClass(/is-awake/, { timeout: 6000 });
      // 스크롤하면 나타난다.
      await page.mouse.move(width / 2, 500);
      await page.mouse.wheel(0, 400);
      await expect(rail).toHaveClass(/is-awake/);
      const wake = async () => { await page.mouse.wheel(0, 1); await expect(rail).toHaveClass(/is-awake/); };
      // 끌기: 위(최신)에서 막대 70% 자리까지. 말풍선에 '○○○○년 ○월', 놓으면 그 달 머리줄이 화면 안.
      await wake();
      const r = await box(rail), th = await box(rail.locator('[data-photos-rail-thumb]'));
      const x = r.x + r.width - 10;
      await page.mouse.move(x, th.y + th.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, r.y + r.height * 0.4, { steps: 5 });
      await page.mouse.move(x, r.y + r.height * 0.7, { steps: 5 });
      const bubble = rail.locator('[data-photos-rail-bubble]');
      await expect(bubble).toBeVisible();
      await expect(bubble).toHaveText(/^\d{4}년 \d{1,2}월$/);
      const text = (await bubble.textContent()).trim();
      const [, yy, mm] = text.match(/^(\d{4})년 (\d{1,2})월$/);
      const key = `${yy}-${pad(Number(mm))}`;
      expect(Number(yy)).toBeLessThan(2026);
      await page.mouse.up();
      await expect(bubble).toBeHidden();
      await expect(root(page).locator(`[data-photos-day^="${key}"]`).first()).toBeInViewport();
      // 아래 사진은 열리지 않았다.
      await expect(page.locator('[data-diary-viewer]')).toHaveCount(0);
      // 막대 아무 곳이나 누르면 그 자리로 점프(맨 위 가까이 = 최신 해).
      await wake();
      const r2 = await box(rail);
      await page.mouse.click(r2.x + r2.width - 10, r2.y + 6);
      await expect(root(page).locator('[data-photos-day^="2026-"]').first()).toBeInViewport();
      await expect(page.locator('[data-diary-viewer]')).toHaveCount(0);
      // 가만히 두면 잠시 뒤 사라진다.
      await page.mouse.move(width / 2, 300);
      await expect(rail).not.toHaveClass(/is-awake/, { timeout: 6000 });
    });
  });
}
