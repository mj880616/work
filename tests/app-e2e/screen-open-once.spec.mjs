import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { start as startFiles } from './helpers/files-server.mjs';

// RULE-한번에그리기(AGENTS.md 4절 '화면은 열 때 한 번에 최종 모양으로 그린다', docs/design/standard-interactions.md U1,
// 조사 docs/design/screen-open-once-audit.md): 메뉴로 화면을 열면, 화면이 처음 보인 순간의 머리 줄(메뉴·고르기 상자·단추·칸)
// 구성(개수·순서·폭)이 자료가 다 온 뒤에도 그대로여야 한다. 기본 모양을 먼저 그렸다가 서버 값이 와서 항목이 끼어들거나 덮이면 실패.
// 화면을 보인 뒤 매 그림(requestAnimationFrame)마다 머리 줄 모양을 적고, 조용해질 때까지 본 모양이 한 가지인지 확인한다.
// 늦는 서버를 흉내 내려고 그 화면 머리 줄을 정하는 읽기에 짧은 지연을 둔다(사업 관리: 조직·사업영역 읽기, 파일: 연결 상태).
// 새 화면·고친 화면은 아래 SCREENS 표에 한 줄 더한다. 이름·번호는 모두 지어낸 값이고 서버 쓰기는 없다(가짜 서버).

test.use({ timezoneId: 'Asia/Seoul' });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = { id: 'user-1', email: 'owner@example.org', user_metadata: { display_name: '관리자' } };
const workspace = { id: 'workspace-1', slug: 'team', name: '웹2' };
const SLOW_MS = 600;
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- 사업 관리 ----------
async function meetings(page, width) {
  const today = new Date().toISOString();
  const meeting = (n, title, kind, area = null) => ({ id: ID(n), workspace_id: workspace.id, title, series_name: title, round_no: null, meeting_at: today, activity_kind: kind, created_by: user.id, notes: '', decisions: '', transcript_text: '', project_id: area });
  // 사업영역이 달린 보고가 있어야 [사업영역 ▾]가 보인다(사용자 화면과 같은 네 상자: 종류·사업영역·기간·보기).
  const spaces = [{ id: 'area-1', workspace_id: workspace.id, name: '합성 사업', description: null, parent_id: null, status: 'active', visibility: 'private', owner_id: user.id, sort_order: 10, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', metadata: { project_system: 'v2', management_version: 2 } }];
  const rows = [meeting(901, '○○ 대표자 회의', 'meeting', 'area-1'), meeting(902, '□□ 실무 회의', 'meeting', 'area-1'), meeting(903, '◇◇ 결의대회', 'struggle')];
  await page.setViewportSize({ width, height: 860 });
  await installViewPrefsServer(page, null);
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null) });
    if (path === '/auth/v1/token') return ok({ access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/functions/v1/google-calendar') return ok({ connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {} });
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path === '/rest/v1/app_workspace_members') return ok([{ workspace_id: workspace.id, user_id: user.id, role: 'owner', workspace, created_at: today }]);
    if (path === '/rest/v1/app_workspaces') return ok([workspace]);
    if (path === '/rest/v1/app_spaces' && req.method() === 'GET') return ok(spaces);
    if (path === '/rest/v1/app_meetings' && req.method() === 'GET') return ok(rows);
    // 사업영역 나무(연결할 곳)·보고 연결이 읽는 조직 목록: 늦는 서버.
    if (path === '/rest/v1/app_suborganizations') { await wait(SLOW_MS); return ok([]); }
    if (path === '/rest/v1/app_profiles') return ok([{ user_id: user.id, display_name: '관리자' }]);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
  await page.goto(`${appOrigin}/app/?view=home`);
  await enterLogin(page);
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 15000 });
  return {
    view: '#meetingsView',
    // 폰·폴드는 앱 머리 줄로 옮겨 가는 #reportTop([걸러 보기 칩]·단추), PC는 한 줄 상자. 어느 쪽이든 머리 줄 단추·고르기 상자 전체를 본다.
    head: '#reportTop :is(button,select), #reportFilterBar select',
    open: () => page.evaluate(() => window.KPTUDeferredFeatures.openView('meetings')),
    settled: () => expect(page.locator('#meetingList [data-mrd-meeting], #meetingList [data-meeting-kind], #meetingList [data-meeting-round], #bizWeekBox').first()).toBeVisible(),
  };
}

// ---------- 파일 ----------
async function files(page, width) {
  await startFiles(page, width);
  // 연결 상태(cloud-files status)를 늦게 준다 — 나무·출처 줄·칸 머리가 이 값으로 정해진다.
  await page.route(`${SB}/functions/v1/cloud-files`, async route => {
    let action = '';
    try { action = route.request().postDataJSON()?.action || ''; } catch { /* 본문 없음 */ }
    if (action === 'status') await wait(SLOW_MS);
    return route.fallback();
  });
  return {
    view: '#filesView',
    head: '#filesRoot .fx-top :is(button,select,[data-fx-srcs]), #filesRoot [data-fx-tree] > *',
    open: () => page.evaluate(() => window.KPTUDeferredFeatures.openView('files')),
    settled: () => expect(page.locator('#filesRoot [data-fx-tree] > *').first()).toBeVisible(),
  };
}

const SCREENS = [
  ['사업 관리', meetings, [1280, 390]],
  ['파일', files, [1280, 884]],
];

// 화면을 보인 뒤 매 그림마다 머리 줄 모양(보이는 항목의 이름·순서·폭)을 적는다. 화면이 안 보이는 동안은 적지 않는다.
// 머리 줄 선택자는 문서 전체에서 찾는다(폰은 화면 머리 줄이 앱 머리 줄로 옮겨 간다).
function record(page, view, head) {
  return page.evaluate(([viewSel, headSel]) => {
    const shown = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const name = e => e.id || e.getAttribute('aria-label') || [...e.attributes].find(a => a.name.startsWith('data-'))?.name || e.className || e.tagName;
    const sig = () => {
      const app = document.querySelector('#appView'), v = document.querySelector(viewSel);
      if (!shown(app) || !shown(v) || v.classList.contains('hidden')) return null;
      return [...document.querySelectorAll(headSel)].filter(shown).map(e => `${name(e)}:${Math.round(e.getBoundingClientRect().width)}`).join(' | ');
    };
    const rec = window.__screenOpenRec = { seen: [], last: performance.now(), stop: false };
    // 그림 차례(requestAnimationFrame) 바로 뒤 일(setTimeout 0)에서 잰다 — 그 차례의 배치 계산·ResizeObserver 맞춤까지 끝나 실제로 화면에 그려진 모양.
    // (requestAnimationFrame 안에서 바로 재면 ResizeObserver가 고치기 전, 그려지지 않는 중간 모양을 볼 수 있다.)
    const tick = () => {
      if (rec.stop) return;
      const s = sig();
      if (s !== null && rec.seen[rec.seen.length - 1] !== s) { rec.seen.push(s); rec.last = performance.now(); }
      requestAnimationFrame(() => setTimeout(tick, 0));
    };
    requestAnimationFrame(() => setTimeout(tick, 0));
  }, [view, head]);
}

for (const [label, setup, widths] of SCREENS) {
  for (const width of widths) {
    test(`U1 ${label} ${width}: 화면을 열면 머리 줄 메뉴·고르기 상자 구성이 처음 그린 그대로다(개수·순서·폭)`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const s = await setup(page, width);
      await record(page, s.view, s.head);
      await s.open();
      await expect(page.locator(s.view)).toBeVisible({ timeout: 15000 });
      await s.settled();
      // 늦는 읽기(SLOW_MS)가 끝나고 1.5초 동안 바뀌지 않을 때까지 본다.
      await expect.poll(() => page.evaluate(() => { const r = window.__screenOpenRec; return r.seen.length > 0 && performance.now() - r.last > 1500; }), { timeout: 15000 }).toBe(true);
      const seen = await page.evaluate(() => { const r = window.__screenOpenRec; r.stop = true; return r.seen; });
      expect(seen.length, `처음 보인 모양 뒤 바뀐 모양:\n${seen.join('\n')}`).toBe(1);
      expect(seen[0]).not.toBe('');
      expect(errors).toEqual([]);
    });
  }
}
