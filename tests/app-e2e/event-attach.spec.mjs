import { test, expect } from '@playwright/test';
import { openEmphasisFixture } from './helpers/calendar-task-emphasis.mjs';

// S59-15 CAL-일정첨부(요청함 11/11 11:11, 시안 docs/design/mockups/event-attach.html ①②, 설계 docs/design/event-attach.md).
// 일정 창 [메모] 아래 [사진·파일]: 사진은 작은 그림, 다른 파일은 이름 한 줄, 줄 끝 ⋯(크게 보기·열기/내려받기/이름 수정/빼기/삭제),
// [+ 붙이기]로 고른 파일은 [변경사항 저장] 뒤 창이 먼저 닫히고 뒤에서 하나씩 올라간다. 새 일정 만들기 창도 같다.
// 서버(google-calendar)는 시험 쪽 메모리 흉내(가짜 이름·1×1 그림). KPTU_SHOTS=1이면 docs/design/screens/s59-15/에 사진을 남긴다(PR 첨부용).
test.use({timezoneId: 'Asia/Seoul'});

const SHOTS = process.env.KPTU_SHOTS === '1';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({path: `docs/design/screens/s59-15/${name}.png`}); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const file = (id, name, mime) => ({drive_file_id: id, file_name: name, mime_type: mime});
const blue = {id: 'blue-0', calendarId: 'qa-cal', source: 'google', title: '파란 일정 시험 1', start: '2026-10-20', end: '2026-10-21', allDay: true, color: '#4285f4', files: []};
const meetingEvent = (files) => ({id: 'att-1', calendarId: 'qa-cal', source: 'google', title: '예시 간담회', start: '2026-10-22T05:00:00.000Z', end: '2026-10-22T07:00:00.000Z',
  allDay: false, color: '#4285f4', location: '예시 회의실', description: '준비물 확인', organizationIds: [], recurring: false, files});
const FILES = [file('ph-1', '예시 현장 1.jpg', 'image/jpeg'), file('ph-2', '예시 현장 2.png', 'image/png'), file('doc-1', '예시 안내문.pdf', 'application/pdf')];

// 일정 흉내: 읽기(events·event)·저장(update/create)·첨부(attach/detach/trash/restore/rename)·작은 그림. 받은 요청은 state.calls에.
async function calendarServer(page, events) {
  const state = {events: new Map(events.map(e => [e.id, structuredClone(e)])), calls: [], uploads: [], hold: false, waiting: [], nextId: 1};
  state.release = () => { state.hold = false; while (state.waiting.length) state.waiting.shift()(); };
  const status = {connected: true, enabled: true, calendars: [{id: 'qa-cal', summary: 'QA', backgroundColor: '#4285f4', accessRole: 'owner'}], calendar_ids: ['qa-cal']};
  await page.route(u => new URL(u).pathname === '/functions/v1/google-calendar', async route => {
    const req = route.request(), url = new URL(req.url()), action = url.searchParams.get('action') || '';
    const ok = (body, code = 200) => route.fulfill({status: code, contentType: 'application/json', body: JSON.stringify(body)});
    if (req.method() === 'GET') {
      if (action === 'events') return ok({...status, events: [...state.events.values()]});
      if (action === 'event') return ok({event: state.events.get(url.searchParams.get('eventId')), eventColors: {}});
      if (action === 'file-photo') { state.calls.push({action, fileId: url.searchParams.get('fileId'), size: url.searchParams.get('size')}); return route.fulfill({status: 200, contentType: 'image/png', body: PNG}); }
      return ok(status);
    }
    if (action === 'attach-file') {
      const raw = req.postDataBuffer()?.toString('latin1') || '';
      const field = name => raw.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1] || '';
      const name = Buffer.from(raw.match(/filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8');
      const mime = raw.match(/name="file"[^\r]*\r\nContent-Type: ([^\r]+)/)?.[1] || '';
      const call = {action, calendar_id: field('calendar_id'), event_id: field('event_id'), name, at: Date.now()};
      state.calls.push(call); state.uploads.push(call);
      if (state.hold) await new Promise(resolve => state.waiting.push(resolve));
      const ev = state.events.get(call.event_id);
      if (!ev) return ok({error: 'Google 일정을 찾을 수 없습니다.', code: 'event_not_found'}, 404);
      const f = file('up-' + state.nextId++, name, mime);
      ev.files = [...(ev.files || []), f];
      return ok({ok: true, file: f, files: ev.files});
    }
    const body = JSON.parse(req.postData() || '{}');
    state.calls.push(body);
    if (body.action === 'update-event') {
      const ev = state.events.get(body.event_id);
      Object.assign(ev, {title: body.title, description: body.memo, location: body.location});
      return ok({ok: true, event: ev});
    }
    if (body.action === 'create-event') {
      const ev = {id: 'new-ev', calendarId: body.calendar_id, source: 'google', title: body.title, start: body.start_iso || body.start_date, end: body.end_iso || body.end_date,
        allDay: !!body.all_day, color: '#4285f4', location: body.location || '', description: body.memo || '', organizationIds: [], recurring: false, files: []};
      state.events.set(ev.id, ev);
      return ok({ok: true, event: ev});
    }
    const ev = state.events.get(body.event_id);
    const drop = () => { ev.files = ev.files.filter(f => f.drive_file_id !== body.drive_file_id); };
    if (body.action === 'detach-file') { drop(); return ok({ok: true, files: ev.files}); }
    if (body.action === 'trash-file') { state.trashed = ev.files.find(f => f.drive_file_id === body.drive_file_id); drop(); return ok({ok: true, detached: true, drive: 'trashed', drive_file_id: body.drive_file_id, files: ev.files}); }
    if (body.action === 'restore-file') { ev.files = [...ev.files, state.trashed]; return ok({ok: true, restored: true, drive_file_id: body.drive_file_id, files: ev.files}); }
    if (body.action === 'rename-file') {
      const f = ev.files.find(x => x.drive_file_id === body.drive_file_id), name = body.base + f.file_name.slice(f.file_name.lastIndexOf('.'));
      f.file_name = name;
      return ok({ok: true, name, drive_file_id: f.drive_file_id, event_synced: true, files: ev.files});
    }
    return ok({error: 'Unknown action'}, 400);
  });
  return state;
}

async function openEvent(page, width, files = FILES) {
  await page.setViewportSize({width, height: width > 760 ? 900 : 915});
  const events = [blue, meetingEvent(files)];
  const fixture = await openEmphasisFixture(page, {events});
  const state = await calendarServer(page, events);
  await page.locator('#calendarGrid [data-google-event="att-1"]').first().click();
  const modal = page.locator('#ciGoogleModal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#ciGoogleSave')).toBeEnabled();
  return {...fixture, state, modal, field: page.locator('#ciGoogleFiles')};
}

for (const width of [1280, 412]) {
  test(`일정 창: [메모] 아래 사진은 작은 그림, 다른 파일은 이름 한 줄과 ⋯ (${width}px)`, async ({page}) => {
    const {field, state, external} = await openEvent(page, width);
    await expect(field).toBeVisible();
    await expect(field.locator('.ci-files-label')).toHaveText('사진·파일');
    await expect(field.locator('.ci-photo')).toHaveCount(2);
    await expect(field.locator('.ci-photo img')).toHaveCount(2); // 작은 그림(서버 file-photo small)
    await expect(field.locator('.ci-file-row')).toHaveCount(1);
    await expect(field.locator('.ci-file-name')).toHaveText('예시 안내문.pdf');
    await expect(field.locator('.gt-pick-btn')).toHaveText('붙이기');
    expect(state.calls.filter(c => c.action === 'file-photo').map(c => c.size)).toEqual(['small', 'small']);
    // [메모] 바로 아래 자리
    expect(await page.evaluate(() => document.querySelector('#ciGoogleMemo').closest('label').nextElementSibling?.id)).toBe('ciGoogleFiles');
    // 폰 412에서도 가로로 넘치지 않는다.
    expect(await page.evaluate(() => { const c = document.querySelector('#ciGoogleModal .modal-card'); return c.scrollWidth <= c.clientWidth + 1; })).toBe(true);
    await field.locator('.ci-file-row summary').click();
    await expect(field.locator('.ci-file-row .row-more-menu button')).toHaveText(['열기', '내려받기', '이름 수정', '빼기', '삭제']);
    await shot(page, `window-${width}`);
    expect(external).toEqual([]);
  });
}

test('붙이기: [변경사항 저장]을 누르면 창이 먼저 닫히고 뒤에서 하나씩 올린 뒤 다시 열면 보인다', async ({page}) => {
  const {field, state, modal, external} = await openEvent(page, 412);
  await field.locator('[data-gt-pick-input]').setInputFiles([
    {name: '현장 사진.jpg', mimeType: 'image/jpeg', buffer: PNG},
    {name: '참고 자료.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test')}
  ]);
  await expect(field.locator('.gt-pick-list li')).toHaveCount(2);
  state.hold = true;
  await page.locator('#ciGoogleSave').click();
  await expect(modal).toBeHidden(); // 올리기를 기다리지 않고 닫힌다
  await expect.poll(() => state.uploads.length).toBe(1); // 한 번에 하나씩
  await expect(page.locator('.up-dock')).toBeVisible();
  await shot(page, 'sending-412');
  state.release();
  await expect.poll(() => state.uploads.length).toBe(2);
  expect(state.uploads.map(c => [c.calendar_id, c.event_id, c.name])).toEqual([['qa-cal', 'att-1', '현장 사진.jpg'], ['qa-cal', 'att-1', '참고 자료.pdf']]);
  expect(state.calls.findIndex(c => c.action === 'update-event')).toBeLessThan(state.calls.findIndex(c => c.action === 'attach-file'));
  await expect(page.locator('.up-dock-text')).toContainText('일정에 사진 1장·파일 1개 올렸어요');
  await page.locator('#calendarGrid [data-google-event="att-1"]').first().click();
  await expect(modal).toBeVisible();
  await expect(field.locator('.ci-photo')).toHaveCount(3);
  await expect(field.locator('.ci-file-name')).toHaveText(['예시 안내문.pdf', '참고 자료.pdf']);
  await expect(field.locator('.gt-pick-list li')).toHaveCount(0);
  expect(external).toEqual([]);
});

test('⋯ 빼기·삭제(되돌리기)·이름 수정은 서버 한 곳(google-calendar)으로', async ({page}) => {
  const {field, state, external} = await openEvent(page, 1280);
  // 빼기: 일정에서만(Drive에 남음)
  await field.locator('.ci-file-row summary').click();
  await field.locator('.ci-file-row .row-more-menu button', {hasText: '빼기'}).click();
  await expect(field.locator('.ci-file-row')).toHaveCount(0);
  expect(state.calls.find(c => c.action === 'detach-file')).toEqual({action: 'detach-file', calendar_id: 'qa-cal', event_id: 'att-1', drive_file_id: 'doc-1'});
  // 삭제: 한 번 묻고 → trash-file → [되돌리기]
  await field.locator('.ci-photo').nth(1).locator('summary').click();
  await field.locator('.ci-photo').nth(1).locator('.row-more-menu button', {hasText: '삭제'}).click();
  await page.locator('.kptu-ask-actions button.danger').click();
  await expect(field.locator('.ci-photo')).toHaveCount(1);
  expect(state.calls.find(c => c.action === 'trash-file')?.drive_file_id).toBe('ph-2');
  await page.getByRole('button', {name: '되돌리기'}).click();
  await expect(field.locator('.ci-photo')).toHaveCount(2);
  expect(state.calls.find(c => c.action === 'restore-file')?.drive_file_id).toBe('ph-2');
  // 이름 수정: 확장자는 따로, 서버가 붙인다
  await field.locator('.ci-photo').first().locator('summary').click();
  await field.locator('.ci-photo').first().locator('.row-more-menu button', {hasText: '이름 수정'}).click();
  const input = field.locator('.fr-input');
  await expect(input).toBeVisible();
  await expect(field.locator('[data-fr-ai]')).toBeHidden();
  await input.fill('새 현장 사진');
  await input.press('Enter');
  await expect.poll(() => state.calls.find(c => c.action === 'rename-file')).toEqual({action: 'rename-file', calendar_id: 'qa-cal', event_id: 'att-1', drive_file_id: 'ph-1', base: '새 현장 사진'});
  await expect(field.locator('.ci-photo-open').first()).toHaveAttribute('aria-label', '사진 크게 보기: 새 현장 사진.jpg');
  expect(external).toEqual([]);
});

test('사진을 누르면 크게 보기(서버 large)', async ({page}) => {
  const {field, state} = await openEvent(page, 1280);
  await field.locator('.ci-photo-open').first().click();
  await expect(page.locator('.basket-photo-stage img').first()).toBeVisible();
  await expect.poll(() => state.calls.some(c => c.action === 'file-photo' && c.fileId === 'ph-1' && c.size === 'large')).toBe(true);
});

test('옛 서버(일정에 files 칸 없음)면 칸을 두지 않는다', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  const old = {...meetingEvent([])}; delete old.files;
  const oldBlue = {...blue}; delete oldBlue.files;
  await openEmphasisFixture(page, {events: [oldBlue, old]});
  await page.locator('#calendarGrid [data-google-event="att-1"]').first().click();
  await expect(page.locator('#ciGoogleSave')).toBeEnabled();
  await expect(page.locator('#ciGoogleFiles')).toBeHidden();
});

test('새 일정 만들기 창도 같은 고르기 칸 — 만든 뒤 그 일정에 뒤에서 올린다', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  const events = [blue, meetingEvent([])];
  await openEmphasisFixture(page, {events});
  const state = await calendarServer(page, events);
  await page.locator('#newEventBtn').click();
  const modal = page.locator('#eventModal');
  await expect(modal).toBeVisible();
  const pick = page.locator('#eventTaskFiles');
  await expect(pick).toBeVisible();
  await page.locator('#eventTitle').fill('예시 새 일정');
  await pick.locator('[data-gt-pick-input]').setInputFiles({name: '미리 붙일 그림.png', mimeType: 'image/png', buffer: PNG});
  await expect(pick.locator('.gt-pick-list li')).toHaveCount(1);
  await pick.evaluate(el => { let box = el.parentElement; while (box && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement; if (box) box.scrollTop = box.scrollHeight; });
  await shot(page, 'new-event-1280');
  await page.locator('#saveEventBtn').click();
  await expect(modal).toBeHidden();
  await expect.poll(() => state.uploads.map(c => [c.event_id, c.name])).toEqual([['new-ev', '미리 붙일 그림.png']]);
  expect(state.calls.findIndex(c => c.action === 'create-event')).toBeLessThan(state.calls.findIndex(c => c.action === 'attach-file'));
});
