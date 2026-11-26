import { test, expect } from '@playwright/test';
import { folderSheet } from './helpers/folder-sheet.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { setup as librarySetup, openLibrary } from './helpers/library-multi-delete-scenario.mjs';
import { loginEntry } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { server as planServer, installServer as installPlanServer } from './helpers/report-plan-marks-server.mjs';
// UI-줄밀기 Raindrop식 2/2(S68-26b, 명진 11/22 21:31 "좌우 스와이프. 이것도 곳곳에 따라해"): 줄 밀기가 없던 목록에 공용 줄 밀기(row-swipe.js)를 붙였다.
// 목록마다: 왼쪽으로 조금 밀면 오른쪽 끝 칸(그 목록의 기존 함수만), 오른쪽으로 밀면 [선택] → 여러 개 선택, 줄 위 밀기는 다른 좌우 밀기(칩 넘김)를 하지 않는다,
// PC(761px~)는 밀기 없음. 휴지통 줄은 project-system-v3.spec.mjs(같은 서버 흉내)에 있다. 글·주소·이름은 모두 가짜.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BASE = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';

// 손가락 밀기(포인터만). 목록이 다시 그려져 찾은 줄이 빠졌으면 다시 찾아 민다(now-row-swipe.spec.mjs와 같은 방법).
async function swipe(locator, dx) {
  await expect(async () => {
    await expect(locator).toBeVisible();
    const sent = await locator.evaluate((el, { dx }) => {
      if (!el.isConnected) return false;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
      fire('pointerdown', x); for (let i = 1; i <= 10; i++) fire('pointermove', x + dx * i / 10); fire('pointerup', x + dx);
      return true;
    }, { dx });
    expect(sent).toBe(true);
  }).toPass({ timeout: 10000 });
}
// 실제 손가락처럼 포인터 + 터치를 함께 보낸다(칩 넘김은 터치로 본다). onRow=false면 그 칸 맨 위(줄 밖)에서 민다.
async function both(locator, dx) {
  await expect(async () => expect(await locator.evaluate((el, { dx }) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 12);
    const pt = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
    const tc = (type, cx) => { const t = new Touch({ identifier: 1, target: el, clientX: cx, clientY: y }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] })); };
    tc('touchstart', x); pt('pointerdown', x);
    for (let i = 1; i <= 10; i++) { pt('pointermove', x + dx * i / 10); tc('touchmove', x + dx * i / 10); }
    pt('pointerup', x + dx); tc('touchend', x + dx);
    return true;
  }, { dx })).toBe(true)).toPass({ timeout: 10000 });
}
// 손가락 한 번 누르기(누름 → click). 칸에 바로 보낸다(Playwright click의 '보이게 스크롤'이 열린 칸을 닫지 않게).
async function touchTap(locator) {
  await locator.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, bubbles: true });
  await locator.dispatchEvent('click');
}
const ends = (root) => root.locator('[data-row-swipe-act="end"]');
const cell = (root, key) => root.locator(`[data-row-swipe-key="${key}"]`);
// S70-64 W1(결정 장부 W3): 오른쪽 밀기는 선택만 — 손을 떼면 [선택] 칸을 열어 두지 않고 바로 그 줄이 선택된다(막대가 뜬다).
// 민 뒤 목록이 다시 그려져 손동작이 빠졌으면 막대가 뜰 때까지 다시 민다(선택 중에는 줄 밀기가 꺼져 있어 두 번 골라지지 않음).
async function swipePick(page, locator, how = swipe) {
  await expect(async () => {
    await how(locator, 320);
    await expect(page.locator('.row-swipe-pickbar:visible, .kptu-selbar:visible').first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await expect(page.locator('[data-row-swipe-key="select"]')).toHaveCount(0);
}
// 시험은 시계를 멈춰 두므로 실제처럼 1초 흐르게 한 뒤 다음 손동작을 한다(줄 밀기 시각보다 뒤에 시작한 손동작).
const tick = async page => { try { await page.clock.setFixedTime(await page.evaluate(() => Date.now() + 1000)); } catch { /* 시계를 멈추지 않은 시험 */ } };

// ---------- 읽을 거리 ----------
const RA = 'a6810000-0000-4000-8000-000000000001', RB = 'a6810000-0000-4000-8000-000000000002', RC = 'a6810000-0000-4000-8000-000000000003';
async function readingServer(page) {
  const row = (id, title, read) => ({ id, workspace_id: 'w', url: `https://example.com/${id.slice(-1)}`, title, site: 'example.com', saved_at: `2026-11-2${id.slice(-1)}T01:00:00Z`, read_at: read ? '2026-11-21T02:00:00Z' : null, body_state: 'ok', body_at: '2026-11-21T01:00:10Z', business_area_id: null, updated_at: '2026-11-21T01:00:10Z', body: '가짜 본문이에요.' });
  const s = { rows: [row(RA, '가짜 기사 하나', false), row(RB, '가짜 칼럼 둘', true), row(RC, '가짜 글 셋', false)], patches: [], deletes: [] };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), method = req.method();
    if (u.pathname !== '/rest/v1/app_reading_items') return route.fallback();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
    const pick = r => { const { workspace_id, body, ...rest } = r; return rest; };
    if (method === 'PATCH') { const body = req.postDataJSON(); s.patches.push({ id, body }); const r = s.rows.find(x => x.id === id); if (r) Object.assign(r, body); return ok(r ? [pick(r)] : []); }
    if (method === 'DELETE') { s.deletes.push(id); return route.fulfill({ status: 204 }); }
    return ok((id ? s.rows.filter(x => x.id === id) : s.rows).map(pick));
  });
  return s;
}
async function openReading(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const s = await readingServer(page);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '저장한 글', exact: true }).click();
  await expect(page.locator('#readingView')).toBeVisible();
  const list = page.locator('#readingView [data-rd-list]');
  await list.locator('.rd-switch [data-filter-value="all"]').click();
  await expect(list.locator('.rd-row[data-rd-open]')).toHaveCount(3);
  return { s, errors, list };
}
const rdRow = (list, id) => list.locator(`.rd-row[data-rd-open="${id}"]`);

test('읽을 거리 412: 왼쪽 밀기 [사업에 연결]·[읽음]·[삭제] 칸, 끝까지 밀어도 바로 하지 않고 칸만 열림', async ({ page }) => {
  test.setTimeout(90000);
  const { s, errors, list } = await openReading(page, 412);
  await swipe(rdRow(list, RA), -60);
  await expect(ends(list)).toHaveCount(3);
  await expect(ends(list).nth(0)).toHaveAttribute('data-row-swipe-key', 'area');
  await expect(ends(list).nth(1)).toHaveAttribute('data-row-swipe-key', 'read');
  // S68-31: ⋯에 [삭제]가 있으므로 맨 끝(위험 색)에 [삭제].
  await expect(ends(list).nth(2)).toHaveAttribute('data-row-swipe-key', 'delete');
  await expect(ends(list).nth(2)).toHaveClass(/row-swipe-tone-danger/);
  // 칸은 줄 높이만큼 꽉 찬다.
  const [cellH, rowH] = await Promise.all([ends(list).first().evaluate(b => b.getBoundingClientRect().height), rdRow(list, RA).evaluate(r => r.getBoundingClientRect().height)]);
  expect(Math.abs(cellH - rowH)).toBeLessThan(1.5);
  await touchTap(cell(list, 'read'));
  await expect.poll(() => s.patches.filter(p => p.id === RA).length).toBe(1);
  expect(s.patches.at(-1).body.read_at).toBeTruthy();
  // 읽은 줄(B)을 왼쪽 끝까지: 맨 끝이 [삭제]라 아무것도 하지 않고 칸만 열린 채 멈춘다(묻는 창도 없음).
  await tick(page);
  await swipe(rdRow(list, RB), -320);
  await expect(ends(list)).toHaveCount(3);
  await expect(cell(list, 'unread')).toBeVisible();
  await expect(page.locator('.kptu-ask')).toHaveCount(0);
  // 열린 칸의 [안 읽음으로] = ⋯ 메뉴와 같은 길.
  await touchTap(cell(list, 'unread'));
  await expect.poll(() => s.patches.filter(p => p.id === RB).length).toBe(1);
  expect(s.patches.at(-1).body.read_at).toBeNull();
  // [사업에 연결] 칸 = ⋯ [사업에 연결]과 같은 사업영역 고르기 창.
  await tick(page);
  await swipe(rdRow(list, RC), -60);
  await touchTap(cell(list, 'area'));
  await expect(page.locator('#areaOrgPickSheet')).toBeVisible();
  expect(s.deletes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('읽을 거리 412: 왼쪽 밀기 [삭제] — ⋯ 삭제와 같이 묻고, 취소하면 그대로, 삭제하면 그 줄만 지운다', async ({ page }) => {
  test.setTimeout(90000);
  const { s, errors, list } = await openReading(page, 412);
  await swipe(rdRow(list, RA), -60);
  await touchTap(cell(list, 'delete'));
  const ask = page.locator('.kptu-ask');
  await expect(ask).toContainText('이 글을 삭제할까요?');
  await ask.locator('.kptu-ask-actions .secondary').click();
  await expect(ask).toHaveCount(0);
  await expect(list.locator('.rd-row[data-rd-open]')).toHaveCount(3);
  expect(s.deletes).toEqual([]);
  await tick(page);
  await swipe(rdRow(list, RA), -60);
  await touchTap(cell(list, 'delete'));
  await expect(ask).toContainText('이 글을 삭제할까요?');
  await ask.locator('.kptu-ask-actions .primary').click();
  await expect.poll(() => s.deletes).toEqual([RA]);
  await expect(list.locator('.rd-row[data-rd-open]')).toHaveCount(2);
  await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('삭제했어요');
  expect(errors).toEqual([]);
});

test('읽을 거리 412: 오른쪽 밀기 [선택] 칸 누르기 → n개 선택됨 · [읽음][삭제], [읽음] 한 번에, [그만]으로 끝', async ({ page }) => {
  test.setTimeout(90000);
  const { s, errors, list } = await openReading(page, 412);
  await swipePick(page, rdRow(list, RA));
  const bar = page.locator('#readingView .row-swipe-pickbar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.row-swipe-pick-count')).toHaveText('1개 선택됨');
  // 선택 중에 줄을 누르면 열지 않고 고르기만 한다.
  await rdRow(list, RC).click();
  await expect(bar.locator('.row-swipe-pick-count')).toHaveText('2개 선택됨');
  await expect(page.locator('#readingView [data-rd-detail] .rd-title')).toHaveCount(0);
  // S68-29: 고르기 단추는 [읽음][삭제](News에서 보낸 줄도 같은 단추).
  await expect(bar.locator('[data-row-pick-act]')).toHaveText(['읽음', '삭제']);
  await bar.locator('[data-row-pick-act="read"]').click();
  await expect.poll(() => s.patches.map(p => p.id).sort()).toEqual([RA, RC].sort());
  expect(s.patches.every(p => p.body.read_at)).toBe(true);
  await expect(bar).toBeHidden();
  // [그만]: 선택을 끝내면 선택 줄이 사라진다.
  await tick(page);
  await swipePick(page, rdRow(list, RB));
  await expect(bar).toBeVisible();
  await bar.locator('[data-row-pick-stop]').click();
  await expect(bar).toBeHidden();
  expect(s.deletes).toEqual([]);
  expect(errors).toEqual([]);
});

test('읽을 거리 412: 고른 줄 [삭제] — 한 번만 묻고, 취소하면 그대로, 삭제하면 고른 줄만 지운다', async ({ page }) => {
  test.setTimeout(90000);
  const { s, errors, list } = await openReading(page, 412);
  await swipePick(page, rdRow(list, RA));
  const bar = page.locator('#readingView .row-swipe-pickbar');
  await expect(bar).toBeVisible();
  await rdRow(list, RB).click();
  await expect(bar.locator('.row-swipe-pick-count')).toHaveText('2개 선택됨');
  await bar.locator('[data-row-pick-act="delete"]').click();
  const ask = page.locator('.kptu-ask');
  await expect(ask).toContainText('선택한 글 2개를 삭제할까요?');
  await ask.locator('.kptu-ask-actions .secondary').click();
  await expect(ask).toHaveCount(0);
  await expect(list.locator('.rd-row[data-rd-open]')).toHaveCount(3);
  expect(s.deletes).toEqual([]);
  await tick(page);
  await swipePick(page, rdRow(list, RA));
  await expect(bar).toBeVisible();
  await rdRow(list, RB).click();
  await bar.locator('[data-row-pick-act="delete"]').click();
  await ask.locator('.kptu-ask-actions .primary').click();
  await expect.poll(() => [...s.deletes].sort()).toEqual([RA, RB].sort());
  await expect(list.locator('.rd-row[data-rd-open]')).toHaveCount(1);
  await expect(rdRow(list, RC)).toBeVisible();
  await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('2개 삭제했어요');
  expect(errors).toEqual([]);
});

test('읽을 거리 412: 줄 위 좌우 밀기는 칩을 넘기지 않고, 줄 밖(머리줄)에서 밀면 옆 칩', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, list } = await openReading(page, 412);
  const allChip = list.locator('.rd-switch [data-filter-value="all"]');
  await expect(allChip).toHaveAttribute('aria-checked', 'true');
  await both(rdRow(list, RA), -120);
  await expect(ends(list)).toHaveCount(3);
  await expect(allChip).toHaveAttribute('aria-checked', 'true');
  await tick(page);
  await swipePick(page, rdRow(list, RB), both);
  await expect(page.locator('#readingView .row-swipe-pickbar')).toBeVisible();
  await expect(allChip).toHaveAttribute('aria-checked', 'true');
  await page.locator('#readingView [data-row-pick-stop]').click();
  await tick(page);
  await both(list.locator('.rd-head'), -160);
  await expect(allChip).toHaveAttribute('aria-checked', 'false');
  expect(errors).toEqual([]);
});

test('읽을 거리 1280: PC는 줄 밀기 없음(⋯ 그대로)', async ({ page }) => {
  test.setTimeout(90000);
  const { s, errors, list } = await openReading(page, 1280);
  await swipe(rdRow(list, RA), -200);
  await expect(page.locator('#readingView [data-row-swipe-act]')).toHaveCount(0);
  await expect(page.locator('#readingView .row-swipe-pickbar')).toHaveCount(0);
  await expect(rdRow(list, RA).locator('[data-rd-more]')).toBeVisible();
  expect(s.patches).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------- 자료실 ----------
const luRows = page => page.locator('#documentList [data-lu-document]');
const luRow = (page, id) => page.locator(`#documentList .lu-row[data-lu-document="${id}"]`);

test('자료실 390: 왼쪽 밀기 [옮기기]·[삭제] 칸 — 끝까지 밀어도 바로 안 지움, [삭제]는 기존 길(줄 빠짐·되돌리기), [옮기기]는 폴더 고르기', async ({ page }) => {
  test.setTimeout(90000);
  const state = await librarySetup(page, 390);
  await openLibrary(page, BASE);
  const list = page.locator('#documentList');
  await expect(luRows(page)).toHaveCount(5);
  // 끝까지 밀어도 맨 끝이 삭제라 칸만 열린다.
  await swipe(luRow(page, 'n1'), -320);
  await expect(ends(list)).toHaveCount(2);
  await expect(ends(list).nth(0)).toHaveAttribute('data-row-swipe-key', 'move');
  await expect(ends(list).nth(1)).toHaveAttribute('data-row-swipe-key', 'delete');
  await expect(luRows(page)).toHaveCount(5);
  await touchTap(cell(list, 'delete'));
  await expect(luRows(page)).toHaveCount(4);
  await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('삭제했어요');
  await page.locator('#kptuNotice .kptu-notice-undo').click();
  await expect(luRows(page)).toHaveCount(5);
  // [옮기기] = ⋯ [폴더로 옮기기]와 같은 폴더 고르기.
  await tick(page);
  await swipe(luRow(page, 'a1'), -60);
  await touchTap(cell(list, 'move'));
  await expect(folderSheet(page)).toBeVisible(); // S69-62: [파일] '옮길 곳' 창과 같은 창
  await page.keyboard.press('Escape');
  await expect(folderSheet(page)).toHaveCount(0);
  await page.waitForTimeout(7000);
  expect(state.deletes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('자료실 390: 오른쪽 밀기 [선택] 칸 누르기 → 자료실 선택 모드가 그 줄이 골라진 채로 열림, 줄 위 밀기는 길게 누르기 메뉴를 열지 않음', async ({ page }) => {
  test.setTimeout(90000);
  const state = await librarySetup(page, 390);
  await openLibrary(page, BASE);
  await swipePick(page, luRow(page, 'a2'), both);
  await expect(page.locator('#librarySelectBar')).toBeVisible();
  await expect(page.locator('#librarySelectCount')).toHaveText('1개 선택됨');
  await expect(page.locator('[data-lu-pick="a2"]')).toBeChecked();
  await expect(page.locator('#luMorePanel')).toBeHidden();
  // 선택 중에는 줄 밀기를 하지 않는다(줄 누르기 = 고르기).
  await tick(page);
  await swipe(luRow(page, 'a3'), -60);
  await expect(page.locator('#documentList [data-row-swipe-act]')).toHaveCount(0);
  expect(state.deletes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('자료실 1280: PC는 줄 밀기 없음', async ({ page }) => {
  test.setTimeout(90000);
  const state = await librarySetup(page, 1280);
  await openLibrary(page, BASE);
  await swipe(luRow(page, 'n1'), -200);
  await expect(page.locator('#documentList [data-row-swipe-act]')).toHaveCount(0);
  await expect(luRows(page)).toHaveCount(5);
  expect(state.errors).toEqual([]);
});

// ---------- 일정 목록 보기 ----------
test.describe('일정 목록', () => {
  test.use({ timezoneId: 'Asia/Seoul' });
  async function openList(page, width) {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date('2026-11-10T00:00:00Z'));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await installViewPrefsServer(page, { calendar_view: 'list' });
    const state = planServer();
    await installPlanServer(page, state, { base: BASE });
    await page.goto(loginEntry(BASE + '/app/?view=calendar'));
    await signInWithSession(page, 'qa@example.org');
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
    await expect(page.locator('#calendarList [data-google-event="todo2"] .rp-mark')).toHaveCount(1);
    return { state, errors, list: page.locator('#calendarList') };
  }
  const ev = (list, id) => list.locator(`.clv-event[data-google-event="${id}"]`).first();

  test('412: 왼쪽 밀기 [보고할 일정]/[표시 끄기]·[삭제] 칸(서버 저장), 끝까지 밀어도 칸만, 오른쪽 밀기 [선택] → [보고할 일정] 여러 개', async ({ page }) => {
    test.setTimeout(90000);
    const { state, errors, list } = await openList(page, 412);
    // 켜 둔 일정(쓰기 권한 있는 캘린더): [표시 끄기]·[삭제] 두 칸. S68-31: 메뉴에 [삭제]가 있어 맨 끝에 [삭제].
    await swipe(ev(list, 'todo2'), -60);
    await expect(ends(list)).toHaveCount(2);
    await expect(ends(list).nth(0)).toHaveAttribute('data-row-swipe-key', 'plan-off');
    await expect(ends(list).nth(1)).toHaveAttribute('data-row-swipe-key', 'delete');
    await touchTap(cell(list, 'plan-off'));
    await expect.poll(() => state.planWrites.length).toBe(1);
    expect(JSON.stringify(state.planWrites[0].body)).toContain('"off"');
    await expect(ev(list, 'todo2').locator('.rp-mark')).toHaveCount(0);
    // 그냥 일정을 끝까지: 맨 끝이 [삭제]라 바로 하지 않고 칸만 열린다(일정 창·묻기 없음). 열린 [보고할 일정]을 누르면 켠다.
    await tick(page);
    await swipe(ev(list, 'none1'), -320);
    await expect(ends(list)).toHaveCount(2);
    await expect(page.locator('#ciGoogleModal')).toBeHidden();
    await expect(page.locator('.kptu-ask')).toHaveCount(0);
    expect(state.planWrites.length).toBe(1);
    await touchTap(cell(list, 'plan-on'));
    await expect.poll(() => state.planWrites.length).toBe(2);
    expect(JSON.stringify(state.planWrites[1].body)).toContain('"on"');
    await expect(ev(list, 'none1').locator('.rp-mark')).toHaveCount(1);
    // [삭제] 칸 = 메뉴 [삭제]와 같은 길: 일정 창을 열고 한 번 묻는다. 취소하면 아무것도 지우지 않는다.
    await tick(page);
    await swipe(ev(list, 'off1'), -60);
    await touchTap(cell(list, 'delete'));
    const ask = page.locator('.kptu-ask');
    await expect(ask).toContainText('이 Google 일정을 삭제할까요?');
    await ask.locator('.kptu-ask-actions .secondary').click();
    await expect(ask).toHaveCount(0);
    await expect(page.locator('#ciGoogleModal')).toBeHidden();
    await expect(ev(list, 'off1')).toBeVisible();
    // 오른쪽 밀기 [선택] → 고른 일정을 한 번에 보고할 일정으로.
    await tick(page);
    await swipePick(page, ev(list, 'todo2'));
    const bar = page.locator('#calendarView .row-swipe-pickbar, .row-swipe-pickbar:visible').first();
    await expect(bar).toBeVisible();
    await expect(bar.locator('.row-swipe-pick-count')).toHaveText('1개 선택됨');
    await ev(list, 'off1').click();
    await expect(bar.locator('.row-swipe-pick-count')).toHaveText('2개 선택됨');
    await expect(page.locator('#ciGoogleModal')).toBeHidden();
    await bar.locator('[data-row-pick-act="plan-on"]').click();
    await expect.poll(() => state.planWrites.length).toBe(4);
    await expect(bar).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('1280: PC 목록은 줄 밀기 없음', async ({ page }) => {
    test.setTimeout(90000);
    const { state, errors, list } = await openList(page, 1280);
    await swipe(ev(list, 'none1'), -200);
    await expect(list.locator('[data-row-swipe-act]')).toHaveCount(0);
    expect(state.planWrites).toEqual([]);
    expect(errors).toEqual([]);
  });
});
