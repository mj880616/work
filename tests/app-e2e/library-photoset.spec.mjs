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
      if (!id) return ok(state.meetings.filter(m => m.id !== M3).map(m => ({...m, workspace_id: 'workspace-1', notes: '', decisions: '', transcript: ''})));
      state.meetingOpens.push(id);
      return ok(state.meetings.filter(m => 'eq.' + m.id === id).map(m => ({...m, workspace_id: 'workspace-1', notes: '', decisions: '', transcript: ''})));
    }
    // LIB-정리보충 ②: 폴더 표(합성). state.failItem 자료의 넣기는 서버가 거절한다(일부만 옮겨지는 상황 만들기).
    if (path === '/rest/v1/app_library_folders' && req.method() === 'GET') return ok(state.folders || []);
    if (path === '/rest/v1/app_library_folder_items') {
      const m = req.method(), did = (url.searchParams.get('document_id') || '').replace(/^eq\./, '');
      state.items ||= [];
      if (m === 'GET') return ok(state.items);
      (state.itemWrites ||= []).push(m);
      if (m === 'POST') {const b = req.postDataJSON(); if (b.document_id === state.failItem) return route.fulfill({status: 500, contentType: 'application/json', body: '{"message":"QA failure"}'}); state.items.push({document_id: b.document_id, folder_id: b.folder_id}); return route.fulfill({status: 201, body: ''});}
      if (m === 'DELETE') {state.items = state.items.filter(x => x.document_id !== did); return route.fulfill({status: 204, body: ''});}
      if (m === 'PATCH') {const b = req.postDataJSON(); state.items.filter(x => x.document_id === did).forEach(x => {x.folder_id = b.folder_id;}); return route.fulfill({status: 204, body: ''});}
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

    // 누르면 사업 보고 화면의 [사진] 보기로 바로 가서 그 사업 보고 묶음 자리에 선다(ACT-사진 6단계)..
    await set(M1).click();
    await expect(page.locator('#reportViewFilter [aria-checked="true"]')).toHaveText('사진');
    await expect(page.locator(`#meetingList [data-rv-set="${M1}"]`)).toBeVisible({timeout: 10000});
    await expect(page.locator(`#meetingList [data-rv-set="${M1}"] .act-photo-thumb`)).toHaveCount(5);
    await expect(page.locator(`#meetingList [data-rv-set="${M2}"] .act-photo-thumb`)).toHaveCount(1);
    await expect(page.locator(`#meetingList [data-rv-set="${M3}"]`)).toHaveCount(0);
    // 머리줄을 누르면 그 사업 보고 결과 창이 열린다.
    await page.locator(`#meetingList [data-rv-set="${M1}"] .rv-set-head`).click();
    await expect.poll(() => state.meetingOpens.some(x => x === 'eq.' + M1)).toBe(true);
  });
}

test('library keeps one row per photo when the business reports cannot be read', async ({page}) => {
  const state = makeState({meetingsFail: true});
  await open(page, state, 390);
  await expect(page.locator('[data-lu-photoset]')).toHaveCount(0);
  for (const n of [11, 15, 21, 30, 40]) await expect(page.locator(`[data-lu-document="${ID(n)}"]`)).toHaveCount(1);
});

// LIB-정리보충 ②(2026-10-28 10:41): 폴더 보기에서 사진 묶음 줄도 끌어 폴더에 넣는다 — 묶음 안 실제 사진 자료 모두가 함께 그 폴더로,
// 폴더 안에서도 한 줄로 묶여 보이고, 하나라도 못 넣으면 넣은 것을 되돌려 일부만 옮겨진 채 끝나지 않는다. 사업 보고 연결(meeting_id)은 그대로.
async function dragSetTo(page, meetingId, key) {
  return page.evaluate(({meetingId, key}) => {
    const src = document.querySelector(`[data-lu-photoset="${meetingId}"]`), dst = document.querySelector(`#documentList details[data-lu-node="${key}"] > summary`), dt = new DataTransfer(), r = dst.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const draggable = src.getAttribute('draggable');
    src.dispatchEvent(new DragEvent('dragstart', {bubbles: true, cancelable: true, dataTransfer: dt}));
    const over = new DragEvent('dragover', {bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y}); dst.dispatchEvent(over);
    dst.dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y}));
    src.dispatchEvent(new DragEvent('dragend', {bubbles: true, dataTransfer: dt}));
    return {draggable, allowed: over.defaultPrevented};
  }, {meetingId, key});
}
for (const fail of [false, true]) test(`photo set row drags into a folder as one unit${fail ? ' (partial failure rolls back)' : ''}`, async ({page}) => {
  const state = makeState();
  state.folders = [{id: ID(700), workspace_id: 'workspace-1', project_id: null, parent_id: null, name: '결의대회 사진', sort_order: 1024, created_at: now()}];
  if (fail) state.failItem = ID(13);
  await open(page, state, 1440);
  await page.locator('#libraryGroupBy').getByRole('radio', {name: '폴더'}).click();
  await expandLibraryTree(page);
  const r = await dragSetTo(page, M1, 'f:' + ID(700));
  expect(r).toEqual({draggable: 'true', allowed: true});
  const photos = [11, 12, 13, 14, 15].map(ID);
  if (!fail) {
    await expect.poll(() => photos.every(id => state.items.some(x => x.document_id === id && x.folder_id === ID(700)))).toBe(true);
    // 결과 보고(PDF)·다른 사업 보고 사진은 그대로. 사업 보고 연결은 바꾸지 않는다(자료 행 쓰기 없음).
    expect(state.items.map(x => x.document_id).sort()).toEqual([...photos].sort());
    await expandLibraryTree(page);
    await expect(page.locator(`#documentList details[data-lu-node="f:${ID(700)}"] [data-lu-photoset="${M1}"]`)).toHaveCount(1);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('옮겼어요 5개');
  } else {
    // 셋째 사진에서 실패 → 앞의 두 장을 되돌려 하나도 들어가지 않은 상태로 끝난다. 묶음 줄은 폴더 밖에 그대로.
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('사진 묶음을 옮기지 못해 그대로 두었어요');
    expect(state.items).toEqual([]);
    expect(state.itemWrites.filter(m => m === 'DELETE')).toHaveLength(2);
    await expandLibraryTree(page);
    await expect(page.locator(`#documentList details[data-lu-node="x:out"] [data-lu-photoset="${M1}"]`)).toHaveCount(1);
  }
});
