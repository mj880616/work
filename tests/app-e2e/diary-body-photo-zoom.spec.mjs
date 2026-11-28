import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// PHOTO-글속사진확대(S73-13, 사용자 2026-11-28 "일기에 넣은 사진. 클릭해서 크게 보거나 펼치기로 확대 가능했으면 또는 둘다 되거나"):
// 하루 기록 본문(글 속) 사진 — 누르면 글 읽기 공용 크게 보기(photo-view.js)가 열리고, 그 안에서 [사진] 메뉴 크게 보기와 같은 공용 확대 손동작
// (photo-zoom-gesture.js: 두 손가락·두 번 톡·확대 중 끌기, PC 휠·더블클릭). 같은 글 안 사진끼리 좌우로 넘기고, 뒤로가기는 크게 보기만 닫는다.
// 글 속 사진 위에서 두 손가락을 벌리면 크게 보기가 열리며 그 손가락으로 이어 확대된다. 한 손가락은 글 스크롤 그대로.
// 표준 동작 V2(docs/design/standard-interactions.md). 자료는 모두 가짜(합성 그림·가짜 글, 네트워크 없음).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const DAY = '2026-10-05', at = '2026-10-05T01:00:00Z';
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const para = text => ({ type: 'paragraph', attrs: { style: 'body2' }, content: [{ type: 'text', text }] });
const image = id => ({ type: 'image', attrs: { src: `drive:${id}`, alt: '' } });

async function fixture(page, { width = 412, scale = 1 } = {}) {
  await page.setViewportSize({ width, height: width >= 1000 ? 900 : 915 });
  const doc = { v: 'ed1', doc: { type: 'doc', content: [para('가짜 하루 첫 줄'), image('bodyA'), para('가운데 가짜 글'), image('bodyB'), ...Array.from({ length: 12 }, (_, i) => para(`가짜 긴 글 ${i + 1}`))] } };
  const row = { id: 'd5', workspace_id: 'w', kind: 'diary', journal_day: DAY, raw_text: '가짜 하루 첫 줄\n\n[사진]', doc, title: null, occurred_at: at, created_at: at, updated_at: '2026-10-05T02:00:00Z', archived_at: null,
    attachments: [{ drive_file_id: 'bodyA', file_name: '가짜사진A.jpg', mime_type: 'image/jpeg', size_bytes: 100 }, { drive_file_id: 'bodyB', file_name: '가짜사진B.jpg', mime_type: 'image/jpeg', size_bytes: 100 }],
    metadata: { body_photos: ['bodyA', 'bodyB'] } };
  const errors = [], photoReads = [];
  let pic = PNG1;
  page.on('pageerror', e => errors.push(e.message));
  const install = async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => {
      const q = new URL(r.request().url()).searchParams;
      if (r.request().method() !== 'GET' || q.get('metadata')) return r.fulfill({ json: [] });
      const day = q.get('journal_day');
      return r.fulfill({ json: !day || day.endsWith(DAY) || /gte|lte/.test(day) ? [structuredClone(row)] : [] });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_record_links', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/basket-files', r => {
      const url = new URL(r.request().url());
      if (url.searchParams.get('action') !== 'photo') return r.fulfill({ status: 404, json: {} });
      photoReads.push(`${url.searchParams.get('file_id')}:${url.searchParams.get('size')}`);
      return r.fulfill({ status: 200, contentType: 'image/png', body: pic });
    });
  };
  await openHome(page, { beforeLoad: install });
  // 합성 그림(무늬만, 실제 사진 아님) 480×320: 확대 범위 계산에 그림 크기가 필요하다.
  pic = Buffer.from((await page.evaluate(() => { const k = document.createElement('canvas'); k.width = 480; k.height = 320; const x = k.getContext('2d'); x.fillStyle = '#9fb8a8'; x.fillRect(0, 0, 480, 320); x.fillStyle = '#6f8f7c'; x.fillRect(60, 120, 200, 140); return k.toDataURL('image/png'); })).split(',')[1], 'base64');
  await page.evaluate(() => window.KPTURouter.go('diary'));
  await expect(page.locator('#diaryView')).toBeVisible();
  await page.locator(`#diaryRoot [data-diary-day="${DAY}"]`).click();
  const text = page.locator('#diaryRoot [data-diary-detail] [data-diary-text-view]');
  await expect(text.locator('img.ed-photo-img')).toHaveCount(2);
  await expect(text.locator('.ed-photo[data-ed-zoom]')).toHaveCount(2);
  return { errors, photoReads, text, inline: i => text.locator('.ed-photo[data-ed-zoom]').nth(i) };
}
const view = page => page.locator('[data-basket-photo-view]');
const count = page => view(page).locator('.basket-photo-count');
const shown = page => view(page).locator('.basket-photo-stage .diary-photo');
const scaleOf = async page => Number((/scale\(([\d.]+)\)/.exec(await shown(page).evaluate(el => el.style.transform)) || [0, 1])[1]);
async function stageCenter(page) { const b = await view(page).locator('.basket-photo-stage').boundingBox(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; }
async function touches(page) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const spread = async (x, y, { from = 30, step = 12, steps = 8, release = true } = {}) => {
    await touch('touchStart', [{ x: x - from, y, id: 0 }, { x: x + from, y, id: 1 }]);
    for (let i = 1; i <= steps; i++) await touch('touchMove', [{ x: x - from - i * step, y, id: 0 }, { x: x + from + i * step, y, id: 1 }]);
    if (release) await touch('touchEnd', []);
  };
  const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 0 }]); await touch('touchEnd', []); };
  const drag = async (x, y, dx, dy, steps = 8) => {
    await touch('touchStart', [{ x, y, id: 0 }]);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [{ x: Math.round(x + dx * i / steps), y: Math.round(y + dy * i / steps), id: 0 }]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
  };
  return { touch, spread, tap, drag, done: () => cdp.detach() };
}

// 폰: 412(보통)과 폴드 접은 화면 배율(2.625 — 실제 기기는 CSS 폭 411.43, Playwright 창 폭은 정수만이라 배율만 맞춤).
for (const [width, dsf] of [[412, 1], [412, 2.625]]) {
  test.describe(`폰 ${width} 배율 ${dsf} 터치`, () => {
    test.use({ hasTouch: true, deviceScaleFactor: dsf });
    test(`V2 글 속 사진 누름 → 크게 보기: 두 손가락 확대·끌기·두 번 톡, 원래 크기에서 좌우 넘기기, 뒤로가기 = 크게 보기만 닫기`, async ({ page }) => {
      const f = await fixture(page, { width });
      await f.inline(0).click();
      await expect(view(page)).toBeVisible();
      await expect(count(page)).toHaveText('1/2');
      await expect(shown(page)).toHaveAttribute('data-state', 'shown');
      expect(f.photoReads.filter(r => r.startsWith('bodyA:')).every(r => r === 'bodyA:large')).toBe(true); // 큰 판(1600) — 글 속과 같은 것을 다시 쓴다
      const t = await touches(page), c = await stageCenter(page);
      // 두 손가락 벌리기 = 사진 안 확대(화면 전체 확대 아님).
      await t.spread(c.x, c.y);
      await expect(view(page)).toHaveAttribute('data-photo-zoom', '');
      expect(await scaleOf(page)).toBeGreaterThan(2);
      expect(await page.evaluate(() => window.visualViewport?.scale || 1)).toBe(1);
      // 확대 중 한 손가락 끌기 = 사진 안 옮기기, 다음 사진으로 넘어가지 않는다.
      const before = await shown(page).evaluate(el => el.style.transform);
      await t.drag(c.x, c.y, -150, 0);
      await expect.poll(() => shown(page).evaluate(el => el.style.transform)).not.toBe(before);
      await page.waitForTimeout(300);
      await expect(count(page)).toHaveText('1/2');
      // 두 번 톡 = 원래 크기, 다시 두 번 톡 = 2.5배, 다시 = 원래 크기.
      const doubleTap = async () => { await t.tap(c.x, c.y); await page.waitForTimeout(60); await t.tap(c.x, c.y); };
      await doubleTap();
      await expect(view(page)).not.toHaveAttribute('data-photo-zoom', '');
      await expect.poll(() => shown(page).evaluate(el => el.style.transform)).toBe('');
      await doubleTap();
      await expect(view(page)).toHaveAttribute('data-photo-zoom', '');
      expect(await scaleOf(page)).toBe(2.5);
      await doubleTap();
      await expect(view(page)).not.toHaveAttribute('data-photo-zoom', '');
      // 원래 크기: 한 손가락 좌우 밀기로 같은 글의 다음 사진.
      await t.drag(c.x, c.y, -180, 0);
      await expect(count(page)).toHaveText('2/2');
      await expect(view(page).locator('.basket-photo-name')).toHaveText('가짜사진B.jpg');
      await t.done();
      // 뒤로가기 = 크게 보기만 닫기(하루 기록 그대로).
      await page.goBack();
      await expect(view(page)).toHaveCount(0);
      await expect(f.text).toBeVisible();
      expect(f.errors).toEqual([]);
    });

    test(`V2 글 속 사진 위 두 손가락 벌리기 → 크게 보기가 열리고 그 손가락으로 이어 확대, 한 손가락은 글 스크롤 그대로`, async ({ page }) => {
      const f = await fixture(page, { width });
      await page.evaluate(() => { window.__blocked = 0; document.addEventListener('touchmove', e => { if (e.defaultPrevented) window.__blocked++; }); });
      await f.inline(0).scrollIntoViewIfNeeded();
      const b = await f.inline(0).boundingBox(), x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
      const t = await touches(page);
      // 한 손가락 세로 끌기: 크게 보기가 열리지 않고 스크롤을 막지 않는다.
      await t.drag(x, y, 0, -120);
      await page.waitForTimeout(200);
      await expect(view(page)).toHaveCount(0);
      expect(await page.evaluate(() => window.__blocked)).toBe(0);
      // 조금만 벌리면(처음 거리의 1.15배 미만) 열리지 않는다.
      const b2 = await f.inline(0).boundingBox(), x2 = Math.round(b2.x + b2.width / 2), y2 = Math.round(b2.y + b2.height / 2);
      await t.spread(x2, y2, { from: 40, step: 1, steps: 4 });
      await expect(view(page)).toHaveCount(0);
      // 크게 벌리면 크게 보기가 열리고, 손을 떼기 전 계속 벌리는 만큼 사진 안이 커진다.
      await t.spread(x2, y2, { from: 30, step: 10, steps: 6, release: false });
      await expect(view(page)).toBeVisible();
      await expect(count(page)).toHaveText('1/2');
      for (let i = 1; i <= 8; i++) await t.touch('touchMove', [{ x: x2 - 90 - i * 15, y: y2, id: 0 }, { x: x2 + 90 + i * 15, y: y2, id: 1 }]);
      expect(await scaleOf(page)).toBeGreaterThan(1.5);
      await t.touch('touchEnd', []);
      await expect(view(page)).toHaveAttribute('data-photo-zoom', '');
      expect(await scaleOf(page)).toBeGreaterThan(1.5);
      expect(await page.evaluate(() => window.visualViewport?.scale || 1)).toBe(1); // 화면 전체 확대가 아니다
      await t.done();
      await page.goBack();
      await expect(view(page)).toHaveCount(0);
      expect(f.errors).toEqual([]);
    });
  });
}

test('V2 PC 1280: 글 속 사진 누름 → 크게 보기, 더블클릭·휠 확대, 확대 중 끌기, ←/→ 넘기면 원래 크기, Esc 닫기', async ({ page }) => {
  const f = await fixture(page, { width: 1280 });
  await f.inline(1).click();
  await expect(view(page)).toBeVisible();
  await expect(count(page)).toHaveText('2/2');
  await expect(shown(page)).toHaveAttribute('data-state', 'shown');
  const c = await stageCenter(page);
  await page.mouse.dblclick(c.x, c.y);
  await expect(view(page)).toHaveAttribute('data-photo-zoom', '');
  expect(await scaleOf(page)).toBe(2.5);
  const before = await shown(page).evaluate(el => el.style.transform);
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x - 120, c.y - 40, { steps: 6 }); await page.mouse.up();
  expect(await shown(page).evaluate(el => el.style.transform)).not.toBe(before);
  await page.keyboard.press('ArrowLeft');
  await expect(count(page)).toHaveText('1/2');
  await expect(view(page)).not.toHaveAttribute('data-photo-zoom', ''); // 넘기면 원래 크기
  await expect(shown(page)).toHaveAttribute('data-state', 'shown');
  await page.mouse.move(c.x, c.y);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200);
  await expect(view(page)).toHaveAttribute('data-photo-zoom', '');
  expect(await scaleOf(page)).toBeGreaterThan(1.2);
  await page.keyboard.press('Escape');
  await expect(view(page)).toHaveCount(0);
  await expect(f.inline(1)).toBeFocused(); // 닫으면 누른 사진으로 초점이 돌아온다
  expect(f.errors).toEqual([]);
});
