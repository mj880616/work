import {test, expect} from '@playwright/test';
import {makeState, openReportCalendar, SB} from './helpers/report-calendar-plan-server.mjs';

// S59-23 CAL-일정첨부 요청 6번 '사업 보고로 넘기기'(시안 docs/design/mockups/event-attach.html ③, 설계 docs/design/event-attach.md 5절).
// 일정에서 연 사업 보고 쓰기 창(사업 보고 달력 [보고 쓰기] — 일정 창 [결과 남기기]도 같은 KPTUReportEntry.open({event}))의 사진 칸 아래
// '일정에 붙인 사진 n · 넣으려면 누르기'. 처음엔 안 고른 상태, 누르면 넣기·빼기, [저장]하면 창이 먼저 닫히고 고른 사진만
// document-actions link-event-photo로 그 보고에 잇는다(올리기 없음). 서버·그림은 모두 흉내(가짜 이름·1×1 그림).
// KPTU_SHOTS=1이면 docs/design/screens/s59-23/에 사진을 남긴다(PR 첨부용).
test.use({timezoneId: 'Asia/Seoul'});

const SHOTS = process.env.KPTU_SHOTS === '1';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({path: `docs/design/screens/s59-23/${name}.png`}); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const file = (id, name, mime) => ({drive_file_id: id, file_name: name, mime_type: mime});
const FILES = [file('ph-1', '예시 참고 그림.jpg', 'image/jpeg'), file('ph-2', '예시 현장.png', 'image/png'), file('doc-1', '예시 안내문.pdf', 'application/pdf')];

// 일정 하나 읽기(action=event)·작은 그림(file-photo)·넣기(document-actions) 흉내. files=null이면 옛 서버(일정에 files 칸 없음).
function photoRoutes(state, {files = FILES} = {}) {
  state.ev = {reads: [], photos: [], links: [], fail: new Map()};
  return async page => {
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/google-calendar', async route => {
      const url = new URL(route.request().url()), action = url.searchParams.get('action');
      if (route.request().method() !== 'GET' || !['event', 'file-photo'].includes(action)) return route.fallback();
      if (action === 'file-photo') {
        state.ev.photos.push({eventId: url.searchParams.get('eventId'), fileId: url.searchParams.get('fileId'), size: url.searchParams.get('size')});
        return route.fulfill({status: 200, contentType: 'image/png', body: PNG});
      }
      state.ev.reads.push({eventId: url.searchParams.get('eventId'), calendarId: url.searchParams.get('calendarId')});
      const base = state.events.find(e => e.id === url.searchParams.get('eventId'));
      const event = base && {...base, ...(files ? {files} : {})};
      return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({event, eventColors: {}})});
    });
    await page.route(`${SB}/functions/v1/document-actions`, async route => {
      const body = route.request().postDataJSON();
      state.ev.links.push(body);
      const fail = state.ev.fail.get(body.drive_file_id);
      if (fail) { state.ev.fail.delete(body.drive_file_id); return route.fulfill({status: fail.status, contentType: 'application/json', body: JSON.stringify(fail.body)}); }
      return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({ok: true, result: 'created', document: {id: 'doc-' + state.ev.links.length, title: body.drive_file_id}})});
    });
    await page.route(`${SB}/functions/v1/library-files**`, route => { state.ev.uploads = (state.ev.uploads || 0) + 1; return route.fulfill({status: 500, body: '{}'}); });
  };
}

const watch = page => { const errors = []; page.on('pageerror', e => errors.push(e.message)); return errors; };
const line = page => page.locator('#meetingEventPhotos');
const tiles = page => line(page).locator('[data-ev-item]');
const pressed = page => tiles(page).evaluateAll(els => els.map(e => e.getAttribute('aria-pressed') === 'true'));
const dock = page => page.locator('#uploadDock:not([hidden])');

// 달력 그날 목록 '가짜 지부 간담회' [보고 쓰기] → [회의] 칸 → 쓰기 창.
async function writeFromPlan(page, cal) {
  await cal.locator('.rv-day-list [data-rv-plan="ev-todo"] [data-rv-plan-write]').click();
  await page.locator('#reportKindSheet [data-sheet-value="meeting"]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingTitle')).toHaveValue('가짜 지부 간담회');
}

for (const width of [1280, 412]) {
  test(`[보고 쓰기] ${width}: 사진 칸 아래 '일정에 붙인 사진 2 · 넣으려면 누르기' — 사진만, 처음엔 안 고름, 서버에는 아무것도 안 감`, async ({page}) => {
    const errors = watch(page), state = makeState();
    const cal = await openReportCalendar(page, state, {width, height: width > 760 ? 900 : 915, routes: photoRoutes(state)});
    await writeFromPlan(page, cal);
    await expect(line(page)).toBeVisible();
    await expect(line(page).locator('[data-ev-head]')).toHaveText('일정에 붙인 사진 2');
    await expect(line(page).locator('[data-ev-note]')).toHaveText('· 넣으려면 누르기');
    await expect(tiles(page)).toHaveCount(2); // pdf는 사진이 아니라 빠진다
    expect(await pressed(page)).toEqual([false, false]);
    await expect(line(page).locator('[data-ev-item] img')).toHaveCount(2);
    await expect(tiles(page).first()).toHaveCSS('opacity', '0.45'); // 안 고른 칸은 흐리게(시안 ③)
    // 일정은 한 번 읽고, 작은 그림은 일정 창과 같은 서버 그림(small)
    expect(state.ev.reads).toEqual([{eventId: 'ev-todo', calendarId: 'own'}]);
    expect(state.ev.photos.map(p => [p.fileId, p.size]).sort()).toEqual([['ph-1', 'small'], ['ph-2', 'small']]);
    expect(state.ev.links).toEqual([]);
    // 자리: 사진 칸(#meetingPhotoBlock) 안, 고른 사진 칸 바로 아래
    expect(await page.evaluate(() => { const el = document.querySelector('#meetingEventPhotos'); return el.parentElement.id + ':' + el.previousElementSibling.id; })).toBe('meetingPhotoBlock:meetingSelectedPhotos');
    // 폰 412에서도 창이 가로로 넘치지 않는다.
    expect(await page.evaluate(() => { const c = document.querySelector('#meetingModal .modal-card'); return c.scrollWidth <= c.clientWidth + 1; })).toBe(true);
    await tiles(page).nth(1).click();
    await expect(line(page).locator('[data-ev-note]')).toHaveText('· 1장 넣음');
    await line(page).scrollIntoViewIfNeeded();
    await shot(page, `entry-${width}`);
    expect(errors).toEqual([]);
  });
}

test('[저장]: 창이 먼저 닫히고 고른 사진만 같은 Drive 원본으로 그 보고에 잇는다(올리기 없음)', async ({page}) => {
  const errors = watch(page), state = makeState();
  const cal = await openReportCalendar(page, state, {routes: photoRoutes(state)});
  await writeFromPlan(page, cal);
  await expect(tiles(page)).toHaveCount(2);
  await tiles(page).nth(1).click();
  expect(await pressed(page)).toEqual([false, true]);
  await page.locator('#meetingTranscript').fill('가짜 결과 내용');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  expect(state.reportPosts).toHaveLength(1);
  const meetingId = state.meetings.at(-1).id;
  await expect.poll(() => state.ev.links.length).toBe(1);
  expect(state.ev.links[0]).toEqual({action: 'link-event-photo', meeting_id: meetingId, calendar_id: 'own', event_id: 'ev-todo', drive_file_id: 'ph-2', category: '회의', document_date: '2026-11-11'});
  expect(state.ev.uploads || 0).toBe(0); // 다시 올리지 않는다
  await page.waitForTimeout(300);
  await expect(dock(page)).toHaveCount(0); // 다 넣으면 따로 알리지 않는다
  expect(errors).toEqual([]);
});

test('하나도 안 고르고 [저장]하면 아무것도 넣지 않는다 · 일정 없이 연 쓰기 창에는 줄이 없다', async ({page}) => {
  const state = makeState();
  const cal = await openReportCalendar(page, state, {routes: photoRoutes(state)});
  await writeFromPlan(page, cal);
  await expect(tiles(page)).toHaveCount(2);
  await page.locator('#meetingTranscript').fill('가짜 결과 내용');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  await page.waitForTimeout(300);
  expect(state.ev.links).toEqual([]);
  // 일정 없이 연 새 사업 보고(같은 공용 길 KPTUReportEntry.open): 줄을 두지 않고 일정도 읽지 않는다.
  const reads = state.ev.reads.length;
  await page.evaluate(() => window.KPTUReportEntry.open({kind: 'meeting', name: '예시 새 보고'}));
  await expect(page.locator('#meetingModal')).toBeVisible();
  await page.waitForTimeout(200);
  await expect(line(page)).toBeHidden();
  expect(state.ev.reads.length).toBe(reads);
});

test('못 넣은 사진은 아래 한 줄 [다시 넣기]로 그 사진만 다시', async ({page}) => {
  const state = makeState();
  const cal = await openReportCalendar(page, state, {routes: photoRoutes(state)});
  await writeFromPlan(page, cal);
  await expect(tiles(page)).toHaveCount(2);
  await tiles(page).nth(0).click();
  await tiles(page).nth(1).click();
  state.ev.fail.set('ph-1', {status: 400, body: {error: 'Web2 일정 창에서 붙인 사진만 사업 보고로 넣을 수 있습니다.', code: 'NOT_EVENT_FILE'}});
  await page.locator('#meetingTranscript').fill('가짜 결과 내용');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  await expect(dock(page).locator('.up-dock-text')).toHaveText('일정 사진 1장 못 넣었어요');
  await expect(dock(page)).toContainText('Web2 일정 창에서 붙인 사진만 사업 보고로 넣을 수 있습니다.');
  expect(state.ev.links.map(b => b.drive_file_id)).toEqual(['ph-1', 'ph-2']);
  await shot(page, 'fail-1280');
  await dock(page).getByRole('button', {name: '못 넣은 일정 사진 다시 넣기'}).click();
  await expect.poll(() => state.ev.links.map(b => b.drive_file_id)).toEqual(['ph-1', 'ph-2', 'ph-1']);
});

test('넣었는지 모르면(503) [다시 넣기] 없이 사업 보고를 열어 확인하라고만 알린다(다시 보내지 않음)', async ({page}) => {
  const state = makeState();
  const cal = await openReportCalendar(page, state, {routes: photoRoutes(state)});
  await writeFromPlan(page, cal);
  await expect(tiles(page)).toHaveCount(2);
  await tiles(page).nth(0).click();
  state.ev.fail.set('ph-1', {status: 503, body: {error: '자료실 등록 결과를 확인하지 못했습니다.', code: 'RESULT_UNKNOWN'}});
  await page.locator('#meetingTranscript').fill('가짜 결과 내용');
  await page.locator('#saveMeetingBtn').click();
  await expect(dock(page).locator('.up-dock-text')).toHaveText('일정 사진 1장 못 넣었어요');
  await expect(dock(page)).toContainText('사업 보고를 열어 확인');
  await expect(dock(page).getByRole('button', {name: '못 넣은 일정 사진 다시 넣기'})).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(state.ev.links).toHaveLength(1);
});

for (const [name, files] of [['옛 서버(일정에 첨부 칸 없음)', null], ['사진 없는 일정', [file('doc-1', '예시 안내문.pdf', 'application/pdf')]]]) {
  test(`${name}이면 줄을 두지 않는다`, async ({page}) => {
    const errors = watch(page), state = makeState();
    const cal = await openReportCalendar(page, state, {routes: photoRoutes(state, {files})});
    await writeFromPlan(page, cal);
    await expect.poll(() => state.ev.reads.length).toBe(1);
    await page.waitForTimeout(200);
    await expect(line(page)).toBeHidden();
    expect(errors).toEqual([]);
  });
}

// 일정 창 [결과 남기기]도 같은 길: 그 일정의 사진이 쓰기 창 줄에 뜬다(달력 화면 흉내는 일정 첨부 시험과 같은 도구).
test('일정 창 [결과 남기기] → 쓰기 창에도 같은 줄(그 일정의 사진만, 안 고른 상태)', async ({page}) => {
  const {openEmphasisFixture} = await import('./helpers/calendar-task-emphasis.mjs');
  const errors = watch(page);
  await page.setViewportSize({width: 412, height: 915});
  const ev = {id: 'att-1', calendarId: 'qa-cal', source: 'google', title: '예시 간담회', start: '2026-10-22T05:00:00.000Z', end: '2026-10-22T07:00:00.000Z',
    allDay: false, color: '#4285f4', location: '예시 회의실', description: '', organizationIds: [], recurring: false, files: FILES};
  const blue = {id: 'blue-0', calendarId: 'qa-cal', source: 'google', title: '파란 일정 시험 1', start: '2026-10-20', end: '2026-10-21', allDay: true, color: '#4285f4', files: []};
  await openEmphasisFixture(page, {events: [blue, ev]});
  const seen = {reads: 0, photos: 0};
  await page.route(u => new URL(u).pathname === '/functions/v1/google-calendar', async route => {
    const url = new URL(route.request().url()), action = url.searchParams.get('action');
    if (route.request().method() !== 'GET') return route.fallback();
    if (action === 'file-photo') { seen.photos++; return route.fulfill({status: 200, contentType: 'image/png', body: PNG}); }
    if (action === 'event') { seen.reads++; return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({event: ev, eventColors: {}})}); }
    return route.fallback();
  });
  await page.locator('#calendarGrid [data-google-event="att-1"]').first().click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await expect(page.locator('#ciGoogleReport')).toBeEnabled();
  await page.locator('#ciGoogleReport').click();
  await page.locator('#reportKindSheet [data-sheet-value="meeting"]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(tiles(page)).toHaveCount(2);
  expect(await pressed(page)).toEqual([false, false]);
  await expect(line(page).locator('[data-ev-head]')).toHaveText('일정에 붙인 사진 2');
  expect(seen.reads).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
