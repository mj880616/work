import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S67-74 UI-윗줄칩잘림(2026-11-21 명진 16:18, 폰 '사업 관리' 캡처: "사업영역 전체 박스 짤림") → S67-75 UI-걸러보기칩하나(18:33 A안).
// #2847의 끝 흐림(mask)은 18:27 "이게 의도된 거라고?"로 걷어냈다. 폰 윗줄은 [아이콘][사업 관리][걸러보기 칩 하나 ▾] … [+][⋯]:
// 고르기 상자 네 개(종류·사업영역·기간·보기)가 그 줄에 다 안 들어가면 칩 하나로 묶고, 누르면 칩 아래 작은 창에서 같은 상자 네 개로 고른다(고르면 바로 반영).
// 칩 글자는 아무것도 안 골랐으면 '전체', 고른 값만 ' · '로 잇고 길면 끝 말줄임(▾는 늘 보임). 다 들어가는 폭(폴드 펼침 700·880)은 네 개 그대로.
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

const BAR = '#meetingsView .report-kind-bar', CHIP = '#reportFilterChip';
const box = e => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }; };
// 칩·상자 줄의 자리, 칩 글자가 칩 안에 다 들어갔는지(말줄임 포함), ▾ 자리(오른쪽 여백).
const chipState = page => page.evaluate(([barSel, chipSel]) => {
  const r = e => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }; };
  const bar = document.querySelector(barSel), chip = document.querySelector(chipSel), text = chip.querySelector('.report-filter-chip-text');
  const shown = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const cs = getComputedStyle(bar);
  return { chip: shown(chip) ? r(chip) : null, chipText: text.textContent, textCut: text.scrollWidth > text.clientWidth + 1, textEllipsis: getComputedStyle(text).textOverflow,
    padRight: parseFloat(getComputedStyle(chip).paddingRight), bar: shown(bar) ? { ...r(bar), sw: bar.scrollWidth, cw: bar.clientWidth } : null,
    mask: cs.maskImage || cs.webkitMaskImage || 'none', open: bar.matches(':popover-open'), expanded: chip.getAttribute('aria-expanded'),
    selects: [...bar.querySelectorAll('select')].filter(shown).map(e => ({ id: e.id || e.dataset.reportPeriod !== undefined && 'period', ...r(e) })) };
}, [BAR, CHIP]);
const noPageScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

// S70-57: 이름 '사업 관리'가 앱 머리 줄로 올라갔다. S71-10(11/26 명진 '한 줄에 우겨넣고 싶어'): 주 줄(‹ 날짜 › · n건)도 같은 줄에 들어가
// 폰(412까지)은 상자 네 개가 다 안 들어가 칩 하나다. 펼친 폴드(700·880)는 네 개 그대로(아래 줄).
for (const width of [320, 360, 412]) {
  test(`phone ${width}: 사업 관리 top line shows one filter chip (never cut) instead of four boxes; the chip opens one small window with the same four boxes, and a pick there filters the list and renames the chip`, async ({ page }) => {
    await open(page, makeState(), width);
    const chip = page.locator(CHIP);
    await expect(chip).toBeVisible({ timeout: 10000 });
    await expect(chip).toHaveText('전체');
    await expect(page.locator('#reportAreaSelect')).toBeHidden();
    await expect(page.locator('#meetingList')).toContainText('◇◇ 결의대회');
    const add = await page.locator('#newMeetingBtn').boundingBox(), more = await page.locator('#reportMore').boundingBox(), head = await page.locator('#appView > .mobile-shell-header').boundingBox();
    let s = await chipState(page);
    // 한 줄: 칩은 [+] 왼쪽에서 끝나고, [+]·[⋯]는 화면 안. 칩은 통째로 보인다(글자 잘림·말줄임 없음, ▾ 자리 있음).
    // S70-57: 이름 '사업 관리'는 앱 머리 줄(찾기 돋보기와 함께) — 칩 줄은 그 아래.
    expect(s.bar).toBeNull();
    expect(s.chip.top).toBeGreaterThanOrEqual(head.y + head.height);
    expect(s.chip.right).toBeLessThanOrEqual(add.x + 0.5);
    expect(more.x + more.width).toBeLessThanOrEqual(width);
    expect(Math.abs((s.chip.top + s.chip.bottom) / 2 - (add.y + add.height / 2))).toBeLessThanOrEqual(2);
    expect(s.textCut).toBe(false);
    expect(s.padRight).toBeGreaterThanOrEqual(20);
    expect(s.mask).toBe('none');
    // 칩을 누르면 칩 바로 아래 작은 창: 상자 네 개가 한 줄에 하나씩, 하단바에 가리지 않음.
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#reportAreaSelect')).toBeVisible();
    s = await chipState(page);
    expect(s.open).toBe(true);
    expect(s.selects.map(x => x.id)).toEqual(['reportKindSelect', 'reportAreaSelect', 'period', 'reportViewSelect']);
    expect(s.bar.top).toBeGreaterThanOrEqual(s.chip.bottom);
    expect(s.bar.left).toBeGreaterThanOrEqual(0);
    expect(s.bar.right).toBeLessThanOrEqual(width);
    const tabs = await page.locator('nav.mobile-tabs').boundingBox();
    if (tabs) expect(s.bar.bottom).toBeLessThanOrEqual(tabs.y + 0.5);
    for (const x of s.selects) { expect(x.left).toBeGreaterThanOrEqual(s.bar.left); expect(x.right).toBeLessThanOrEqual(s.bar.right + 0.5); }
    // 사업영역을 사람처럼 고른다: 상자를 눌러 열린 작은 목록에서 한 줄. 목록은 바로 걸러지고 칩 글자가 바뀌며 창은 닫힌다(초점은 칩).
    await page.locator('#reportAreaSelect').click();
    await page.locator('#kptuSelectMenu .kptu-select-opt', { hasText: '합성 사업' }).click();
    await expect(page.locator('#reportAreaSelect')).toHaveValue('area-1');
    await expect(page.locator('#meetingList')).not.toContainText('◇◇ 결의대회');
    await expect(page.locator('#meetingList')).toContainText('○○ 대표자 회의');
    await expect(chip).toHaveText('합성 사업');
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await expect(chip).toBeFocused();
    await expect(page.locator('#reportAreaSelect')).toBeHidden();
    // 고른 뒤 뒤로 가기 기록이 남지 않는다: 창을 다시 열고 뒤로 가기 한 번이면 창만 닫힌다(아래).
    // 보기도 같은 창에서: 달력을 고르면 기간 상자는 빠지고 칩은 '합성 사업 · 달력'.
    await chip.click();
    await page.locator('#reportViewSelect').selectOption('calendar');
    await expect(chip).toHaveText('합성 사업 · 달력');
    // S70-57: 달력은 기간 상자가 빠져, 남은 상자가 줄에 다 들어가면 칩 없이 상자 그대로다(칩/상자는 실제 폭이 정함).
    if (await chip.isVisible()) await chip.click();
    await expect(page.locator('#reportPeriodPick')).toBeHidden();
    await page.locator('#reportViewSelect').selectOption('list');
    await expect(chip).toHaveText('합성 사업');
    // Esc로 닫으면 칩으로 초점이 돌아온다. 뒤로 가기로도 닫히고 화면은 그대로 사업 관리.
    await chip.click();
    await expect(page.locator('#reportAreaSelect')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await expect(chip).toBeFocused();
    await expect(page.locator('#reportAreaSelect')).toBeHidden();
    await chip.click();
    await expect(page.locator('#reportAreaSelect')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#reportAreaSelect')).toBeHidden();
    await expect(page.locator('#meetingsView')).toBeVisible();
    // 바깥을 누르면 닫힌다.
    await chip.click();
    await expect(page.locator('#reportAreaSelect')).toBeVisible();
    await page.mouse.click(width / 2, 400);
    await expect(page.locator('#reportAreaSelect')).toBeHidden();
    expect(await noPageScroll(page)).toBe(true);
  });

  test(`phone ${width}: a long chip label (several picks) ends with … inside the line and keeps ▾, [+] and [⋯] in place`, async ({ page }) => {
    await open(page, makeState(), width);
    const chip = page.locator(CHIP);
    await expect(chip).toBeVisible({ timeout: 10000 });
    for (const [sel, value] of [['#reportKindSelect', { index: 1 }], ['#reportAreaSelect', 'area-1'], ['#reportPeriodPick [data-report-period]', 'all']]) {
      await chip.click();
      await page.locator(sel).selectOption(value);
      await expect(page.locator('#reportAreaSelect')).toBeHidden();
    }
    await expect(chip).toHaveText(/ · .* · 전체 기간$/);
    const add = await page.locator('#newMeetingBtn').boundingBox(), more = await page.locator('#reportMore').boundingBox();
    const s = await chipState(page);
    expect(s.chip.right).toBeLessThanOrEqual(add.x + 0.5);
    expect(more.x + more.width).toBeLessThanOrEqual(width);
    expect(s.textEllipsis).toBe('ellipsis');
    expect(s.padRight).toBeGreaterThanOrEqual(20);
    expect(await noPageScroll(page)).toBe(true);
  });
}

for (const width of [700, 880]) {
  test(`${width < 600 ? 'phone' : 'fold open'} ${width}: all four boxes fit in the line, so they stay four (no chip)`, async ({ page }) => {
    await open(page, makeState(), width);
    await expect(page.locator('#reportAreaSelect')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(150);
    const s = await chipState(page);
    expect(s.chip).toBeNull();
    expect(s.selects.length).toBe(4);
    expect(s.bar.sw).toBeLessThanOrEqual(s.bar.cw + 1);
    expect(s.mask).toBe('none');
    for (const c of s.selects) { expect(c.left).toBeGreaterThanOrEqual(s.bar.left - 0.5); expect(c.right).toBeLessThanOrEqual(s.bar.right + 1); }
    expect(await noPageScroll(page)).toBe(true);
  });
}

test('phone 360 → wide: folding the window open while the chip window is open closes it and shows the four boxes', async ({ page }) => {
  await open(page, makeState(), 360);
  const chip = page.locator(CHIP);
  await expect(chip).toBeVisible({ timeout: 10000 });
  await chip.click();
  await expect(page.locator('#reportAreaSelect')).toBeVisible();
  await page.setViewportSize({ width: 880, height: 800 });
  await expect(chip).toBeHidden();
  await expect.poll(async () => (await chipState(page)).open).toBe(false);
  await expect(page.locator('#reportAreaSelect')).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(chip).toBeVisible();
  await expect(page.locator('#reportAreaSelect')).toBeHidden();
});

for (const width of [360, 412]) {
  test(`phone ${width}: long names a person gave (custom_words, up to 20 letters) keep the chip, [+]·[⋯] on the line and the page from scrolling sideways`, async ({ page }) => {
    const state = makeState(LONG_WORDS);
    await open(page, state, width);
    const title = page.locator('#appView > .mobile-shell-header [data-mobile-view-name]'); // S70-57: 이름은 앱 머리 줄
    await expect(title).toHaveText(LONG_WORDS.menu_biz);
    await expect(page.locator(CHIP)).toBeVisible({ timeout: 10000 });
    await page.locator(CHIP).click();
    await expect(page.locator('#reportAreaSelect')).toHaveText(new RegExp(LONG_WORDS.area));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const t = await title.boundingBox(), add = await page.locator('#newMeetingBtn').boundingBox(), more = await page.locator('#reportMore').boundingBox();
    const s = await chipState(page);
    // 아주 긴 이름은 앱 머리 줄 끝에서 …(찾기 돋보기 자리를 지킴). 칩·버튼은 그 아래 한 줄, 화면 안.
    expect(t.x + t.width).toBeLessThanOrEqual(width);
    expect(s.chip.top).toBeGreaterThanOrEqual(t.y + t.height);
    expect(s.chip.right).toBeLessThanOrEqual(add.x + 0.5);
    expect(s.chip.width).toBeGreaterThan(40);
    expect(more.x + more.width).toBeLessThanOrEqual(width);
    expect(Math.abs((more.y + more.height / 2) - (s.chip.top + s.chip.bottom) / 2)).toBeLessThanOrEqual(4);
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
