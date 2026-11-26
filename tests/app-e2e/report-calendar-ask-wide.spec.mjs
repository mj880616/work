import {test, expect} from '@playwright/test';
import {makeState, openReportCalendar, event, iso, DAY, WS} from './helpers/report-calendar-plan-server.mjs';

// S67-16 BIZ-보고할일정(사용자 11/20 03:19 "주요일정 중에 보고 하라고 점선으로 뜨기로" → 03:23 "ㅇ 넓혀").
// 사업 보고 [달력]의 점선 □ '보고할까요?'가 일정에 붙인 담당조직만이 아니라
//   ② 제목에 내 담당조직 이름이 든 일정 ③ 사업영역 주요 일정 행에 오른 일정 ④ 주간보고 '주요 일정' 기준(기자회견·결의대회 등)에도 뜬다.
// 판정은 report-plan-model.mjs askReason 한 곳. 같은 이름 저절로 켜짐·[빼기] 기억·이미 쓴 보고(●) 규칙은 그대로다. 일정·이름은 모두 가짜.
test.use({timezoneId: 'Asia/Seoul'});

const cell = (cal, n) => cal.locator(`.rv-cell[data-rv-cell="${DAY(n)}"]`);
const dayRow = (cal, id) => cal.locator(`.rv-day-list [data-rv-plan="${id}"]`);
const menu = page => page.locator('#rowMenu');
const marks = scope => scope.locator('.rv-dot').evaluateAll(els => els.map(el => (el.classList.contains('rv-dot-todo') ? 'todo' : el.classList.contains('rv-dot-ask') ? 'ask' : 'done')));
const sent = state => state.planWrites.map(w => [w.method, w.body?.google_event_id ?? '', w.body?.state ?? '', w.body?.decided_by ?? '']);
const settled = state => expect.poll(() => state.planWrites.length, {timeout: 15000}).toBeGreaterThanOrEqual(2);
const watch = page => { const errors = []; page.on('pageerror', e => errors.push(e.message)); return errors; };
const noSideScroll = page => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

function wideState() {
  const state = makeState();
  state.orgs = [{id: 'org-a', name: '예시지부', aliases: [], active: true}, {id: 'org-b', name: '쉬는지회', aliases: [], active: false}];
  state.events.push(
    event('wd-title', '예시 지부 현장 방문', DAY(16), '10:00'),       // ② 제목에 내 담당조직 이름
    event('wd-press', '가짜 공동 기자회견', DAY(16), '14:00'),        // ④ 주요 일정 기준
    event('wd-area', '가짜 정리 점검', DAY(17), '11:00'),             // ③ 사업영역 주요 일정 행
    event('wd-meet', '가짜 기자회견 준비 회의', DAY(17), '16:00'),    // 회의는 주요 일정이 아니다
    event('wd-rest', '쉬는지회 방문', DAY(19), '10:00'),              // 쉬는 조직은 빼고 본다
    event('wd-done', '가짜 총력투쟁 결의대회', DAY(10), '18:00')       // 이미 보고를 쓴 주요 일정 → ●
  );
  state.milestones = [{google_event_id: 'wd-area', start_at: iso(DAY(17), '11:00')}, {google_event_id: 'wd-other', start_at: iso('2026-12-02', '11:00')}];
  state.meetings.push({...state.meetings[2], id: '00000000-0000-4000-8000-000000000990', title: '가짜 총력투쟁 결의대회', series_name: '가짜 총력투쟁 결의대회', meeting_at: iso(DAY(10), '18:00'), google_event_id: 'wd-done', google_calendar_id: 'own'});
  return state;
}

test('1280 넓힌 점선 □: 제목의 담당조직·사업영역 주요 일정·주요 일정 기준 → [보고할까요?] → □ [보고 쓰기], ⋯ [빼기]', async ({page}) => {
  const errors = watch(page), state = wideState();
  const cal = await openReportCalendar(page, state);
  await settled(state);
  await expect.poll(() => marks(cell(cal, 16).locator('.rv-titles'))).toEqual(['ask', 'ask']);
  await expect(cell(cal, 16).locator('.rv-title')).toHaveText(['예시 지부 현장 방문', '가짜 공동 기자회견']);
  expect(await marks(cell(cal, 17).locator('.rv-titles'))).toEqual(['ask']); // 회의(16:00)는 묻지 않는다
  await expect(cell(cal, 17).locator('.rv-title')).toHaveText(['가짜 정리 점검']);
  await expect(cell(cal, 19).locator('.rv-title')).toHaveCount(0);           // 쉬는 조직
  expect(await marks(cell(cal, 10).locator('.rv-titles'))).toEqual(['done', 'done']); // 이미 쓴 주요 일정은 ●(점선 아님)
  // 힌트 읽기: 내 담당조직(쉬는 조직 제외 — 작업공간은 서버가 정한다)·이 달(서울) 사업영역 주요 일정 행.
  expect(state.hintReads.some(q => q.startsWith('/rest/v1/app_suborganizations?active=eq.true&'))).toBe(true);
  expect(state.hintReads).toContain('/rest/v1/app_project_milestones?google_event_id=not.is.null&start_at=gte.2026-10-31T15:00:00.000Z&start_at=lt.2026-11-30T15:00:00.000Z&select=google_event_id&limit=1000');
  // 그날 목록 둘째 줄이 왜 묻는지 알려 준다.
  await cell(cal, 16).locator('.rv-num').click();
  await expect(dayRow(cal, 'wd-title').locator('p')).toHaveText('일정 · 10:00 · 담당조직 연결됨');
  await expect(dayRow(cal, 'wd-press').locator('p')).toHaveText('일정 · 14:00 · 주요 일정');
  await expect(dayRow(cal, 'wd-press').locator('button')).toHaveText(['보고할까요?', '⋯']);
  // [보고할까요?] → □(서버 저장) → [보고 쓰기] → 일정이 채워진 쓰기 창
  await dayRow(cal, 'wd-press').locator('[data-rv-plan-ask]').click();
  await expect(dayRow(cal, 'wd-press')).toHaveAttribute('data-rv-plan-status', 'todo');
  await expect.poll(() => sent(state).slice(2)).toEqual([['POST', 'wd-press', 'on', 'user']]);
  expect(state.planWrites.at(-1).body).toMatchObject({workspace_id: WS, title: '가짜 공동 기자회견', event_day: DAY(16)});
  await dayRow(cal, 'wd-press').locator('[data-rv-plan-write]').click();
  const sheet = page.locator('#reportKindSheet'); await expect(sheet).toBeVisible();
  await sheet.locator('[data-sheet-value="meeting"]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingTitle')).toHaveValue('가짜 공동 기자회견');
  await expect(page.locator('#meetingAt')).toHaveValue('2026-11-16T14:00');
  await page.keyboard.press('Escape');
  await expect(page.locator('#meetingModal')).toBeHidden();
  // 사업영역 주요 일정 ⋯ [빼기] → 다시 묻지 않음(서버 저장)
  await cell(cal, 17).locator('.rv-num').click();
  await expect(dayRow(cal, 'wd-area').locator('p')).toHaveText('일정 · 11:00 · 주요 일정');
  await dayRow(cal, 'wd-area').locator('[data-rv-plan-more]').click();
  await expect(menu(page)).toBeVisible();
  await menu(page).locator('button', {hasText: '빼기'}).click();
  await expect(dayRow(cal, 'wd-area')).toHaveCount(0);
  await expect(cell(cal, 17).locator('.rv-title')).toHaveCount(0);
  expect(sent(state).at(-1)).toEqual(['POST', 'wd-area', 'skip', 'user']);
  expect(errors).toEqual([]);
});

for (const [width, height] of [[412, 900], [884, 1000]]) test(`${width} 폰·폴드: 넓힌 점선 □가 칸에 보이고 단추가 화면 안`, async ({page}) => {
  const errors = watch(page), state = wideState();
  const cal = await openReportCalendar(page, state, {width, height});
  await settled(state);
  const where = width < 761 ? '.rv-dots' : '.rv-titles';
  await expect.poll(() => marks(cell(cal, 16).locator(where))).toEqual(['ask', 'ask']);
  expect(await marks(cell(cal, 17).locator(where))).toEqual(['ask']);
  await cell(cal, 16).locator('.rv-num').click();
  for (const id of ['wd-title', 'wd-press']) for (const button of await dayRow(cal, id).locator('button').all()) {
    await button.scrollIntoViewIfNeeded();
    const b = await button.boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(width);
  }
  await noSideScroll(page);
  expect(errors).toEqual([]);
});

test('힌트를 못 읽어도(조직·사업영역 읽기 실패) 달력은 그대로, 주요 일정 이름 기준과 붙인 조직만으로 묻는다', async ({page}) => {
  const errors = watch(page), state = wideState();
  const cal = await openReportCalendar(page, state, {routes: async p => {
    await p.route('**/rest/v1/app_suborganizations**', r => r.fulfill({status: 500, contentType: 'application/json', body: '{"message":"x"}'}));
    await p.route('**/rest/v1/app_project_milestones**', r => r.fulfill({status: 500, contentType: 'application/json', body: '{"message":"x"}'}));
  }});
  await settled(state);
  await expect.poll(() => marks(cell(cal, 16).locator('.rv-titles'))).toEqual(['ask']);
  await expect(cell(cal, 16).locator('.rv-title')).toHaveText(['가짜 공동 기자회견']);
  await expect(cell(cal, 17).locator('.rv-title')).toHaveCount(0);
  expect(await marks(cell(cal, 11).locator('.rv-titles'))).toEqual(['done', 'todo', 'ask']); // 예전 표시는 그대로
  expect(errors).toEqual([]);
});
