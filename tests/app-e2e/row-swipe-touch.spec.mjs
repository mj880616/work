import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S68-50(명진 11/23 12:46 "좌우 스와이프 제대로 작동 안함 점검"): 저장한 글 줄 밀기를 실제 손가락 입력(브라우저 터치 입력 — 터치 → 포인터·click 변환,
// touch-action·세로 스크롤·pointercancel까지 브라우저가 처리)으로 확인한다. 합성 이벤트를 직접 쏘는 다른 시험(row-swipe-more.spec.mjs)과 달리
// 손을 뗀 뒤 click이 따라오는지, 세로 스크롤과 섞일 때, 열린 칸 위에서 다시 밀 때를 브라우저가 실제로 판단한다.
// 지킬 것: 삭제는 [삭제] 칸을 직접 누를 때만(끝까지 밀기·빠른 밀기·열린 칸 위 밀기·스크롤로는 절대 안 됨), 칸이 열린 채 다른 곳을 누르면 닫기만,
// 줄 위 좌우 밀기는 보기 탭을 넘기지 않고 줄 밖에서 밀면 넘긴다. 글·주소는 모두 가짜.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({ hasTouch: true, isMobile: true });
const rid = n => `a6850000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function readingServer(page) {
  const row = (n, read) => ({ id: rid(n), workspace_id: 'w', url: `https://example.com/${n}`, title: `가짜 글 ${n}`, site: 'example.com', saved_at: `2026-11-${String(30 - n).padStart(2, '0')}T01:00:00Z`, read_at: read ? '2026-11-21T02:00:00Z' : null, body_state: 'ok', body_at: '2026-11-21T01:00:10Z', business_area_id: null, updated_at: '2026-11-21T01:00:10Z', body: '가짜 본문이에요.' });
  const s = { rows: Array.from({ length: 24 }, (_, i) => row(i + 1, i % 2 === 1)), patches: [], deletes: [] };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), method = req.method();
    if (u.pathname !== '/rest/v1/app_reading_items') return route.fallback();
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
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
  await list.locator('.rd-switch [data-filter-value="all"]').click();
  await expect(list.locator('.rd-row[data-rd-open]')).toHaveCount(24);
  const cdp = await page.context().newCDPSession(page);
  return { s, errors, list, cdp };
}

// 손가락 한 번: 점들을 차례로 지나 떼기(브라우저 터치 입력). 뗀 뒤 칸이 자리 잡을 때까지(.18s) 기다린다.
async function finger(page, cdp, pts, step = 16) {
  const [a, ...rest] = pts;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a[0], y: a[1] }] });
  for (const p of rest) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); await page.waitForTimeout(step); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);
}
const path = (x, y, dx, dy, n = 10) => Array.from({ length: n + 1 }, (_, i) => [x + dx * i / n, y + dy * i / n]);
const rowOf = (list, n) => list.locator(`.rd-row[data-rd-open="${rid(n)}"]`);
// 줄 가운데(화면 안으로 먼저 굴린다 — 하단바·보기 탭에 가리지 않게 화면 가운데쯤).
async function center(row) {
  await row.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await row.page().waitForTimeout(150);
  const b = await row.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, right: b.x + b.width };
}
// 시험은 시계를 멈춰 두므로(home-entry) 다음 손동작 전에 1초 흐르게 한다 — 실제처럼 '앞 줄 밀기보다 뒤에 시작한 손동작'(claimedSince).
const tick = async page => { await page.clock.setFixedTime(await page.evaluate(() => Date.now() + 1000)); };
const cells = list => list.locator('[data-row-swipe-act="end"]');
const allTab = list => list.locator('.rd-switch [data-filter-value="all"]');
const detail = page => page.locator('#readingView [data-rd-detail]:not([hidden]) .rd-title');
async function nothingDeleted(page, s) {
  expect(s.deletes).toEqual([]);
  await expect(page.locator('.kptu-ask')).toHaveCount(0);
  expect(await page.locator('#kptuNotice .kptu-notice-text').allTextContents()).not.toContainEqual(expect.stringMatching(/삭제/));
}

test('저장한 글 412 실제 손가락: 조금·끝까지·빠르게 왼쪽 밀기는 칸만 열고, 열린 채 다른 줄을 누르면 닫기만, 삭제는 칸을 직접 누를 때만', async ({ page }) => {
  test.setTimeout(120000);
  const { s, errors, list, cdp } = await openReading(page, 412);
  // ① 왼쪽으로 조금: 칸 2개([수정][삭제] — S70-62)가 열리고 멈춘다. 줄은 열리지 않는다(뗀 뒤 click 없음).
  let p = await center(rowOf(list, 3));
  await finger(page, cdp, path(p.x, p.y, -90, 0));
  await expect(cells(list)).toHaveCount(2);
  await expect(rowOf(list, 3)).toHaveCSS('transform', /matrix\(1, 0, 0, 1, -128, 0\)/);
  await expect(detail(page)).toHaveCount(0);
  // ② 칸이 열린 채 다른 줄을 누르면 닫기만 한다(그 줄이 열리지 않는다).
  p = await center(rowOf(list, 5));
  await finger(page, cdp, [[p.x, p.y]]);
  await expect(cells(list)).toHaveCount(0);
  await expect(detail(page)).toHaveCount(0);
  // ③ 왼쪽 끝까지: 맨 끝이 [삭제]라 칸만 열린다(묻는 창·삭제 없음).
  p = await center(rowOf(list, 3));
  await finger(page, cdp, path(p.x, p.y, -320, 0));
  await expect(cells(list)).toHaveCount(2);
  await nothingDeleted(page, s);
  // 열린 줄을 누르면 닫기만.
  await finger(page, cdp, [[p.x - 150, p.y]]);
  await expect(cells(list)).toHaveCount(0);
  await expect(detail(page)).toHaveCount(0);
  // ④ 빠르게 휙(움직임 두 번): 역시 칸만.
  p = await center(rowOf(list, 4));
  await finger(page, cdp, path(p.x, p.y, -280, 0, 2), 4);
  await expect(cells(list)).toHaveCount(2);
  await nothingDeleted(page, s);
  // ⑤ 열린 칸([삭제] 자리) 위에서 다시 왼쪽으로 밀어도 지워지지 않고, 오른쪽으로 밀면 닫힌다.
  p = await center(rowOf(list, 4));
  await finger(page, cdp, path(p.right - 40, p.y, -120, 0));
  await expect(cells(list)).toHaveCount(2);
  await nothingDeleted(page, s);
  // S70-62: 칸이 둘(128px)이라 열린 자리에서 오른쪽으로 그만큼 밀면 닫힌 자리(더 밀면 반대쪽 [선택] 칸이 열린다).
  await finger(page, cdp, path(p.right - 40, p.y, 130, 0));
  await expect(cells(list)).toHaveCount(0);
  await nothingDeleted(page, s);
  // ⑥ 열린 칸 위에서 시작한 세로 스크롤: 칸이 닫히고 아무것도 실행되지 않는다.
  p = await center(rowOf(list, 6));
  await finger(page, cdp, path(p.x, p.y, -90, 0));
  await expect(cells(list)).toHaveCount(2);
  await finger(page, cdp, path(p.right - 32, p.y, 0, -160));
  await expect(cells(list)).toHaveCount(0);
  await nothingDeleted(page, s);
  expect(s.patches).toEqual([]);
  // ⑦ [삭제] 칸을 직접 누를 때만: 직접 넣은 글은 묻는다(취소하면 그대로).
  p = await center(rowOf(list, 6));
  await finger(page, cdp, path(p.x, p.y, -90, 0));
  await expect(cells(list)).toHaveCount(2);
  const del = await list.locator('[data-row-swipe-key="delete"]').boundingBox();
  await finger(page, cdp, [[del.x + del.width / 2, del.y + del.height / 2]]);
  const ask = page.locator('.kptu-ask');
  await expect(ask).toContainText('이 글을 삭제할까요?');
  await ask.locator('.kptu-ask-actions .secondary').click();
  expect(s.deletes).toEqual([]);
  await expect(list.locator('.rd-row[data-rd-open]')).toHaveCount(24);
  expect(errors).toEqual([]);
});

test('저장한 글 412 실제 손가락: 세로 스크롤은 밀기가 아니고, 오른쪽 끝까지는 [선택] 칸만(누르면 선택), 줄 위 좌우 밀기는 탭을 넘기지 않고 줄 밖에서는 넘긴다', async ({ page }) => {
  test.setTimeout(120000);
  const { s, errors, list, cdp } = await openReading(page, 412);
  await expect(allTab(list)).toHaveAttribute('aria-checked', 'true');
  // ① 조금 비스듬한 세로 스크롤: 칸이 열리지 않고 탭·줄 그대로.
  let p = await center(rowOf(list, 8));
  await finger(page, cdp, path(p.x, p.y, 40, -220));
  await expect(cells(list)).toHaveCount(0);
  await expect(page.locator('#readingView .row-swipe-acts')).toHaveCount(0);
  await expect(allTab(list)).toHaveAttribute('aria-checked', 'true');
  await expect(detail(page)).toHaveCount(0);
  // ② 줄 위 왼쪽 밀기: 칸만 열리고 탭은 그대로.
  p = await center(rowOf(list, 8));
  await finger(page, cdp, path(p.x, p.y, -150, 0));
  await expect(cells(list)).toHaveCount(2);
  await expect(allTab(list)).toHaveAttribute('aria-checked', 'true');
  await finger(page, cdp, [[p.x - 160, p.y]]);
  await expect(cells(list)).toHaveCount(0);
  // ③ 오른쪽 끝까지: 바로 그 줄 선택(S70-64 W1 — [선택] 칸이 남지 않음) → '1개 선택됨', 탭은 그대로, 줄은 열리지 않는다.
  p = await center(rowOf(list, 9));
  await finger(page, cdp, path(p.x, p.y, 300, 0));
  // S70-64: 오른쪽 밀기는 칸 없이 그 줄을 바로 고른다.
  const bar = page.locator('#readingView .row-swipe-pickbar');
  await expect(bar).toBeVisible();
  await expect(list.locator('[data-row-swipe-key="select"]')).toHaveCount(0);
  await expect(bar.locator('.row-swipe-pick-count')).toHaveText('1개 선택됨');
  await expect(allTab(list)).toHaveAttribute('aria-checked', 'true');
  await expect(detail(page)).toHaveCount(0);
  await bar.locator('[data-row-pick-stop]').click();
  await expect(bar).toBeHidden();
  // ④ 줄 밖(맨 위 머리 줄)에서 왼쪽으로 밀면 옆 탭.
  await tick(page);
  const head = list.locator('.rd-head'); // S70-57: 머리 줄 제목 없음(이름은 앱 머리 줄) — 머리 줄 빈 곳
  await head.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const h = await head.boundingBox();
  await finger(page, cdp, path(h.x + h.width / 2 + 60, h.y + h.height / 2, -160, 0));
  await expect(allTab(list)).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#readingView .row-swipe-acts')).toHaveCount(0);
  await nothingDeleted(page, s);
  expect(s.patches).toEqual([]);
  expect(errors).toEqual([]);
});

test('저장한 글 390 실제 손가락: 왼쪽 밀기 칸 열고 닫기, 끝까지 밀어도 삭제 없음', async ({ page }) => {
  test.setTimeout(90000);
  const { s, errors, list, cdp } = await openReading(page, 390);
  let p = await center(rowOf(list, 2));
  await finger(page, cdp, path(p.x, p.y, -90, 0));
  await expect(cells(list)).toHaveCount(2);
  // 열린 줄은 오른쪽으로 짧게(60px) 되밀어도 닫힌다.
  await finger(page, cdp, path(p.x - 120, p.y, 60, 0));
  await expect(cells(list)).toHaveCount(0);
  await expect(detail(page)).toHaveCount(0);
  p = await center(rowOf(list, 2));
  await finger(page, cdp, path(p.x, p.y, -320, 0));
  await expect(cells(list)).toHaveCount(2);
  await nothingDeleted(page, s);
  expect(errors).toEqual([]);
});
