// UI-두칸높이(S71-60, 사용자 2026-11-26 21:02~21:04 PC 화면 의견): 목록 + 본문 두 칸 화면은
//  ① 본문(오른쪽) 칸 높이를 고정 숫자로 묶지 않는다 — 칸 아래 끝이 창 아래 끝(붙는 틈 12px)까지 오고, 칸 안 세로 스크롤은 칸이 '붙었을 때 창 높이'를 다 쓴 뒤에만 생긴다.
//  ② 본문 칸에 가로 스크롤 막대가 없다(넘치는 내용 원인을 고침).
//  ③ 두 칸 윗선: 오른쪽 칸 위끝 = 왼쪽 목록 윗선(머리 줄이 있으면 그 줄 아래 끝, 통화가 대표) ±2px.
// 칸 모양은 공용 follow-pane.js + desktop-ui.css(.kptu-follow-pane) 한 곳. 폰 390은 한 칸(본문이 화면 전체)이라 가로 넘침만 본다.
// 서버는 모두 흉내, 이름·글은 지어낸 것.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { openSavedDoc, openNewsDoc } from './helpers/doc-view.mjs';
import { fixture as callFixture, openCalls } from './helpers/call-feed-server.mjs';
import { installTgServer, telegramRows } from './helpers/tg-room-day-server.mjs';
import { bootLibrary, libFolder } from './helpers/library-folder-server.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const GAP = 12; // follow-pane.js: 창 아래 끝과 칸 사이 틈
const LONG = Array.from({ length: 40 }, (_, i) => `예시 문단 ${i + 1} — 본문이 길어 칸 높이를 다 쓰는지 보는 글이에요.`).join('\n\n');

// 화면 표: [이름, 여는 법(page, width) → {pane, line}]. pane = 본문 칸(붙는 칸), line = 왼쪽 윗선 {sel, edge}(없으면 윗선은 보지 않음).
const SCREENS = [
  ['저장한 글', async (page, width) => {
    await openSavedDoc(page, width, { body: LONG });
    return { pane: '#readingView [data-rd-detail]', line: { sel: '#readingView [data-rd-list]', edge: 'top' } };
  }],
  ['읽을 거리', async (page, width) => {
    await openNewsDoc(page, width);
    return { pane: '#outsideRoot [data-now-detail]', line: { sel: '#outsideRoot #nowMain', edge: 'top' } };
  }],
  ['통화', async (page, width) => {
    await callFixture(page, { width });
    await openCalls(page, width);
    await page.locator('#callsView .feed-rows:not(.feed-ask-rows) [data-cf-row]').first().click();
    await expect(page.locator('#cfDetail [data-cf-detail]')).toBeVisible();
    return { pane: '#cfDetail', line: { sel: '#cfList > .feed-head', edge: 'bottom' } };
  }],
  ['텔레그램', async (page, width) => {
    await openHome(page, { beforeLoad: async () => {
      for (const path of ['app_tg_senders', 'app_tg_day_senders']) await page.route(u => u.origin === SB && u.pathname === '/rest/v1/' + path, r => r.fulfill({ json: [] }));
      await installTgServer(page, { items: telegramRows() });
    } });
    await page.locator('#appView>.app-nav').getByRole('link', { name: '텔레그램 소식', exact: true }).click();
    await page.locator('#telegramView [data-tg-rd] .feed-rdb').first().click();
    await expect(page.locator('#tgDetail [data-tg-daybox]')).toBeVisible();
    return { pane: '#tgDetail', line: { sel: '#tgList > .feed-head', edge: 'bottom' } };
  }],
  ['조직 관리', async page => {
    await openHome(page);
    await clickView(page, 'team');
    await page.locator('#soOrganizationList [data-so-org]').first().click();
    await expect(page.locator('#wdDetailPane')).toBeVisible();
    return { pane: '#wdDetailPane', line: { sel: '#soOrganizationList', edge: 'top' } };
  }],
  ['사업 관리', async page => {
    await openHome(page);
    await clickView(page, 'meetings');
    await expect(page.locator('#meetingList .mcol-result')).toBeVisible();
    return { pane: '#meetingList .mcol-result', line: { sel: '#meetingList .mcol-layout > :first-child', edge: 'top' } };
  }],
  ['할 일', async page => {
    await openHome(page);
    await clickView(page, 'tasks');
    await page.locator('#tasksView [data-gt-edit]').first().click();
    await expect(page.locator('#gtDetailPane')).toBeVisible();
    return { pane: '#gtDetailPane', line: { sel: '#gtTaskSection .gt-head', edge: 'bottom' } };
  }],
  ['자료실 두 칸', async (page, width) => {
    const folders = [libFolder('fa', 'top-a', { name: '가상 A', sort_order: 1024 }), libFolder('fn', null, { name: '가상 N', sort_order: 2048 })];
    await bootLibrary(page, width, { folders, items: [{ document_id: 'a-1', folder_id: 'fa' }], group: '폴더', init: { viewPrefs: null } });
    await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
    return { pane: '#documentList [data-lu-two]', line: null };
  }],
  ['노트 폴더 나무', async page => {
    await openHome(page);
    await chooseBasketKind(page, 'note');
    await expect(page.locator('#basketView .nx-tree.kptu-follow-pane')).toBeVisible();
    return { pane: '#basketView .nx-tree.kptu-follow-pane', line: null };
  }],
];

const measure = (page, pane, line) => page.evaluate(({ pane, line }) => {
  const el = document.querySelector(pane), r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  const l = line ? document.querySelector(line.sel)?.getBoundingClientRect() : null;
  return {
    vh: innerHeight, top: r.top, bottom: r.bottom, height: r.height,
    stuck: parseFloat(cs.top) || 0,
    inner: el.scrollHeight > el.clientHeight + 1,
    wide: el.scrollWidth - el.clientWidth,
    docWide: document.documentElement.scrollWidth - innerWidth,
    line: l ? (line.edge === 'bottom' ? l.bottom : l.top) : null,
  };
}, { pane, line });

for (const [name, open] of SCREENS) for (const [width, height] of [[1280, 800], [1920, 1080]]) {
  test(`UI-두칸높이 ${name} PC ${width}×${height}: 본문 칸 창 끝까지·가로 막대 없음·윗선 맞춤`, async ({ page }) => {
    test.setTimeout(90000);
    const { pane, line } = await open(page, width);
    await page.setViewportSize({ width, height });
    const at = () => measure(page, pane, line);
    // 창 크기를 바꾼 뒤 칸이 다시 재어질 때까지(follow-pane은 다음 그림 틀에서 잰다).
    await expect.poll(async () => { const m = await at(); return Math.round(m.vh - GAP - m.bottom); }, { message: `${name}: 칸 아래 끝이 창 아래 끝(틈 ${GAP}px)까지` }).toBeLessThanOrEqual(2);
    const m = await at();
    // 칸 안 세로 스크롤은 칸이 '붙었을 때 창 높이'(창 높이 - 붙는 자리 - 틈)를 다 쓴 뒤에만.
    if (m.inner) expect(m.height, `${name}: 칸 안 스크롤인데 칸 높이가 창 높이를 다 쓰지 않음`).toBeGreaterThanOrEqual(m.vh - m.stuck - GAP - 2);
    expect(m.wide, `${name}: 본문 칸 가로 넘침`).toBeLessThanOrEqual(0);
    expect(m.docWide, `${name}: 화면 가로 넘침`).toBeLessThanOrEqual(0);
    if (line) expect(Math.abs(m.top - m.line), `${name}: 오른쪽 칸 위끝 ${m.top} · 왼쪽 윗선 ${m.line}`).toBeLessThanOrEqual(2);
  });
}

// 위쪽에 긴 상자가 있는 화면(사업 관리 = 이번 주 주간 보고 상자): 전에는 칸이 '지금 자리에서 창 끝까지'로 작게 묶여 칸 안 스크롤이 생기고
// 화면은 그만큼만 길어 위 상자를 올릴 수도 없었다. 이제 화면을 내리면 칸이 창 높이를 다 쓴다(붙은 뒤 칸 아래 끝 = 창 아래 끝).
test('UI-두칸높이 사업 관리 1280×800: 화면을 내리면 결과 칸이 창 높이를 다 쓴다(작게 묶인 칸 안 스크롤 없음)', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHome(page);
  await clickView(page, 'meetings');
  const pane = page.locator('#meetingList .mcol-result');
  await expect(pane).toBeVisible();
  await page.mouse.move(640, 20);
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await expect.poll(() => pane.evaluate(el => { const r = el.getBoundingClientRect(), top = parseFloat(getComputedStyle(el).top) || 0; return Math.round(r.height - (innerHeight - top - 12)); })).toBeGreaterThanOrEqual(-2);
});

// 폰 390 회귀: 한 칸(본문이 화면 전체), 가로 넘침 없음.
test.describe('폰', () => { test.use({ hasTouch: true });
for (const [name, open, sel] of [['저장한 글', page => openSavedDoc(page, 390, { body: LONG }), '#readingView [data-rd-detail]'], ['통화', async page => { await callFixture(page, { width: 390 }); await openCalls(page, 390); await page.locator('#callsView .feed-rows:not(.feed-ask-rows) [data-cf-row]').first().tap(); }, '#cfDetail']]) {
  test(`UI-두칸높이 ${name} 폰 390: 본문 한 칸, 가로 넘침 없음`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(page.locator(sel)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(await page.locator(sel).evaluate(el => el.classList.contains('kptu-follow-pane') && !el.classList.contains('kptu-follow-narrow'))).toBe(false);
  });
}
});
