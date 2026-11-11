import {test, expect} from '@playwright/test';
import {makeState, openReportCalendar, SB} from './helpers/report-calendar-plan-server.mjs';

// S59-13 BIZ-보고할일정 PR D(요청 ⑤, 설계 docs/design/biz-report-plan-link.md 10절, 시안 docs/design/mockups/biz-report-plan-link.html ④).
// 사업 보고 달력 [보고 쓰기] → 쓰기 창을 열면 그 일정 시각의 사진이 미리 골라져 있다(시작 30분 전 ~ 3시간 뒤). 고르기만 한다:
// 칸을 누르면 빼기·더하기, 서버에는 아무것도 가지 않는다. [저장]을 누르면 창이 먼저 닫히고, 그때 고른 사진만 파일로 만들어
// 새 사업 보고의 공용 한 묶음 올리기 길(library-upload.js sendForMeeting → meeting-send.mjs)로 뒤에서 올라간다. 못 올리면 [다시 올리기].
// 서버·사진은 모두 흉내(가짜 이름·1×1 그림). KPTU_SHOTS=1이면 docs/design/screens/s59-13/에 사진을 남긴다(PR 첨부용).
test.use({timezoneId: 'Asia/Seoul'});

const SHOTS = process.env.KPTU_SHOTS === '1';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({path: `docs/design/screens/s59-13/${name}.png`}); };
const CDN = 'https://od-media.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.2';
const KEY = 'PhoneKeyForTest_0123456789';
// 일정 '가짜 지부 간담회' = 11. 11. 10:00(서울) = 01:00Z. 미리 고르는 범위 09:30~13:00, 줄에 보이는 범위 07:00~13:00(+ 그 장소).
// d = 08:00(보이지만 골라 두지 않음) · a = 09:50 · b = 10:40 · c = 11:30(골라 둠) · e = 다음 날(안 보임)
const SHOTS_AT = {d: '2026-11-10T23:00:00Z', a: '2026-11-11T00:50:00Z', b: '2026-11-11T01:40:00Z', c: '2026-11-11T02:30:00Z', e: '2026-11-12T01:00:00Z'};
const OD_DAYS = {
  '2026-11-11': ['d', 'a', 'b', 'c'].map(k => ({id: 'od-' + k, name: `od_${k}.jpg`, taken_at: SHOTS_AT[k], approx: false})),
  '2026-11-12': [{id: 'od-e', name: 'od_e.jpg', taken_at: SHOTS_AT.e, approx: false}]
};
const PHONE = ['d', 'a', 'b', 'c', 'e'].map((k, i) => ({id: String(i + 1), name: `IMG_${k}.jpg`, day: SHOTS_AT[k].slice(0, 10), taken_at: SHOTS_AT[k], size_bytes: 10 + i,
  approx: false, kind: 'photo', width: 10, height: 10, duration_ms: null, screenshot: false, uploaded_at: SHOTS_AT[k]}));

// 사진 출처(원드라이브 또는 폰 앱)·원본 받기·올리기(library-files POST) 흉내. 받은 요청은 state.photo에 남긴다.
function photoRoutes(state, {onedrive = true, phone = false} = {}) {
  state.photo = {od: [], media: [], phoneReads: [], uploads: [], hold: false, waiting: [], failNames: new Set(), badMedia: new Set()};
  const p = state.photo;
  p.release = () => { p.hold = false; while (p.waiting.length) p.waiting.shift()(); };
  return async page => {
    if (phone) await page.addInitScript(key => {
      const listeners = [], prev = window.KPTUAppShell;
      window.KPTUAppShell = {
        postMessage(m) {
          if (m === 'photos:hello' || m === 'photos:ask') setTimeout(() => listeners.forEach(fn => fn({data: `photos:state:{"access":"full","key":"${key}","trash":true,"hide":true}`})), 0);
          prev?.postMessage?.(m);
        },
        addEventListener(type, fn) { if (type === 'message') listeners.push(fn); prev?.addEventListener?.(type, fn); }
      };
    }, KEY);
    await page.route(u => u.origin === CDN, r => {
      const id = new URL(r.request().url()).pathname.split('/').pop().replace(/\.png$/, '');
      if (/\/orig\//.test(r.request().url())) p.media.push(id);
      if (p.badMedia.has(id)) return r.fulfill({status: 500, body: ''});
      return r.fulfill({status: 200, contentType: 'image/png', headers: {'access-control-allow-origin': '*'}, body: PNG});
    });
    await page.route('**/__phone/**', r => {
      const u = new URL(r.request().url());
      p.phoneReads.push(u.pathname.replace(/^.*__phone\//, '') + u.search);
      if (!u.pathname.includes(`/__phone/${KEY}/`)) return r.fulfill({status: 404, body: ''});
      if (u.pathname.endsWith('/page')) {
        const before = Number(u.searchParams.get('before')) || Infinity;
        const list = PHONE.filter(m => Date.parse(m.taken_at) < before).sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at));
        return r.fulfill({json: {items: list, next: null, total: list.length}});
      }
      if (u.pathname.includes('/media/')) p.media.push('phone-' + u.pathname.split('/').pop());
      if (u.pathname.includes('/thumb/') || u.pathname.includes('/media/')) return r.fulfill({status: 200, contentType: 'image/png', body: PNG});
      return r.fulfill({status: 404, body: ''});
    });
    await page.route(`${SB}/functions/v1/onedrive-photos`, async r => {
      const body = r.request().postDataJSON();
      p.od.push(body.action);
      const ok = data => r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data)});
      if (!onedrive) return ok({configured: false, connected: false});
      if (body.action === 'status') return ok({configured: true, connected: true, folder: {name: '카메라'}, whole: true, can_delete: true});
      if (body.action === 'photos') return ok({days: body.month === '2026-11' ? OD_DAYS : {}});
      if (body.action === 'photo-urls') return ok({urls: Object.fromEntries(body.ids.filter(id => body.size === 'small' || !p.badMedia.has(id)).map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {}});
      if (body.action === 'media-url') return ok({url: `${CDN}/orig/${body.id}.png`, kind: 'photo', name: body.id, expires_in: 3000});
      return r.fulfill({status: 400, contentType: 'application/json', body: JSON.stringify({error: 'action_invalid'})});
    });
    await page.route(`${SB}/functions/v1/library-files**`, async r => {
      const req = r.request();
      if (req.method() !== 'POST') return r.fulfill({status: 200, contentType: 'image/png', body: PNG});
      const raw = (req.postDataBuffer() || Buffer.alloc(0)).toString('utf8'), name = raw.match(/filename="([^"]+)"/)?.[1] || '';
      p.uploads.push({name, meeting: raw.match(/name="meeting_id"\r\n\r\n([^\r]+)/)?.[1] || ''});
      if (p.hold) await new Promise(resolve => p.waiting.push(resolve));
      if (p.failNames.has(name)) return r.fulfill({status: 500, contentType: 'application/json', body: JSON.stringify({message: '가짜 올리기 실패'})});
      const doc = {id: 'doc-' + p.uploads.length, workspace_id: 'rc-ws', file_id: 'drive-' + p.uploads.length, file_name: name, title: name, mime_type: 'image/png', category: '사진', tags: [], meeting_id: p.uploads.at(-1).meeting, created_at: new Date().toISOString()};
      return r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({ok: true, document: doc})});
    });
  };
}

const watch = page => { const errors = []; page.on('pageerror', e => errors.push(e.message)); return errors; };
const line = page => page.locator('#meetingTimePhotos');
const tiles = page => line(page).locator('[data-tp-item]');
const pressed = page => tiles(page).evaluateAll(els => els.map(e => e.getAttribute('aria-pressed') === 'true'));
const dock = page => page.locator('#uploadDock:not([hidden])');
const dayRow = (cal, id) => cal.locator(`.rv-day-list [data-rv-plan="${id}"]`);
const reloadAsks = page => page.evaluate(() => { const detail = {otherDraft: false}; window.dispatchEvent(new CustomEvent('kptu:before-reload', {detail})); return detail.otherDraft; });

// 달력 그날 목록 '가짜 지부 간담회' [보고 쓰기] → [회의] 칸 → 쓰기 창.
async function writeFromPlan(page, cal) {
  await dayRow(cal, 'ev-todo').locator('[data-rv-plan-write]').click();
  await page.locator('#reportKindSheet [data-sheet-value="meeting"]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingTitle')).toHaveValue('가짜 지부 간담회');
  await expect(page.locator('#meetingAt')).toHaveValue('2026-11-11T10:00');
}

test('1280 [보고 쓰기]: 그 시각 사진이 미리 골라져 있고(서버에는 아무것도 안 감), 빼기·더하기 → [저장] = 창 먼저 닫고 고른 사진만 뒤에서 올림', async ({page}) => {
  const errors = watch(page), state = makeState();
  const cal = await openReportCalendar(page, state, {routes: photoRoutes(state)});
  await writeFromPlan(page, cal);
  const head = line(page).locator('[data-tp-head]');
  await expect(head).toHaveText('그 시각 사진 4장 중 3장 선택됨');
  await expect(tiles(page)).toHaveCount(4); // 다음 날 사진(e)은 없다
  expect(await pressed(page)).toEqual([false, true, true, true]); // 08:00 사진은 보이지만 골라 두지 않는다(일정 30분 전보다 앞)
  await expect(line(page)).toHaveClass(/(^| )tp-preset( |$)/);
  await expect(line(page).locator('[data-tp-note]')).toHaveText('누르면 빼기·더하기 · 저장하면 붙어요');
  // 미리 골라 둔 줄에는 [선택해 붙이기]·[닫기]·[붙이기]가 없다(고르기만 — 붙이기는 [저장]).
  for (const s of ['[data-tp-open]', '[data-tp-close]', '[data-tp-attach]']) await expect(line(page).locator(s)).toBeHidden();
  await line(page).scrollIntoViewIfNeeded();
  await shot(page, 'preset-1280');
  // 골라 두기만 했다: 원본을 받지도, 올리지도 않는다. 창을 연 것만으로는 '쓰던 글'이 아니다(닫을 때 묻지 않음 — #2406 규칙 그대로).
  expect(state.photo.media).toEqual([]);
  expect(state.photo.uploads).toEqual([]);
  expect(await reloadAsks(page)).toBe(false);
  // 빼기(10:40 b) · 더하기(08:00 d)
  await tiles(page).nth(2).click();
  await expect(head).toHaveText('그 시각 사진 4장 중 2장 선택됨');
  await tiles(page).nth(0).click();
  await expect(head).toHaveText('그 시각 사진 4장 중 3장 선택됨');
  expect(await pressed(page)).toEqual([true, true, false, true]);
  await expect(tiles(page).nth(2)).toHaveCSS('opacity', '0.45'); // 뺀 칸은 흐리게
  expect(state.photo.uploads).toEqual([]);
  // [저장]: 글 저장이 끝나면 창이 먼저 닫히고, 그때 고른 사진만 받아 같은 한 묶음 올리기 길로 하나씩.
  await page.locator('#meetingTranscript').fill('가짜 결과 내용');
  state.photo.hold = true;
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  expect(state.reportPosts).toHaveLength(1);
  expect(state.reportPosts[0]).toMatchObject({series_name: '가짜 지부 간담회', google_event_id: 'ev-todo'});
  await expect.poll(() => state.photo.uploads.length).toBe(1); // 첫 장이 서버에 붙잡혀 있는 동안 창은 이미 닫혔다
  await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 3개 올리는 중');
  expect(await reloadAsks(page)).toBe(true);
  await shot(page, 'sending-1280');
  state.photo.release();
  await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 3장 올렸어요');
  const meetingId = state.meetings.at(-1).id;
  expect(state.photo.uploads.map(u => u.name)).toEqual(['od_d.jpg', 'od_a.jpg', 'od_c.jpg']);
  expect(state.photo.uploads.every(u => u.meeting === meetingId)).toBe(true);
  expect([...state.photo.media].sort()).toEqual(['od-a', 'od-c', 'od-d']); // 뺀 사진(b)은 받지도 않는다
  expect(await reloadAsks(page)).toBe(false);
  expect(errors).toEqual([]);
});

test('1280 못 올린 사진(올리기 실패·사진 읽기 실패)은 아래 한 줄 [다시 올리기]로 그 사진만 다시', async ({page}) => {
  const errors = watch(page), state = makeState();
  const cal = await openReportCalendar(page, state, {routes: photoRoutes(state)});
  await writeFromPlan(page, cal);
  await expect(line(page).locator('[data-tp-head]')).toHaveText('그 시각 사진 4장 중 3장 선택됨');
  state.photo.failNames.add('od_c.jpg'); // 올리기 실패
  state.photo.badMedia.add('od-b');      // 원본도 큰 그림도 못 받음 → 사진 읽기 실패
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  // 읽은 두 장(a·c)은 한 묶음으로 올라가고(c는 서버가 거절), 읽지 못한 b는 올리지 않는다.
  await expect.poll(() => state.photo.uploads.map(u => u.name).sort()).toEqual(['od_a.jpg', 'od_c.jpg']);
  // 읽지 못한 사진: 그 한 줄에 [다시 올리기](올리는 줄이 끝나면 먼저 보인다)
  const readFail = dock(page);
  await expect(readFail.locator('.up-dock-text')).toHaveText('사진 1장 못 올렸어요');
  await expect(readFail.locator('.up-dock-note')).toHaveText('사진을 읽지 못했어요. 폰·원드라이브 연결을 확인한 뒤 다시 올려 주세요.');
  await shot(page, 'fail-1280');
  state.photo.badMedia.clear();
  await readFail.locator('button', {hasText: '다시 올리기'}).click();
  await expect.poll(() => state.photo.uploads.map(u => u.name).sort()).toEqual(['od_a.jpg', 'od_b.jpg', 'od_c.jpg']);
  // 올리기 실패(c): 공용 묶음 끝 알림의 [다시 올리기](못 올린 파일만)
  await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 1장 못 올렸어요');
  await expect(dock(page).locator('.up-dock-note')).toContainText('사진 1장 올렸어요');
  state.photo.failNames.clear();
  await dock(page).locator('button', {hasText: '다시 올리기'}).click();
  await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 1장 올렸어요');
  expect(state.photo.uploads.map(u => u.name).filter(n => n === 'od_c.jpg')).toHaveLength(2);
  expect(state.photo.uploads.map(u => u.name).filter(n => n !== 'od_c.jpg').sort()).toEqual(['od_a.jpg', 'od_b.jpg']); // 올라간 것은 다시 보내지 않는다
  expect(errors).toEqual([]);
});

test('1280 다 빼고 [저장] = 사진 없이 저장(아무것도 받거나 올리지 않음), 일정 없이 연 쓰기 창은 지금처럼 [선택해 붙이기]', async ({page}) => {
  const errors = watch(page), state = makeState();
  const cal = await openReportCalendar(page, state, {routes: photoRoutes(state)});
  await writeFromPlan(page, cal);
  await expect(line(page).locator('[data-tp-head]')).toHaveText('그 시각 사진 4장 중 3장 선택됨');
  for (const n of [1, 2, 3]) await tiles(page).nth(n).click();
  await expect(line(page).locator('[data-tp-head]')).toHaveText('그 시각 사진 4장');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  await page.waitForTimeout(500);
  expect(state.photo.media).toEqual([]);
  expect(state.photo.uploads).toEqual([]);
  await expect(dock(page)).toHaveCount(0);
  // [+]로 연 새 보고(일정 없음): 미리 골라 두지 않는다 — 줄은 접힌 '그 시각 사진 [선택해 붙이기]' 그대로.
  await page.locator('#newMeetingBtn').click();
  const sheet = page.locator('#reportKindSheet');
  if (await sheet.isVisible()) await sheet.locator('[data-sheet-value="meeting"]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(line(page).locator('[data-tp-open]')).toBeVisible();
  await expect(line(page).locator('[data-tp-open]')).toHaveText('선택해 붙이기');
  await expect(line(page).locator('[data-tp-pick]')).toBeHidden();
  await expect(line(page)).not.toHaveClass(/(^| )tp-preset( |$)/);
  expect(errors).toEqual([]);
});

test.describe('폰 앱 412', () => {
  test.use({userAgent: ANDROID, hasTouch: true, isMobile: true});
  test('[보고 쓰기]: 폰 사진이 미리 골라져 있고, 하나 빼고 [저장] → 창 먼저 닫히고 나머지만 올라감', async ({page}) => {
    const errors = watch(page), state = makeState();
    const cal = await openReportCalendar(page, state, {width: 412, height: 915, routes: photoRoutes(state, {onedrive: false, phone: true})});
    await writeFromPlan(page, cal);
    await expect(line(page).locator('[data-tp-head]')).toHaveText('그 시각 사진 4장 중 3장 선택됨');
    expect(await pressed(page)).toEqual([false, true, true, true]);
    await line(page).scrollIntoViewIfNeeded();
    await shot(page, 'preset-412');
    expect(state.photo.media).toEqual([]); // 고르기만 — 원본은 아직 읽지 않는다
    await tiles(page).nth(3).tap(); // 11:30 c 빼기
    await expect(line(page).locator('[data-tp-head]')).toHaveText('그 시각 사진 4장 중 2장 선택됨');
    const box = await line(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(412);
    state.photo.hold = true;
    await page.locator('#saveMeetingBtn').click();
    await expect(page.locator('#meetingModal')).toBeHidden();
    // 폰 앱: 앱이 묶음을 받지 않으면(옛 앱 흉내) 지금 길로 화면이 올린다.
    await expect.poll(() => state.photo.uploads.length, {timeout: 10000}).toBe(1);
    await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 2개 올리는 중');
    await shot(page, 'sending-412');
    state.photo.release();
    await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 2장 올렸어요');
    expect(state.photo.uploads.map(u => u.name)).toEqual(['IMG_a.jpg', 'IMG_b.jpg']);
    expect(state.photo.media.sort()).toEqual(['phone-2', 'phone-3']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
});
