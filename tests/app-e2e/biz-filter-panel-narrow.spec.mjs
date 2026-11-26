import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S71-75 BIZ-걸러보기창좁게(사용자 2026-11-26 "이거 너무 좌우로 길지 않니"): 폰 사업 관리 머리 줄 [전체 ▾]가 여는 걸러 보기 창은
// 내용만큼 좁고(최대 260px, 화면 폭의 70% 미만), [전체 ▾] 칩 아래 왼쪽 끝에 맞춘다. 창 안 고르기는 큰 테두리 상자 대신 메뉴 줄
// (테두리 없음, 고른 줄은 앞에 회색 이름 '종류 · 회의'), 누르면 그 자리에 공용 작은 목록이 열리고 고르면 목록이 바로 걸러진다.
// PC 1280은 창 없이 한 줄 상자 그대로 — 상자는 글자만큼(줄 전체 폭의 70% 미만), 값을 바꾸면 목록이 걸러진다.
// (가짜 서버·가짜 보고는 topbar-chip-clip.spec.mjs와 같은 틀. 모든 이름·번호는 합성 값.)
test.use({ timezoneId: 'Asia/Seoul' });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = { id: 'user-1', email: 'owner@example.org', user_metadata: { display_name: '관리자' } };
const workspace = { id: 'workspace-1', slug: 'team', name: '웹2' };

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

const BAR = '#reportFilterBar', CHIP = '#reportFilterChip';
const panelState = page => page.evaluate(([barSel, chipSel]) => {
  const r = e => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }; };
  const shown = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
  const bar = document.querySelector(barSel), chip = document.querySelector(chipSel);
  const rows = [...bar.querySelectorAll('select')].filter(shown);
  // 줄마다 글자가 실제로 차지하는 폭(이름 칸 + 상자 글자 + 안쪽 여백) — 창이 '내용만큼'인지 본다.
  const need = rows.map(s => { const name = s.previousElementSibling?.classList.contains('report-filter-name') && shown(s.previousElementSibling) ? s.previousElementSibling.scrollWidth : 0; const cs = getComputedStyle(s); return name + (s.scrollWidth || 0) + (name ? 4 : 0) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth); });
  return { bar: r(bar), chip: shown(chip) ? r(chip) : null, open: bar.matches(':popover-open'), vw: document.documentElement.clientWidth,
    rows: rows.map(s => ({ id: s.id || 'period', border: parseFloat(getComputedStyle(s).borderTopWidth) || 0, borderColor: getComputedStyle(s).borderTopColor, ...r(s) })),
    need: Math.max(0, ...need), pad: parseFloat(getComputedStyle(bar).paddingLeft) + parseFloat(getComputedStyle(bar).paddingRight) + parseFloat(getComputedStyle(bar).borderLeftWidth) * 2,
    names: [...bar.querySelectorAll('.report-filter-name')].filter(shown).map(e => e.textContent) };
}, [BAR, CHIP]);
const transparent = c => c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);

for (const width of [390, 360]) {
  test(`phone ${width}: the 사업 관리 filter window is only as wide as its rows (under 70% of the screen, at most 260px), left-aligned under the chip, rows look like menu lines, and picking still filters the list`, async ({ page }) => {
    await open(page, makeState(), width);
    const chip = page.locator(CHIP);
    await expect(chip).toBeVisible({ timeout: 10000 });
    await chip.click();
    await expect(page.locator('#reportAreaSelect')).toBeVisible();
    let s = await panelState(page);
    expect(s.open).toBe(true);
    expect(s.rows.map(x => x.id)).toEqual(['reportKindSelect', 'reportAreaSelect', 'period', 'reportViewSelect']);
    // 폭: 화면의 70% 미만·260px 이하이고, 가장 긴 줄 글자 + 창 여백보다 크게 남지 않는다(최소 폭 140px 안쪽은 허용).
    expect(s.bar.width).toBeLessThan(width * 0.7);
    expect(s.bar.width).toBeLessThanOrEqual(260.5);
    expect(s.bar.width).toBeLessThanOrEqual(Math.max(140, s.need + s.pad) + 2);
    // 칩 아래, 왼쪽 끝 맞춤(화면 안으로 밀린 때만 예외 — 이 폭에서는 밀리지 않는다).
    expect(s.bar.top).toBeGreaterThanOrEqual(s.chip.bottom);
    expect(Math.abs(s.bar.left - s.chip.left)).toBeLessThanOrEqual(1);
    expect(s.bar.right).toBeLessThanOrEqual(width - 8 + 0.5);
    // 메뉴 줄 모양: 테두리 상자가 아니다(테두리 색 투명), 줄 높이는 촘촘(36px 이하), 줄은 창 안.
    for (const x of s.rows) {
      expect(x.border === 0 || transparent(x.borderColor)).toBe(true);
      expect(x.bottom - x.top).toBeLessThanOrEqual(36);
      expect(x.left).toBeGreaterThanOrEqual(s.bar.left);
      expect(x.right).toBeLessThanOrEqual(s.bar.right + 0.5);
    }
    expect(s.names).toEqual([]);
    // 사업영역 줄을 눌러 그 자리 작은 목록에서 고른다 → 목록이 걸러지고 창은 닫힌다.
    await page.locator('#reportAreaSelect').click();
    await page.locator('#kptuSelectMenu .kptu-select-opt', { hasText: '합성 사업' }).click();
    await expect(page.locator('#reportAreaSelect')).toHaveValue('area-1');
    await expect(page.locator('#meetingList')).not.toContainText('◇◇ 결의대회');
    await expect(page.locator('#meetingList')).toContainText('○○ 대표자 회의');
    await expect(chip).toHaveText('합성 사업');
    // 다시 열면 고른 줄은 '사업영역 · 합성 사업' 한 줄(앞 이름은 회색), 창은 여전히 내용만큼.
    await chip.click();
    await expect(page.locator('#reportAreaSelect')).toBeVisible();
    s = await panelState(page);
    expect(s.names).toEqual(['사업영역']);
    const area = s.rows.find(x => x.id === 'reportAreaSelect'), nameBox = await page.locator(`${BAR} [data-filter-name=area]`).boundingBox();
    expect(Math.abs((nameBox.y + nameBox.height / 2) - (area.top + area.bottom) / 2)).toBeLessThanOrEqual(2);
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(area.left + 1);
    expect(s.bar.width).toBeLessThan(width * 0.7);
    // 종류 줄도 같은 자리 목록으로: 고르면 목록이 걸러진다.
    await page.locator('#reportKindSelect').click();
    await page.locator('#kptuSelectMenu .kptu-select-opt', { hasText: '회의' }).first().click();
    await expect(page.locator('#meetingList')).toContainText('○○ 대표자 회의');
    await expect(page.locator('#meetingList')).not.toContainText('◇◇ 결의대회');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.S7175_SHOT) { await chip.click(); await page.waitForTimeout(200); await page.screenshot({ path: `${process.env.S7175_SHOT}/phone-${width}.png` }); }
  });
}

test('PC 1280: no filter window — the four boxes stay on the one line, each only as wide as its words, and changing one still filters the list', async ({ page }) => {
  await open(page, makeState(), 1280);
  await expect(page.locator('#reportAreaSelect')).toBeVisible({ timeout: 10000 });
  await expect(page.locator(CHIP)).toBeHidden();
  const s = await page.evaluate(barSel => {
    const bar = document.querySelector(barSel), shown = e => e.getClientRects().length > 0;
    return { vw: document.documentElement.clientWidth, rows: [...bar.querySelectorAll('select')].filter(shown).map(e => ({ w: e.getBoundingClientRect().width, need: e.scrollWidth })),
      span: (() => { const r = [...bar.children].filter(shown).map(e => e.getBoundingClientRect()); return Math.max(...r.map(x => x.right)) - Math.min(...r.map(x => x.left)); })(),
      names: [...bar.querySelectorAll('.report-filter-name')].filter(shown).length };
  }, BAR);
  expect(s.names).toBe(0);
  expect(s.span).toBeLessThan(s.vw * 0.7);
  for (const x of s.rows) expect(x.w).toBeLessThanOrEqual(12 * 16);
  await page.locator('#reportAreaSelect').click();
  await page.locator('#kptuSelectMenu .kptu-select-opt', { hasText: '합성 사업' }).click();
  await expect(page.locator('#meetingList')).not.toContainText('◇◇ 결의대회');
  await expect(page.locator('#meetingList')).toContainText('○○ 대표자 회의');
  if (process.env.S7175_SHOT) await page.screenshot({ path: `${process.env.S7175_SHOT}/pc-1280.png`, clip: { x: 0, y: 0, width: 1280, height: 240 } });
});
