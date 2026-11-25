// NOTE-달력보기(S67-42, 요청함 11/20 "노트도 달력보기 추가"): 노트 보기 탭 '폴더 · 목록 · 포스트잇 · 태그 · 댓글 · 달력'.
// 달력은 사업 관리 [달력]과 같은 부품(rv-* 칸): 만든 날 칸에 그날 노트 수, 오늘 표시, 달 넘기기·[오늘], 날짜(칸)를 누르면 아래에 그날 노트 줄.
// 잠긴 폴더 노트는 줄이 '잠김'(내용·제목 안 보임), 누르면 그 자리 숫자 판 → 맞는 PIN이면 보임. [달력]은 서버 칸 note_view에 쓰지 않는다.
// 서버는 page.route로 흉내 낸다. 이름·날짜는 지어낸 것(오늘 기준으로 만든다). 화면 사진: KPTU_SHOTS=1 이면 docs/design/screens/s67-42/.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import {screenFind} from './helpers/screen-find.mjs';

test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const SHOTS = process.env.KPTU_SHOTS ? 'docs/design/screens/s67-42/' : '';
const shot = (page, name) => SHOTS ? page.screenshot({ path: `${SHOTS}${name}.png` }) : null;
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OPEN = U(1), LOCK = U(2);

// 오늘 = openHome의 고정 시각(2026-10-06 10:00 KST). 지난달 = 9월 15일. 정오 UTC 03시 = 서울 낮 12시라 날짜가 흔들리지 않는다.
const TODAY = '2026-10-06', PREV = '2026-09-15';
const at = key => `${key}T03:00:00Z`;

function server() {
  const s = { calls: [], viewWrites: [] };
  const folders = [
    { id: OPEN, workspace_id: 'w', parent_id: null, name: '회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: LOCK, workspace_id: 'w', parent_id: null, name: '비밀', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' },
  ];
  // 만든 날(created_at)이 기준 — 고친 날(updated_at)은 일부러 다른 날로 둔다.
  const row = (id, title, created, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문 글', occurred_at: at(created), created_at: at(created), updated_at: at(PREV), archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const notes = [
    row('n1', '오늘 회의 노트', TODAY, { folder_id: OPEN }),
    row('n2', '감춘 노트', TODAY, { folder_id: LOCK }),
    row('n3', '지난달 노트', PREV),
  ];
  s.install = async page => {
    await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const body = route.request().postDataJSON() || {};
      s.calls.push(name);
      const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
      if (name === 'app_lock_read') return json({ has_pin: true, features: [], relock: '5m', left: 5, blocked_until: null });
      if (name === 'app_lock_note_folders') return json({ folders: [LOCK], covered: [LOCK], top_names: ['비밀'] });
      if (name === 'app_lock_check') return json(body.p_pin === '1234' ? { ok: true, left: 5, blocked_until: null } : { ok: false, left: 4, blocked_until: null });
      return route.fulfill({ status: 404, body: '' });
    });
  };
  s.installNotes = async page => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(notes) }) : r.fulfill({ status: 500, json: {} }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
    await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
    page.on('request', req => { if (req.method() === 'PATCH' && req.url().includes('/rest/v1/app_profiles')) s.viewWrites.push(req.postData() || ''); });
  };
  return s;
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const cal = page => page.locator('#noteRows [data-nt-cal]');
const dayList = page => page.locator('#noteRows [data-nt-cal-list]');
const title = (page, id) => page.locator(`#noteRows [data-nt-cal-list] [data-note-row="${id}"] .basket-title-text`);

for (const width of [412, 884, 1440]) test(`[달력] 보기: 탭 노출·만든 날 칸 수·날짜 누르면 그날 노트·잠긴 노트 가려짐·달 넘기기 (${width})`, async ({ page }) => {
  const s = server(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: width < 761 ? 915 : 900 });
  await openHome(page, { beforeLoad: () => s.install(page) });
  await s.installNotes(page);
  await page.evaluate(() => window.KPTURouter.go('basket', { source: 'delegated' }));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');

  // 보기 탭: 폴더 · 목록 · 보드 · 태그 · 메모(S69-94, 옛 댓글) · 달력(맨 끝), 한 줄 안에 들어간다.
  const tabs = page.locator('.nv-switch [data-note-view]');
  await expect(tabs).toHaveText(['폴더', '목록', '보드', '태그', '메모', '달력']);
  const sw = await page.locator('.nv-switch').boundingBox();
  expect(sw.x).toBeGreaterThanOrEqual(0); expect(sw.x + sw.width).toBeLessThanOrEqual(width);
  const tab = page.locator('.nv-switch [data-note-view="calendar"]');
  await press(page, tab, width);
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  await expect(cal(page)).toBeVisible();
  await expect(page.locator('[data-nx-tree]')).toBeHidden();

  // 이 달: 오늘 칸에 2(만든 날 기준 — 고친 날은 지난달), 오늘 표시, 처음 고른 날 = 오늘.
  const todayCell = page.locator(`#noteRows [data-nt-cal-cell="${TODAY}"]`);
  await expect(todayCell).toHaveClass(/ds-today/);
  await expect(todayCell.locator('.nt-cal-count')).toHaveText('2');
  await expect(page.locator('#noteRows .nt-cal-count')).toHaveCount(1);
  await expect(dayList(page)).toHaveAttribute('data-nt-cal-list', TODAY);
  await expect(dayList(page).locator('[data-note-row]')).toHaveCount(2);
  await expect(title(page, 'n1')).toHaveText('오늘 회의 노트');
  await expect(dayList(page).locator('[data-nx-note="n1"] .nx-path')).toHaveText('회의');
  // 잠긴 폴더 노트: 제목·내용 대신 '잠김'(폴더 꼬리표만).
  await expect(title(page, 'n2')).toHaveText('잠김');
  await expect(dayList(page)).not.toContainText('감춘 노트');
  // 칸은 콤팩트: 폰 날짜 칸 높이 56px 그대로, 달력이 화면 폭을 넘지 않는다.
  const box = await cal(page).boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect((await todayCell.boundingBox()).height).toBeLessThanOrEqual(58);
  await shot(page, `calendar-${width}`);

  // 지난달로: 15일 칸에 1, 날짜를 누르면 그날 노트. 다음 달(이 달)로 돌아오면 고른 날은 오늘.
  await press(page, page.locator('#noteRows [data-nt-cal-nav="prev"]'), width);
  await expect(page.locator(`#noteRows [data-nt-cal-cell="${PREV}"] .nt-cal-count`)).toHaveText('1');
  await press(page, page.locator(`#noteRows [data-nt-cal-day="${PREV}"]`), width);
  await expect(dayList(page)).toHaveAttribute('data-nt-cal-list', PREV);
  await expect(title(page, 'n3')).toHaveText('지난달 노트');
  await expect(page.locator(`#noteRows [data-nt-cal-day="${PREV}"]`)).toHaveAttribute('aria-pressed', 'true');
  // 빈 날(지난달 1일)은 칸 아무 곳이나 눌러도 고른다 → '이날 쓴 노트 없음'.
  const empty = PREV.slice(0, 8) + '01';
  await press(page, page.locator(`#noteRows [data-nt-cal-cell="${empty}"]`), width);
  await expect(dayList(page)).toHaveAttribute('data-nt-cal-list', empty);
  await expect(dayList(page)).toContainText('이날 쓴 노트 없음');
  await press(page, page.locator('#noteRows [data-nt-cal-nav="next"]'), width);
  await expect(dayList(page)).toHaveAttribute('data-nt-cal-list', TODAY);
  await press(page, page.locator('#noteRows [data-nt-cal-nav="next"]'), width);
  await expect(page.locator('#noteRows .nt-cal-count')).toHaveCount(0);
  await press(page, page.locator('#noteRows [data-nt-cal-nav="today"]'), width);
  await expect(dayList(page)).toHaveAttribute('data-nt-cal-list', TODAY);

  // 찾기: 맞는 노트만 센다.
  await (await screenFind(page)).fill('회의');
  await expect(todayCell.locator('.nt-cal-count')).toHaveText('1');
  await (await screenFind(page)).fill('');
  await expect(todayCell.locator('.nt-cal-count')).toHaveText('2');

  // 잠긴 노트를 누르면 그 자리 숫자 판 → 맞는 PIN이면 제목이 보인다(잠금 규칙 그대로).
  await press(page, page.locator('#noteRows [data-nt-cal-list] [data-note-row="n2"]'), width);
  for (const d of '1234') await page.locator(`dialog.lk-here [data-lk-key="${d}"]`).click();
  await expect(title(page, 'n2')).toHaveText('감춘 노트');
  expect(s.calls.filter(c => c === 'app_lock_check').length).toBe(1);

  // [달력]은 서버 기억 칸(note_view)에 쓰지 않는다.
  expect(s.viewWrites.filter(b => b.includes('calendar'))).toEqual([]);
  expect(errors).toEqual([]);
});

// 폰: 좌우로 밀어 보기 이동 — [메모]에서 왼쪽으로 밀면 [달력].
test('[달력] 폰 밀기: 메모 → 달력 → 메모 (412)', async ({ page }) => {
  const s = server();
  await page.setViewportSize({ width: 412, height: 915 });
  await openHome(page, { beforeLoad: () => s.install(page) });
  await s.installNotes(page);
  await page.evaluate(() => window.KPTURouter.go('basket', { source: 'delegated' }));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  await page.locator('.nv-switch [data-note-view="comment"]').tap();
  // 손가락 밀기는 다른 화면 시험(calendar-month-view)과 같이 touches 값을 붙인 사건으로 낸다.
  const swipe = dx => page.locator('[data-nx-body]').evaluate((el, dx) => {
    const r = el.getBoundingClientRect(), x = 206, y = r.top + 60;
    const fire = (type, cx, key) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, key, { value: [{ clientX: cx, clientY: y }] }); if (key === 'changedTouches') Object.defineProperty(e, 'touches', { value: [] }); el.dispatchEvent(e); };
    fire('touchstart', x, 'touches'); fire('touchend', x + dx, 'changedTouches');
  }, dx);
  await swipe(-120);
  await expect(page.locator('.nv-switch [data-note-view="calendar"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(cal(page)).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-10-06T01:00:05Z')); // 밀기 뒤 잠깐(400ms) 다시 밀기를 막는 시계를 넘긴다(시험 시계는 멈춰 있다).
  await swipe(120);
  await expect(page.locator('.nv-switch [data-note-view="comment"]')).toHaveAttribute('aria-pressed', 'true');
});
