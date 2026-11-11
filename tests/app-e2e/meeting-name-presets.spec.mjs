// S57-14 MTG-회의명처음배치(시안 docs/design/mockups/meeting-name-groups-phone.html): 사업 보고 입력 창 회의명 상자가
// 처음부터 조직 머리글 아래 정한 순서로 뜨고, 아직 보고가 없는 '미리 넣은 회의'가 보이며 고를 수 있다.
// '회의 미리 넣기'로 넣으면 그 조직 맨 아래에 붙고, 줄 ⋯ [위로]·[아래로]로 순서를 고치고, ⋯ [목록에서 빼기]로 뺀다.
// 값은 서버(내 프로필 meeting_name_sorts)에만 있다 — 새로 고침·다른 화면(다른 기기와 같은 조건)에서도 같은 목록.
// 서버는 가짜, 이름은 모두 지어낸 값(실제 회의·단체 이름 없음).
import {test, expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';

test.use({timezoneId: 'Asia/Seoul'});
const BASE = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const A = 'gaaaaaa1', B = 'gbbbbbb2';
const PARENTS = [{id: A, name: '예시 조직 A'}, {id: B, name: '예시 조직 B'}];
const row = (id, name, at) => ({id, workspace_id: 'mp-ws', project_id: null, activity_kind: 'meeting', title: name, series_name: name, meeting_at: at, notes: '', transcript_text: '', created_by: 'mp-user', result_status: 'final'});
// 최근 순서: 회의 2 > 회의 3 > 회의 1 > 회의 4
const meetings = [
  row('m1', '예시 회의 1', '2026-11-01T01:00:00Z'),
  row('m2', '예시 회의 2', '2026-11-05T01:00:00Z'),
  row('m3', '예시 회의 3', '2026-11-03T01:00:00Z'),
  row('m4', '예시 회의 4', '2026-10-01T01:00:00Z'),
];
const key = s => s.replace(/\s+/g, '').toLowerCase();

async function mock(page, state) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const ok = data => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token: 'mp-access', refresh_token: 'mp-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: {id: 'mp-user'}});
    if (path === '/auth/v1/user') return ok({id: 'mp-user', email: 'mp@example.org', user_metadata: {display_name: '회의명 QA'}});
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'mp-ws', user_id: 'mp-user', role: 'owner', workspace: {id: 'mp-ws', name: 'QA'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id: 'mp-ws', name: 'QA'}]);
    if (path === '/rest/v1/app_profiles') {
      if (method === 'PATCH') { const body = req.postDataJSON(); if ('meeting_name_sorts' in body) { state.sorts = body.meeting_name_sorts; state.writes.push(body.meeting_name_sorts); } return ok([{user_id: 'mp-user', meeting_name_sorts: state.sorts}]); }
      if ((url.searchParams.get('select') || '').includes('meeting_name_sorts')) return ok([{meeting_name_sorts: state.sorts}]);
      return ok([{user_id: 'mp-user', display_name: '회의명 QA'}]);
    }
    if (path === '/rest/v1/app_meetings') return ok(method === 'GET' ? meetings : []);
    if (path === '/functions/v1/google-calendar') return ok({connected: false, enabled: false, selected: [], calendars: [], events: []});
    if (path === '/functions/v1/google-tasks') return ok({tasks: [], needs_reconnect: false});
    if (path === '/functions/v1/push-notifications') return ok({enabled: false, web_enabled: false, native_enabled: false, public_key: 'qa'});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path.startsWith('/rest/v1/') || path.startsWith('/functions/v1/')) return ok([]);
    return ok({});
  });
}
async function openModal(page) {
  await expect(page.locator('#meetingsView')).toBeVisible({timeout: 15000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout: 15000});
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingNameSelect')).toHaveAttribute('data-name-panel', '1');
  // PC는 입력 창이 가장 최근 회의명을 미리 고른 채 열린다 — 빈 이름에서 시작한다.
  await page.locator('#meetingNameSelect').selectOption('__other__');
}
async function openEntry(page, state) {
  await mock(page, state);
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(`${BASE}/app/?view=meetings`)}`);
  await signInWithSession(page, 'mp@example.org');
  await openModal(page);
}
const panel = page => page.locator('#kptuNamePanel');
const picks = page => panel(page).locator('.mnp-row:not(.mnp-other-row) .mnp-pick .mnp-name');
const openPanel = async page => { await page.locator('#meetingNameSelect').click(); await expect(panel(page)).toBeVisible(); };
const menuOf = async (page, name) => { await panel(page).locator('.mnp-row', {hasText: name}).locator('.mnp-more').click(); await expect(panel(page).locator('.mnp-title')).toHaveText(name); };
const acts = page => panel(page).locator('[data-mnp-act]');
const SIZES = [['폰 412', {width: 412, height: 915}], ['폴드 펼침 768', {width: 768, height: 900}], ['PC 1280', {width: 1280, height: 900}]];

for (const [label, size] of SIZES) {
  test(`${label}: 회의명 상자를 열면 처음부터 조직 머리글 아래 정한 순서로 묶여 있고, 미리 넣은 회의가 보이며 고를 수 있다`, async ({page}) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize(size);
    // 처음 배치가 끝난 값: 조직 A = 회의 3 · (미리) 회의 9 · 회의 1, 조직 B = 회의 2 · (미리) 회의 10. 최근 순서(2·3·1)와 다른 정한 순서.
    const state = {sorts: {parents: PARENTS, orgs: {[key('예시 회의 3')]: A, [key('예시 회의 9')]: A, [key('예시 회의 1')]: A, [key('예시 회의 2')]: B, [key('예시 회의 10')]: B},
      presets: ['예시 회의 9', '예시 회의 10'], order: ['예시 회의 3', '예시 회의 9', '예시 회의 1', '예시 회의 2', '예시 회의 10'].map(key)}, writes: []};
    await openEntry(page, state);
    await openPanel(page);
    await expect(panel(page).locator('.mnp-org')).toHaveText(['예시 조직 A', '예시 조직 B', '기타']);
    await expect(picks(page)).toHaveText(['예시 회의 3', '예시 회의 9', '예시 회의 1', '예시 회의 2', '예시 회의 10', '예시 회의 4']);
    await expect(panel(page).locator('[data-mnp-preset-row] .mnp-name')).toHaveText(['예시 회의 9', '예시 회의 10']);
    // 기존 그대로: 회의 찾기 · 기타(직접 입력) · 조직 목록 수정. 새로: 회의 미리 넣기.
    await expect(panel(page).locator('[data-mnp-find]')).toBeVisible();
    await expect(panel(page).locator('.mnp-other')).toHaveText('기타(직접 입력)');
    await expect(panel(page).locator('.mnp-foot .mnp-link')).toHaveText(['조직 목록 수정', '회의 미리 넣기']);
    // 창이 화면 옆으로 나가지 않는다.
    const box = await panel(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    // 찾기: 미리 넣은 회의도 찾고, 조직 꼬리표가 붙는다.
    await panel(page).locator('[data-mnp-find]').fill('회의10');
    await expect(picks(page)).toHaveText(['예시 회의 10']);
    await expect(panel(page).locator('.mnp-tag')).toHaveText('· 예시 조직 B');
    await panel(page).locator('[data-mnp-find]').fill('');
    // 미리 넣은 회의를 고르면 회의명 상자 값이 된다(서버에는 아무것도 쓰지 않음).
    await panel(page).locator('.mnp-pick', {hasText: '예시 회의 9'}).click();
    await expect(panel(page)).toBeHidden();
    await expect(page.locator('#meetingNameSelect')).toHaveValue('예시 회의 9');
    expect(state.writes).toEqual([]);
    // 다시 열면 고른 줄이 표시된다.
    await openPanel(page);
    await expect(panel(page).locator('.mnp-row.is-on .mnp-name')).toHaveText('예시 회의 9');
    expect(errors).toEqual([]);
  });
}

for (const [label, size] of [SIZES[0], SIZES[2]]) {
  test(`${label}: 회의 미리 넣기 → 그 조직 맨 아래 · ⋯ 위로/아래로 · 새로 고침 뒤에도 같음 · ⋯ 목록에서 빼기`, async ({page}) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize(size);
    // 조직 A에 회의 3·1이 순서 표시 없이 있다(최근 먼저: 3, 1).
    const state = {sorts: {parents: PARENTS, orgs: {[key('예시 회의 3')]: A, [key('예시 회의 1')]: A}}, writes: []};
    await openEntry(page, state);
    await openPanel(page);
    await expect(picks(page)).toHaveText(['예시 회의 3', '예시 회의 1', '예시 회의 2', '예시 회의 4']);
    // 회의 미리 넣기: 이름 + 조직 → [추가]. 넣은 뒤에도 그 칸에 머문다(이어서 넣기).
    await panel(page).locator('[data-mnp-preset]').click();
    await expect(panel(page).locator('.mnp-title')).toHaveText('회의 미리 넣기');
    await expect(panel(page).locator('[data-mnp-preset-org]')).toHaveText(['예시 조직 A', '예시 조직 B', '기타']);
    await expect(panel(page).locator('[data-mnp-preset-org][aria-checked="true"]')).toHaveText('기타');
    await panel(page).locator(`[data-mnp-preset-org="${A}"]`).click();
    await expect(panel(page).locator('[data-mnp-preset-org][aria-checked="true"]')).toHaveText('예시 조직 A');
    // 이미 있는 회의명·빈 이름은 저장하지 않고 알린다.
    await panel(page).locator('[data-mnp-preset-name]').fill('예시회의 1');
    await panel(page).locator('[data-mnp-preset-form] button[type="submit"]').click();
    await expect(panel(page).locator('.mnp-msg')).toHaveText('이미 목록에 있는 회의예요.');
    expect(state.writes).toEqual([]);
    await panel(page).locator('[data-mnp-preset-name]').fill('예시 회의 9');
    await panel(page).locator('[data-mnp-preset-name]').press('Enter');
    await expect(panel(page).locator('.mnp-msg')).toHaveText('‘예시 회의 9’을 ‘예시 조직 A’에 추가했어요.');
    await expect(panel(page).locator('[data-mnp-preset-name]')).toHaveValue('');
    expect(state.writes.at(-1).presets).toEqual(['예시 회의 9']);
    expect(state.writes.at(-1).orgs[key('예시 회의 9')]).toBe(A);
    expect(state.writes.at(-1).order).toEqual(['예시 회의 3', '예시 회의 1', '예시 회의 9'].map(key));
    // 이어서 하나 더(조직은 고른 그대로).
    await panel(page).locator('[data-mnp-preset-name]').fill('예시 회의 10');
    await panel(page).locator('[data-mnp-preset-name]').press('Enter');
    await expect(panel(page).locator('.mnp-msg')).toHaveText('‘예시 회의 10’을 ‘예시 조직 A’에 추가했어요.');
    // 목록으로: 조직 A 맨 아래에 넣은 순서대로.
    await panel(page).locator('[data-mnp-back]').click();
    await expect(panel(page).locator('.mnp-org')).toHaveText(['예시 조직 A', '기타']);
    await expect(picks(page)).toHaveText(['예시 회의 3', '예시 회의 1', '예시 회의 9', '예시 회의 10', '예시 회의 2', '예시 회의 4']);
    // 미리 넣은 줄 ⋯: 조직 바꾸기 · 이름 바꾸기 · 위로 · 아래로 · 목록에서 빼기(비정기로 두기·삭제는 없음).
    await menuOf(page, '예시 회의 9');
    await expect(acts(page)).toHaveText(['조직 바꾸기 (예시 조직 A)', '이름 바꾸기', '위로', '아래로', '목록에서 빼기']);
    // [위로] 두 번: 메뉴에 머물고, 맨 위에서는 [위로]가 없다.
    await panel(page).locator('[data-mnp-act="up"]').click();
    await expect.poll(() => state.writes.at(-1).order).toEqual(['예시 회의 3', '예시 회의 9', '예시 회의 1', '예시 회의 10'].map(key));
    await expect(acts(page)).toHaveText(['조직 바꾸기 (예시 조직 A)', '이름 바꾸기', '위로', '아래로', '목록에서 빼기']);
    await panel(page).locator('[data-mnp-act="up"]').click();
    await expect.poll(() => state.writes.at(-1).order).toEqual(['예시 회의 9', '예시 회의 3', '예시 회의 1', '예시 회의 10'].map(key));
    await expect(acts(page)).toHaveText(['조직 바꾸기 (예시 조직 A)', '이름 바꾸기', '아래로', '목록에서 빼기']);
    await panel(page).locator('[data-mnp-act="down"]').click();
    await expect.poll(() => state.writes.at(-1).order).toEqual(['예시 회의 3', '예시 회의 9', '예시 회의 1', '예시 회의 10'].map(key));
    await panel(page).locator('[data-mnp-back]').click();
    await expect(picks(page)).toHaveText(['예시 회의 3', '예시 회의 9', '예시 회의 1', '예시 회의 10', '예시 회의 2', '예시 회의 4']);
    // 보고가 있는 줄 ⋯도 위로·아래로가 있고 기존 항목은 그대로(끝 줄은 그쪽 항목이 없음).
    await menuOf(page, '예시 회의 3');
    await expect(acts(page)).toHaveText(['비정기로 두기', '조직 바꾸기 (예시 조직 A)', '이름 바꾸기', '아래로', '삭제']);
    await panel(page).locator('[data-mnp-back]').click();
    // 기존 줄 ⋯ 조직 바꾸기 → 그 조직 맨 아래에 붙는다.
    await menuOf(page, '예시 회의 4');
    await panel(page).locator('[data-mnp-act="org"]').click();
    await panel(page).locator(`[data-mnp-org-pick="${A}"]`).click();
    await expect(picks(page)).toHaveText(['예시 회의 3', '예시 회의 9', '예시 회의 1', '예시 회의 10', '예시 회의 4', '예시 회의 2']);
    // 기기에는 아무것도 저장하지 않는다(서버 값만): 새로 고침해도 같은 목록.
    expect(await page.evaluate(() => [localStorage, sessionStorage].flatMap(s => Object.keys(s).map(k => s.getItem(k))).some(v => /예시 회의 9|예시회의9/.test(String(v))))).toBe(false);
    await page.reload();
    await openModal(page);
    await openPanel(page);
    await expect(picks(page)).toHaveText(['예시 회의 3', '예시 회의 9', '예시 회의 1', '예시 회의 10', '예시 회의 4', '예시 회의 2']);
    // 미리 넣은 회의 이름 바꾸기: 보고가 없으므로 묻지 않고 정리 값의 이름만 바뀐다(자리·조직 그대로).
    await menuOf(page, '예시 회의 10');
    await panel(page).locator('[data-mnp-act="rename"]').click();
    await panel(page).locator('[data-mnp-rename]').fill('예시 회의 열');
    await panel(page).locator('[data-mnp-rename-form] button[type="submit"]').click();
    await expect.poll(() => state.sorts.presets).toEqual(['예시 회의 9', '예시 회의 열']);
    expect(state.sorts.orgs[key('예시 회의 열')]).toBe(A);
    await expect(panel(page)).toBeHidden();
    await openPanel(page);
    await expect(picks(page)).toHaveText(['예시 회의 3', '예시 회의 9', '예시 회의 1', '예시 회의 열', '예시 회의 4', '예시 회의 2']);
    // ⋯ 목록에서 빼기: 한 번 묻고, 미리 넣은 표시·조직·순서 표시가 지워진다.
    await menuOf(page, '예시 회의 9');
    await panel(page).locator('[data-mnp-act="unpreset"]').click();
    await expect(page.locator('.kptu-ask')).toContainText('‘예시 회의 9’을 회의명 목록에서 뺄까요?');
    await page.locator('.kptu-ask button', {hasText: '빼기'}).click();
    await expect(picks(page)).toHaveText(['예시 회의 3', '예시 회의 1', '예시 회의 열', '예시 회의 4', '예시 회의 2']);
    expect(state.sorts.presets).toEqual(['예시 회의 열']);
    expect(key('예시 회의 9') in state.sorts.orgs).toBe(false);
    expect(state.sorts.order).toEqual(['예시 회의 3', '예시 회의 1', '예시 회의 열', '예시 회의 4'].map(key));
    expect(errors).toEqual([]);
  });
}

test('조직에 넣은 회의가 미리 넣은 회의뿐이어도 조직 머리글로 묶이고, 조직 없이 미리 넣으면 지금 모양(묶음 없음) 맨 아래에 보인다', async ({page}) => {
  await page.setViewportSize({width: 412, height: 915});
  const state = {sorts: {parents: PARENTS, presets: ['예시 회의 9']}, writes: []};
  await openEntry(page, state);
  await openPanel(page);
  await expect(panel(page).locator('.mnp-org')).toHaveCount(0);
  await expect(picks(page)).toHaveText(['예시 회의 2', '예시 회의 3', '예시 회의 1', '예시 회의 4', '예시 회의 9']);
  // ⋯ 조직 바꾸기 → 조직 A: 이제 조직 머리글로 묶인다.
  await menuOf(page, '예시 회의 9');
  await panel(page).locator('[data-mnp-act="org"]').click();
  await panel(page).locator(`[data-mnp-org-pick="${A}"]`).click();
  await expect(panel(page).locator('.mnp-org')).toHaveText(['예시 조직 A', '기타']);
  await expect(picks(page)).toHaveText(['예시 회의 9', '예시 회의 2', '예시 회의 3', '예시 회의 1', '예시 회의 4']);
});

test('서버가 새 칸을 아직 받지 않으면(DB 적용 전) 저장 실패만 알리고 목록은 그대로다', async ({page}) => {
  await page.setViewportSize({width: 412, height: 915});
  const state = {sorts: {parents: PARENTS, orgs: {[key('예시 회의 3')]: A}}, writes: []};
  await openEntry(page, state);
  // 검사에 걸린 저장(400)을 흉내 낸다.
  await page.route(`${SB}/rest/v1/app_profiles**`, async route => {
    if (route.request().method() === 'PATCH') return route.fulfill({status: 400, contentType: 'application/json', body: JSON.stringify({code: '23514', message: 'check constraint'})});
    return route.fallback();
  });
  await openPanel(page);
  await panel(page).locator('[data-mnp-preset]').click();
  await panel(page).locator('[data-mnp-preset-name]').fill('예시 회의 9');
  await panel(page).locator('[data-mnp-preset-name]').press('Enter');
  await expect(panel(page).locator('.mnp-msg')).toHaveText('저장하지 못했어요. 다시 해 주세요.');
  await expect(panel(page).locator('[data-mnp-preset-name]')).toHaveValue('예시 회의 9');
  await panel(page).locator('[data-mnp-back]').click();
  await expect(picks(page)).toHaveText(['예시 회의 3', '예시 회의 2', '예시 회의 1', '예시 회의 4']);
});
