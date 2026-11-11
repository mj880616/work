import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// FOLD-넓은화면 ④(S57-16, 시안 docs/design/mockups/home-fold-two-columns.html '안 1', 명진 선택 11/11 09:51):
// 홈 [하루] 카드는 폴드 펼침(600~1199px)에서 5:5 두 단 — 왼쪽 [그날 일정 → 할 일], 오른쪽 [오늘 한 일 → 읽을 글·사진 → 재료], 다가오는 일은 두 단 폭 전체 한 줄,
// 두 단은 한 덩어리로 같이 내림(안쪽 스크롤 없음), 입력 줄은 카드 밖이라 날짜 줄 아래 전체 폭 그대로. 접은 폰(600 미만)·PC(1200~)는 배치가 그대로다.
// 날짜 줄: 요일·날짜를 한 줄('수 11')로, 높이는 옆 단추(‹ › [이번 주])와 같은 32px, 400px 미만 접은 폰은 요일 글자만 숨김.
// 시계 2026-10-06(화) 10:00 KST(openHome), 가짜 서버·가짜 자료만 쓴다.
const FOLD = [[690, 1000], [750, 1000], [884, 1104], [1024, 900], [1199, 900]];
const SINGLE = [[412, 915], [599, 900]];
const PC = [[1200, 900], [1280, 900]];

const rects = page => page.evaluate(() => {
  const r = sel => { const e = document.querySelector('#journalRoot ' + sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
  const sched = document.querySelector('#journalRoot [data-journal-schedule]');
  return {
    vw: innerWidth, docW: document.documentElement.scrollWidth,
    day: r('[data-journal-day]'), dday: r('[data-journal-dday]'),
    // 폴드 두 단에서는 일정 칸(section)이 display:contents라 상자가 없다 → 그 안 머리·목록 묶음을 잰다.
    sched: sched.getBoundingClientRect().width ? r('[data-journal-schedule]') : r('.journal-schedule-body'),
    tasks: r('[data-journal-tasks]'), done: r('[data-journal-done-day]'), fill: r('[data-journal-fill]'), mats: r('[data-journal-materials]'),
    right: r('.journal-day-right'), rightDisplay: getComputedStyle(document.querySelector('#journalRoot .journal-day-right')).display,
    dayDisplay: getComputedStyle(document.querySelector('#journalRoot [data-journal-day]')).display,
    quick: (() => { const e = document.querySelector('#homeView .home-quick[data-home-quick]'); const b = e.getBoundingClientRect(); return { y: b.y, bottom: b.bottom, position: getComputedStyle(e).position }; })(),
  };
});
const ready = async (page, width, height) => {
  await page.setViewportSize({ width, height });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await expect(page.locator('#journalRoot [data-journal-date]')).toHaveCount(7);
  await expect(page.locator('#journalRoot [data-journal-dday] .journal-dday-chip')).toHaveText(['D-1 주요 일정']);
  await expect(page.locator('#journalRoot [data-journal-schedule] .journal-event')).toHaveCount(2);
  await expect(page.locator('#journalRoot [data-journal-tasks] [data-journal-task]').first()).toBeVisible();
  return errors;
};

for (const [width, height] of FOLD) {
  test(`폴드 펼침 ${width}: 홈 하루 카드가 5:5 두 단(왼쪽 일정·할 일 / 오른쪽 오늘 한 일·재료)으로 화면 전체 폭을 쓴다`, async ({ page }) => {
    const errors = await ready(page, width, height);
    const m = await rects(page);
    expect(m.docW).toBeLessThanOrEqual(m.vw);
    expect(m.dayDisplay).toBe('grid');
    expect(m.rightDisplay).toBe('flex');
    // 다가오는 일: 카드 맨 위 두 단 폭 전체 한 줄(일정·오른쪽 칸보다 위).
    expect(m.dday.y).toBeGreaterThanOrEqual(m.day.y - 1);
    expect(m.dday.bottom).toBeLessThanOrEqual(m.sched.y + 1);
    expect(m.dday.w).toBeGreaterThan(m.done.right - m.sched.x - 2);
    // 왼쪽 단: 일정 위 · 할 일 아래, 같은 x. 사이가 벌어지지 않는다(할 일이 일정 바로 아래, 간격 12px 안팎).
    expect(Math.abs(m.tasks.x - m.sched.x)).toBeLessThanOrEqual(1);
    expect(m.tasks.y).toBeGreaterThanOrEqual(m.sched.bottom - 1);
    expect(m.tasks.y - m.sched.bottom).toBeLessThanOrEqual(16);
    // 오른쪽 단: 오늘 한 일이 일정과 같은 줄에서 시작, 재료는 그 아래 같은 단.
    expect(m.done.x).toBeGreaterThanOrEqual(m.sched.right - 1);
    expect(Math.abs(m.done.y - m.sched.y)).toBeLessThanOrEqual(2);
    expect(m.mats.y).toBeGreaterThanOrEqual(m.done.bottom - 1);
    expect(Math.abs(m.mats.x - m.done.x)).toBeLessThanOrEqual(1);
    // 5:5(두 단 폭이 같다, 사이 여백·선은 각 단 안쪽 16px) · 두 단이 카드 안쪽 폭을 끝까지 쓴다(오른쪽 단 끝 = 카드 끝 − 안쪽 여백 12px − 테두리).
    expect(Math.abs(m.sched.w - m.right.w)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.right.right - (m.day.right - 13))).toBeLessThanOrEqual(2);
    // 한 덩어리로 같이 스크롤: 두 단 어느 쪽도 안쪽 스크롤 칸이 아니다.
    const scrolls = await page.evaluate(() => ['.journal-day-right', '.journal-schedule-body', '[data-journal-tasks]'].map(sel => { const e = document.querySelector('#journalRoot ' + sel); const o = getComputedStyle(e).overflowY; return { sel, o, inner: e.scrollHeight > e.clientHeight + 1 && o !== 'visible' }; }));
    for (const s of scrolls) expect(s.inner, s.sel).toBe(false);
    // 입력 줄은 카드 밖. 761px부터(PC 틀)는 날짜 줄 아래 전체 폭에 있고 카드는 그 아래, 600~760(폰 틀)은 지금처럼 하단 탭 위 고정.
    if (width >= 761) { expect(m.quick.position).not.toBe('fixed'); expect(m.day.y).toBeGreaterThanOrEqual(m.quick.bottom - 1); }
    else expect(m.quick.position).toBe('fixed');
    // 키보드·읽기 순서는 그대로(일정 → 할 일 → 오늘 한 일 → 재료).
    const order = await page.evaluate(() => ['[data-journal-schedule]', '[data-journal-tasks]', '[data-journal-done-day]', '[data-journal-fill]', '[data-journal-materials]'].map(s => document.querySelector('#journalRoot ' + s)).map((e, i, all) => i === 0 || !!(all[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)));
    expect(order.every(Boolean)).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const [width, height] of [...SINGLE, ...PC]) {
  test(`폴드 두 단 밖 ${width}: 홈 하루 카드 배치는 그대로(묶음 두 개는 없는 것과 같음)`, async ({ page }) => {
    const errors = await ready(page, width, height);
    const m = await rects(page);
    expect(m.docW).toBeLessThanOrEqual(m.vw);
    expect(m.dayDisplay).toBe('flex');
    expect(m.rightDisplay).toBe('contents');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#journalRoot .journal-schedule-body')).display)).toBe('contents');
    // 다가오는 일은 일정 칸 안 맨 아래(지금처럼), 일정 칸 폭만큼.
    expect(m.dday.y).toBeGreaterThanOrEqual(m.sched.y);
    expect(m.dday.w).toBeLessThanOrEqual(m.sched.w + 1);
    if (width < 600) {
      // 접은 폰: 한 단 — 일정 → 할 일 → 오늘 한 일 → 재료, 모두 같은 x.
      expect(Math.abs(m.tasks.x - m.sched.x)).toBeLessThanOrEqual(1);
      expect(m.tasks.y).toBeGreaterThanOrEqual(m.sched.bottom - 1);
      expect(Math.abs(m.done.x - m.sched.x)).toBeLessThanOrEqual(1);
      expect(m.done.y).toBeGreaterThanOrEqual(m.tasks.bottom - 1);
      expect(m.mats.y).toBeGreaterThanOrEqual(m.done.bottom - 1);
      if (width === 412) expect(m.quick.position).toBe('fixed'); // 폰 입력 줄은 하단 탭 위 고정(지금처럼)
    } else {
      // PC: [일정 | 할 일] 좌우 같은 줄, 오늘 한 일·재료는 그 아래 전체 폭.
      expect(Math.abs(m.tasks.y - m.sched.y)).toBeLessThanOrEqual(2);
      expect(m.tasks.x).toBeGreaterThanOrEqual(m.sched.right - 1);
      expect(m.done.y).toBeGreaterThanOrEqual(Math.max(m.sched.bottom, m.tasks.bottom) - 1);
      expect(Math.abs(m.done.x - m.sched.x)).toBeLessThanOrEqual(1);
      expect(m.done.w).toBeGreaterThan(m.sched.w * 1.8);
      expect(m.mats.y).toBeGreaterThanOrEqual(m.done.bottom - 1);
    }
    expect(errors).toEqual([]);
  });
}

for (const [width, height] of [[390, 844], [412, 915], [690, 1000], [884, 1104], [1280, 900]]) {
  test(`날짜 줄 ${width}: 날짜 칸이 낮다(‹ › [이번 주]와 같은 32px) · 요일·날짜 한 줄 · 오늘·고른 날 표시 그대로`, async ({ page }) => {
    const errors = await ready(page, width, height);
    const m = await page.evaluate(() => {
      const h = sel => document.querySelector('#journalRoot ' + sel).getBoundingClientRect().height;
      const cells = [...document.querySelectorAll('#journalRoot [data-journal-date]')].map(c => {
        const b = c.getBoundingClientRect(), wd = c.querySelector('.journal-weekday'), nm = c.querySelector('.journal-num');
        const wb = wd.getBoundingClientRect(), nb = nm.getBoundingClientRect(), shown = getComputedStyle(wd).display !== 'none';
        return { h: b.height, w: b.width, shown, dy: Math.abs((wb.y + wb.height / 2) - (nb.y + nb.height / 2)), wdLeft: shown ? wb.right <= nb.left + 1 : null, inside: shown ? wb.left >= b.left - 0.5 && nb.right <= b.right + 0.5 : nb.left >= b.left - 0.5 && nb.right <= b.right + 0.5 };
      });
      return { cells, prev: h('[data-journal-prev]'), next: h('[data-journal-next]'), today: h('[data-journal-today]'), docW: document.documentElement.scrollWidth, vw: innerWidth };
    });
    expect(m.docW).toBeLessThanOrEqual(m.vw);
    for (const c of m.cells) {
      expect(c.h).toBeLessThanOrEqual(m.today + 0.5);            // 옆 단추와 같은 높이(세로로 긴 알약 아님)
      expect(c.h).toBeGreaterThanOrEqual(m.prev - 0.5);
      expect(c.inside).toBe(true);                               // 글자가 칸 밖으로 나가지 않음
      expect(c.shown).toBe(width >= 400);                        // 400px 미만 접은 폰만 요일 글자 숨김
      if (c.shown) { expect(c.dy).toBeLessThanOrEqual(3); expect(c.wdLeft).toBe(true); }
    }
    expect(m.prev).toBeCloseTo(32, 0); expect(m.next).toBeCloseTo(32, 0); expect(m.today).toBeCloseTo(32, 0);
    // 오늘 칸 = 공용 오늘 표시 + 고른 날, 읽기 이름은 그대로.
    const today = page.locator('#journalRoot [data-journal-date="2026-10-06"]');
    await expect(today).toHaveClass(/ds-today/); await expect(today).toHaveAttribute('aria-current', 'date'); await expect(today).toHaveAttribute('aria-pressed', 'true');
    await expect(today).toHaveAttribute('aria-label', /10월 6일 화요일/);
    if (width >= 400) await expect(today).toContainText('화');
    expect(errors).toEqual([]);
  });
}

test('폴드 펼침 884: 날짜를 눌러(터치)·키보드로 고르면 고른 날이 바뀌고 두 단 배치가 그대로 유지된다', async ({ page }) => {
  const errors = await ready(page, 884, 1104);
  const cell = day => page.locator(`#journalRoot [data-journal-date="${day}"]`);
  await cell('2026-10-07').click();
  await expect(cell('2026-10-07')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 7일 수요일');
  await cell('2026-10-08').focus();
  await page.keyboard.press('Enter');
  await expect(cell('2026-10-08')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 8일 목요일');
  // 오늘이 아닌 날은 '다가오는 일' 줄이 없다 → 첫 행이 비어도 두 단이 그대로(일정 왼쪽 · 오늘 한 일 오른쪽 같은 줄).
  await expect(page.locator('#journalRoot [data-journal-dday]')).toHaveCount(0);
  await expect(page.locator('#journalRoot [data-journal-tasks] .journal-schedule-head')).toBeVisible();
  await expect(page.locator('#journalRoot [data-journal-schedule] .journal-schedule-head')).toBeVisible();
  const m = await rects(page);
  expect(m.dayDisplay).toBe('grid');
  expect(m.done.x).toBeGreaterThanOrEqual(m.sched.right - 1); expect(Math.abs(m.done.y - m.sched.y)).toBeLessThanOrEqual(2);
  expect(m.tasks.y).toBeGreaterThanOrEqual(m.sched.bottom - 1);
  // 이번 주 단추로 돌아오면 다가오는 일 줄이 다시 두 단 폭 전체로.
  await page.locator('#journalRoot [data-journal-today]').click();
  await expect(page.locator('#journalRoot [data-journal-dday] .journal-dday-chip')).toHaveCount(1);
  const back = await rects(page);
  expect(back.dday.w).toBeGreaterThan(back.done.right - back.sched.x - 2);
  expect(errors).toEqual([]);
});

test('폭을 바꿔도(폴드 접음 ↔ 펼침 ↔ PC) 두 단 배치가 그 폭에 맞게 바뀐다', async ({ page }) => {
  const errors = await ready(page, 884, 1104);
  expect((await rects(page)).dayDisplay).toBe('grid');
  await page.setViewportSize({ width: 412, height: 915 });
  await expect.poll(async () => (await rects(page)).dayDisplay).toBe('flex');
  await page.setViewportSize({ width: 690, height: 1000 });
  await expect.poll(async () => (await rects(page)).dayDisplay).toBe('grid');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(async () => (await rects(page)).dayDisplay).toBe('flex');
  expect(errors).toEqual([]);
});
