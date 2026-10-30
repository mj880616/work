import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// FEAT-1029묶음 ③ 오래 연락 안 한 담당조직: 홈 한 줄(폰 412·884, PC 1440). HOME-업무일지홈: 줄은 홈(업무일지) 맨 아래 [data-home-quiet],
// 기준 주 수는 내 프로필 '수집·사용량' 칸 [data-ps-quiet]. 가짜 이름만. 오늘 = 2026-10-06(KST).
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

async function routes(page, weeks) {
  const json = (r, body) => r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
  await page.route(SB + '/rest/v1/app_suborganizations?**', r => json(r, ORGS.map(([id, name]) => ({id, name, active: true}))));
  await page.route(SB + '/rest/v1/app_suborganization_assignees?**', r => json(r, ORGS.map(([id]) => ({organization_id: id, user_id: 'home-test'}))));
  await page.route(SB + '/rest/v1/app_org_key_people?**', r => json(r, PEOPLE.map(([id, organization_id, name], i) => ({id, workspace_id: 'w', organization_id, name, match_names: [name], sort_order: i}))));
  await page.route(SB + '/rest/v1/app_tg_senders?**', r => json(r, SENDERS));
  await page.route(SB + '/rest/v1/app_tg_day_senders?**', r => json(r, LINKS));
  await page.route(SB + '/rest/v1/app_feed_items?**', r => {
    const u = new URL(r.request().url()), source = u.searchParams.get('source'), room = u.searchParams.get('room_key');
    if (source === 'eq.call') return json(r, CALLS.map(c => ({...c, workspace_id: 'w', source: 'call', occurred_at: c.day + 'T01:00:00Z'})));
    if (source === 'eq.telegram' && room) {
      const key = room.slice(3);
      return json(r, Object.entries(RAW).filter(([k]) => k.startsWith(key + '|')).map(([k, raw_text], i) => ({id: 't' + i + key, room_key: key, day: k.split('|')[1], occurred_at: k.split('|')[1] + 'T05:00:00Z', raw_text})));
    }
    return json(r, []);
  });
  return weeks;
}
const line = page => page.locator('#homeView [data-home-quiet]');

for (const [width, phone] of [[412, true], [884, false], [1440, false]]) {
  test(`연락 없는 조직 한 줄 ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await openHome(page, {beforeLoad: () => routes(page)});
    const q = line(page);
    await expect(q).toBeVisible();
    await expect(q.locator('.oq-text')).toHaveText('3주째 연락 없음: 가지부 25일 · 나지부 40일 · 사지부 62일 외 1곳');
    // 자리: 홈 맨 아래(그날 재료·주간 정리 뒤, #journalRoot의 마지막 칸)
    expect(await page.locator('#journalRoot > :last-child').getAttribute('data-home-quiet')).toBe('');
    const day = await page.locator('#journalRoot [data-journal-day]').boundingBox(), qb = await q.boundingBox();
    expect(qb.y).toBeGreaterThan(day.y + day.height - 1);
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
    expect(box.height).toBeLessThanOrEqual(36);
    // 키보드로 접기
    await q.locator('[data-oq-toggle]').focus();
    await page.keyboard.press('Enter');
    await expect(q.locator('.oq-list')).toBeHidden();
    // 이름을 누르면 담당조직으로
    await q.locator('.oq-text [data-oq-org="o1"]').click();
    await expect.poll(() => page.evaluate(() => window.KPTURouter.current)).toBe('team');
  });
}

test('기준 주 수는 내 프로필에서 고르고 서버에 저장한다(끄기면 줄 없음)', async ({page}) => {
  await page.setViewportSize({width: 412, height: 900});
  const home = await openHome(page, {beforeLoad: () => routes(page)});
  await expect(line(page)).toBeVisible();
  await page.evaluate(() => window.KPTURouter.go('profile'));
  const seg = page.locator('#psStatusPanel [data-ps-quiet]');
  await expect(seg.locator('[aria-pressed="true"]')).toHaveText('3주');
  await seg.locator('[data-ps-weeks="6"]').click();
  await expect.poll(() => home.prefs.value?.quiet_weeks).toBe(6);
  await expect(seg.locator('[aria-pressed="true"]')).toHaveText('6주');
  await expect(seg.locator('[data-ps-weeks="6"]')).toBeFocused();
  await seg.locator('[data-ps-weeks="0"]').click();
  await expect.poll(() => home.prefs.value?.quiet_weeks).toBe(0);
  await page.evaluate(() => window.KPTURouter.go('home'));
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(line(page)).toBeHidden();
  await page.evaluate(() => window.KPTURouter.go('profile'));
  await seg.locator('[data-ps-weeks="6"]').click();
  await page.evaluate(() => window.KPTURouter.go('home'));
  await expect(line(page).locator('.oq-text')).toHaveText('6주째 연락 없음: 사지부 62일 · 마분회 180일+');
});

test('하나라도 읽기에 실패하면 줄을 그리지 않는다', async ({page}) => {
  await page.setViewportSize({width: 412, height: 900});
  let failed = false;
  await openHome(page, {beforeLoad: async () => {
    await routes(page);
    await page.route(SB + '/rest/v1/app_tg_day_senders?**', r => (failed = true, r.fulfill({status: 500, contentType: 'application/json', body: '{"message":"QA"}'})));
  }});
  await expect(page.locator('#homeView [data-journal-schedule]')).toBeVisible();
  await expect.poll(() => failed).toBe(true);
  await expect(line(page)).toBeHidden();
  await expect(line(page)).toBeEmpty();
});
