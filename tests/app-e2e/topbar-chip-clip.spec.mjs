import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S67-74 UI-윗줄칩잘림(2026-11-21 명진 16:18, 폰 '사업 관리' 캡처: "사업영역 전체 박스 짤림").
// 폰 윗줄 [아이콘][사업 관리][종류 전체 ▾][사업영역 전체 ▾][이번 주 ▾][목록 ▾] … [+][⋯]에서 칩이 다 안 들어가면
// 칩 줄 안에서 가로로 밀린다. 밀리는 쪽 끝은 흐리게 사라져(칩 줄의 mask, 흐림 폭 --rk-fade-l/-r) 칩 테두리가 칼로 자른 듯 보이지 않고,
// 끝까지 밀면 그쪽 흐림이 없어져 마지막 칩(▾ 포함)이 다 보인다. 안 넘치는 폭(폴드 펼침 등)은 흐림이 없다.
// 사람마다 바꾼 이름(custom_words, 최대 20글자)이 길어도 [+]·[⋯]가 줄 밖으로 밀리거나 화면이 가로로 넘치지 않는다.
// (가짜 서버·가짜 보고는 biz-top-tidy.spec.mjs와 같은 틀. 모든 이름·번호는 합성 값.)
test.use({ timezoneId: 'Asia/Seoul' });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = { id: 'user-1', email: 'owner@example.org', user_metadata: { display_name: '관리자' } };
const workspace = { id: 'workspace-1', slug: 'team', name: '웹2' };
const LONG_WORDS = { menu_biz: '아주 긴 이름의 활동 기록 모음 화면', area: '우리 회사 아주 큰 프로젝트 묶음', menu_org: '맡은 곳 전부 모아 보는 긴 화면', org_one: '아주 길게 고친 담당 대상 이름' };

function makeState(words = null) {
  const today = new Date().toISOString();
  const meeting = (n, title, kind, area = null) => ({ id: ID(n), workspace_id: workspace.id, title, series_name: title, round_no: null, meeting_at: today, activity_kind: kind, created_by: user.id, notes: '', decisions: '', transcript_text: '', project_id: area });
  return {
    words,
    // 사업영역이 달린 보고가 있어야 [사업영역 전체 ▾]가 보인다(명진 화면과 같은 네 칩).
    spaces: [{ id: 'area-1', workspace_id: workspace.id, name: '합성 사업', description: null, parent_id: null, status: 'active', visibility: 'private', owner_id: user.id, sort_order: 10, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', metadata: { project_system: 'v2', management_version: 2 } }],
    meetings: [meeting(901, '○○ 대표자 회의', 'meeting', 'area-1'), meeting(902, '□□ 실무 회의', 'meeting', 'area-1'), meeting(903, '◇◇ 결의대회', 'struggle')],
  };
}

async function mock(page, state) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null) });
    if (path === '/auth/v1/token') return ok({ access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/functions/v1/google-calendar') return ok({ connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {} });
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path === '/rest/v1/app_workspace_members') return ok([{ workspace_id: workspace.id, user_id: user.id, role: 'owner', workspace, created_at: new Date().toISOString() }]);
    if (path === '/rest/v1/app_workspaces') return ok([workspace]);
    if (path === '/rest/v1/app_spaces' && req.method() === 'GET') return ok(state.spaces);
    if (path === '/rest/v1/app_meetings' && req.method() === 'GET') return ok(state.meetings);
    if (path === '/rest/v1/app_profiles') {
      if ((url.searchParams.get('select') || '').includes('custom_words')) return ok([{ custom_words: state.words }]);
      return ok([{ user_id: user.id, display_name: '관리자' }]);
    }
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

async function open(page, state, width, view = 'meetings') {
  await page.setViewportSize({ width, height: 800 });
  await installViewPrefsServer(page, null);
  await mock(page, state);
  await page.goto(`${appOrigin}/app/?view=${view}`);
  await enterLogin(page);
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 15000 });
}

const BAR = '#meetingsView .report-kind-bar';
// 칩 줄과 보이는 칩들의 위치(칩 줄 안 가로 밀기 위치 포함), 흐림 폭.
const barState = page => page.locator(BAR).evaluate(bar => {
  const r = e => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  const cs = getComputedStyle(bar);
  const chips = [...bar.children].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
    .map(e => ({ id: e.id, ...r(e), padRight: parseFloat(getComputedStyle(e.matches('select') ? e : e.querySelector('select')).paddingRight) }));
  return { ...r(bar), sw: bar.scrollWidth, cw: bar.clientWidth, sl: bar.scrollLeft, fadeL: parseFloat(cs.getPropertyValue('--rk-fade-l')) || 0, fadeR: parseFloat(cs.getPropertyValue('--rk-fade-r')) || 0, mask: cs.maskImage || cs.webkitMaskImage, chips };
});
const scrollBar = (page, to) => page.locator(BAR).evaluate((el, x) => { el.scrollLeft = x === 'end' ? el.scrollWidth : x; }, to);
const noPageScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [360, 412]) {
  test(`phone ${width}: 사업 관리 top-line chips are never cut with a hard edge — they slide inside the line, the overflowing end fades, and the last chip (with ▾) shows whole at the end`, async ({ page }) => {
    await open(page, makeState(), width);
    await expect(page.locator('#reportAreaSelect')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#reportAreaSelect')).toHaveText(/사업영역 전체/);
    await page.waitForTimeout(150);
    const add = await page.locator('#newMeetingBtn').boundingBox(), more = await page.locator('#reportMore').boundingBox();
    let s = await barState(page);
    // 칩 묶음은 [+] 왼쪽에서 끝나고, [+]·[⋯]는 화면 안·같은 줄.
    expect(s.right).toBeLessThanOrEqual(add.x + 0.5);
    expect(more.x + more.width).toBeLessThanOrEqual(width);
    // 네 칩이 이 폭에는 다 안 들어가 칩 줄 안에서 밀린다(한 줄, 줄 높이 그대로).
    expect(s.chips.length).toBe(4);
    expect(s.sw).toBeGreaterThan(s.cw);
    for (const c of s.chips) expect(Math.abs((c.top + c.bottom) / 2 - (s.top + s.bottom) / 2)).toBeLessThanOrEqual(2);
    // 처음 자리: 오른쪽 끝을 걸친 칩이 있으면 그 끝은 흐림 안에 있다(잘린 테두리가 보이지 않음). 왼쪽은 흐림 없음.
    expect(s.mask).toContain('linear-gradient');
    expect(s.fadeL).toBe(0);
    expect(s.fadeR).toBeGreaterThanOrEqual(16);
    for (const c of s.chips) {
      expect(c.left, `${c.id} starts inside the line`).toBeGreaterThanOrEqual(s.left - 0.5);
      if (c.left < s.right && c.right > s.right) expect(c.left, `${c.id} crosses the edge only inside the fade`).toBeGreaterThan(s.left);
    }
    // 처음 보이는 칩(종류)은 ▾까지 다 보이고 흐림 밖이다.
    const first = s.chips[0];
    expect(first.right).toBeLessThanOrEqual(s.right - s.fadeR);
    // 끝까지 밀면: 오른쪽 흐림이 없어지고 마지막 칩이 ▾까지 칩 줄 안에 다 보인다. 밀어 둔 앞쪽(왼쪽)이 흐려진다.
    await scrollBar(page, 'end');
    await expect.poll(async () => (await barState(page)).fadeR).toBe(0);
    s = await barState(page);
    expect(s.fadeL).toBeGreaterThanOrEqual(16);
    const last = s.chips.at(-1);
    expect(last.right).toBeLessThanOrEqual(s.right + 1);
    expect(last.left).toBeGreaterThanOrEqual(s.left);
    // 칩 하나하나: 칩 줄 안으로 밀어 오면 칩 오른쪽 끝(▾ 자리 = 오른쪽 여백 26px 안)이 칩 줄 오른쪽 끝을 넘지 않는다.
    for (const id of ['reportKindSelect', 'reportAreaSelect', 'reportViewSelect']) {
      await page.locator('#' + id).evaluate(el => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      await page.waitForTimeout(50);
      const now = await barState(page), c = now.chips.find(x => x.id === id);
      expect(c.right, id).toBeLessThanOrEqual(now.right + 1);
      expect(c.left, id).toBeGreaterThanOrEqual(now.left - 1);
      expect(c.padRight, `${id} keeps room for ▾`).toBeGreaterThanOrEqual(20);
    }
    expect(await noPageScroll(page)).toBe(true);
  });
}

for (const width of [700, 880]) {
  test(`fold open ${width}: all four chips fit in the line, nothing slides and nothing fades`, async ({ page }) => {
    await open(page, makeState(), width);
    await expect(page.locator('#reportAreaSelect')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(150);
    const s = await barState(page);
    expect(s.sw).toBeLessThanOrEqual(s.cw);
    expect(s.fadeL).toBe(0);
    expect(s.fadeR).toBe(0);
    for (const c of s.chips) { expect(c.left).toBeGreaterThanOrEqual(s.left - 0.5); expect(c.right).toBeLessThanOrEqual(s.right + 1); }
    expect(await noPageScroll(page)).toBe(true);
  });
}

for (const width of [360, 412]) {
  test(`phone ${width}: long names a person gave (custom_words, up to 20 letters) keep [+]·[⋯] on the line and the page from scrolling sideways`, async ({ page }) => {
    const state = makeState(LONG_WORDS);
    await open(page, state, width);
    const title = page.locator('#meetingsView .report-top-title');
    await expect(title).toHaveText(LONG_WORDS.menu_biz);
    await expect(page.locator('#reportAreaSelect')).toHaveText(new RegExp(LONG_WORDS.area), { timeout: 10000 });
    await page.waitForTimeout(150);
    const t = await title.boundingBox(), add = await page.locator('#newMeetingBtn').boundingBox(), more = await page.locator('#reportMore').boundingBox();
    const s = await barState(page);
    // 아주 긴 이름만 줄 끝에서 …(칩 자리·버튼 자리를 지킴). 버튼은 화면 안, 이름과 같은 줄.
    expect(t.x + t.width).toBeLessThanOrEqual(s.left);
    expect(s.right).toBeLessThanOrEqual(add.x + 0.5);
    expect(more.x + more.width).toBeLessThanOrEqual(width);
    expect(Math.abs((more.y + more.height / 2) - (t.y + t.height / 2))).toBeLessThanOrEqual(4);
    expect(s.cw).toBeGreaterThan(40);
    expect(s.fadeR).toBeGreaterThanOrEqual(16);
    expect(await noPageScroll(page)).toBe(true);
    // 다른 화면의 윗줄(앱 머리줄: 아이콘 · 이름)도 긴 이름에 넘치지 않는다.
    for (const [view, word] of [['team', LONG_WORDS.menu_org], ['calendar', null], ['basket&pane=note', null], ['library', null]]) {
      await page.goto(`${appOrigin}/app/?view=${view}`);
      await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 15000 });
      await page.waitForTimeout(300);
      if (word) await expect(page.locator('#appView > .mobile-shell-header [data-mobile-view-name]')).toHaveText(word);
      const cut = await page.evaluate(() => [...document.querySelectorAll('#appView button, #appView select')]
        .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
        .map(e => ({ id: e.id || e.className, r: e.getBoundingClientRect() }))
        .filter(x => x.r.top < 140 && x.r.bottom > 0 && x.r.width > 2 && x.r.right > innerWidth + 0.5).map(x => x.id));
      expect(cut, view).toEqual([]);
      expect(await noPageScroll(page), view).toBe(true);
    }
  });
}
