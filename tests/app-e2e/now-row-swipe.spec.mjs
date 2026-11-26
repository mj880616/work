import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// S49-3 NOW-줄밀기(명진 11/03 08:55): Now 글 줄을 왼쪽으로 밀면 숨기기, 오른쪽으로 밀면 보관(뉴스 = 별표). 공용 줄 밀기(row-swipe.js)와 서버 저장(now-marks.js) 그대로.
// PC는 밀기 대신 줄에 마우스를 올리면 [보관][숨기기]. 탭 이동은 탭 줄 위 밀기·누르기만. 서버 흉내(helpers/news-server.mjs), 글은 모두 가짜.
const item = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
async function swipe(locator, dx) {
  // 목록을 열면 바로 채우기(#1901) → 목록 다시 읽기·곁 자료 읽기로 줄이 몇 번 다시 그려진다. 찾은 줄이 그 사이 화면에서 빠졌으면
  // (isConnected 아님) 손가락 이벤트를 보내지 않고 다시 찾아 민다. 보낼 때는 한 evaluate 안에서 동기로 다 보내므로 도중에 다시 그려지지 않는다.
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
// UI-줄밀기 Raindrop식(S68-26): 왼쪽으로 조금 밀면 오른쪽 끝 칸 [보관]·[숨기기]가 열린 채 멈춘다 → 그 칸을 누른다.
// 누르기는 그 칸에 바로 보낸다(Playwright click의 '보이게 스크롤'이 스크롤 이벤트를 내 열린 칸을 닫지 않게 — 손가락은 스크롤하지 않고 누른다).
async function swipeTap(page, locator, key) {
  const b = page.locator(`[data-row-swipe-key="${key}"]`);
  // 민 뒤 목록이 다시 그려지면(늦게 온 읽기) 열린 칸도 닫히므로, 칸이 보일 때까지 다시 민다.
  await expect(async () => {
    await swipe(locator, -50);
    await expect(b).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await touchTap(b);
}
// 손가락 한 번 누르기(누름 → click). 밀기 뒤 따라오는 click을 삼키는 규칙은 다음 누름에서 풀린다.
async function touchTap(locator) {
  await locator.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, bubbles: true });
  await locator.dispatchEvent('click');
}
// S70-64 W1(결정 장부 W3): 오른쪽 밀기는 선택만 — 손을 떼면 [선택] 칸을 열어 두지 않고 바로 그 줄이 선택된다(막대가 뜬다).
// 민 뒤 목록이 다시 그려져 손동작이 빠졌으면 막대가 뜰 때까지 다시 민다(선택 중에는 줄 밀기가 꺼져 있어 두 번 골라지지 않음).
async function swipePick(page, locator) {
  await expect(async () => {
    await swipe(locator, 320);
    await expect(page.locator('.row-swipe-pickbar:visible, .kptu-selbar:visible').first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await expect(page.locator('[data-row-swipe-key="select"]')).toHaveCount(0);
}

test('Now 뉴스 412: 왼쪽 끝까지 밀어도 칸만 열림(S70-60), [숨기기]를 누르면 숨기고 [되돌리기], [보관] 칸(별표)·다시 누르면 풀기', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  await openNews(page, 412);
  await expect(item(page, 'c1')).toBeVisible();

  // UI-스와이프메뉴만(S70-60): 끝까지 밀어도 숨기지 않고 [저장][숨기기] 칸만 펼쳐진다.
  await swipe(item(page, 'c1'), -320);
  await expect(page.locator('#newsRoot [data-row-swipe-act="end"]')).toHaveText(['저장', '숨기기']);
  await page.waitForTimeout(500);
  await expect(item(page, 'c1')).toHaveCount(1);
  expect(server.calls.filter(c => c.what === 'app_news_marks' && c.method !== 'GET')).toHaveLength(0);
  await touchTap(page.locator('[data-row-swipe-key="hide"]'));
  await expect(item(page, 'c1')).toHaveCount(0);
  const hide = server.calls.filter(c => c.what === 'app_news_marks' && (c.method === 'PATCH' || c.method === 'POST')).at(-1);
  // NEWS-모두에게열기 ③: 표시 줄이 아직 없는 기사는 내 표시 한 줄을 넣는다(작업공간·기사·숨김만, 칸 권한 그대로).
  expect(hide.method).toBe('POST');
  expect(Object.keys(hide.body).sort()).toEqual(['article_id', 'hidden_at', 'workspace_id']);
  expect(hide.body.workspace_id).toBe('w');
  expect(hide.body.hidden_at).toBeTruthy();
  await expect.poll(() => server.calls.some(c => c.what === 'app_news_now_signals' && c.body?.article_id === 'c1' && c.body?.action === 'dismiss')).toBe(true);
  expect(await noticeText(page)).toBe('숨겼어요');
  await page.locator('#kptuNotice .kptu-notice-undo').click();
  await expect(item(page, 'c1')).toBeVisible();
  expect(server.calls.filter(c => c.what === 'app_news_marks' && (c.method === 'PATCH' || c.method === 'POST')).at(-1).body.hidden_at).toBeNull();

  await swipeTap(page, item(page, 'k1'), 'save');
  await expect(item(page, 'k1').locator('.nw-star')).toHaveCount(1);
  // S68-27: 보관 = 내 읽을 거리 한 줄(서버 함수 app_reading_keep) — 표시 표의 별표 칸에는 쓰지 않는다.
  expect(server.calls.filter(c => c.what === 'reading_keep').at(-1).body).toEqual({ p_workspace: 'w', p_source: 'news', p_article: 'k1', p_on: true, p_saved_at: null });
  expect(server.calls.some(c => c.what === 'app_news_marks' && c.body && 'starred_at' in c.body)).toBe(false);
  await expect.poll(() => server.calls.some(c => c.what === 'app_news_now_signals' && c.body?.article_id === 'k1' && c.body?.action === 'star')).toBe(true);
  await swipeTap(page, item(page, 'k1'), 'save');
  await expect(item(page, 'k1').locator('.nw-star')).toHaveCount(0);
  expect(server.calls.filter(c => c.what === 'reading_keep').at(-1).body).toMatchObject({ p_article: 'k1', p_on: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Now 뉴스 412: 왼쪽으로 조금 밀면 칸 [보관][숨기기](줄 높이만큼), 오른쪽으로 밀면 [고르기] → 여러 개 숨기기·한 번에 되돌리기', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  await openNews(page, 412);
  await expect(item(page, 'c1')).toBeVisible();
  // 왼쪽 조금: 오른쪽 끝에 칸 두 개, 맨 오른쪽이 [숨기기], 칸 높이 = 줄 높이.
  await swipe(item(page, 'c1'), -50);
  const cells = page.locator('#newsRoot [data-row-swipe-act="end"]');
  await expect(cells).toHaveCount(2);
  await expect(cells).toHaveText(['저장', '숨기기']);
  const rowBox = await item(page, 'c1').boundingBox(), cellBox = await cells.nth(1).boundingBox();
  expect(Math.abs(cellBox.height - rowBox.height)).toBeLessThan(2);
  expect(cellBox.x + cellBox.width).toBeGreaterThan(rowBox.x + rowBox.width - 2);
  expect(server.calls.filter(c => c.what === 'app_news_marks' && c.method !== 'GET')).toHaveLength(0);
  // 오른쪽 끝까지: [선택] 칸만 → 누르면 그 줄이 골라진 채로 고르기 줄. 다른 줄을 눌러 더 고른다(열리지 않음).
  await swipePick(page, item(page, 'c1'));
  const bar = page.locator('#newsRoot .row-swipe-pickbar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.row-swipe-pick-count')).toHaveText('1개 선택됨');
  // S70-64b(명진 11/26 07:46): 읽을 거리 고르기 막대 = [전체 선택][저장][삭제](삭제 = 숨기기). [✕]·[그만]·개수 글자 없음.
  await expect(bar.locator('[data-row-pick-stop]')).toHaveCount(0);
  await expect(bar.locator('[data-row-pick-all]')).toHaveAttribute('aria-checked', 'false');
  await expect(bar.locator('[data-row-pick-act]')).toHaveText(['저장', '삭제']);
  await touchTap(item(page, 'k1').locator('.nw-title'));
  await expect(bar.locator('.row-swipe-pick-count')).toHaveText('2개 선택됨');
  await expect(page.locator('#newsRoot [data-nc-detail]:visible, #newsRoot .nc-detail:visible')).toHaveCount(0);
  await bar.locator('[data-row-pick-act="hide"]').click();
  await expect(item(page, 'c1')).toHaveCount(0);
  await expect(item(page, 'k1')).toHaveCount(0);
  await expect(bar).toBeHidden();
  expect(await noticeText(page)).toBe('2개 숨겼어요');
  await page.locator('#kptuNotice .kptu-notice-undo').click();
  await expect(item(page, 'c1')).toBeVisible();
  await expect(item(page, 'k1')).toBeVisible();
  // Esc(폰은 뒤로가기): 선택을 끝내면 선택 줄이 사라진다(선택 상태는 화면 메모리만).
  await swipePick(page, item(page, 'c1'));
  await page.keyboard.press('Escape'); // S70-64b: [✕]·[그만] 없음 — Esc(폰은 뒤로가기)로 끝
  await expect(bar).toBeHidden();
  expect(errors).toEqual([]);
});

test('Now 뉴스 412: 글 줄 위 좌우 밀기는 탭을 옮기지 않는다', async ({ page }) => {
  const { errors } = await start(page, 412);
  await openNews(page, 412);
  await item(page, 'c1').evaluate(el => {
    const t = (type, x) => { const p = new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [p], changedTouches: [p] })); };
    t('touchstart', 300); t('touchmove', 150); t('touchend', 150);
  });
  await expect(page.locator('#outsideRoot [data-os-tab="media"]')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('Now 뉴스 412: 실제 손가락처럼(포인터 + 터치 함께) 글 줄 위를 밀면 줄 밀기만, 줄 밖 빈 곳을 밀면 탭 넘김', async ({ page }) => {
  const { errors } = await start(page, 412);
  await openNews(page, 412);
  await expect(item(page, 'c1')).toBeVisible();
  // 목록이 처음 채워지며 다시 그려지는 사이 찾은 줄이 빠졌으면 다시 찾아 민다(위 swipe와 같은 방법).
  const both = (locator, dx, onRow = true) => expect(async () => expect(await locator.evaluate((el, { dx, onRow }) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = onRow ? r.top + r.height / 2 : r.top + 4;
    const pt = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
    const tc = (type, cx) => { const t = new Touch({ identifier: 1, target: el, clientX: cx, clientY: y }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] })); };
    tc('touchstart', x); pt('pointerdown', x);
    for (let i = 1; i <= 10; i++) { pt('pointermove', x + dx * i / 10); tc('touchmove', x + dx * i / 10); }
    pt('pointerup', x + dx); tc('touchend', x + dx);
    return true;
  }, { dx, onRow })).toBe(true)).toPass({ timeout: 10000 });
  // 글 줄 위 오른쪽 끝까지: 바로 그 줄 선택(S70-64 W1, [선택] 칸이 남지 않음), 탭은 그대로.
  await expect(item(page, 'k1')).toBeVisible();
  await expect(async () => {
    await both(item(page, 'c1'), 320);
    await expect(page.locator('#newsRoot .row-swipe-pickbar')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await expect(page.locator('[data-row-swipe-key="select"]')).toHaveCount(0);
  await expect(page.locator('#outsideRoot [data-os-tab="media"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape'); // S70-64b: [✕]·[그만] 없음 — Esc(폰은 뒤로가기)로 끝
  // 글 줄 위 왼쪽 조금: 칸만 열리고 탭은 그대로.
  await page.clock.setFixedTime(await page.evaluate(() => Date.now() + 1000));
  await both(item(page, 'k1'), -60);
  await expect(page.locator('#newsRoot [data-row-swipe-act="end"]')).toHaveCount(2);
  await expect(page.locator('#outsideRoot [data-os-tab="media"]')).toHaveAttribute('aria-selected', 'true');
  // 줄 밖(탭 줄)에서 밀면 탭이 넘어간다.
  const tabs = page.locator('#outsideRoot [data-os-tabs]');
  // 시험은 시계를 멈춰 두므로(home-entry.mjs) 실제처럼 1초 흐르게 한 뒤 민다(줄 밀기 시각보다 뒤에 시작한 손동작).
  await page.clock.setFixedTime(await page.evaluate(() => Date.now() + 1000));
  await both(tabs, -120, false);
  await expect(page.locator('#outsideRoot [data-os-tab="media"]')).toHaveAttribute('aria-selected', 'false');
  expect(errors).toEqual([]);
});

test('Now 뉴스 1440: 줄에 마우스를 올리면 [보관][숨기기], 눌러서 숨기기·보관', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1440);
  await openNews(page, 1440);
  const c1 = item(page, 'c1');
  await expect(c1.locator('[data-now-act]')).toHaveCount(2);
  await expect(c1.locator('[data-now-act="save"]')).toBeHidden();
  await c1.hover();
  await expect(c1.locator('[data-now-act="save"]')).toBeVisible();
  await c1.locator('[data-now-act="save"]').click();
  await expect(c1.locator('.nw-star')).toHaveCount(1);
  await c1.hover();
  await c1.locator('[data-now-act="hide"]').click();
  await expect(item(page, 'c1')).toHaveCount(0);
  expect(server.calls.filter(c => c.what === 'app_news_marks' && (c.method === 'PATCH' || c.method === 'POST')).at(-1).body.hidden_at).toBeTruthy();
  expect(errors).toEqual([]);
});
