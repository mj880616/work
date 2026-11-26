import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { pickReportBox } from './helpers/report-boxes.mjs';
import { pickReportFilter } from './helpers/report-filter.mjs';

// S71-23 BIZ-머리한줄(명진 11/26 "시안 한줄 좋아", 시안 claude.ai/artifact/Bod9CNKnxrLMj4m8BGKxfw):
// 폰·폴드 = 앱 머리 줄 하나 [W] 사업 관리 · [전체 ▾] · n건 ……… [+] · 찾기. 예전 둘째 줄(날짜 ‹ ›·녹음 ●·⋯)은 없다.
// PC = 화면 안 첫 줄 하나 [고르기 상자들] · n건 ……… [+]. 주 넘기기 ‹ 11.23~11.29 ›는 '이번 주 주간 보고' 상자 제목 줄.
// [+] 메뉴 = [새 사업 보고][녹음] / 구분선 / [사업영역 관리](옅은 글자). '쓰는 법'은 없다.
// (예전 S71-10 report-filter-chip-week.spec.mjs '주 줄 첫 줄 안'은 이 결정으로 거두고 이 시험이 대신한다. 모든 이름은 합성 값.)
test.use({timezoneId: 'Asia/Seoul'});
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LONG_AREA = '합성 사업영역 이름이 아주 길어서 한 줄에 다 들어가지 않는 경우';

function seoulDay(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return d.toISOString();
}
function makeState() {
  const meeting = (id, title, when, area = null) => ({id, workspace_id: 'workspace-1', title, series_name: title, round_no: null, meeting_at: when, activity_kind: 'meeting', created_by: 'user-1', notes: '', decisions: '', transcript_text: '원문', business_area_id: area, project_id: area});
  // 이번 주 둘(오늘), 지난 주 하나(7일 전) — 주를 넘기면 목록·건수가 바뀐다.
  const meetings = [meeting(ID(1), '합성 대표자 회의', seoulDay(0), 'area-1'), meeting(ID(2), '합성 실무 회의', seoulDay(0)), meeting(ID(3), '합성 지난주 점검 회의', seoulDay(-7))];
  return {
    user: {id: 'user-1', email: 'owner@example.org', user_metadata: {display_name: '관리자'}},
    workspace: {id: 'workspace-1', slug: 'team', name: '웹2'},
    spaces: [{id: 'area-1', workspace_id: 'workspace-1', name: LONG_AREA, description: null, parent_id: null, status: 'active', visibility: 'private', owner_id: 'user-1', sort_order: 10, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', metadata: {project_system: 'v2', management_version: 2}}],
    meetings
  };
}

async function mock(page, state) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const ok = data => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: state.user});
    if (path === '/auth/v1/user') return ok(state.user);
    if (path === '/auth/v1/logout') return ok({});
    if (path === '/functions/v1/google-calendar') return ok({connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {}});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'workspace-1', user_id: state.user.id, role: 'owner', workspace: state.workspace, created_at: new Date().toISOString()}]);
    if (path === '/rest/v1/app_workspaces') return ok([state.workspace]);
    if (path === '/rest/v1/app_spaces' && req.method() === 'GET') return ok(state.spaces);
    if (path === '/rest/v1/app_meetings' && req.method() === 'GET') return ok(state.meetings);
    if (path === '/rest/v1/app_profiles') return ok([{user_id: state.user.id, display_name: '관리자'}]);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

async function open(page, width) {
  await page.setViewportSize({width, height: 860});
  await installViewPrefsServer(page, null, {});
  await mock(page, makeState());
  await page.goto(`${appOrigin}/app/?view=meetings`);
  await enterLogin(page);
  await signInWithSession(page, 'owner@example.org');
  await page.waitForFunction(() => window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#reportCount')).toHaveText(/\d+건/);
  await expect(page.locator('#bizWeekBox .biz-week-nav .report-week-label')).toBeVisible();
  // 맨 위 찾기 칸이 '사업 관리에서 찾기'로 붙은 뒤(폰 머리 줄 끝 돋보기·폴드 찾기 칸, PC 위쪽 줄).
  await expect(page.locator('html')).toHaveAttribute('data-screen-find', 'meetings');
  if (width <= 760) await expect(page.locator('#appView > .mobile-shell-header .mobile-shell-find').locator('.sf-open:visible, .gs-field:visible').first()).toBeVisible();
}

// 첫 줄에 보이는 것들(왼쪽부터): 폰은 아이콘·이름·고르기·건수·[+]·찾기, PC는 고르기·건수·[+].
function measure(page) {
  return page.evaluate(() => {
    const vis = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
    const box = e => { const r = e.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, mid: r.top + r.height / 2, h: r.height}; };
    const head = document.querySelector('#appView > .mobile-shell-header');
    const top = document.querySelector('#reportTop');
    const chip = document.querySelector('#reportFilterChip');
    const filters = (vis(chip) ? [chip] : [...document.querySelectorAll('#reportFilterBar > select, #reportFilterBar #reportPeriodPick select')]).filter(vis);
    const phone = !!(head && vis(head) && head.contains(top));
    const items = [
      ...(phone ? [head.querySelector('.head-mark'), head.querySelector('[data-mobile-view-name]')] : []),
      ...filters, document.querySelector('#reportCount'), document.querySelector('#newMeetingBtn'),
      ...(phone ? [[...head.querySelectorAll('.mobile-shell-find .sf-open, .mobile-shell-find .gs-field')].find(vis)] : [])
    ].filter(vis);
    const row = phone ? head : top;
    return {phone, items: items.map(e => ({id: e.id || e.className, ...box(e)})), row: {...box(row), scroll: row.scrollWidth, client: row.clientWidth},
      page: {scroll: document.documentElement.scrollWidth, inner: innerWidth},
      chipText: vis(chip) ? chip.innerText.trim() : '', chipCut: vis(chip) ? (e => e.scrollWidth > e.clientWidth + 1)(chip.querySelector('.report-filter-chip-text')) : false,
      gone: ['#reportMore', '#reportRecordBtn', '#phoneRecordBtn'].filter(s => document.querySelector(s)),
      screenLine: [...document.querySelectorAll('#meetingsView .report-top > *')].filter(vis).map(e => e.id || e.className)};
  });
}

function expectOneLine(m) {
  const mids = m.items.map(x => x.mid);
  // 한 줄: 가운데 높이가 모두 같고 줄 높이는 한 줄(폰 머리 줄 44px 안쪽, PC 첫 줄 36px 안쪽).
  expect(Math.max(...mids) - Math.min(...mids)).toBeLessThanOrEqual(3);
  expect(m.row.h).toBeLessThanOrEqual(m.phone ? 46 : 40);
  // 왼쪽부터 차례로 서고 겹치지 않는다.
  for (let i = 1; i < m.items.length; i++) expect(m.items[i].left).toBeGreaterThanOrEqual(m.items[i - 1].right - 0.5);
  // 줄 안·화면 안(가로 넘침 없음).
  for (const x of m.items) { expect(x.left).toBeGreaterThanOrEqual(m.row.left - 0.5); expect(x.right).toBeLessThanOrEqual(m.row.right + 0.5); }
  expect(m.page.scroll).toBeLessThanOrEqual(m.page.inner);
  // 예전 첫 줄 [녹음]·⋯는 없다.
  expect(m.gone).toEqual([]);
}

// 390 폰, 344 폴드 접힘, 700 폴드 펼침(찾기 칸이 펼쳐진 폭), 1280 PC.
for (const width of [390, 344, 700, 1280]) test(`${width}: 첫 줄 한 줄 — 고르기 · n건 ……… [+]${width <= 760 ? ' · 찾기(앱 머리 줄)' : '(화면 안)'}, 둘째 줄·날짜·녹음·⋯ 없음`, async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await open(page, width);
  await expect.poll(async () => { const m = await measure(page); const mids = m.items.map(x => x.mid); return Math.max(...mids) - Math.min(...mids); }).toBeLessThanOrEqual(3);
  const m = await measure(page);
  expect(m.phone).toBe(width <= 760);
  expectOneLine(m);
  // 폰: 순서 [W] 사업 관리 [고르기] n건 [+] 찾기 — 찾기가 줄 맨 끝.
  if (m.phone) { expect(m.items.at(-1).id).toMatch(/sf-open|gs-field/); expect(m.items.at(-2).id).toBe('newMeetingBtn'); }
  else expect(m.items.at(-1).id).toBe('newMeetingBtn');
  // 화면 안에는 첫 줄 말고 다른 줄이 없다(폰은 첫 줄이 머리 줄로 가서 화면 안 줄이 비어 있음).
  expect(m.screenLine).toEqual(m.phone ? [] : ['reportTop']);
  // 날짜는 첫 줄에 없고 상자 제목 줄에 있다.
  await expect(page.locator('#reportTop .report-week-label')).toHaveCount(0);
  await expect(page.locator('#bizWeekBox .biz-week-title')).toContainText(/이번 주 주간 보고\s*‹?\s*\d{1,2}\.\d{1,2}~\d{1,2}\.\d{1,2}/);
  expect(errors).toEqual([]);
});

test('390: 긴 사업영역 이름을 골라도 한 줄 — [전체 ▾] 자리 칩 글자가 끝 말줄임', async ({page}) => {
  await open(page, 390);
  await pickReportFilter(page, 'area', 'area-1');
  await expect(page.locator('#reportFilterChip')).toContainText('합성 사업영역 이름이');
  const m = await measure(page);
  expectOneLine(m);
  expect(m.chipCut).toBe(true);
});

for (const width of [390, 1280]) test(`${width}: ‹ ›(주간 보고 상자 제목 줄)로 주를 넘기면 목록·건수가 바뀌고, 상태는 하나`, async ({page}) => {
  await open(page, width);
  const label = page.locator('#bizWeekBox .biz-week-nav .report-week-label'), count = page.locator('#reportCount');
  // 목록 글자는 폰 목록 줄로 본다(PC는 오른쪽에 고른 보고 칸이 함께 열려 있어 건수로 본다).
  const phone = width <= 760, list = page.locator('#meetingList');
  const now = await label.textContent();
  expect(now).toMatch(/^\d{1,2}\.\d{1,2}~\d{1,2}\.\d{1,2}$/);
  await expect(count).toHaveText('2건');
  if (phone) {
    await expect(list).toContainText('합성 대표자 회의');
    await expect(list).not.toContainText('합성 지난주 점검 회의');
  }
  await page.locator('#bizWeekBox [data-report-week="prev"]').click();
  await expect(label).not.toHaveText(now);
  await expect(count).toHaveText('1건');
  if (phone) {
    await expect(list).toContainText('합성 지난주 점검 회의');
    await expect(list).not.toContainText('합성 대표자 회의');
  }
  // 이번 주가 아니면 상자 이름은 '주간 보고'(날짜는 ‹ › 사이 한 곳), 고르기 기간 상자는 '주 단위'(같은 상태를 읽음).
  await expect(page.locator('#bizWeekBox .biz-week-title > .biz-week-fold').first()).toHaveText('주간 보고');
  await expect(page.locator('#reportPeriodPick [data-report-period]')).toHaveValue('');
  // 키보드로 이어 넘길 수 있게 누른 단추에 초점이 남는다.
  await expect(page.locator('#bizWeekBox [data-report-week="prev"]')).toBeFocused();
  await page.locator('#bizWeekBox [data-report-week="next"]').click();
  await expect(label).toHaveText(now);
  await expect(count).toHaveText('2건');
  if (phone) await expect(list).toContainText('합성 대표자 회의');
});

const ITEMS = el => [...el.querySelectorAll('button, hr')].filter(e => e.getClientRects().length).map(e => e.tagName === 'HR' ? '—' : e.textContent.trim());

test('1280: [+] 메뉴 = 새 사업 보고 · 녹음 / 구분선 / 사업영역 관리(옅은 글자) — 쓰는 법 없음, 녹음·사업영역 관리·새 사업 보고가 여기서 열림', async ({page}) => {
  await open(page, 1280);
  await page.waitForFunction(() => !!window.KPTUMeetingRecorder); // 녹음기는 첫 화면 뒤에 붙는다(loader-v2.js)
  const add = page.locator('#newMeetingBtn'), menu = page.locator('#bizAddMenu');
  await add.click();
  await expect(menu).toBeVisible();
  await expect(add).toHaveAttribute('aria-expanded', 'true');
  // 녹음 가능 브라우저(PC)면 세 줄과 구분선 하나.
  expect(await menu.evaluate(ITEMS)).toEqual(['새 사업 보고', '녹음', '—', '사업영역 관리']);
  await expect(menu.locator('hr[role="separator"]')).toHaveCount(1);
  const [areaColor, newColor] = await Promise.all([menu.locator('[data-report-areas]').evaluate(e => getComputedStyle(e).color), menu.locator('[data-report-new]').evaluate(e => getComputedStyle(e).color)]);
  expect(areaColor).not.toBe(newColor);
  await expect(menu).not.toContainText('쓰는 법');
  // 녹음: 녹음기(meeting-recorder.js)의 시작 길을 부른다(마이크는 시험에서 켜지 않는다 — 시작 함수만 바꿔 끼워 확인).
  await page.evaluate(() => { window.__recStarted = 0; window.KPTUMeetingRecorder.startRecord = () => { window.__recStarted++; }; });
  await menu.locator('[data-report-rec]').click();
  await expect(menu).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__recStarted)).toBe(1);
  // 사업영역 관리: 사업영역 관리 창.
  await add.click();
  await menu.locator('[data-report-areas]').click();
  await expect(page.locator('#areaWindow')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#areaWindow')).toBeHidden();
  // 새 사업 보고: 예전 [+]처럼 '어느 칸에 남길까요?' 창.
  await add.click();
  await menu.locator('[data-report-new]').click();
  await expect(page.locator('#reportKindSheet')).toBeVisible();
});

test('390: 폰 [+] 메뉴 — 녹음기가 없으면 두 줄(새 사업 보고 / 사업영역 관리), 폰 앱 녹음기가 있으면 녹음 줄이 생기고 그 녹음기를 시작', async ({page}) => {
  await open(page, 390);
  const add = page.locator('#newMeetingBtn'), menu = page.locator('#bizAddMenu');
  // 앱 머리 줄 안의 [+].
  await expect(page.locator('#appView > .mobile-shell-header #newMeetingBtn')).toBeVisible();
  await add.click();
  expect(await menu.evaluate(ITEMS)).toEqual(['새 사업 보고', '—', '사업영역 관리']);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // 폰 앱 녹음기(phone-recorder.js가 붙이는 KPTUPhoneRecorder)와 같은 모양의 대역.
  await page.evaluate(() => { window.__phoneRec = 0; window.KPTUPhoneRecorder = {recordItem: () => ({shown: true, disabled: false, label: '녹음', pressed: false}), startRecord: () => { window.__phoneRec++; }}; });
  await add.click();
  expect(await menu.evaluate(ITEMS)).toEqual(['새 사업 보고', '녹음', '—', '사업영역 관리']);
  await menu.locator('[data-report-rec]').click();
  await expect.poll(() => page.evaluate(() => window.__phoneRec)).toBe(1);
  // 녹음 중이면 '녹음 중'으로 꺼진다.
  await page.evaluate(() => { window.KPTUPhoneRecorder.recordItem = () => ({shown: true, disabled: true, label: '녹음 중', pressed: true}); });
  await add.click();
  await expect(menu.locator('[data-report-rec]')).toHaveText('녹음 중');
  await expect(menu.locator('[data-report-rec]')).toBeDisabled();
});

test('390: 기간 정하기 창은 첫 줄 아래 한 칸, 정한 기간은 첫 줄 건수 앞에 [기간 ×]', async ({page}) => {
  await open(page, 390);
  await pickReportBox(page, '#reportPeriodPick [data-report-period]', 'range');
  const panel = page.locator('#reportWeekFilter .report-period-panel');
  await expect(panel).toBeVisible();
  const [p, add] = await Promise.all([panel.boundingBox(), page.locator('#newMeetingBtn').boundingBox()]);
  expect(p.y).toBeGreaterThanOrEqual(add.y + add.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // 주 단위가 아닐 때는 상자 제목 줄에 ‹ ›가 없다.
  await panel.locator('[data-report-quick]').first().click();
  await panel.locator('[data-report-week="apply"]').click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#bizWeekBox .biz-week-nav')).toHaveCount(0);
  await expect(page.locator('#reportCount [data-report-week="clear"]')).toBeVisible();
  await page.locator('#reportCount [data-report-week="clear"]').click();
  await expect(page.locator('#bizWeekBox .biz-week-nav .report-week-label')).toBeVisible();
  expectOneLine(await measure(page));
});
