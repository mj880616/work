import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// FEAT-1029묶음 ③ 오래 연락 안 한 담당조직 한 줄(폰 412·884, PC 1440). 2026-11-24 명진 요청("홈화면에서 이거 없애고, 이거는 조직 관리 화면 맨 아래로"):
// 줄은 홈에 없고 조직 관리 목록(#soOrganizationList) 맨 아래 [data-team-quiet]. 기준 주 수는 조직 관리 ⋯ [data-so-quiet](MULTI-다른담당자맞춤 ⑥,
// 통화·텔레그램 수집이 있는 작업공간만). 가짜 이름만. 오늘 = 2026-10-06(KST).
// '연락' = 주요 인물과의 통화, 또는 텔레그램에서 내가 묻고 그쪽이 답한 것. 일방 전달·단체방 소식은 세지 않는다.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ORGS = [['o1', '가지부'], ['o2', '나지부'], ['o3', '다분회'], ['o4', '라지부'], ['o5', '마분회'], ['o6', '바지부'], ['o7', '사지부']];
const PEOPLE = [['k1', 'o1', '가위원장'], ['k2', 'o2', '나사무장'], ['k3', 'o3', '다위원장'], ['k4', 'o4', '라간부'], ['k5', 'o5', '마위원장'], ['k7', 'o7', '사위원장']];
const CALLS = [
  {id: 'c1', day: '2026-09-11', counterpart: '가위원장', title: '통화'},       // 가지부 25일
  {id: 'c3', day: '2026-10-01', counterpart: '다위원장', title: '통화'},       // 다분회 5일 → 조용하지 않음
  {id: 'c7', day: '2026-08-05', counterpart: '사위원장', title: '안부'},       // 사지부 62일
];
const SENDERS = [{id: 'me', workspace_id: 'w', name: null, auto_name: '나', is_self: true, sender_key: null},
  {id: 's2', workspace_id: 'w', name: '나사무장', auto_name: null, is_self: false, sender_key: null},
  {id: 's4', workspace_id: 'w', name: '라간부', auto_name: null, is_self: false, sender_key: null}];
const link = (room_key, day, label, sender_id) => ({workspace_id: 'w', room_key, day, label, sender_id});
const LINKS = [
  link('r2', '2026-08-27', 'A', 'me'), link('r2', '2026-08-27', 'B', 's2'),   // 나지부: 묻고 답함 → 40일
  link('r2', '2026-09-26', 'A', 'me'), link('r2', '2026-09-26', 'B', 's2'),   // 나지부: 그쪽 공지 + 내 대답 → 세지 않음
  link('r4', '2026-10-03', 'A', 'me'), link('r4', '2026-10-03', 'B', 's4'),   // 라지부: 묻고 답함 → 3일
];
const RAW = {
  'r2|2026-08-27': '09:00 A: 요즘 교섭 어떻게 돼요?\n09:20 B: 다음 주 3차입니다',
  'r2|2026-09-26': '10:00 B: 내일 집회 공지 올립니다\n10:05 A: 확인했어요',
  'r4|2026-10-03': '14:00 A: 자료 받으셨나요\n14:30 B: 네 받았습니다',
};

// ORG-연락없음1대1수집: 1:1 방(app_feed_rooms.chat_kind='user')은 상대가 그 날 직접 쓴 글이 있으면 연락. dm=true일 때만 아래 방을 더한다.
const DM_SENDERS = [{id: 's5', workspace_id: 'w', name: '마위원장', auto_name: null, is_self: false, sender_key: null},
  {id: 's7', workspace_id: 'w', name: '사위원장', auto_name: null, is_self: false, sender_key: null}];
const DM_LINKS = [
  link('5005', '2026-09-30', 'A', 's5'), link('5005', '2026-09-30', 'B', 'me'),   // 마분회 1:1: 상대가 먼저 쓰고 내가 답함 → 6일(조용하지 않음)
  link('7007', '2026-10-04', 'A', 's7'), link('7007', '2026-10-04', 'B', 'me'),   // 사지부 1:1: 상대는 전달 글만 → 세지 않음
  link('7007', '2026-10-05', 'B', 'me'),                                            // 사지부 1:1: 나만 보냄 → 세지 않음
  link('g2', '2026-10-02', 'A', 's2'),                                              // 나지부 단체방: 상대만 말함 → 세지 않음
];
const DM_RAW = {
  '5005|2026-09-30': '20:00 A: 내일 회의 자료 보냅니다\n20:10 B: 고맙습니다',
  '7007|2026-10-04': '11:00 A (전달): 공문 원문\n11:05 B: 확인할게요',
  '7007|2026-10-05': '09:00 B: 요즘 어떠세요?',
  'g2|2026-10-02': '08:00 A: 오늘 집회 장소 바뀌었습니다',
};
const DM_ROOMS = [{room_key: '5005', chat_kind: 'user'}, {room_key: '7007', chat_kind: 'user'}];

async function routes(page, weeks, {dm = false} = {}) {
  const raw = dm ? {...RAW, ...DM_RAW} : RAW;
  const json = (r, body) => r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
  // 조직 한 곳 읽기(id=eq.…)는 그 조직만(상세 제목 확인용).
  await page.route(SB + '/rest/v1/app_suborganizations?**', r => { const one = new URL(r.request().url()).searchParams.get('id'); return json(r, ORGS.filter(([id]) => !one || one === 'eq.' + id).map(([id, name]) => ({id, name, active: true}))); });
  await page.route(SB + '/rest/v1/app_suborganization_assignees?**', r => json(r, ORGS.map(([id]) => ({organization_id: id, user_id: 'home-test'}))));
  await page.route(SB + '/rest/v1/app_org_key_people?**', r => json(r, PEOPLE.map(([id, organization_id, name], i) => ({id, workspace_id: 'w', organization_id, name, match_names: [name], sort_order: i}))));
  await page.route(SB + '/rest/v1/app_tg_senders?**', r => json(r, dm ? [...SENDERS, ...DM_SENDERS] : SENDERS));
  await page.route(SB + '/rest/v1/app_tg_day_senders?**', r => json(r, dm ? [...LINKS, ...DM_LINKS] : LINKS));
  await page.route(SB + '/rest/v1/app_feed_rooms?**', r => json(r, dm ? DM_ROOMS : []));
  await page.route(SB + '/rest/v1/app_feed_items?**', r => {
    const u = new URL(r.request().url()), source = u.searchParams.get('source'), room = u.searchParams.get('room_key');
    if (source === 'eq.call') return json(r, CALLS.map(c => ({...c, workspace_id: 'w', source: 'call', occurred_at: c.day + 'T01:00:00Z'})));
    if (source === 'eq.telegram' && room) {
      const key = room.slice(3);
      return json(r, Object.entries(raw).filter(([k]) => k.startsWith(key + '|')).map(([k, raw_text], i) => ({id: 't' + i + key, room_key: key, day: k.split('|')[1], occurred_at: k.split('|')[1] + 'T05:00:00Z', raw_text})));
    }
    return json(r, []);
  });
  return weeks;
}
const line = page => page.locator('#teamView [data-team-quiet]');
async function openTeam(page) {
  await page.evaluate(() => window.KPTURouter.go('team'));
  await expect(page.locator('#teamView')).toBeVisible();
  await expect(page.locator('#soOrganizationList [data-so-org]').first()).toBeVisible();
}
const noHomeLine = async page => {
  await expect(page.locator('#homeView [data-home-quiet], #homeView [data-team-quiet], #homeView .oq-line')).toHaveCount(0);
};

for (const [width, phone] of [[412, true], [884, false], [1440, false]]) {
  test(`연락 없는 조직 한 줄은 조직 관리 맨 아래 ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await openHome(page, {beforeLoad: () => routes(page)});
    await expect(page.locator('#homeView [data-journal-schedule]')).toBeVisible();
    // 홈에는 이 줄이 없다(그리지도 않음).
    await page.waitForTimeout(600);
    await noHomeLine(page);
    await openTeam(page);
    const q = line(page);
    await expect(q).toBeVisible();
    await expect(q.locator('.oq-text')).toHaveText('3주째 연락 없음: 가지부 25일 · 나지부 40일 · 사지부 62일 외 1곳');
    // 자리: 조직 관리 목록의 마지막 칸, 마지막 조직 줄보다 아래.
    expect(await page.locator('#soOrganizationList > :last-child').getAttribute('data-team-quiet')).toBe('');
    const lastRow = await page.locator('#soOrganizationList [data-so-org]').last().boundingBox(), qb = await q.boundingBox();
    expect(qb.y).toBeGreaterThan(lastRow.y + lastRow.height - 1);
    await noHomeLine(page);
    // 펼치기
    await q.locator('[data-oq-toggle]').click();
    await expect(q.locator('[data-oq-toggle]')).toHaveAttribute('aria-expanded', 'true');
    await expect(q.locator('.oq-text')).toHaveText('3주째 연락 없음 4곳');
    await expect(q.locator('.oq-row')).toHaveCount(4);
    await expect(q.locator('.oq-row').nth(0)).toContainText('가지부마지막 · 통화 9.1125일');
    await expect(q.locator('.oq-row').nth(1)).toContainText('나지부마지막 · 텔레그램 8.2740일');
    await expect(q.locator('.oq-row').nth(3)).toContainText('마분회180일 안 연락 없음180일+');
    await expect(q.locator('.oq-note')).toHaveText('주요 인물이 없는 담당조직 1곳은 세지 않음');
    await expect(q).not.toContainText('다분회');
    await expect(q).not.toContainText('라지부');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await q.locator('.oq-line').boundingBox();
    if (width !== 884) expect(box.height).toBeLessThanOrEqual(36);
    // 좁은 목록 칸(PC 884)에서도 접힌 줄의 이름이 잘려 숨지 않는다(모두 줄 안에 보이고 누를 수 있다).
    await q.locator('[data-oq-toggle]').click();
    for (const b of await q.locator('.oq-text .oq-org').all()) {
      const r = await b.boundingBox();
      expect(r.x).toBeGreaterThanOrEqual(qb.x - 1);
      expect(r.x + r.width).toBeLessThanOrEqual(qb.x + qb.width + 1);
    }
    await q.locator('[data-oq-toggle]').click();
    if (process.env.KPTU_SHOTS) await page.screenshot({path: `docs/design/screens/org-quiet-team-${width}.png`});
    // 키보드로 접기
    await q.locator('[data-oq-toggle]').focus();
    await page.keyboard.press('Enter');
    await expect(q.locator('.oq-list')).toBeHidden();
    // 목록을 다시 그려도 같은 자리(맨 끝)에 남는다.
    await page.evaluate(() => window.dispatchEvent(new Event('kptu:basket-links-changed')));
    await expect(q.locator('.oq-text')).toHaveText('3주째 연락 없음: 가지부 25일 · 나지부 40일 · 사지부 62일 외 1곳');
    // 이름을 누르면 그 담당조직 상세
    await q.locator('.oq-text [data-oq-org="o2"]').click();
    await expect(page.locator('#wdTitle')).toHaveText('나지부');
    if (!phone) await expect(page.locator('#soOrganizationList [data-so-org="o2"]')).toHaveClass(/is-selected/);
    if (phone) await expect(page.locator('#wdModal')).toBeVisible();
    expect(await page.evaluate(() => window.KPTURouter.current)).toBe('team');
  });
}

// MULTI-다른담당자맞춤 ⑥: 기준은 조직 관리 ⋯에서 선택(내 프로필에는 없음). 값은 그대로 서버 화면 기억 quiet_weeks.
const SBQ = 'https://xmlkxfjeagycwttklxjw.supabase.co';
async function teamMenu(page) {
  await openTeam(page);
  await page.locator('#soTeamMore').click();
  return page.locator('#soTeamMenu');
}
test('기준 주 수는 조직 관리 ⋯에서 선택하고 서버에 저장한다(끄기면 줄 없음)', async ({page}) => {
  await page.setViewportSize({width: 412, height: 900});
  const home = await openHome(page, {beforeLoad: async () => { await routes(page); await page.route(u => u.origin === SBQ && u.pathname === '/rest/v1/rpc/app_my_features', r => r.fulfill({json: ['calls']})); }});
  // 내 프로필에는 기준 칸이 없다.
  await page.evaluate(() => window.KPTURouter.go('profile'));
  await expect(page.locator('#profileView')).toBeVisible();
  await expect(page.locator('[data-ps-quiet]')).toHaveCount(0);
  let menu = await teamMenu(page);
  await expect(line(page)).toBeVisible();
  const seg = menu.locator('.so-quiet-seg');
  await expect(menu.locator('.so-menu-label')).toHaveText("'연락 없는 조직' 기준");
  await expect(seg.locator('[aria-pressed="true"]')).toHaveText('3주');
  await expect(seg.locator('button')).toHaveText(['2주', '3주', '4주', '6주', '끄기']);
  await seg.locator('[data-so-quiet="6"]').click();
  await expect.poll(() => home.prefs.value?.quiet_weeks).toBe(6);
  menu = await teamMenu(page);
  await expect(menu.locator('.so-quiet-seg [aria-pressed="true"]')).toHaveText('6주');
  await menu.locator('[data-so-quiet="0"]').click();
  await expect.poll(() => home.prefs.value?.quiet_weeks).toBe(0);
  await expect(line(page)).toBeHidden();
  menu = await teamMenu(page);
  await menu.locator('[data-so-quiet="6"]').click();
  await expect(line(page).locator('.oq-text')).toHaveText('6주째 연락 없음: 사지부 62일 · 마분회 180일+');
});
test('통화·텔레그램 수집이 없는 작업공간은 조직 관리 ⋯에 기준 칸이 없다', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  await openHome(page, {beforeLoad: async () => { await routes(page); await page.route(u => u.origin === SBQ && u.pathname === '/rest/v1/rpc/app_my_features', r => r.fulfill({json: []})); }});
  const menu = await teamMenu(page);
  await expect(menu.getByRole('button', {name: '쟁의 단계 관리'})).toBeVisible();
  await expect(menu.locator('.so-quiet-seg, .so-menu-label')).toHaveCount(0);
});

test('S67-51: 통화·텔레그램 수집이 없는 사람은 주요 인물이 있어도 연락 없는 조직 줄이 없고 통화를 읽지 않는다', async ({page}) => {
  await page.setViewportSize({width: 412, height: 900});
  let feedReads = 0;
  await openHome(page, {beforeLoad: async () => {
    await routes(page);
    await page.route(u => u.origin === SBQ && u.pathname === '/rest/v1/rpc/app_my_features', r => r.fulfill({json: ['files']}));
    await page.route(SB + '/rest/v1/app_feed_items?**', r => (/source=eq\.call.*counterpart,organization_id,points/.test(r.request().url()) && (feedReads += 1), r.fulfill({status: 200, contentType: 'application/json', body: '[]'})));
  }});
  await openTeam(page);
  await page.waitForTimeout(800);
  await expect(line(page)).toBeHidden();
  await expect(line(page)).toBeEmpty();
  expect(feedReads).toBe(0);
});

test('대상 조직이 없으면 줄 자체가 보이지 않는다', async ({page}) => {
  await page.setViewportSize({width: 412, height: 900});
  let calls = 0;
  await openHome(page, {beforeLoad: async () => {
    await routes(page);
    // 모든 조직과 어제 통화 → 조용한 조직 없음
    await page.route(SB + '/rest/v1/app_feed_items?**', r => {
      const source = new URL(r.request().url()).searchParams.get('source');
      if (source === 'eq.call') calls += 1;
      return r.fulfill({json: source === 'eq.call' ? PEOPLE.map(([, , name], i) => ({id: 'y' + i, workspace_id: 'w', source: 'call', day: '2026-10-05', occurred_at: '2026-10-05T01:00:00Z', counterpart: name, title: '통화'})) : []});
    });
  }});
  await openTeam(page);
  await expect.poll(() => calls).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await expect(line(page)).toBeHidden();
  await expect(line(page)).toBeEmpty();
});

test('하나라도 읽기에 실패하면 줄을 그리지 않는다', async ({page}) => {
  await page.setViewportSize({width: 412, height: 900});
  let failed = false;
  await openHome(page, {beforeLoad: async () => {
    await routes(page);
    await page.route(SB + '/rest/v1/app_tg_day_senders?**', r => (failed = true, r.fulfill({status: 500, contentType: 'application/json', body: '{"message":"QA"}'})));
  }});
  await openTeam(page);
  await expect.poll(() => failed).toBe(true);
  await expect(line(page)).toBeHidden();
  await expect(line(page)).toBeEmpty();
});

test('1:1 방은 상대가 쓴 글로 센다(나만 보낸 날·전달 글·단체방 상대 글은 세지 않음)', async ({page}) => {
  await page.setViewportSize({width: 412, height: 900});
  await openHome(page, {beforeLoad: () => routes(page, undefined, {dm: true})});
  await openTeam(page);
  const q = line(page);
  await expect(q.locator('.oq-text')).toHaveText('3주째 연락 없음: 가지부 25일 · 나지부 40일 · 사지부 62일');
  await q.locator('[data-oq-toggle]').click();
  await expect(q.locator('.oq-row')).toHaveCount(3);
  await expect(q).not.toContainText('마분회');
  await expect(q.locator('.oq-row').nth(2)).toContainText('사지부마지막 · 통화 8.562일');
});

// SEC-기능PIN잠금(S67-14): 통화를 잠갔고 아직 안 풀었으면 마지막 연락 날짜(통화·텔레그램에서 옴) 대신 '잠김' 한 줄.
test('통화를 잠그면 연락 없는 조직은 "잠김" 한 줄 412', async ({page}) => {
  await page.setViewportSize({width: 412, height: 900});
  await openHome(page, {beforeLoad: async () => {
    await routes(page);
    await page.route(SB + '/rest/v1/rpc/app_lock_read*', r => r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({has_pin: true, features: ['calls'], relock: '5m', left: 5, blocked_until: null})}));
    await page.route(SB + '/rest/v1/rpc/app_lock_check*', r => r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(r.request().postDataJSON()?.p_pin === '1234' ? {ok: true, left: 5, blocked_until: null} : {ok: false, left: 4, blocked_until: null})}));
  }});
  await openTeam(page);
  const q = line(page);
  await expect(q.locator('[data-oq-locked]')).toHaveText('연락 없는 조직 · 잠김 풀기');
  await expect(q).not.toContainText('가지부');
  await expect(q).not.toContainText('25일');
  // S67-25: [풀기] → 그 자리 PIN 창(화면을 떠나지 않음) → 맞으면 같은 자리에 조직 이름이 보인다.
  await q.locator('button.lk-open').click();
  const here = page.locator('dialog.lk-here');
  await expect(here.locator('.lk-title')).toHaveText('통화·텔레그램 잠김');
  for (const d of '1234') await here.locator(`[data-lk-key="${d}"]`).click();
  await expect(here).toHaveCount(0);
  await expect(q.locator('[data-oq-locked]')).toHaveCount(0);
  await expect(q).toContainText('가지부');
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('team');
});
