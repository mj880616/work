import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { expandLibraryTree } from './helpers/library-tree.mjs';

// ACT-사진 4단계(결정 A): 자료실에서 사업 보고에 붙은 사진은 사업 보고마다 한 줄('사진 n · 제목' + 작은 그림 3장).
// 자료실에 직접 올린 그림은 한 장 한 줄, 휴지통 사업 보고의 사진은 보이지 않고, 사업 보고를 읽지 못하면 묶지 않는다. 모든 이름·번호는 합성 값.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M1 = ID(901), M2 = ID(902), M3 = ID(903);
const now = () => new Date().toISOString();

function makeState({meetingsFail = false} = {}) {
  const doc = (n, title, file_name, extra = {}) => ({id: ID(n), workspace_id: 'workspace-1', project_id: null, title, file_name, mime_type: file_name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', category: '투쟁', tags: [], document_date: '2026-10-20', created_at: now(), file_id: 'drive-' + n, ...extra});
  const docs = [];
  for (let k = 1; k <= 5; k++) docs.push(doc(10 + k, '현장 ' + k, `s${k}.jpg`, {meeting_id: M1}));
  docs.push(doc(20, '결과 보고', 'result.pdf', {meeting_id: M1}));
  docs.push(doc(21, '교육 사진', 'edu.jpg', {meeting_id: M2}));
  docs.push(doc(30, '휴지통 사진 1', 't1.jpg', {meeting_id: M3}), doc(31, '휴지통 사진 2', 't2.jpg', {meeting_id: M3}));
  docs.push(doc(40, '직접 올린 그림', 'direct.jpg'));
  return {
    user: {id: 'user-1', email: 'owner@example.org', user_metadata: {display_name: '자료실 관리자'}},
    workspace: {id: 'workspace-1', slug: 'team', name: '웹2'},
    photoCalls: [], meetingReads: [], meetingOpens: [], meetingsFail, docs,
    meetings: [{id: M1, title: '○○ 결의대회', series_name: '○○ 결의대회', round_no: null, meeting_at: '2026-10-24T05:00:00Z', activity_kind: 'struggle'}, {id: M2, title: '□□ 교육', series_name: '□□ 교육', round_no: null, meeting_at: '2026-10-10T05:00:00Z', activity_kind: 'education'}]
  };
}

async function mock(page, state) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const ok = data => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: state.user});
    if (path === '/auth/v1/user') return ok(state.user);
    if (path === '/auth/v1/logout') return ok({});
    if (path === '/functions/v1/library-files' && req.method() === 'GET') {
      const q = url.searchParams;
      state.photoCalls.push({action: q.get('action'), id: q.get('document_id'), size: q.get('size')});
      return route.fulfill({status: 200, contentType: 'image/png', body: PNG});
    }
    if (path === '/functions/v1/google-calendar') return ok({connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {}});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'workspace-1', user_id: state.user.id, role: 'owner', workspace: state.workspace, created_at: now()}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id: state.user.id, display_name: '자료실 관리자'}]);
    if (path === '/rest/v1/app_workspaces') return ok([state.workspace]);
    if (path === '/rest/v1/app_documents' && req.method() === 'GET') return ok(state.docs);
    if (path === '/rest/v1/app_meetings' && req.method() === 'GET') {
      const id = url.searchParams.get('id') || '';
      if (id.startsWith('in.(')) {
        state.meetingReads.push(id);
        if (state.meetingsFail) return route.fulfill({status: 500, contentType: 'application/json', body: '{"message":"QA failure"}'});
        const ids = id.slice(4, -1).split(',');
        return ok(state.meetings.filter(m => ids.includes(m.id)));
      }
      state.meetingOpens.push(id);
      return ok(state.meetings.filter(m => 'eq.' + m.id === id).map(m => ({...m, workspace_id: 'workspace-1', notes: '', decisions: '', transcript: ''})));
    }
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

async function open(page, state, width) {
  await page.setViewportSize({width, height: 900});
  await mock(page, state);
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);
  await signInWithSession(page, 'owner@example.org');
  await expect(page.locator('[data-lu-document],[data-lu-photoset]').first()).toBeAttached({timeout: 10000});
  await expandLibraryTree(page);
}

for (const width of [390, 1440]) {
  test(`library folds photos of a business report into one row ${width}`, async ({page}) => {
    const state = makeState();
    await open(page, state, width);
    const set = id => page.locator(`[data-lu-photoset="${id}"]`);

    // 사업 보고마다 한 줄. 사진 5장이어도 한 줄, 제목 = 사진 n · 사업 보고 제목.
    await expect(page.locator('[data-lu-photoset]')).toHaveCount(2);
    await expect(set(M1).locator('.lu-row-title')).toHaveText('사진 5 · ○○ 결의대회');
    await expect(set(M2).locator('.lu-row-title')).toHaveText('사진 1 · □□ 교육');
    // 작은 그림은 앞 3장뿐, '외 n장'은 붙이지 않는다.
    await expect(set(M1).locator('.report-photo-thumb')).toHaveCount(3);
    await expect(set(M1).locator('[data-report-photo-more]')).toHaveCount(0);
    await expect(set(M2).locator('.report-photo-thumb')).toHaveCount(1);
    await expect(set(M1).locator('.report-photo-thumb[data-state="shown"] img')).toHaveCount(3);
    const asked = state.photoCalls.map(c => c.id);
    for (const n of [11, 12, 13]) expect(asked).toContain(ID(n));
    for (const n of [14, 15]) expect(asked).not.toContain(ID(n));
    expect(state.photoCalls.every(c => c.action === 'photo' && c.size === 'small')).toBe(true);
    // 사업 보고에 붙은 사진 자료 행은 목록에 따로 나오지 않는다. 직접 올린 그림·글 자료는 그대로 한 장 한 줄.
    for (const n of [11, 12, 13, 14, 15, 21, 30, 31]) await expect(page.locator(`[data-lu-document="${ID(n)}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-lu-document="${ID(20)}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-lu-document="${ID(40)}"]`)).toHaveCount(1);
    // 사업 보고는 한 번에 읽는다(줄마다 따로 읽지 않음).
    expect(state.meetingReads.length).toBe(1);
    for (const m of [M1, M2, M3]) expect(state.meetingReads[0]).toContain(m);
    // 줄이 화면 안에 들어간다.
    const box = await set(M1).boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1)).toBe(true);
    await expect(set(M1).locator('.lu-row-title')).toBeVisible();

    // 누르면 그 사업 보고를 연다.
    await set(M1).click();
    await expect.poll(() => state.meetingOpens.some(x => x === 'eq.' + M1)).toBe(true);
  });
}

test('library keeps one row per photo when the business reports cannot be read', async ({page}) => {
  const state = makeState({meetingsFail: true});
  await open(page, state, 390);
  await expect(page.locator('[data-lu-photoset]')).toHaveCount(0);
  for (const n of [11, 15, 21, 30, 40]) await expect(page.locator(`[data-lu-document="${ID(n)}"]`)).toHaveCount(1);
});
