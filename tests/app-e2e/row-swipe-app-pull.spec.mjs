import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S68-59(명진 11/23 16:17, 갤럭시 폰 앱 "왼쪽으로 스와이프 여전히 안됨" — 오른쪽 밀기 [선택]은 됨):
// 원인(코드로 확인): 폰 앱 껍데기의 당겨서 새로고침(SwipeRefreshLayout)은 가로·세로를 견주지 않고, 화면 맨 위에서 손가락이 아래로
// touchSlop(약 8dp)만 내려가도 '당기기'로 보고 손가락을 웹에서 빼앗는다(웹에는 pointercancel). 오른손 엄지로 줄을 왼쪽으로 밀면
// 손끝이 호를 그리며 조금씩 아래로 내려가고(오른쪽으로 밀면 위로), 그래서 왼쪽 밀기만 늘 끊겼다. 브라우저 합성 터치에는 껍데기가 없어 보이지 않았다.
// 고침: 껍데기는 옆으로 가는 손가락을 가로채지 않고(ShellRules.pullAxis, Android 단위 시험), 웹은 옆으로 가는 손가락에 'pull:off'를 보낸다(옛 앱 대비).
// 이 시험은 앱 표시(KPTUAndroid)·앱 다리(KPTUAppShell, 가짜)를 붙인 화면에서, 실제 손가락 입력(CDP 터치)으로 엄지 호 모양 밀기를 해 본다.
// 글·주소·이름은 모두 가짜.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const APP = 'Mozilla/5.0 (Linux; Android 14; SM-F946N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.5.26';
test.use({ hasTouch: true, isMobile: true, userAgent: APP });
const rid = n => `a6859000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LONG = '아주 긴 제목이 끝없이 이어지는 가짜 기사입니다 아주 긴 제목이 끝없이 이어지는 가짜 기사입니다 https://example.com/very/long/path/without/any/breaks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function readingServer(page) {
  const row = (n, read) => ({ id: rid(n), workspace_id: 'w', url: `https://www.example-very-long-domain-name-for-test.co.kr/${n}`, title: n % 2 ? LONG : `가짜 글 ${n}`, site: 'www.example-very-long-domain-name-for-test.co.kr', saved_at: `2026-11-${String(30 - n).padStart(2, '0')}T01:00:00Z`, read_at: read ? '2026-11-21T02:00:00Z' : null, body_state: 'ok', body_at: '2026-11-21T01:00:10Z', business_area_id: null, updated_at: '2026-11-21T01:00:10Z', body: '가짜 본문이에요.' });
  const s = { rows: Array.from({ length: 7 }, (_, i) => row(i + 1, i % 2 === 1)), patches: [], deletes: [] };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), method = req.method();
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (u.pathname === '/rest/v1/app_news_highlights' && method === 'GET') return ok([]);
    if (u.pathname !== '/rest/v1/app_reading_items') return route.fallback();
    const pick = r => { const { workspace_id, body, ...rest } = r; return rest; };
    if (method === 'PATCH') { s.patches.push(u.searchParams.get('id')); return ok([]); }
    if (method === 'DELETE') { s.deletes.push(u.searchParams.get('id')); return route.fulfill({ status: 204 }); }
    return ok(s.rows.map(pick));
  });
  return s;
}

// 가짜 앱 다리: 화면이 앱에 보낸 글을 적는다. 화면의 pointercancel 수도 센다(앱 껍데기가 손가락을 빼앗으면 웹에 오는 것).
async function phoneApp(page) {
  await page.addInitScript(() => {
    window.__shell = [];
    window.__cancels = 0;
    window.KPTUAppShell = { postMessage(m) { window.__shell.push(String(m)); }, addEventListener() {} };
    document.addEventListener('pointercancel', () => { window.__cancels++; }, true);
  });
}

async function openReading(page, width) {
  await page.setViewportSize({ width, height: 800 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await phoneApp(page);
  await openHome(page);
  const s = await readingServer(page);
  await page.locator('#mobileMenuTab').click();
  await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  const list = page.locator('#readingView [data-rd-list]');
  await list.locator('.rd-switch [data-filter-value="all"]').click();
  await expect(list.locator('.rd-row[data-rd-open]')).toHaveCount(7);
  await expect.poll(() => page.evaluate(() => window.__KPTU_PULL_REFRESH__ === true)).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  return { s, errors, list, cdp };
}

// 손가락 한 번. 시작 전에 다리 글·pointercancel 수를 비우고, 뗀 뒤 그동안 보낸 pull:* 글을 돌려준다.
async function finger(page, cdp, pts) {
  await page.evaluate(() => { window.__shell.length = 0; window.__cancels = 0; });
  const [a, ...rest] = pts;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a[0], y: a[1] }] });
  for (const p of rest) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); await page.waitForTimeout(12); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);
  return page.evaluate(() => ({ pull: window.__shell.filter(m => m.startsWith('pull:')), cancels: window.__cancels }));
}
// 엄지 호: 옆으로 가며 세로로 점점 더 내려가거나(왼쪽 밀기) 올라간다(오른쪽 밀기).
const arc = (x, y, dx, dy, n = 20) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [x + dx * t, y + dy * t * t]; });
const tick = async page => { await page.clock.setFixedTime(await page.evaluate(() => Date.now() + 1000)); };
const rows = list => list.locator('.rd-row[data-rd-open]');
const cells = list => list.locator('[data-row-swipe-act="end"]');
async function box(loc) {
  await loc.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await loc.page().waitForTimeout(150);
  return loc.boundingBox();
}
// 폰 글자 크기를 키운 것과 같게(WebView textZoom·갤럭시 큰 글자): 모든 글자 크기를 k배.
const bigText = (page, k) => page.evaluate(k => {
  const els = [...document.querySelectorAll('*')], fs = els.map(e => parseFloat(getComputedStyle(e).fontSize));
  els.forEach((e, i) => { e.style.fontSize = (fs[i] * k) + 'px'; });
}, k);
const overflow = page => page.evaluate(() => { const se = document.scrollingElement; return { sw: se.scrollWidth, cw: se.clientWidth }; });

for (const width of [412, 360]) {
  test(`폰 앱 저장한 글 ${width}: 엄지 호 모양 왼쪽 밀기는 칸을 열고 앱에 pull:off를 보낸다, 아래로 당기기는 그대로 pull:on`, async ({ page }) => {
    test.setTimeout(120000);
    const { s, errors, list, cdp } = await openReading(page, width);
    // ① 왼쪽 밀기(가운데 → 왼쪽, 손끝이 36px 내려감): 칸 3개, 웹에 pointercancel 없음, 앱에는 처음 pull:on 뒤 옆으로 가는 순간 pull:off.
    await tick(page);
    let b = await box(rows(list).first());
    let r = await finger(page, cdp, arc(b.x + b.width * 0.7, b.y + b.height / 2 - 12, -150, 36));
    await expect(cells(list), '엄지 호 왼쪽 밀기').toHaveCount(3);
    expect(r).toEqual({ pull: ['pull:on', 'pull:off'], cancels: 0 });
    await finger(page, cdp, [[b.x + 40, b.y + b.height / 2]]);
    await expect(cells(list)).toHaveCount(0);
    // ② 줄 오른쪽 끝(⋯ 자리)에서 시작한 엄지 호 왼쪽 밀기도 같다.
    await tick(page);
    b = await box(rows(list).nth(2));
    r = await finger(page, cdp, arc(b.x + b.width - 6, b.y + b.height / 2 - 12, -140, 40));
    await expect(cells(list), '오른쪽 끝 시작 엄지 호').toHaveCount(3);
    expect(r).toEqual({ pull: ['pull:on', 'pull:off'], cancels: 0 });
    await finger(page, cdp, [[b.x + 40, b.y + b.height / 2]]);
    await expect(cells(list)).toHaveCount(0);
    // ③ 오른쪽 밀기(손끝이 위로): 칸 없이 바로 '1개 선택됨'(W3 S70-64). 이것도 옆으로 가는 손가락이라 pull:off.
    await tick(page);
    b = await box(rows(list).last());
    r = await finger(page, cdp, arc(b.x + 40, b.y + b.height / 2 + 12, 280, -36));
    const bar = page.locator('#readingView .row-swipe-pickbar');
    expect(r).toEqual({ pull: ['pull:on', 'pull:off'], cancels: 0 });
    await expect(list.locator('[data-row-swipe-key="select"]')).toHaveCount(0);
    await expect(bar.locator('.row-swipe-pick-count')).toHaveText('1개 선택됨');
    await bar.locator('[data-row-pick-stop]').click();
    await expect(bar).toBeHidden();
    // ④ 맨 위에서 아래로 당기기: 줄은 움직이지 않고, 앱에는 pull:on만(당겨서 새로고침은 그대로 앱 몫).
    await page.evaluate(() => window.scrollTo(0, 0));
    await tick(page);
    b = await rows(list).first().boundingBox();
    r = await finger(page, cdp, Array.from({ length: 11 }, (_, i) => [b.x + 120 + i, b.y + b.height / 2 + i * 12]));
    expect(r.pull).toEqual(['pull:on']);
    await expect(page.locator('#readingView .row-swipe-acts')).toHaveCount(0);
    expect(s.deletes).toEqual([]);
    expect(s.patches).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`폰 앱 저장한 글 ${width}: 큰 글자(1.3·1.6·2배)·긴 제목에서도 화면이 옆으로 넘치지 않고, 왼쪽 밀기 칸이 열린다`, async ({ page }) => {
    test.setTimeout(120000);
    const { errors, list, cdp } = await openReading(page, width);
    let done = 1;
    for (const k of [1.3, 1.6 / 1.3, 2 / 1.6]) {
      await bigText(page, k);
      done *= k;
      const o = await overflow(page);
      expect(o.sw, `글자 ${done.toFixed(1)}배: 화면 가로 넘침 없음`).toBeLessThanOrEqual(o.cw);
      // 화면 폭을 넘는 줄 칸도 없다(넘치면 브라우저가 옆 스크롤로 손가락을 가져갈 수 있음).
      const wide = await list.evaluate((el, W) => [...el.querySelectorAll('.rd-row[data-rd-open]')].filter(r => r.getBoundingClientRect().right > W + 1).length, width);
      expect(wide).toBe(0);
      await tick(page);
      const b = await box(rows(list).first());
      const r = await finger(page, cdp, arc(b.x + b.width * 0.7, b.y + Math.min(b.height / 2, 30), -150, 30));
      await expect(cells(list), `글자 ${done.toFixed(1)}배 왼쪽 밀기`).toHaveCount(3);
      expect(r.cancels).toBe(0);
      await finger(page, cdp, [[b.x + 40, b.y + 20]]);
      await expect(cells(list)).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
