import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// JOURNAL-일기원드라이브 10.6 '그날 맥락' (2026-11-10 명진 결정): 사진 있는 날 사진 격자 아래 접힌 한 줄 '그날 맥락 · 일정 1 · 회의 1'
// (네이티브 <details>, 일정·회의만), 펼치면 제목 줄, 누르면 그 화면. 크게 보기 캡션은 찍은 시각과 일정 시간을 맞춘 한 줄
// ("14:20 시험 회의 3차 중"), 찍은 시각이 대략인 사진은 생략. 사진 없는 날에는 맥락을 그리지 않는다.
// 지어낸 Supabase: onedrive-photos(Edge, 원드라이브 응답은 일기 원드라이브 시험과 같은 가짜), google-calendar 일정, app_meetings 회의. 시계는 2026-10-06 KST.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const DAYS = {
  '2026-10-12': [
    { id: 'P1', name: 'P1.jpg', taken_at: '2026-10-12T05:20:00Z', approx: false }, // 14:20 KST — 회의 중
    { id: 'P2', name: 'P2.jpg', taken_at: '2026-10-12T01:30:00Z', approx: false }, // 10:30 KST — 일정 중
    { id: 'P3', name: 'P3.jpg', taken_at: '2026-10-12T05:30:00Z', approx: true },  // 대략 시각 — 생략
    { id: 'P4', name: 'P4.jpg', taken_at: '2026-10-12T12:00:00Z', approx: false }, // 21:00 KST — 맞는 것 없음
  ],
};
const EVENTS = [
  { id: 'ev1', title: '시험 일정', start: '2026-10-12T10:00:00+09:00', end: '2026-10-12T11:00:00+09:00', calendarId: 'c' },
  { id: 'ev2', title: '다른 날 일정', start: '2026-10-13T10:00:00+09:00', end: '2026-10-13T11:00:00+09:00', calendarId: 'c' },
  { id: 'ev3', title: '취소된 일정', start: '2026-10-12T15:00:00+09:00', end: '2026-10-12T16:00:00+09:00', calendarId: 'c', status: 'cancelled' },
];
// DIARY-맥락사업보고이름(11/14 명진 확정): 사업 보고 줄의 꼬리표는 그 칸 이름 그대로(회의 칸 '회의', 투쟁 칸 '투쟁' …), 이 줄에서는 이름 앞 [칸]을 뺀다.
const MEETINGS = [
  { id: 'mt1', workspace_id: 'workspace-1', title: '시험 회의', series_name: '시험 회의', round_no: 3, meeting_at: '2026-10-12T05:00:00Z' },
  { id: 'mt2', workspace_id: 'workspace-1', title: '가상 총력결의대회', series_name: '가상 총력결의대회', round_no: null, meeting_at: '2026-10-12T07:00:00Z', activity_kind: 'struggle' },
];

async function fixture(page, { width }) {
  const state = { errors: [], writes: [], eventReads: [], meetingReads: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) state.errors.push(m.text()); });
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_meetings', r => {
    if (r.request().method() !== 'GET') { state.writes.push(r.request().url()); return r.fulfill({ status: 500, json: {} }); }
    const q = new URL(r.request().url()).searchParams;
    if (q.get('meeting_at')) state.meetingReads.push(q.getAll('meeting_at'));
    const id = (q.get('id') || '').replace(/^eq\./, '');
    return r.fulfill({ json: id ? MEETINGS.filter(m => m.id === id) : MEETINGS });
  });
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/google-calendar', r => {
    const a = new URL(r.request().url()).searchParams.get('action');
    if (a !== 'events') return r.fallback();
    state.eventReads.push(new URL(r.request().url()).searchParams.get('timeMin'));
    return r.fulfill({ json: { events: EVENTS } });
  });
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
    if (body.action === 'photos') return r.fulfill({ json: { month: body.month, days: DAYS, truncated: false } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: 4, total: 4 }, folders: [], indexing: false } });
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  return state;
}
async function openDiary(page, width) {
  if (width <= 760) {
    await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
    await expect(page.locator('#calendarView')).toBeVisible();
    await page.locator('#calendarView .schedule-switch [data-view="diary"]').click();
  } else await page.locator('.app-nav [data-view="diary"]').click();
  await expect(page.locator('#diaryView')).toBeVisible();
  await expect(page.locator('#diaryRoot [data-diary-title]')).toHaveText('2026년 10월');
}
const cell = (page, day) => page.locator(`#diaryRoot [data-diary-day="${day}"]`);

for (const width of [390, 884, 1440]) {
  test(`그날 맥락: 사진 있는 날 접힌 한 줄(일정·회의만), 펼쳐 누르면 그 화면, 크게 보기 캡션 시각 맞춤, 사진 없는 날은 없음 ${width}`, async ({ page }) => {
    const f = await fixture(page, { width });
    await openDiary(page, width);
    const detail = page.locator('#diaryRoot [data-diary-detail]');

    // 사진 없는 날(10/13): 그날 일정이 있어도 맥락 자리를 그리지 않는다(명진 결정 ③).
    await cell(page, '2026-10-13').click();
    await expect(detail).toContainText('일기 없음');
    await expect(detail.locator('[data-diary-context-slot]')).toHaveCount(0);
    await expect(detail.locator('[data-diary-context]')).toHaveCount(0);

    // 사진 있는 날(10/12): 격자 아래 접힌 한 줄. 취소된 일정·다른 날 일정은 세지 않는다.
    await cell(page, '2026-10-12').click();
    await expect(detail.locator('[data-diary-grid] .diary-grid-item')).toHaveCount(4);
    const ctx = detail.locator('details[data-diary-context]');
    await expect(ctx.locator('summary')).toHaveText('그날 맥락 · 일정 1 · 회의 1 · 투쟁 1');
    expect(await ctx.evaluate(el => el.open)).toBe(false);
    const order = await page.evaluate(() => {
      const g = document.querySelector('#diaryRoot [data-diary-grid]').getBoundingClientRect(), c = document.querySelector('#diaryRoot [data-diary-context]').getBoundingClientRect();
      return { gridBottom: g.bottom, ctxTop: c.top, ctxRight: c.right, page: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth };
    });
    expect(order.ctxTop).toBeGreaterThanOrEqual(order.gridBottom - 1);
    expect(order.scroll).toBeLessThanOrEqual(order.page);
    // 펼치면 제목 줄(일정 먼저, 그다음 회의). 키보드로도 펼친다(네이티브 <details>).
    await ctx.locator('summary').focus();
    await page.keyboard.press('Enter');
    const lines = ctx.locator('[data-diary-context-open]');
    await expect(lines).toHaveText(['일정 10:00 시험 일정', '회의 14:00 시험 회의 3차', '투쟁 16:00 가상 총력결의대회']);
    await expect(lines.nth(2)).toHaveAttribute('aria-label', '투쟁 16:00 가상 총력결의대회 열기');
    await expect(lines.nth(2).locator('.diary-ctx-kind')).toHaveText('투쟁');
    // 업무일지와 같은 주 단위 읽기(그 주 월요일부터) 한 번. 폰은 달력 화면을 거쳐 오므로 달력의 읽기(다른 주)가 앞에 있을 수 있다.
    expect(f.eventReads.filter(t => t === new Date('2026-10-12T00:00:00+09:00').toISOString())).toHaveLength(1);
    expect(f.meetingReads.length).toBeGreaterThanOrEqual(1);

    // 크게 보기 캡션: 찍은 시각과 일정·회의 시간을 맞춘 한 줄(명진 결정 ②). 대략 시각·맞는 것 없는 사진은 비어 있다.
    await detail.locator('[data-diary-open="0"]').click();
    const caption = page.locator('#diaryRoot [data-diary-viewer-caption]');
    await expect(caption).toHaveText('14:20 시험 회의 3차 중');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#diaryRoot [data-diary-viewer-count]')).toHaveText('2 / 4');
    await expect(caption).toHaveText('10:30 시험 일정 중');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#diaryRoot [data-diary-viewer-count]')).toHaveText('3 / 4');
    await expect(caption).toHaveText('');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#diaryRoot [data-diary-viewer-count]')).toHaveText('4 / 4');
    await expect(caption).toHaveText('');
    await page.locator('#diaryRoot [data-diary-viewer-close]').click();
    await expect(page.locator('#diaryRoot [data-diary-viewer-strip]')).toHaveCount(0);

    // 펼침은 다시 그려도 유지되고, 일정 줄을 누르면 달력의 그 일정 수정 창이 이 화면 위에 열린다.
    await expect(ctx).toHaveJSProperty('open', true);
    await lines.filter({ hasText: '시험 일정' }).click();
    await expect(page.locator('#ciGoogleModal')).toBeVisible();
    await page.locator('#ciGoogleClose').click();
    await expect(page.locator('#ciGoogleModal')).toBeHidden();
    await expect(page.locator('#diaryView')).toBeVisible();
    // 회의 줄을 누르면 그 회의 창.
    await lines.filter({ hasText: '시험 회의' }).click();
    await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();

    // 보여 주기만: 회의·일정 쓰기 없음.
    expect(f.writes).toEqual([]);
    expect(f.errors).toEqual([]);
  });
}
