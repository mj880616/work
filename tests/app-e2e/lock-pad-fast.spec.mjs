// S69-87 SEC-잠금판빠르게(사용자 11/25 "잠금 핀넘버 칸을 불러올 때 꾸밈 적용 전 화면이 잠깐 떴다 꾸밈 화면으로 바뀌는 문제 /
// 숫자를 빠르게 터치하면 씹히는 문제 난 빨리 입력 하고픔"):
// 1) 잠금 화면(앱 전체 잠금으로 앱을 열 때)과 '잠김' 줄의 작은 PIN 창 모두, 판이 처음 보이는 순간에 lock.css 규칙이 이미 붙어 있다
//    (모양 파일을 일부러 늦게 내줘도 꾸밈 없는 판이 한 프레임도 없다 — 화면에 붙는 순간(MutationObserver)과 매 프레임을 함께 본다).
// 2) 숫자를 30ms 간격으로 터치해도(두 손가락이 겹치게 번갈아·같은 숫자 연타 포함) 4자리가 다 들어가고 서버 대조는 정확히 한 번.
// 서버(app_lock_*)는 page.route로 흉내 낸다. 값은 모두 합성.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({ hasTouch: true, isMobile: true });

function lockServer(features) {
  const s = { features, checks: [] };
  s.install = async page => {
    await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const body = route.request().postDataJSON() || {};
      const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
      if (name === 'app_lock_read') return json({ has_pin: true, features: s.features, relock: '5m', left: 5, blocked_until: null });
      if (name === 'app_lock_note_folders') return json({ folders: [], covered: [], top_names: [] });
      if (name === 'app_lock_check') { s.checks.push(body.p_pin); return json({ ok: body.p_pin === '1234', left: 4, blocked_until: null }); }
      return route.fulfill({ status: 404, body: '' });
    });
  };
  return s;
}
// 잠금 모양 파일을 늦게 내준다(느린 폰 망). 늦어도 판은 꾸밈이 붙은 뒤에 보여야 한다.
const slowLockCss = page => page.route(/\/app\/lock\.css(\?|$)/, async route => { await new Promise(r => setTimeout(r, 700)); await route.continue(); });

// 판(.lk-pad)이 화면에 보이는 순간마다 lock.css 규칙(숫자 판 grid·판 flex)이 붙어 있는지 적는다.
function watchPads() {
  const seen = window.__lkSeen = { shown: 0, bare: 0 };
  const check = () => {
    for (const pad of document.querySelectorAll('.lk-pad')) {
      if (!pad.getClientRects().length) continue;
      seen.shown++;
      const keys = pad.querySelector('.lk-keys');
      if (getComputedStyle(pad).display !== 'flex' || (keys && getComputedStyle(keys).display !== 'grid')) seen.bare++;
    }
  };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'open', 'data-lk-full'] });
  const frame = () => { check(); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}
const seen = page => page.evaluate(() => window.__lkSeen);

// 터치(CDP): keys를 gap ms 간격으로. overlap이면 두 숫자씩 두 손가락으로 — 앞 손가락을 떼기 전에 다음 손가락이 닿는다(두 손가락 번갈아 빠르게).
// 이렇게 겹치면 브라우저는 click을 하나도 만들지 않는다(옛 판은 4자리 모두 빠짐). 손가락마다 새 id.
async function touchKeys(page, scope, keys, { gap = 30, overlap = false } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const points = [];
  for (const [i, k] of [...keys].entries()) {
    const box = await page.locator(`${scope} [data-lk-key="${k}"]`).boundingBox();
    points.push({ x: box.x + box.width / 2, y: box.y + box.height / 2, id: i + 1 });
  }
  const send = (type, active) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: active });
  const wait = () => new Promise(r => setTimeout(r, gap));
  if (overlap) {
    for (let i = 0; i < points.length; i += 2) {
      await send('touchStart', [points[i]]); await wait();
      if (points[i + 1]) { await send('touchStart', [points[i], points[i + 1]]); await wait(); }
      await send('touchEnd', []); await wait();
    }
  } else {
    for (const p of points) { await send('touchStart', [p]); await wait(); await send('touchEnd', []); await wait(); }
  }
  await cdp.detach();
}

test('폰 390 앱 전체 잠금: 모양 파일이 늦어도 꾸밈 없는 판이 안 보임 · 30ms 연타 1111·두 손가락 번갈아 1234 모두 4자리 · 대조는 한 번씩', async ({ page }) => {
  const server = lockServer(['diary']);
  await page.setViewportSize({ width: 390, height: 860 });
  await openHome(page, { beforeLoad: () => server.install(page) });
  server.features = ['app', 'diary'];
  await slowLockCss(page);
  await page.addInitScript(watchPads);
  await page.reload();
  const pad = page.locator('#lockView .lk-pad');
  await expect(pad.locator('.lk-title')).toHaveText('앱 잠김', { timeout: 20000 });
  const first = await seen(page);
  expect(first.shown).toBeGreaterThan(0);
  expect(first.bare).toBe(0);

  // 같은 숫자 연타: 4자리 그대로, 대조 한 번(틀림 → 다음 시도 바로).
  await touchKeys(page, '#lockView', '1111');
  await expect(page.locator('#lockView [data-lk-msg]')).toContainText('PIN이 맞지 않아요');
  expect(server.checks).toEqual(['1111']);
  await expect(page.locator('#lockView .lk-dot.on')).toHaveCount(0);
  // 두 손가락 번갈아(앞 손가락을 떼기 전에 다음 숫자) 30ms 간격.
  await touchKeys(page, '#lockView', '1234', { overlap: true });
  await expect(page.locator('#homeView')).toBeVisible();
  expect(server.checks).toEqual(['1111', '1234']);
});

test('폰 390 \'잠김\' 줄 작은 PIN 창: 모양 파일이 늦어도 꾸밈 없는 판이 안 보임 · 30ms 연타도 4자리 · 키보드 숫자도 그대로', async ({ page }) => {
  const server = lockServer(['diary', 'photos']);
  await page.setViewportSize({ width: 390, height: 860 });
  await openHome(page, { beforeLoad: async () => { await server.install(page); await slowLockCss(page); } });
  await page.evaluate(watchPads);
  await page.locator('#homeView [data-journal-photos-locked] button.lk-open').click();
  const here = page.locator('dialog.lk-here');
  await expect(here.locator('.lk-title')).toHaveText('사진 잠김');
  const first = await seen(page);
  expect(first.shown).toBeGreaterThan(0);
  expect(first.bare).toBe(0);

  await touchKeys(page, 'dialog.lk-here', '9090', { overlap: true });
  await expect(here.locator('[data-lk-msg]')).toContainText('PIN이 맞지 않아요');
  expect(server.checks).toEqual(['9090']);
  // 키보드(PC·블루투스 자판)도 그대로 — 한 번씩.
  await page.keyboard.type('1234');
  await expect(here).toHaveCount(0);
  expect(server.checks).toEqual(['9090', '1234']);
});
