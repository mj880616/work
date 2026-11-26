import {test, expect} from '@playwright/test';
import {makeState, openReportCalendar, event, iso, DAY, WS} from './helpers/report-calendar-plan-server.mjs';

// S67-40(사용자 11/20 20:22 "이미 보고를 했는데 중복된 일정 보고 제안"): 일정에서 시작하지 않고 따로 쓴 보고가 같은 날·가까운 시각·겹치는 제목이면
// 그 일정은 '보고함'으로 보고 점선 □ '보고할까요?'를 놓지 않는다(판정 report-plan-model.mjs reportCover 한 곳).
// 낱말 일부만 겹치면 그대로 묻되 둘째 줄에 '비슷한 보고 있음', ⋯ [이미 보고함: 보고 제목]으로 기존 일정 id 칸에 잇는다(서버 저장). 일정·이름은 모두 가짜.
test.use({timezoneId: 'Asia/Seoul'});

const cell = (cal, n) => cal.locator(`.rv-cell[data-rv-cell="${DAY(n)}"]`);
const dayRow = (cal, id) => cal.locator(`.rv-day-list [data-rv-plan="${id}"]`);
const menu = page => page.locator('#rowMenu');
const marks = scope => scope.locator('.rv-dot').evaluateAll(els => els.map(el => (el.classList.contains('rv-dot-todo') ? 'todo' : el.classList.contains('rv-dot-ask') ? 'ask' : 'done')));
const settled = state => expect.poll(() => state.planWrites.length, {timeout: 15000}).toBeGreaterThanOrEqual(2);
const watch = page => { const errors = []; page.on('pageerror', e => errors.push(e.message)); return errors; };
const PRESS = '예시 3개노조 안전운행 투쟁 돌입 기자회견';

function coveredState() {
  const state = makeState();
  state.events.push(
    event('dup-press', '안전운행 투쟁 기자회견', DAY(6), '10:00'),          // 주요 일정 기준(기자회견) — 따로 쓴 보고가 덮는다
    event('dup-rally', '가짜 공동 결의대회', DAY(6), '15:00'),               // 다른 행사 → 그대로 묻는다
    event('near-ev', '예시 지부 간담회', DAY(7), '14:00', {organizationIds: ['org-1']}) // 낱말 일부만 겹침 → 묻되 [이미 보고함]
  );
  const base = state.meetings[2];
  state.meetings.push(
    {...base, id: '00000000-0000-4000-8000-000000000961', activity_kind: 'press', title: PRESS, series_name: PRESS, meeting_at: iso(DAY(6), '10:00'), created_at: iso(DAY(6), '12:00')},
    {...base, id: '00000000-0000-4000-8000-000000000962', title: '예시 지부 운영위', series_name: '예시 지부 운영위', meeting_at: iso(DAY(7), '14:30'), created_at: iso(DAY(7), '16:00')}
  );
  return state;
}

for (const [width, height] of [[1280, 900], [412, 900]]) test(`${width}: 따로 쓴 보고가 있는 일정은 점선 □가 사라지고, 비슷한 보고는 ⋯ [이미 보고함]으로 잇는다`, async ({page}) => {
  const errors = watch(page), state = coveredState();
  const cal = await openReportCalendar(page, state, {width, height});
  await settled(state);
  const where = width < 761 ? '.rv-dots' : '.rv-titles';
  // 6일: 쓴 보고(●) + 다른 행사(점선 □)만. 같은 기자회견 일정의 점선 □는 없다.
  await expect.poll(() => marks(cell(cal, 6).locator(where))).toEqual(['done', 'ask']);
  await expect.poll(() => marks(cell(cal, 7).locator(where))).toEqual(['ask', 'done']);
  await cell(cal, 6).locator('.rv-num').click();
  await expect(dayRow(cal, 'dup-press')).toHaveCount(0);
  await expect(dayRow(cal, 'dup-rally').locator('p')).toHaveText('일정 · 15:00 · 주요 일정');
  // 7일: 비슷한 보고 → 둘째 줄 안내 + ⋯ [이미 보고함: 예시 지부 운영위] → 서버에 일정 id 칸만 저장 → 점선 □ 사라짐
  await cell(cal, 7).locator('.rv-num').click();
  await expect(dayRow(cal, 'near-ev').locator('p')).toHaveText('일정 · 14:00 · 담당조직 연결됨 · 비슷한 보고 있음');
  await dayRow(cal, 'near-ev').locator('[data-rv-plan-more]').click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).locator('button', {hasText: '이미 보고함'})).toHaveText(['이미 보고함: 예시 지부 운영위']);
  await menu(page).locator('button', {hasText: '이미 보고함'}).click();
  await expect(dayRow(cal, 'near-ev')).toHaveCount(0);
  await expect.poll(() => marks(cell(cal, 7).locator(where))).toEqual(['done']);
  const patch = state.reportPatches.at(-1);
  expect(patch.query).toContain(`id=eq.00000000-0000-4000-8000-000000000962`);
  expect(patch.query).toContain(`workspace_id=eq.${WS}`);
  expect(patch.query).toContain('google_event_id=is.null');
  expect(Object.keys(patch.body).sort()).toEqual(['google_calendar_id', 'google_event_id', 'updated_at']);
  expect(patch.body).toMatchObject({google_event_id: 'near-ev', google_calendar_id: 'own'});
  // 다른 날의 예전 표시는 그대로(11일: ● □ 점선 □).
  expect(await marks(cell(cal, 11).locator(where))).toEqual(['done', 'todo', 'ask']);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
