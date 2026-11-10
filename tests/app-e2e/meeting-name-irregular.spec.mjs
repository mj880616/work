// S53-20 MTG-비정기회의접기(시안 docs/design/mockups/meeting-name-irregular.html): 사업 보고 입력 창 회의명 상자를 누르면
// 정기 회의만 보이고 상위 아래 비정기가 접혀 있으며, '회의 찾기'로 비정기까지 찾아 고르고, ⋯로 비정기에 두고, 상위 목록에 상위를 추가한다(폰·PC).
// 지어낸 이름만 쓴다(실제 회의·단체 이름 없음).
import {test, expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';

test.use({timezoneId: 'Asia/Seoul'});
const BASE = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const P1 = 'gaaaaaa1';
const row = (id, name, at) => ({id, workspace_id: 'mn-ws', project_id: null, activity_kind: 'meeting', title: name, series_name: name, meeting_at: at, notes: '', transcript_text: '', created_by: 'mn-user', result_status: 'final'});
const meetings = [
  row('m1', '샘플 정기회의', '2026-11-03T01:00:00Z'),
  row('m2', '가상협의회 대표자 회의', '2026-11-01T01:00:00Z'),
  row('m3', '하반기 공동 기획회의(2차)', '2026-11-06T01:00:00Z'),
  row('m4', '하반기 공동 기획회의(1차)', '2026-10-20T01:00:00Z'),
  row('m5', '가상지부 점검 회의', '2026-11-04T01:00:00Z'),
  row('m6', '한 번 모임', '2026-09-01T01:00:00Z'),
];
const key = s => s.replace(/\s+/g, '').toLowerCase();

async function mock(page, state) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const ok = data => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token: 'mn-access', refresh_token: 'mn-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: {id: 'mn-user'}});
    if (path === '/auth/v1/user') return ok({id: 'mn-user', email: 'mn@example.org', user_metadata: {display_name: '회의명 QA'}});
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'mn-ws', user_id: 'mn-user', role: 'owner', workspace: {id: 'mn-ws', name: 'QA'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id: 'mn-ws', name: 'QA'}]);
    if (path === '/rest/v1/app_profiles') {
      if (method === 'PATCH') { const body = req.postDataJSON(); if ('meeting_name_sorts' in body) { state.sorts = body.meeting_name_sorts; state.writes.push(body.meeting_name_sorts); } return ok([{user_id: 'mn-user', meeting_name_sorts: state.sorts}]); }
      if ((url.searchParams.get('select') || '').includes('meeting_name_sorts')) return ok([{meeting_name_sorts: state.sorts}]);
      return ok([{user_id: 'mn-user', display_name: '회의명 QA'}]);
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
async function openEntry(page, state) {
  await mock(page, state);
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(`${BASE}/app/?view=meetings`)}`);
  await signInWithSession(page, 'mn@example.org');
  await expect(page.locator('#meetingsView')).toBeVisible({timeout: 15000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout: 15000});
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingNameSelect')).toHaveAttribute('data-name-panel', '1');
}
const panel = page => page.locator('#kptuNamePanel');
const picks = page => panel(page).locator('.mnp-pick .mnp-name');

for (const [label, size] of [['폰', {width: 390, height: 844}], ['PC', {width: 1280, height: 900}]]) {
  test(`${label}: 회의명 목록은 정기만 + 상위 아래 접힌 비정기, 찾기로 비정기 선택, ⋯로 비정기 두기, 상위 추가`, async ({page}) => {
    await page.setViewportSize(size);
    const state = {sorts: {parents: [{id: P1, name: '가상협의회'}], names: {[key('가상지부 점검 회의')]: P1, [key('하반기 공동 기획회의(2차)')]: P1, [key('하반기 공동 기획회의(1차)')]: P1}}, writes: []};
    await openEntry(page, state);

    // PC는 입력 창이 가장 최근 회의명(비정기)을 미리 고른 채 열린다 — 지금 고른 이름은 정기 줄처럼 보이므로, 빈 이름에서 시작한다.
    await page.locator('#meetingNameSelect').selectOption('__other__');
    // ② 평소: 정기만 + 상위 줄 바로 아래 접힌 묶음(차수만 다른 회의는 한 줄).
    await page.locator('#meetingNameSelect').click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator('[data-mnp-find]')).toBeVisible();
    await expect(picks(page)).toHaveText(['샘플 정기회의', '가상협의회 대표자 회의', '한 번 모임']);
    const group = panel(page).locator(`[data-mnp-group="${P1}"]`);
    await expect(group).toContainText('가상협의회 비정기 회의 2');
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    // 펼치면 그 아래만 날짜와 함께(최근 차수가 위).
    await group.click();
    await expect(panel(page).locator('.mnp-sub .mnp-name')).toHaveText(['하반기 공동 기획회의(2차)', '가상지부 점검 회의']);
    await expect(panel(page).locator('.mnp-sub').first()).toContainText('11/6');
    // 패널은 화면 안에 있다.
    const box = await panel(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(size.width);

    // ③ 찾기: 비정기도 나오고 꼬리표가 붙는다 → 고르면 상자 값.
    await panel(page).locator('[data-mnp-find]').fill('점검');
    await expect(picks(page)).toHaveText(['가상지부 점검 회의']);
    await expect(panel(page).locator('.mnp-tag')).toHaveText('· 비정기 · 가상협의회');
    await panel(page).locator('.mnp-pick').first().click();
    await expect(panel(page)).toBeHidden();
    await expect(page.locator('#meetingNameSelect')).toHaveValue('가상지부 점검 회의');
    await expect(page.locator('#meetingTitle')).toHaveValue('가상지부 점검 회의');

    // ④ ⋯ → 비정기로 두기(S56-1: 지금 조직 아래로 바로 — 조직이 없으면 기타): 서버에 그 회의명 열쇠가 'etc'로 저장되고 목록에서 접힌다.
    await page.locator('#meetingNameSelect').click();
    const once = panel(page).locator('.mnp-row', {hasText: '한 번 모임'});
    await once.locator('.mnp-more').click();
    await panel(page).locator('[data-mnp-act="irregular"]').click();
    await expect(panel(page).locator('[data-mnp-group="etc"]')).toContainText('기타 비정기 회의 1');
    expect(state.writes.at(-1).names[key('한 번 모임')]).toBe('etc');
    await expect(panel(page).locator('.mnp-row:not(.mnp-sub) .mnp-name', {hasText: '한 번 모임'})).toHaveCount(0);

    // ⑧⑨ 조직 목록 수정(S56-1 ④ 옛 '상위 목록') → 조직 추가(서버 저장).
    await expect(panel(page).locator('[data-mnp-parents]')).toHaveText('조직 목록 수정');
    await panel(page).locator('[data-mnp-parents]').click();
    await expect(page.locator('#mtgParentsHeading')).toContainText('조직 목록');
    await expect(page.locator('#meetingParentsModal')).toBeVisible();
    await page.locator('#meetingParentsModal [data-mtgp-add-input]').fill('샘플 모임');
    await page.locator('#meetingParentsModal [data-mtgp-add-form] button[type="submit"]').click();
    await expect(page.locator('#meetingParentsModal [data-le-rename]')).toHaveText(['가상협의회', '샘플 모임']);
    expect(state.writes.at(-1).parents.map(p => p.name)).toEqual(['가상협의회', '샘플 모임']);
    await page.locator('#meetingParentsModal [data-mtgp-close]').click();
    await expect(page.locator('#meetingParentsModal')).toBeHidden();
    await expect(page.locator('#meetingModal')).toBeVisible();

    // ④ 새 회의명(기타(직접 입력))은 처음부터 비정기·상위를 고를 수 있다.
    await page.locator('#meetingNameSelect').click();
    await panel(page).locator('[data-mnp-pick="__other__"]').click();
    await page.locator('#meetingTitle').fill('새로 만든 모임');
    await expect(page.locator('#meetingNameSort')).toBeVisible();
    await expect(page.locator('#meetingNameSort option')).toHaveText(['정기 회의', '정기 · 가상협의회', '비정기 · 가상협의회', '정기 · 샘플 모임', '비정기 · 샘플 모임', '비정기 · 기타']);
    await page.locator('#meetingTitle').fill('샘플 정기회의');
    await expect(page.locator('#meetingNameSort')).toBeHidden();
  });
}

// S56-1 MTG-회의명조직묶기(시안 docs/design/mockups/meeting-name-groups.html): 정기 회의에 조직이 붙어 있으면 조직 머리글(누를 수 없음) 아래로 묶고,
// 비정기는 그 조직 맨 아래 '└ 비정기 회의 n', 조직 없는 회의는 맨 아래 '기타'. ⋯ '조직 바꾸기', 찾기 줄 '· 조직' 꼬리표.
const P2 = 'gbbbbbb2';
for (const [label, size] of [['폰', {width: 412, height: 915}], ['PC', {width: 1280, height: 900}]]) {
  test(`${label}: 회의명 목록을 조직별로 묶고, ⋯ 조직 바꾸기, 찾기 꼬리표`, async ({page}) => {
    await page.setViewportSize(size);
    const state = {sorts: {parents: [{id: P1, name: '가상협의회'}, {id: P2, name: '샘플 모임'}],
      names: {[key('가상지부 점검 회의')]: P1, [key('하반기 공동 기획회의(2차)')]: P1, [key('하반기 공동 기획회의(1차)')]: P1},
      orgs: {[key('가상협의회 대표자 회의')]: P1, [key('샘플 정기회의')]: P2}}, writes: []};
    const startNames = {...state.sorts.names};
    await openEntry(page, state);
    await page.locator('#meetingNameSelect').selectOption('__other__');
    await page.locator('#meetingNameSelect').click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator('.mnp-org')).toHaveText(['가상협의회', '샘플 모임', '기타']);
    await expect(picks(page)).toHaveText(['가상협의회 대표자 회의', '샘플 정기회의', '한 번 모임']);
    await expect(panel(page).locator(`[data-mnp-group="${P1}"]`)).toContainText('└ 비정기 회의 2');
    // 조직 머리글은 누를 수 없다(눌러도 창이 그대로, 값도 그대로).
    await panel(page).locator('.mnp-org').first().click();
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('#meetingNameSelect')).toHaveValue('__other__');
    // ③ ⋯ 조직 바꾸기 → 샘플 모임: orgs에 저장, '기타' 머리글이 사라지고 샘플 모임 아래로.
    await panel(page).locator('.mnp-row', {hasText: '한 번 모임'}).locator('.mnp-more').click();
    await expect(panel(page).locator('[data-mnp-act="org"]')).toHaveText('조직 바꾸기 (기타)');
    await panel(page).locator('[data-mnp-act="org"]').click();
    await expect(panel(page).locator('[data-mnp-org-pick]')).toHaveText(['가상협의회', '샘플 모임', '기타']);
    await panel(page).locator(`[data-mnp-org-pick="${P2}"]`).click();
    await expect(panel(page).locator('.mnp-org')).toHaveText(['가상협의회', '샘플 모임']);
    expect(state.writes.at(-1).orgs[key('한 번 모임')]).toBe(P2);
    expect(state.writes.at(-1).names).toEqual(startNames);
    await expect(picks(page)).toHaveText(['가상협의회 대표자 회의', '샘플 정기회의', '한 번 모임']);
    // ⑤ 찾기는 전체에서, 찾은 줄에 '· 조직' 꼬리표(비정기는 '· 비정기 · 조직').
    await panel(page).locator('[data-mnp-find]').fill('모임');
    await expect(picks(page)).toHaveText(['한 번 모임']);
    await expect(panel(page).locator('.mnp-tag')).toHaveText('· 샘플 모임');
    await panel(page).locator('[data-mnp-find]').fill('점검');
    await expect(panel(page).locator('.mnp-tag')).toHaveText('· 비정기 · 가상협의회');
    await expect(panel(page).locator('.mnp-org')).toHaveCount(0);
    const box = await panel(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(size.width);
  });
}

test('정리 칸을 못 읽으면(적용 전 서버) 모든 회의명을 펼쳐 보인다', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  const state = {sorts: undefined, writes: []};
  await openEntry(page, state);
  await page.locator('#meetingNameSelect').click();
  await expect(panel(page)).toBeVisible();
  await expect(picks(page)).toHaveText(['하반기 공동 기획회의(2차)', '가상지부 점검 회의', '샘플 정기회의', '가상협의회 대표자 회의', '한 번 모임']);
  await expect(panel(page).locator('.mnp-grp')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
});

// UI-고르기목록잘림: 회의명 고르기 창도 공용 목록과 같은 규칙 — 창 폭은 가장 긴 이름까지 넓어지고, 화면보다 길 때만 줄바꿈(잘림·… 없음).
for (const [label, size] of [['폰', {width: 412, height: 900}], ['PC', {width: 1280, height: 900}]]) {
  test(`${label}: 회의명 고르기 창의 긴 이름이 잘리지 않는다`, async ({page}) => {
    await page.setViewportSize(size);
    const long = row('m9', '아주 긴 이름의 가상 공동 대책 회의 준비 모임 확대 간담회 두 번째 자리', '2026-11-05T01:00:00Z');
    const state = {sorts: {parents: [], names: {}}, writes: []};
    // openEntry가 mock을 먼저 걸고, 그 뒤에 건 이 경로가 회의 목록만 긴 이름을 더해 돌려준다(뒤에 건 경로가 먼저).
    const route = page.route.bind(page);
    page.route = async (...a) => { await route(...a); await route(`${SB}/rest/v1/app_meetings**`, r => r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(r.request().method() === 'GET' ? [...meetings, long] : [])})); page.route = route; };
    await openEntry(page, state);
    await page.locator('#meetingNameSelect').selectOption('__other__');
    await page.locator('#meetingNameSelect').click();
    await expect(panel(page)).toBeVisible();
    await expect(picks(page).filter({hasText: '두 번째 자리'})).toHaveCount(1);
    const box = await panel(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(7); expect(box.x + box.width).toBeLessThanOrEqual(size.width - 7);
    const clipped = await panel(page).evaluate(p => [...p.querySelectorAll('.mnp-name')].filter(n => {
      const r = document.createRange(); r.selectNodeContents(n); const t = r.getBoundingClientRect(), b = n.closest('.mnp-pick,.mnp-act,.mnp-grp').getBoundingClientRect();
      return n.scrollWidth > n.clientWidth + 1 || t.right > b.right + 1;
    }).map(n => n.textContent));
    expect(clipped).toEqual([]);
  });
}
