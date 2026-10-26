import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { expandLibraryTree } from './helpers/library-tree.mjs';

// ACT-사진 3단계: 사업 보고 상세 창의 사진 줄. 작은 그림, 눌러서 크게 보기(넘기기·닫기), 사진 올리기(제목·종류·날짜를 싣고 AI에 보내지 않음).
// 자료 목록은 자료실 사업 보고 사진 묶음 줄을 눌러 연다(4단계). 모든 이름·번호는 합성 값.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M1 = ID(901);
const now = () => new Date().toISOString();

function makeState() {
  const doc = (n, title, file_name, extra = {}) => ({id: ID(n), workspace_id: 'workspace-1', project_id: null, title, file_name, mime_type: file_name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', category: '투쟁', tags: [], document_date: '2026-10-20', created_at: now(), file_id: 'drive-' + n, drive_url: 'https://drive.google.com/file/d/drive-' + n + '/view', meeting_id: M1, ...extra});
  const docs = [];
  for (let k = 1; k <= 4; k++) docs.push(doc(10 + k, '현장 ' + k, `s${k}.jpg`));
  docs.push(doc(20, '결과 보고', 'result.pdf'));
  return {
    user: {id: 'user-1', email: 'owner@example.org', user_metadata: {display_name: '관리자'}},
    workspace: {id: 'workspace-1', slug: 'team', name: '웹2'},
    photoCalls: [], uploads: [], aiCalls: 0, docs,
    meeting: {id: M1, workspace_id: 'workspace-1', title: '○○ 결의대회', series_name: '○○ 결의대회', round_no: null, meeting_at: '2026-10-24T05:00:00Z', activity_kind: 'struggle', created_by: 'user-1', notes: '', decisions: '', transcript_text: '결과 원문', result_status: 'final'}
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
      state.photoCalls.push({id: url.searchParams.get('document_id'), size: url.searchParams.get('size')});
      return route.fulfill({status: 200, contentType: 'image/png', body: PNG});
    }
    if (path === '/functions/v1/library-files' && req.method() === 'POST') {
      state.uploads.push((req.postDataBuffer() || Buffer.alloc(0)).toString('utf8'));
      const n = 100 + state.uploads.length;
      const added = {id: ID(n), workspace_id: 'workspace-1', meeting_id: M1, title: 'new', file_name: 'new.png', mime_type: 'image/png', category: '투쟁', file_id: 'drive-' + n, created_at: now()};
      state.docs.push(added);
      return ok({ok: true, document: added});
    }
    if (path.startsWith('/functions/v1/ai-assist')) { state.aiCalls++; return ok({}); }
    if (path === '/functions/v1/google-calendar') return ok({connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {}});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'workspace-1', user_id: state.user.id, role: 'owner', workspace: state.workspace, created_at: now()}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id: state.user.id, display_name: '관리자'}]);
    if (path === '/rest/v1/app_workspaces') return ok([state.workspace]);
    if (path === '/rest/v1/app_documents' && req.method() === 'GET') {
      const m = url.searchParams.get('meeting_id');
      return ok(m ? state.docs.filter(d => 'eq.' + d.meeting_id === m) : state.docs);
    }
    if (path === '/rest/v1/app_meetings' && req.method() === 'GET') {
      const id = url.searchParams.get('id') || '';
      if (id.startsWith('in.(')) return ok([state.meeting]);
      return ok('eq.' + M1 === id ? [state.meeting] : []);
    }
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

async function openDetail(page, state, width) {
  await page.setViewportSize({width, height: 900});
  await mock(page, state);
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);
  await signInWithSession(page, 'owner@example.org');
  await expect(page.locator('[data-lu-photoset]').first()).toBeAttached({timeout: 10000});
  await expandLibraryTree(page);
  await page.locator(`[data-lu-photoset="${M1}"]`).click();
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible({timeout: 10000});
}

for (const width of [390, 1440]) {
  test(`business report detail shows a photo row and a viewer ${width}`, async ({page}) => {
    const state = makeState();
    await openDetail(page, state, width);
    const grid = page.locator('#mrdPhotos');
    // 사진 줄: 사진만 작은 그림으로, 사진 아닌 자료는 아래 자료 줄에만 있다.
    await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 4');
    await expect(grid.locator('.act-photo-thumb')).toHaveCount(4);
    await expect(grid.locator('.act-photo-thumb[data-state="shown"] img')).toHaveCount(4);
    await expect(page.locator('#mrdMaterials .file-line')).toHaveCount(1);
    await expect(page.locator('#mrdMaterials')).toContainText('result.pdf');
    expect(state.photoCalls.every(c => c.size === 'small' || c.size === 'large')).toBe(true);
    // 가로로 넘치지 않는다.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1)).toBe(true);

    // 크게 보기: 두 번째 사진을 열고 좌우로 넘기고 Esc로 닫는다.
    await grid.locator('.act-photo-thumb').nth(1).click();
    const view = page.locator('.basket-photo-view');
    await expect(view).toBeVisible();
    await expect(view.locator('.basket-photo-count')).toHaveText('2/4');
    await view.locator('.basket-photo-step[data-dir="1"]').click();
    await expect(view.locator('.basket-photo-count')).toHaveText('3/4');
    await page.keyboard.press('ArrowLeft');
    await expect(view.locator('.basket-photo-count')).toHaveText('2/4');
    expect(state.photoCalls.some(c => c.size === 'large')).toBe(true);
    // ⋯ 메뉴에 Drive에서 열기·내려받기·지우기가 있다.
    await view.locator('.basket-photo-more-btn').click();
    await expect(view.locator('.basket-photo-more-panel')).toContainText('지우기');
    await expect(view.locator('.basket-photo-more-panel')).toContainText('Drive에서 열기');
    await page.keyboard.press('Escape');
    await expect(view).toHaveCount(0);
  });
}

test('business report detail uploads photos directly with the report kind and no AI', async ({page}) => {
  const state = makeState();
  await openDetail(page, state, 1440);
  await page.locator('#mrdPhotoInput').setInputFiles({name: '현장 사진.png', mimeType: 'image/png', buffer: PNG});
  await expect(page.locator('#mrdPhotoStatus')).toContainText('1장을 올렸어요', {timeout: 10000});
  expect(state.uploads.length).toBe(1);
  const body = state.uploads[0];
  expect(body).toContain(M1);
  expect(body).toMatch(/name="category"\r\n\r\n투쟁/);
  expect(body).toMatch(/name="title"\r\n\r\n현장 사진\r\n/);
  expect(body).toMatch(/name="document_date"\r\n\r\n2026-10-24/);
  expect(state.aiCalls).toBe(0);
  // 올린 뒤 사진 줄이 다시 읽혀 5장이 된다.
  await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 5', {timeout: 10000});
});
