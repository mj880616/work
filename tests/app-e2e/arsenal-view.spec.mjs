import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { openHome } from './helpers/home-entry.mjs';
import { innerScrollers, docScroll } from './helpers/one-scroll.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { checkSplit } from './helpers/split-check.mjs';
// 주소 개편 ② E1(docs/design/domain-move.md 2절): Web2 '아스날' 메뉴(?view=arsenal).
// 메뉴 창 맨 아래(폰)·사이드바 맨 아래 묶음 끝(PC), 경기 자료 app/arsenal/matches.js는 이 화면을 처음 열 때만 한 번 불러온다.
// 시즌·대회·상대 검색 거르기, 목록 → 리뷰(폰은 한 칸 + 뒤로가기 = 목록, PC는 두 칸), 바깥 링크는 https·새 탭.
const context = { window: {} };
runInNewContext(readFileSync(new URL('../../app/arsenal/matches.js', import.meta.url), 'utf8'), context);
// S46-26: 예정 경기 줄(upcoming:true)은 목록·개수에 안 들어가고 목록 위 작은 줄로만 보인다(오늘(한국) 이후만).
const ALL = context.window.ARSENAL_MATCHES.filter(m => m.upcoming !== true);
const kstToday = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const NEXT = context.window.ARSENAL_MATCHES.filter(m => m.upcoming === true && m.date >= kstToday);
const newest = [...ALL].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))[0];

async function start(page, width) {
  const errors = [], data = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('request', r => { if (new URL(r.url()).pathname.endsWith('/arsenal/matches.js')) data.push(r.url()); });
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  return { errors, data };
}
async function openArsenal(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    const tiles = page.locator('#mobileMenu nav button:visible');
    await expect(tiles.last()).toHaveText('아스날');
    await tiles.last().click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '아스날', exact: true }).click();
  await expect(page.locator('#arsenalView')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('arsenal');
}
const rows = page => page.locator('#arsenalRoot [data-ars-row]');
const review = page => page.locator('#arsenalRoot [data-ars-review]');
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('아스날 폰 390: 메뉴 창 맨 아래에서 열고, 자료는 그때 한 번만 받고, 거르기·리뷰·뒤로가기', async ({ page }) => {
  const f = await start(page, 390);
  expect(f.data).toEqual([]); // 첫 화면은 경기 자료를 받지 않는다.
  await openArsenal(page, 390);
  await expect(rows(page)).toHaveCount(ALL.length);
  await expect(page.locator('#arsenalRoot [data-ars-count]')).toHaveText(`경기 ${ALL.length}`);
  await expect(page.locator('#arsenalRoot [data-ars-upcoming]')).toHaveCount(NEXT.length);
  if (NEXT.length) await expect(page.locator('#arsenalRoot [data-ars-upcoming]').first()).toContainText(/^예정 · \d{1,2}\.\d{1,2}\.\([일월화수목금토]\)/);
  expect(f.data).toHaveLength(1);
  expect(f.data[0]).toMatch(/\/app\/arsenal\/matches\.js(\?|$)/);
  // 폰은 목록이 먼저(리뷰 칸은 닫혀 있음).
  await expect(review(page)).toBeHidden();
  await page.locator('#arsenalRoot [data-ars-season]').selectOption('2025-26');
  await expect(rows(page)).toHaveCount(53);
  await page.locator('#arsenalRoot [data-ars-competition]').selectOption('Premier League');
  await expect(rows(page)).toHaveCount(38);
  await expect(page.locator('#arsenalRoot [data-ars-competition] option:checked')).toHaveText('프리미어리그');
  await page.locator('#arsenalRoot [data-ars-competition]').selectOption('UEFA Champions League');
  await expect(rows(page)).toHaveCount(15);
  await page.locator('#arsenalRoot [data-ars-search]').fill('아틀레티코');
  await expect(rows(page)).toHaveCount(3);
  await page.locator('#arsenalRoot [data-ars-search]').fill('없는팀');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#arsenalRoot [data-wait-empty]')).toHaveText('맞는 경기 없음');
  await page.locator('#arsenalRoot [data-ars-search]').fill('');
  await page.locator('#arsenalRoot [data-ars-competition]').selectOption('Premier League');
  // 줄을 누르면 리뷰 한 칸(목록 숨김), 득점·도움, 판정, 첫 묶음만 펼침.
  await page.getByRole('button', { name: '크리스털 팰리스 1-2 아스날 리뷰 보기' }).click();
  await expect(review(page)).toBeVisible();
  await expect(page.locator('#arsenalRoot [data-ars-list]')).toBeHidden();
  await expect(review(page).locator('.ars-score-num')).toHaveText('1–2');
  await expect(review(page)).toContainText('38R');
  await expect(review(page).getByRole('region', { name: '득점·도움 기록' })).toBeVisible();
  await expect(review(page).locator('.ars-sec')).toHaveCount(4);
  await expect(review(page).locator('.ars-sec[open]')).toHaveCount(1);
  for (const link of await review(page).locator('a').all()) {
    expect(await link.getAttribute('href')).toMatch(/^https:\/\//);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  expect(await noWideScroll(page)).toBe(true);
  // 뒤로가기 한 번 = 목록(거르기 그대로).
  await page.goBack();
  await expect(review(page)).toBeHidden();
  await expect(rows(page)).toHaveCount(38);
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('arsenal');
  // [‹ 목록] 버튼도 같은 일.
  await rows(page).first().click();
  await page.locator('#arsenalRoot [data-ars-back]').click();
  await expect(rows(page).first()).toBeVisible();
  // 다른 화면에 갔다 와도 자료는 다시 받지 않는다.
  await page.locator('.mobile-tabs [data-view="home"]').click();
  await expect(page.locator('#homeView')).toBeVisible();
  await openArsenal(page, 390);
  expect(f.data).toHaveLength(1);
  expect(await noWideScroll(page)).toBe(true);
  expect(f.errors).toEqual([]);
});

test('아스날 PC 1280: 사이드바 맨 아래에서 열고, 목록·리뷰 두 칸, 맨 위 경기가 골라져 있음', async ({ page }) => {
  const f = await start(page, 1280);
  const items = await page.locator('#appView>.app-nav .nav-btn:visible').allTextContents();
  expect(items.at(-2)).toBe('아스날');
  expect(f.data).toEqual([]);
  await openArsenal(page, 1280);
  await expect(rows(page)).toHaveCount(ALL.length);
  await expect(review(page)).toBeVisible();
  await expect(page.locator('#arsenalRoot [data-ars-list]')).toBeVisible();
  await expect(review(page)).toHaveAttribute('data-ars-review', newest.id);
  await expect(rows(page).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#arsenalRoot [data-ars-back]')).toHaveCount(0);
  await page.locator('#arsenalRoot [data-ars-season]').selectOption('2025-26');
  await page.locator('#arsenalRoot [data-ars-competition]').selectOption('UEFA Champions League');
  await page.locator('#arsenalRoot [data-ars-row]').filter({ hasText: '파리 생제르맹' }).click();
  await expect(review(page)).toContainText('결과 패');
  await expect(review(page).locator('.ars-score-num')).toHaveText('1–1');
  await expect(review(page).locator('[data-ars-media] a').first()).toHaveAttribute('href', /^https:\/\//);
  // 고른 경기가 거르기에서 빠지면 남은 목록의 맨 위.
  await page.locator('#arsenalRoot [data-ars-search]').fill('아틀레티코');
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(review(page)).toContainText('아틀레티코');
  // 두 칸이 나란히(목록 왼쪽, 리뷰 오른쪽).
  const [list, detail] = await Promise.all(['[data-ars-list]', '[data-ars-detail]'].map(s => page.locator('#arsenalRoot ' + s).boundingBox()));
  expect(list.x + list.width).toBeLessThanOrEqual(detail.x + 1);
  expect(detail.width).toBeGreaterThan(list.width);
  expect(await noWideScroll(page)).toBe(true);
  expect(f.data).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

// UI-칸안스크롤하나로(2026-10-30 사용자 결정, 시안 A + 접힘 표시)
test('아스날 PC 1440: 스크롤 막대는 화면 하나, 아래쪽 옛 경기를 눌러도 리뷰가 바로 보이고, 접힌 칸에 펼침 표시', async ({ page }) => {
  const f = await start(page, 1440);
  await openArsenal(page, 1440);
  await expect(rows(page)).toHaveCount(ALL.length);
  await expect(review(page)).toBeVisible();
  // 목록 칸·리뷰 칸 어디에도 따로 스크롤이 없고, 문서만 세로로 넘어간다(경기가 많아 화면보다 김).
  expect(await innerScrollers(page, '#arsenalView')).toEqual([]);
  const d = await docScroll(page);
  expect(d.over).toBeGreaterThan(1000); expect(d.wide).toBeLessThanOrEqual(0);
  await expect(page.locator('#arsenalRoot [data-ars-list]')).toHaveCSS('overflow-y', 'visible');
  // 맨 아래 옛 경기를 누르면 리뷰가 화면 안에(머리부터) 보인다.
  const last = rows(page).last();
  await last.scrollIntoViewIfNeeded(); await last.click();
  await expect(review(page)).toHaveAttribute('data-ars-review', await last.getAttribute('data-ars-row'));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  await expect(review(page)).toBeInViewport();
  const head = await review(page).boundingBox();
  expect(head.y).toBeGreaterThanOrEqual(0); expect(head.y).toBeLessThan(200);
  // 접힌 칸 제목 앞 펼침 표시: 접힘 ▸, 펼침 ▾(기본 표시는 숨김).
  const marks = await review(page).locator('.ars-sec').evaluateAll(list => list.map(d => ({ open: d.open, mark: getComputedStyle(d.querySelector('summary'), '::before').content })));
  expect(marks.length).toBeGreaterThan(1);
  for (const m of marks) expect(m.mark).toBe(m.open ? '"▾"' : '"▸"');
  const key = await review(page).locator('.ars-sec:not([open])').first().getAttribute('data-ars-sec');
  const closed = review(page).locator(`.ars-sec[data-ars-sec="${key}"] summary`);
  await closed.click(); await expect(review(page).locator(`.ars-sec[data-ars-sec="${key}"]`)).toHaveAttribute('open', '');
  expect(await closed.evaluate(s => getComputedStyle(s, '::before').content)).toBe('"▾"');
  expect(f.errors).toEqual([]);
});

// UI-칸폭끌기전수(요청함 10/30 10:29): PC 목록 | 리뷰 사이 경계를 끌어 폭을 바꾸고, 폭은 서버(view_prefs.split_ratio.arsenal)에 기억한다.
test('아스날 PC 1440: 목록 | 리뷰 경계 끌기·키보드·새로고침 유지·두 번 눌러 기본', async ({ page }) => {
  const server = await installViewPrefsServer(page);
  const f = await start(page, 1440);
  const open = async () => { await openArsenal(page, 1440); await expect(review(page)).toBeVisible(); };
  await open();
  await checkSplit(page, { container: '#arsenalRoot .ars-body', left: ':scope>.ars-list', right: ':scope>.ars-detail', name: 'arsenal', share: 1 / 3, server, reopen: open });
  expect(f.errors).toEqual([]);
});
