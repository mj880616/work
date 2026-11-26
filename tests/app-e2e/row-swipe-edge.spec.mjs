import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { setup as librarySetup, openLibrary } from './helpers/library-multi-delete-scenario.mjs';
// S68-53(사용자 11/23 14:46~14:49, 폰 앱 저장한 글 '전체' 7줄 "좌에서 우로는 작동 선택은 나옴 / 우에서 좌로가 아예 스와이프가 안됨"):
// 오른쪽에서 왼쪽으로 미는 손가락은 화면 오른쪽 끝(⋯ 단추 자리)에서 시작한다. 전에는 공용 줄 밀기(row-swipe-model.mjs swipeEdge)가
// 화면 오른쪽 끝 24px에서 시작한 밀기를 버려서, 줄은 움직이지 않고 그 밀기를 보기 탭 넘김이 가져갔다(390 폭에서는 ⋯ 단추 오른쪽 절반도 그 띠 안).
// 실제 손가락 입력(브라우저 터치 입력: CDP Input.dispatchTouchEvent)으로, 줄 위에서 시작한 가로 밀기는 방향·시작 자리와 관계없이 줄 밀기가 먼저인지 본다.
// 글·주소·이름은 모두 가짜.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BASE = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
test.use({ hasTouch: true, isMobile: true });
const rid = n => `a6853000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// 사용자 캡처와 같은 7줄(안 읽음 4 · 읽음 3), 그중 3줄에 밑줄.
async function readingServer(page) {
  const row = (n, read) => ({ id: rid(n), workspace_id: 'w', url: `https://example.com/${n}`, title: `가짜 글 ${n}`, site: 'example.com', saved_at: `2026-11-${String(30 - n).padStart(2, '0')}T01:00:00Z`, read_at: read ? '2026-11-21T02:00:00Z' : null, body_state: 'ok', body_at: '2026-11-21T01:00:10Z', business_area_id: null, updated_at: '2026-11-21T01:00:10Z', body: '가짜 본문이에요.' });
  const s = { rows: Array.from({ length: 7 }, (_, i) => row(i + 1, i % 2 === 1)), patches: [], deletes: [] };
  const marks = [1, 2, 3].map(n => ({ id: `b6853000-0000-4000-8000-${String(n).padStart(12, '0')}`, workspace_id: 'w', source_type: 'reading', source_id: rid(n), quote: '가짜 밑줄', quote_prefix: '', quote_suffix: '', memo: '', created_at: '2026-11-21T03:00:00Z', updated_at: '2026-11-21T03:00:00Z' }));
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), method = req.method();
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (u.pathname === '/rest/v1/app_news_highlights' && method === 'GET') return ok(marks);
    if (u.pathname !== '/rest/v1/app_reading_items') return route.fallback();
    const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
    const pick = r => { const { workspace_id, body, ...rest } = r; return rest; };
    if (method === 'PATCH') { const body = req.postDataJSON(); s.patches.push({ id, body }); const r = s.rows.find(x => x.id === id); if (r) Object.assign(r, body); return ok(r ? [pick(r)] : []); }
    if (method === 'DELETE') { s.deletes.push(id); return route.fulfill({ status: 204 }); }
    return ok((id ? s.rows.filter(x => x.id === id) : s.rows).map(pick));
  });
  return s;
}

async function openReading(page, width) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const s = await readingServer(page);
  await page.locator('#mobileMenuTab').click();
  await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  const list = page.locator('#readingView [data-rd-list]');
  await tab(list, 'all').click();
  await expect(list.locator('.rd-row[data-rd-open]')).toHaveCount(7);
  const cdp = await page.context().newCDPSession(page);
  return { s, errors, list, cdp };
}

// 손가락 한 번: 점들을 차례로 지나 떼기. 뗀 뒤 칸이 자리 잡을 때까지 기다린다.
async function finger(page, cdp, pts, step = 16) {
  const [a, ...rest] = pts;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a[0], y: a[1] }] });
  for (const p of rest) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); await page.waitForTimeout(step); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);
}
const path = (x, y, dx, dy, n = 10) => Array.from({ length: n + 1 }, (_, i) => [x + dx * i / n, y + dy * i / n]);
// 시험은 시계를 멈춰 두므로(home-entry) 다음 손동작 전에 1초 흐르게 한다(claimedSince: '앞 줄 밀기보다 뒤에 시작한 손동작').
const tick = async page => { await page.clock.setFixedTime(await page.evaluate(() => Date.now() + 1000)); };
const tab = (list, v) => list.locator(`.rd-switch [data-filter-value="${v}"]`);
const rows = list => list.locator('.rd-row[data-rd-open]');
const cells = list => list.locator('[data-row-swipe-act="end"]');
const detail = page => page.locator('#readingView [data-rd-detail]:not([hidden]) .rd-title');
async function box(loc) {
  await loc.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await loc.page().waitForTimeout(150);
  return loc.boundingBox();
}

for (const width of [412, 390]) {
  test(`저장한 글 ${width} 실제 손가락: 안 읽음·전체·밑줄 탭마다 오른쪽 끝(⋯ 자리)에서 시작한 왼쪽 밀기는 칸을 열고, 오른쪽 밀기는 [선택], 줄 밖 밀기만 탭 넘김`, async ({ page }) => {
    test.setTimeout(150000);
    const { s, errors, list, cdp } = await openReading(page, width);
    const menu = page.locator('#readingView [data-rd-more][aria-expanded="true"]');
    for (const [v, n] of [['unread', 4], ['all', 7]]) {
      await tick(page);
      await tab(list, v).click();
      await expect(tab(list, v)).toHaveAttribute('aria-checked', 'true');
      await expect(rows(list)).toHaveCount(n);
      const first = rows(list).first();
      // ① 줄 오른쪽 끝에서 시작(줄 끝에서 4px — 전에 버리던 화면 오른쪽 24px 띠 안): 칸 3개가 열리고 탭은 그대로.
      let b = await box(first);
      const sx = b.x + b.width - 4;
      expect(sx).toBeGreaterThan(width - 24);
      await finger(page, cdp, path(sx, b.y + b.height / 2, -120, 0));
      await expect(cells(list), `${v}: 오른쪽 끝 시작`).toHaveCount(2);
      await expect(tab(list, v)).toHaveAttribute('aria-checked', 'true');
      await expect(detail(page)).toHaveCount(0);
      await finger(page, cdp, [[b.x + 40, b.y + b.height / 2]]); // 열린 줄을 누르면 닫기만
      await expect(cells(list)).toHaveCount(0);
      // ② ⋯ 단추 위에서 시작: 역시 칸만 열리고 ⋯ 메뉴는 열리지 않는다.
      await tick(page);
      const more = await box(first.locator('[data-rd-more]'));
      await finger(page, cdp, path(more.x + more.width * 0.75, more.y + more.height / 2, -120, 0));
      await expect(cells(list), `${v}: ⋯ 위 시작`).toHaveCount(2);
      await expect(menu).toHaveCount(0);
      await expect(tab(list, v)).toHaveAttribute('aria-checked', 'true');
      await finger(page, cdp, [[b.x + 40, b.y + b.height / 2]]);
      await expect(cells(list)).toHaveCount(0);
      // ③ 줄 가운데에서 왼쪽 밀기: 칸.
      await tick(page);
      b = await box(rows(list).last());
      await finger(page, cdp, path(b.x + b.width / 2, b.y + b.height / 2, -100, 0));
      await expect(cells(list), `${v}: 가운데 시작`).toHaveCount(2);
      await finger(page, cdp, [[b.x + 40, b.y + b.height / 2]]);
      await expect(cells(list)).toHaveCount(0);
      // ④ 오른쪽 밀기: 바로 그 줄 선택(S70-64 W3, [선택] 칸이 남지 않음) → '1개 선택됨', 탭 그대로.
      await tick(page);
      await finger(page, cdp, path(b.x + 40, b.y + b.height / 2, 300, 0));
      const bar = page.locator('#readingView .row-swipe-pickbar');
      await expect(list.locator('[data-row-swipe-key="select"]'), `${v}: 오른쪽 밀기는 칸을 남기지 않음`).toHaveCount(0);
      await expect(bar.locator('.row-swipe-pick-count')).toHaveText('1개 선택됨');
      await expect(tab(list, v)).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape'); // S70-64b: [✕]·[그만] 없음 — Esc(폰은 뒤로가기)로 끝
      await expect(bar).toBeHidden();
    }
    // S69-04: [밑줄] 탭은 글 줄이 아니라 밑줄 줄(노트 › 밑줄과 같은 부품 .nh-row) — 글 줄 밀기 대상이 아니다.
    await tick(page);
    await tab(list, 'marks').click();
    await expect(tab(list, 'marks')).toHaveAttribute('aria-checked', 'true');
    await expect(list.locator('[data-rd-marks] .nh-row')).toHaveCount(3);
    await expect(rows(list)).toHaveCount(0);
    // ⑤ 줄 밖(맨 위 머리 줄)에서 밀면 탭을 넘긴다: 밑줄 → (오른쪽 밀기) 안 읽음 → (왼쪽 밀기) 밑줄. S70-24: 탭 차례 [전체·안 읽음·밑줄·메모].
    const head = list.locator('.rd-head'); // S70-57: 머리 줄 제목 없음(이름은 앱 머리 줄) — 머리 줄 빈 곳
    await tick(page);
    let h = await box(head);
    await finger(page, cdp, path(h.x + 20, h.y + h.height / 2, 160, 0));
    await expect(tab(list, 'unread')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#readingView .row-swipe-acts')).toHaveCount(0);
    await tick(page);
    h = await box(head);
    await finger(page, cdp, path(h.x + h.width / 2 + 60, h.y + h.height / 2, -160, 0));
    await expect(tab(list, 'marks')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#readingView .row-swipe-acts')).toHaveCount(0);
    // 왼쪽 가장자리(24px 안)에서 시작한 오른쪽 밀기는 줄 밀기가 아니다(뒤로가기 손동작 몫) — 줄은 그대로.
    await tick(page);
    const b = await box(list.locator('[data-rd-marks] .nh-row').first());
    await finger(page, cdp, path(8, b.y + b.height / 2, 160, 0));
    await expect(page.locator('#readingView .row-swipe-pickbar:not([hidden])')).toHaveCount(0);
    await expect(page.locator('#readingView .row-swipe-acts')).toHaveCount(0);
    expect(s.deletes).toEqual([]);
    expect(s.patches).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('자료실 390 실제 손가락: 줄 오른쪽 끝에서 시작한 왼쪽 밀기도 칸([옮기기][삭제])을 연다(공용 줄 밀기)', async ({ page }) => {
  test.setTimeout(90000);
  const state = await librarySetup(page, 390);
  await openLibrary(page, BASE);
  const list = page.locator('#documentList');
  const row = list.locator('.lu-row[data-lu-document="n1"]');
  await expect(list.locator('[data-lu-document]')).toHaveCount(5);
  const cdp = await page.context().newCDPSession(page);
  const b = await box(row);
  // 자료실 줄은 나무 안쪽으로 들여 있어 화면 끝까지 닿지 않는다 — 줄 오른쪽 끝(⋯ 자리)에서 시작한다.
  await finger(page, cdp, path(b.x + b.width - 4, b.y + b.height / 2, -120, 0));
  await expect(list.locator('[data-row-swipe-act="end"]')).toHaveCount(3); // S70-65 가안 [옮기기][이름 바꾸기][삭제]
  await expect(list.locator('[data-lu-document]')).toHaveCount(5);
  expect(state.deletes).toEqual([]);
  expect(state.errors).toEqual([]);
});
