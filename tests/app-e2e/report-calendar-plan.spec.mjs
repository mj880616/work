import {test, expect} from '@playwright/test';
import {makeState, openReportCalendar, DAY, WS, REPORT} from './helpers/report-calendar-plan-server.mjs';

// S58-10 BIZ-보고할일정 PR C(설계 docs/design/biz-report-plan-link.md 4절, 시안 docs/design/mockups/biz-report-plan-link.html ③).
// 사업 보고 [달력]: ● 쓴 보고 · □ 보고할 일정 · 점선 □ 보고할까요?, 그날 목록 [보고 쓰기]·[보고할까요?]·⋯ [빼기], 저절로 골라 주기, '안 쓴 보고 n'.
// 저장은 모두 서버(app_calendar_report_plans). 새 표가 없는 서버에서는 표시 없이 예전 그대로. 서버는 흉내, 일정·이름은 모두 가짜다(오늘 = 2026-11-11 수).
test.use({timezoneId: 'Asia/Seoul'});

const cell = (cal, n) => cal.locator(`.rv-cell[data-rv-cell="${DAY(n)}"]`);
const dayRow = (cal, id) => cal.locator(`.rv-day-list [data-rv-plan="${id}"]`);
const menu = page => page.locator('#rowMenu');
const labels = page => menu(page).locator('button').allTextContents().then(a => a.map(s => s.trim()));
const sent = state => state.planWrites.map(w => [w.method, w.body?.google_event_id ?? '', w.body?.state ?? '', w.body?.decided_by ?? '']);
// 표시 모양: 'done' ● · 'todo' □ · 'ask' 점선 □
const marks = scope => scope.locator('.rv-dot').evaluateAll(els => els.map(el => (el.classList.contains('rv-dot-todo') ? 'todo' : el.classList.contains('rv-dot-ask') ? 'ask' : 'done')));
// 처음 그릴 때 저절로 켜지는 줄(같은 이름 기억) 두 개가 서버에 들어갈 때까지.
const settled = state => expect.poll(() => state.planWrites.length).toBeGreaterThanOrEqual(2);
const watch = page => { const errors = []; page.on('pageerror', e => errors.push(e.message)); return errors; };
const noSideScroll = page => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

test('1280 달력: ● 쓴 보고 · □ 보고할 일정 · 점선 □ 보고할까요?, 같은 이름은 저절로 □(줄을 서버에 한 번만 넣는다)', async ({page}) => {
  const errors = watch(page), state = makeState();
  const cal = await openReportCalendar(page, state);
  await settled(state);
  // 오늘 칸: 일정에 이어 쓴 보고 ●, 켜 둔 일정 □, 담당조직 연결 일정 점선 □ — 시각 순.
  await expect(cell(cal, 11).locator('.rv-title')).toHaveText(['가짜 본부 집행위', '가짜 지부 간담회', '예시 기자회견']);
  expect(await marks(cell(cal, 11).locator('.rv-titles'))).toEqual(['done', 'todo', 'ask']);
  // 전에 보고를 쓴 이름('시험 주간 회의')의 다음 일정은 저절로 □. 보고를 쓴 그 일정(4일)은 ●만.
  for (const n of [18, 25]) { await expect(cell(cal, n).locator('.rv-title')).toHaveText(['시험 주간 회의']); expect(await marks(cell(cal, n).locator('.rv-titles'))).toEqual(['todo']); }
  expect(await marks(cell(cal, 4).locator('.rv-titles'))).toEqual(['done']);
  // 지난 보고할 일정(9일·5일)도 □, 같은 이름의 다음 담당조직 일정(20일)은 점선 □, 그냥 일정·끈 일정(12일)은 표시 없음.
  expect(await marks(cell(cal, 9).locator('.rv-titles'))).toEqual(['todo']);
  expect(await marks(cell(cal, 5).locator('.rv-titles'))).toEqual(['todo']);
  expect(await marks(cell(cal, 20).locator('.rv-titles'))).toEqual(['ask']);
  await expect(cell(cal, 12).locator('.rv-title')).toHaveCount(0);
  await expect(cell(cal, 11).locator('.rv-num')).toHaveAttribute('aria-label', '11월 11일 (수) 사업 보고 1건 · 보고할 일정 1건 · 보고할까요? 1건');
  await expect(cal.locator('.rv-legend')).toHaveText('쓴 보고보고할 일정보고할까요?');
  // 그날 목록: 보고(누르면 열림) · 보고할 일정 [보고 쓰기] ⋯ · 보고할까요? [보고할까요?] ⋯
  const rows = cal.locator('.rv-day-list .rv-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-mrd-meeting', REPORT.head);
  await expect(dayRow(cal, 'ev-todo').locator('h3')).toHaveText('가짜 지부 간담회');
  await expect(dayRow(cal, 'ev-todo').locator('p')).toHaveText('일정 · 10:00');
  await expect(dayRow(cal, 'ev-todo').locator('button')).toHaveText(['보고 쓰기', '⋯']);
  await expect(dayRow(cal, 'ev-ask').locator('p')).toHaveText('일정 · 15:00 · 담당조직 연결됨');
  await expect(dayRow(cal, 'ev-ask').locator('button')).toHaveText(['보고할까요?', '⋯']);
  // 단추는 공용 글자 버튼·아이콘 버튼.
  await expect(dayRow(cal, 'ev-todo').locator('[data-rv-plan-write]')).toHaveClass(/(^| )row-act( |$)/);
  await expect(dayRow(cal, 'ev-todo').locator('[data-rv-plan-more]')).toHaveClass(/(^| )icon-btn( |$)/);
  // 저절로 켜진 줄: 내 작업공간에 state=on·decided_by=rule로 한 번씩만. 일정은 이 달(서울) 범위로 한 번만 읽는다.
  expect(sent(state)).toEqual([['POST', 'wk-1118', 'on', 'rule'], ['POST', 'wk-1125', 'on', 'rule']]);
  expect(state.planWrites.every(w => w.body.workspace_id === WS)).toBe(true);
  expect(state.planWrites[0].body).toMatchObject({title: '시험 주간 회의', event_day: DAY(18), google_calendar_id: 'own'});
  await page.waitForTimeout(700); // 다시 그리기가 맴돌며 더 읽거나 쓰지 않는다
  expect(state.planWrites).toHaveLength(2);
  expect(state.eventReads).toEqual([{timeMin: '2026-10-31T15:00:00.000Z', timeMax: '2026-11-30T15:00:00.000Z'}]);
  expect(state.planReads).toBe(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => /plan|report/i.test(k)))).toEqual([]);
  expect(errors).toEqual([]);
});

test('1280 [보고할까요?] → □ 확정(서버 저장), 같은 이름 다음 일정은 저절로 □, 새로 고쳐도 유지', async ({page}) => {
  const errors = watch(page), state = makeState();
  const cal = await openReportCalendar(page, state);
  await settled(state);
  await dayRow(cal, 'ev-ask').locator('[data-rv-plan-ask]').click();
  await expect(dayRow(cal, 'ev-ask').locator('button')).toHaveText(['보고 쓰기', '⋯']);
  await expect(dayRow(cal, 'ev-ask')).toHaveAttribute('data-rv-plan-status', 'todo');
  await expect(dayRow(cal, 'ev-ask').locator('[data-rv-plan-write]')).toBeFocused(); // 다시 그려도 누른 줄에 초점
  await expect(page.locator('#toast')).toHaveText('보고할 일정으로 표시했어요.');
  expect(await marks(cell(cal, 11).locator('.rv-titles'))).toEqual(['done', 'todo', 'todo']);
  // 같은 이름('예시 기자회견')의 20일 일정: 저절로 □가 되고, 그 줄(rule)도 서버에 들어간다.
  await expect.poll(() => sent(state).slice(2)).toEqual([['POST', 'ev-ask', 'on', 'user'], ['POST', 'ev-ask-next', 'on', 'rule']]);
  expect(await marks(cell(cal, 20).locator('.rv-titles'))).toEqual(['todo']);
  await page.reload();
  await page.waitForFunction(() => window.KPTUViewLoader?.isLoaded('meetings'));
  const again = page.locator('#meetingList .rv-cal');
  await expect(dayRow(again, 'ev-ask').locator('button')).toHaveText(['보고 쓰기', '⋯']);
  expect(await marks(cell(again, 20).locator('.rv-titles'))).toEqual(['todo']);
  await page.waitForTimeout(500);
  expect(state.planWrites).toHaveLength(4); // 새로 고친 뒤 더 넣지 않는다
  expect(errors).toEqual([]);
});

test('1280 ⋯ [빼기] = 같은 이름은 다시 묻지 않음, ⋯ [보고할 일정 ✓] = 이 일정만 끔, 우클릭도 같은 메뉴', async ({page}) => {
  const errors = watch(page), state = makeState();
  const cal = await openReportCalendar(page, state);
  await settled(state);
  // 보고할까요? 줄 ⋯ → [빼기]
  await dayRow(cal, 'ev-ask').locator('[data-rv-plan-more]').click();
  await expect(menu(page)).toBeVisible();
  expect(await labels(page)).toEqual(['빼기']);
  await menu(page).locator('button', {hasText: '빼기'}).click();
  await expect(dayRow(cal, 'ev-ask')).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText('뺐어요. 같은 이름 일정은 다시 묻지 않아요.');
  await expect(cell(cal, 20).locator('.rv-title')).toHaveCount(0); // 같은 이름의 20일 일정도 더 묻지 않는다
  expect(sent(state).slice(2)).toEqual([['POST', 'ev-ask', 'skip', 'user']]);
  // 보고할 일정 줄 우클릭 = ⋯와 같은 메뉴 → [보고할 일정 ✓] = 이 일정만 끔(줄 고치기)
  const box = await dayRow(cal, 'ev-todo').locator('h3').boundingBox();
  await page.mouse.click(Math.round(box.x + 20), Math.round(box.y + box.height / 2), {button: 'right'});
  await expect(menu(page)).toBeVisible();
  expect(await labels(page)).toEqual(['보고할 일정 ✓', '빼기']);
  await menu(page).locator('button', {hasText: '보고할 일정 ✓'}).click();
  await expect(dayRow(cal, 'ev-todo')).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText('보고할 일정 표시를 껐어요.');
  expect(state.planWrites.at(-1)).toMatchObject({method: 'PATCH', body: {state: 'off', decided_by: 'user'}});
  expect(state.planWrites.at(-1).query).toContain(`workspace_id=eq.${WS}&id=eq.plan-1`);
  // 칸 안 □ 줄(⋯ 단추 없는 자리) 우클릭도 같은 메뉴(칸의 [이날 사업 보고 추가] 메뉴가 아니다). '안 쓴 보고' 목록 줄 우클릭도 그 줄 ⋯ 메뉴.
  const line = await cell(cal, 25).locator('[data-rv-plan="wk-1125"]').boundingBox();
  await page.mouse.click(Math.round(line.x + 30), Math.round(line.y + line.height / 2), {button: 'right'});
  await expect(menu(page)).toBeVisible();
  expect(await labels(page)).toEqual(['보고할 일정 ✓', '빼기']);
  await page.keyboard.press('Escape'); await expect(menu(page)).toBeHidden();
  await cal.locator('[data-rv-due] summary').click();
  const late = await cal.locator('[data-rv-due] [data-rv-plan="ev-late2"] .rv-due-name').boundingBox();
  await page.mouse.click(Math.round(late.x + 10), Math.round(late.y + late.height / 2), {button: 'right'});
  await expect(menu(page)).toBeVisible();
  expect(await labels(page)).toEqual(['보고할 일정 ✓', '빼기']);
  await page.keyboard.press('Escape'); await expect(menu(page)).toBeHidden();
  // 저절로 켜진 이름을 [빼기]: 그 줄은 skip으로, 같은 이름의 다른 저절로 켜진 줄(25일)은 삭제 → 25일 표시가 사라진다.
  await cell(cal, 18).locator('.rv-num').click();
  await dayRow(cal, 'wk-1118').locator('[data-rv-plan-more]').click();
  expect(await labels(page)).toEqual(['보고할 일정 ✓', '빼기']);
  await menu(page).locator('button', {hasText: '빼기'}).click();
  await expect(cell(cal, 25).locator('.rv-title')).toHaveCount(0);
  await expect(cell(cal, 18).locator('.rv-title')).toHaveCount(0);
  const tail = state.planWrites.slice(-2);
  expect(tail[0]).toMatchObject({method: 'PATCH', body: {state: 'skip', decided_by: 'user'}});
  expect(tail[1].method).toBe('DELETE');
  expect(tail[1].query).toMatch(new RegExp(`workspace_id=eq\\.${WS}&decided_by=eq\\.rule&state=eq\\.on&id=in\\.\\(plan-\\d+\\)$`));
  expect(state.plans.map(p => [p.google_event_id, p.state]).sort()).toEqual([['ev-ask', 'skip'], ['ev-late1', 'on'], ['ev-late2', 'on'], ['ev-off', 'off'], ['ev-todo', 'off'], ['wk-1118', 'skip']]);
  await expect(cell(cal, 4).locator('.rv-title')).toHaveText(['시험 주간 회의']); // 이미 쓴 보고는 그대로
  expect(errors).toEqual([]);
});

test('1280 [보고 쓰기] → 일정이 채워진 쓰기 창 → 저장하면 일정과 이어지고 □가 ●로', async ({page}) => {
  const errors = watch(page), state = makeState();
  const cal = await openReportCalendar(page, state);
  await settled(state);
  await dayRow(cal, 'ev-todo').locator('[data-rv-plan-write]').click();
  const sheet = page.locator('#reportKindSheet'); await expect(sheet).toBeVisible();
  await sheet.locator('[data-sheet-value="meeting"]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingTitle')).toHaveValue('가짜 지부 간담회');
  await expect(page.locator('#meetingAt')).toHaveValue('2026-11-11T10:00');
  await expect(page.locator('#meetingLocation')).toHaveValue('가짜 회의실');
  await page.locator('#meetingTranscript').fill('가짜 결과 내용');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  expect(state.reportPosts).toHaveLength(1);
  expect(state.reportPosts[0]).toMatchObject({workspace_id: WS, series_name: '가짜 지부 간담회', google_event_id: 'ev-todo', google_calendar_id: 'own'});
  // 달력으로 돌아오면 그 일정은 보고 줄(●) 하나로만 보인다(□ 줄 없음).
  await expect(dayRow(cal, 'ev-todo')).toHaveCount(0);
  await expect(cal.locator('.rv-day-list .rv-row h3')).toHaveText(['가짜 본부 집행위', '가짜 지부 간담회', '예시 기자회견']);
  await expect.poll(() => marks(cell(cal, 11).locator('.rv-titles'))).toEqual(['done', 'done', 'ask']);
  // 줄은 지우지 않는다(결정은 그대로, 표시는 '이어진 보고가 있음'으로 판정).
  expect(state.plans.find(p => p.google_event_id === 'ev-todo')?.state).toBe('on');
  expect(errors).toEqual([]);
});

test("1280 '안 쓴 보고 n': 지나고 하루 지난 보고할 일정만 세고, 누르면 그 자리에서 목록, 거기서 [보고 쓰기]·⋯", async ({page}) => {
  const errors = watch(page), state = makeState();
  const cal = await openReportCalendar(page, state);
  await settled(state);
  const due = cal.locator('[data-rv-due]');
  await expect(due.locator('summary')).toHaveText('안 쓴 보고 2 · 11. 9. 시험 운영위 외 1');
  await expect(due.locator('.rv-due-row')).toHaveCount(2);
  await expect(due.locator('.rv-due-row').first()).toBeHidden(); // 접혀 있다
  await due.locator('summary').click();
  await expect(due.locator('.rv-due-row .rv-due-name')).toHaveText(['시험 운영위', '예시 대표자 회의']);
  await expect(due.locator('.rv-due-row .rv-due-day')).toHaveText(['11. 9.', '11. 5.']);
  // 달력을 다시 그려도(다른 날 고르기) 펼친 채로 있다.
  await cell(cal, 12).locator('.rv-num').click();
  await expect(due.locator('.rv-due-row').first()).toBeVisible();
  // 목록의 [보고 쓰기]: 그 일정 날짜·시각이 채워진 쓰기 창.
  await due.locator('[data-rv-plan="ev-late1"] [data-rv-plan-write]').click();
  await page.locator('#reportKindSheet [data-sheet-value="meeting"]').click();
  await expect(page.locator('#meetingTitle')).toHaveValue('시험 운영위');
  await expect(page.locator('#meetingAt')).toHaveValue('2026-11-09T14:00');
  await page.keyboard.press('Escape');
  await expect(page.locator('#meetingModal')).toBeHidden();
  // 목록의 ⋯ → [보고할 일정 ✓](이 일정만 끔) → 줄에서 빠지고 숫자가 준다.
  await due.locator('[data-rv-plan="ev-late1"] [data-rv-plan-more]').click();
  await menu(page).locator('button', {hasText: '보고할 일정 ✓'}).click();
  await expect(due.locator('summary')).toHaveText('안 쓴 보고 1 · 11. 5. 예시 대표자 회의');
  await expect(cell(cal, 9).locator('.rv-title')).toHaveCount(0);
  expect(state.planWrites.at(-1)).toMatchObject({method: 'PATCH', body: {state: 'off', decided_by: 'user'}});
  expect(errors).toEqual([]);
});

test("1280 '+n' 그날 창에도 같은 표시: 점선 □ 줄의 [보고할까요?] → 창은 그대로 □ [보고 쓰기], 칸 □ 줄은 Enter로 쓰기 창", async ({page}) => {
  const errors = watch(page), state = makeState({busy: true});
  const cal = await openReportCalendar(page, state);
  await settled(state);
  // 13일: 보고 4건 + 보고할까요? 1건 = 5줄 → 칸에는 3줄 + '+2'.
  const more = cell(cal, 13).locator('[data-rv-more]');
  await expect(more).toHaveText('+2');
  await expect(more).toHaveAttribute('aria-label', '11월 13일 (금) 사업 보고 4건 · 보고할까요? 1건 모두 보기');
  await more.click();
  const win = page.locator('#calendarDayModal[data-day-kind="report"]');
  await expect(win).toBeVisible();
  await expect(win.locator('.kptu-day-note')).toHaveText('사업 보고 4 · 일정 1');
  // 머리(날짜·건수)는 한 줄에 들어간다.
  expect(await win.locator('#calendarDayTitle').evaluate(el => el.getClientRects().length && Math.round(el.getBoundingClientRect().height))).toBeLessThanOrEqual(24);
  await expect(win.locator('.rv-pop-row')).toHaveCount(5);
  expect(await marks(win)).toEqual(['done', 'done', 'done', 'done', 'ask']);
  const planRow = win.locator('[data-rv-plan="ev-ask-busy"]');
  await expect(planRow.locator('.rv-pop-name')).toHaveText('예시 현장 방문');
  await planRow.locator('[data-rv-plan-ask]').click();
  await expect(planRow.locator('button')).toHaveText('보고 쓰기');
  await expect(win).toBeVisible();
  expect(await marks(win)).toEqual(['done', 'done', 'done', 'done', 'todo']);
  expect(sent(state).at(-1)).toEqual(['POST', 'ev-ask-busy', 'on', 'user']);
  // 창 안 [보고 쓰기]: 창이 닫히고 쓰기 창 길(어느 칸에 남길지)로.
  await planRow.locator('[data-rv-plan-write]').click();
  await expect(win).toBeHidden();
  await expect(page.locator('#reportKindSheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#reportKindSheet')).toBeHidden();
  // 칸 안 □ 줄은 글자 단추: 키보드 Enter로도 쓰기 창 길이 열린다. 점선 □ 줄은 단추가 아니다(칸을 누르면 그날 목록).
  const line = cell(cal, 18).locator('[data-rv-plan-write]');
  await expect(line).toHaveAttribute('role', 'button');
  await line.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#reportKindSheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cell(cal, 20).locator('.rv-plan-wait')).not.toHaveAttribute('role', 'button');
  await cell(cal, 20).locator('.rv-plan-wait').click();
  await expect(cal.locator('.rv-day-title')).toHaveText('11월 20일 (금)');
  await expect(dayRow(cal, 'ev-ask-next').locator('[data-rv-plan-ask]')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const [width, height] of [[412, 900], [884, 1000]]) test(`${width} 폰·폴드: 칸 표시와 그날 목록 단추가 화면 안에 보이고 ⋯ 메뉴로 뺀다`, async ({page}) => {
  const errors = watch(page), state = makeState();
  const cal = await openReportCalendar(page, state, {width, height});
  await settled(state);
  if (width < 761) {
    // 폰: 칸에는 점만(● □ 점선 □), 이름 줄은 숨긴다.
    expect(await marks(cell(cal, 11).locator('.rv-dots'))).toEqual(['done', 'todo', 'ask']);
    await expect(cell(cal, 11).locator('.rv-dots')).toBeVisible();
    await expect(cell(cal, 11).locator('.rv-titles')).toBeHidden();
    expect(await marks(cell(cal, 18).locator('.rv-dots'))).toEqual(['todo']);
  } else {
    await expect(cell(cal, 11).locator('.rv-titles')).toBeVisible();
    expect(await marks(cell(cal, 11).locator('.rv-titles'))).toEqual(['done', 'todo', 'ask']);
  }
  await expect(cal.locator('[data-rv-due] summary')).toHaveText('안 쓴 보고 2 · 11. 9. 시험 운영위 외 1');
  // 그날 목록의 단추 둘이 화면 폭 안에 다 보인다(잘리지 않음). 옆으로 밀리는 스크롤 없음.
  for (const id of ['ev-todo', 'ev-ask']) for (const button of await dayRow(cal, id).locator('button').all()) {
    await button.scrollIntoViewIfNeeded();
    const b = await button.boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(width);
  }
  await noSideScroll(page);
  // 표시는 9px 네모: 꽉 찬 점(쓴 보고)과 모양으로 구분된다.
  const shape = await dayRow(cal, 'ev-todo').locator('.rv-dot').evaluate(el => { const s = getComputedStyle(el); return [s.borderTopStyle, s.borderTopLeftRadius, s.backgroundColor, Math.round(el.getBoundingClientRect().width)]; });
  expect(shape).toEqual(['solid', '2px', 'rgba(0, 0, 0, 0)', 9]);
  expect(await dayRow(cal, 'ev-ask').locator('.rv-dot').evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('dashed');
  // ⋯ → 작은 메뉴가 화면 안에 뜨고 [빼기]가 된다.
  await dayRow(cal, 'ev-ask').locator('[data-rv-plan-more]').click();
  await expect(menu(page)).toBeVisible();
  const m = await menu(page).boundingBox();
  expect(m.x).toBeGreaterThanOrEqual(0); expect(m.x + m.width).toBeLessThanOrEqual(width); expect(m.y + m.height).toBeLessThanOrEqual(height);
  await menu(page).locator('button', {hasText: '빼기'}).click();
  await expect(dayRow(cal, 'ev-ask')).toHaveCount(0);
  expect(sent(state).at(-1)).toEqual(['POST', 'ev-ask', 'skip', 'user']);
  expect(errors).toEqual([]);
});

test('새 표가 없는 서버(적용 전·되돌린 뒤): 표시·안 쓴 보고 줄 없이 예전 그대로, 일정도 읽지 않고 쓰지 않는다', async ({page}) => {
  const errors = watch(page), state = makeState({store: false});
  const cal = await openReportCalendar(page, state);
  await expect(cell(cal, 11).locator('.rv-title')).toHaveText(['가짜 본부 집행위']);
  await page.waitForTimeout(700);
  await expect(cal.locator('.rv-dot-todo, .rv-dot-ask, .rv-legend, [data-rv-due], [data-rv-plan]')).toHaveCount(0);
  await expect(cal.locator('.rv-day-list .rv-row')).toHaveCount(1);
  expect(state.planWrites).toEqual([]);
  expect(state.eventReads).toEqual([]);
  expect(errors).toEqual([]);
});

test('Google 일정을 못 읽어도(연결 없음) 켜 둔 일정의 □와 안 쓴 보고는 줄 사본으로 보인다', async ({page}) => {
  const errors = watch(page), state = makeState({google: false});
  const cal = await openReportCalendar(page, state);
  await expect(dayRow(cal, 'ev-todo').locator('button')).toHaveText(['보고 쓰기', '⋯']);
  await expect(cal.locator('[data-rv-due] summary')).toHaveText('안 쓴 보고 2 · 11. 9. 시험 운영위 외 1');
  expect(await marks(cell(cal, 11).locator('.rv-titles'))).toEqual(['done', 'todo']);
  await expect(cal.locator('.rv-dot-ask')).toHaveCount(1); // 범례의 것 하나뿐 — 달력에는 보고할까요?가 없다
  await page.waitForTimeout(500);
  expect(state.planWrites).toEqual([]);
  expect(errors).toEqual([]);
});
