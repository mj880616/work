// S71-38 SEC-잠금위로: 앱 전체 잠금 '앱 닫을 때'에서 입력 창·메뉴·고르기 창을 연 채 다른 앱에 갔다 오면(화면 숨김 → 보임)
// 잠금 화면이 그 모든 겹 위를 덮어야 한다 — 아래 글자는 보이지도(화면 어느 점을 짚어도 잠금 화면), 읽히지도(접근성 나무에 없음),
// 눌리지도·초점이 가지도 않고(Tab이 잠금 안에서만 돈다), PIN 단추는 그대로 눌린다. 풀면 창·쓰던 글은 그대로(A1, docs/design/standard-interactions.md 13절).
// 고치기 전: 창(z-index 50, 잠금 화면 뒤에 있는 겹)이 잠금 화면 위에 그대로 보이고 PIN 단추를 가렸다(`#meetingModal ... intercepts pointer events`).
// 서버(app_lock_*)는 page.route로 흉내 낸다. 값은 모두 합성.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const WORDS = '쓰던 글 S71-38';

function lockServer({ pin = '1234', features = [], relock = 'close' } = {}) {
  const s = { pin, features, relock };
  s.install = page => page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
    if (name === 'app_lock_read') return json({ has_pin: true, features: s.features, relock: s.relock, left: 5, blocked_until: null });
    if (name === 'app_lock_note_folders') return json({ folders: [], covered: [], top_names: [] });
    if (name === 'app_lock_check') return json(body.p_pin === s.pin ? { ok: true, left: 5, blocked_until: null } : { ok: false, left: 4, blocked_until: null });
    return route.fulfill({ status: 404, body: '' });
  });
  return s;
}
const current = page => page.evaluate(() => window.KPTURouter.current);
const setVisible = (page, visible) => page.evaluate(v => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}, visible ? 'visible' : 'hidden');
// 맞는 PIN을 보통 누르기로 넣는다(가린 겹이 있으면 Playwright가 '…intercepts pointer events'로 실패한다).
const keys = async (page, digits) => { for (const d of digits) await page.locator('#lockView [data-lk-key="' + d + '"]').click({ timeout: 3000 }); };

// 앱을 열고 앱 전체 잠금('앱 닫을 때' 또는 기능 잠금)을 켠 뒤 한 번 풀어 둔다.
async function openUnlocked(page, server) {
  const want = server.features;
  server.features = [];
  await openHome(page, { beforeLoad: () => server.install(page) });
  server.features = want;
  await page.evaluate(() => window.KPTUFeatureLock.refresh());
  if (want.includes('app')) {
    await expect(page.locator('#lockView .lk-pad .lk-title')).toHaveText('앱 잠김');
    await keys(page, '1234');
    await expect(page.locator('#homeView')).toBeVisible();
  }
}
const addMenu = async (page, kind) => {
  await page.locator('#appView>.app-topline [data-quick-add]').evaluate(b => b.click());
  if (kind) await page.locator(`#toplineAddMenu [data-topline-add="${kind}"]`).evaluate(b => b.click());
};

// 잠긴 동안: 화면 아홉 점 어디를 짚어도 잠금 화면, 가린 글자·창 제목은 접근성 나무에 없음, Tab은 잠금 안에서만.
async function expectCovered(page, hiddenText) {
  expect(await current(page)).toBe('lock');
  await expect(page.locator('#lockView .lk-pad .lk-title')).toBeVisible();
  const leaks = await page.evaluate(() => {
    const out = [];
    for (const fx of [0.05, 0.5, 0.95]) for (const fy of [0.05, 0.5, 0.95]) {
      const x = Math.round(innerWidth * fx), y = Math.round(innerHeight * fy);
      const el = document.elementFromPoint(x, y);
      if (!el?.closest('#lockView')) out.push(`${x},${y} ${el?.tagName || '-'}#${el?.id || ''}.${String(el?.className || '').slice(0, 40)}`);
    }
    return out;
  });
  expect(leaks, '잠금 화면 밖이 보이는 점').toEqual([]);
  // 화면 읽기가 읽는 나무(브라우저 접근성 나무, 무시된 것 빼고): 가린 글자·창 제목이 없어야 한다. 잠금 판 글자는 있어야 한다.
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  await cdp.detach();
  const read = nodes.filter(n => !n.ignored).flatMap(n => [n.name?.value, n.value?.value]).filter(v => typeof v === 'string' && v).join('\n');
  expect(read).toContain('PIN 4자리');
  for (const text of hiddenText) expect(read, `가린 글자 '${text}'가 읽히면 안 된다`).not.toContain(text);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#lockView')), 'Tab 초점은 잠금 안에서만').toBe(true);
  }
}

// 여러 겹: 창(div.modal)·쓰기 창·창 위 고르기 창(브라우저 맨 위 겹 dialog)·⋯ 메뉴(popover).
const CASES = [
  { name: '사업 보고 창', open: async page => {
      await addMenu(page, 'report');
      await page.locator('#reportKindSheet [data-sheet-value="meeting"]').click();
      await expect(page.locator('#meetingModal')).toBeVisible();
      await page.locator('#meetingTranscript').fill(WORDS);
      await page.locator('#meetingTranscript').evaluate(el => { el.dataset.s71Mark = '1'; });
      await page.locator('#meetingTranscript').focus();
    },
    hidden: [WORDS, '회의명'],
    after: async page => {
      await expect(page.locator('#meetingModal')).toBeVisible();
      await expect(page.locator('#meetingTranscript[data-s71-mark="1"]')).toHaveValue(WORDS);
    } },
  { name: '일정 창', open: async page => {
      await addMenu(page, 'event');
      await expect(page.locator('#eventModal')).toBeVisible();
      await page.locator('#eventTitle').fill(WORDS);
    },
    hidden: [WORDS],
    after: async page => { await expect(page.locator('#eventModal')).toBeVisible(); await expect(page.locator('#eventTitle')).toHaveValue(WORDS); } },
  { name: '업데이트 쓰기 창', open: async page => {
      await addMenu(page, 'update');
      const body = page.locator('#edWindow .ed-window-body .ProseMirror').first();
      await expect(body).toBeVisible();
      await body.click(); await page.keyboard.type(WORDS);
    },
    hidden: [WORDS],
    after: async page => { await expect(page.locator('#edWindow .ed-window-body .ProseMirror').first()).toContainText(WORDS); } },
  { name: '고르기 창(맨 위 겹)', open: async page => {
      await addMenu(page, 'report');
      await expect(page.locator('#reportKindSheet')).toBeVisible();
    },
    hidden: [],
    after: async page => { await expect(page.locator('#reportKindSheet')).toBeVisible(); } },
  { name: '[+ 추가] 메뉴', open: async page => {
      await addMenu(page, null);
      await expect(page.locator('#toplineAddMenu')).toBeVisible();
    },
    hidden: [],
    after: async () => {} },
];

for (const [label, size] of [['폰 390', { width: 390, height: 844 }], ['PC 1280', { width: 1280, height: 860 }]]) {
  for (const c of CASES) test(`S71-38 ${label} ${c.name}을 연 채 다른 앱에 갔다 오면 잠금 화면이 맨 위(아래 안 보임·안 읽힘·초점 갇힘), PIN 눌림, 풀면 그대로`, async ({ page }) => {
    await page.setViewportSize(size);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const server = lockServer({ features: ['app'], relock: 'close' });
    await openUnlocked(page, server);
    await c.open(page);
    const view = await current(page);
    await setVisible(page, false);
    await setVisible(page, true);
    await expectCovered(page, c.hidden);
    await keys(page, '1234');
    await expect.poll(() => current(page)).toBe(view);
    await c.after(page);
    // 풀린 뒤에는 잠금 겹이 남지 않는다(아래 창을 그대로 누를 수 있음).
    await expect(page.locator('#lockView')).toBeHidden();
    expect(await page.evaluate(() => document.querySelectorAll('dialog:modal').length === document.querySelectorAll('dialog:modal:not(#lockView *)').length)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('S71-38 PC 1280 사업 보고: 잠긴 동안 친 숫자는 가린 칸에 들어가지 않고 PIN으로, 풀면 초점이 쓰던 칸으로 돌아온다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const server = lockServer({ features: ['app'], relock: 'close' });
  await openUnlocked(page, server);
  await CASES[0].open(page);
  await setVisible(page, false);
  await setVisible(page, true);
  await expect(page.locator('#lockView .lk-pad .lk-title')).toHaveText('앱 잠김');
  // Esc(폰 뒤로 가기와 같은 닫기 요청)를 거듭 눌러도 잠금 겹은 닫히지 않고, 아래 창도 닫히지 않는다.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
  await expectCovered(page, [WORDS]);
  await page.keyboard.type('1234');
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingTranscript')).toHaveValue(WORDS);
  await expect(page.locator('#meetingTranscript')).toBeFocused();
});

test('S71-38 폰 390 기능 잠금(하루 기록, 앱 닫을 때): 하루 기록 위에 메뉴를 연 채 갔다 오면 잠금 화면이 맨 위, [✕]도 눌림', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const server = lockServer({ features: ['diary'], relock: 'close' });
  await openUnlocked(page, server);
  await page.evaluate(() => window.KPTUFeatureLock.openHere());
  await page.evaluate(() => window.KPTURouter.go('diary', { source: 'delegated' }));
  await expect(page.locator('#diaryView')).toBeVisible();
  await addMenu(page, null);
  await expect(page.locator('#toplineAddMenu')).toBeVisible();
  await setVisible(page, false);
  await setVisible(page, true);
  await expect(page.locator('#lockView .lk-pad .lk-title')).toHaveText('하루 기록 잠김');
  await expectCovered(page, []);
  await page.locator('#lockView [data-lk-close]').click({ timeout: 3000 });
  await expect.poll(() => current(page)).not.toBe('lock');
  await expect(page.locator('#lockView')).toBeHidden();
});
