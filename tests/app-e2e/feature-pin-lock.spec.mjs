// SEC-기능PIN잠금 ②: 메뉴 › 잠금 → 스위치 켜기 → PIN 정하기(두 번) → 하루 기록 열면 숫자 판 → 맞는 PIN이면 풀림 →
// 다시 잠그기 5분(시계 흉내) → 틀린 PIN 5번이면 막힘(서버) → 끄기(PIN 확인 뒤). 잠긴 동안 하루 기록 자료를 읽지 않는지(요청 0)도 본다.
// 서버(app_lock_*)는 page.route로 흉내 낸다 — 대조·횟수는 흉내 서버가 하고 화면은 결과만 받는다(PIN 원문 저장 안 함·횟수 제한의 실제 검사는
// tests/auth-handoff/feature-pin-lock-db.test.mjs). 값은 모두 합성.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const T0 = Date.parse('2026-10-06T01:00:00Z');

function lockServer({ pin = null, features = [], relock = '5m' } = {}) {
  const s = { pin, features, relock, fail: 0, blocked: null, calls: [], diaryReads: 0 };
  const read = () => ({ has_pin: !!s.pin, features: s.features, relock: s.relock, left: s.blocked ? 0 : 5 - s.fail, blocked_until: s.blocked });
  const tryPin = p => {
    if (s.blocked) return { ok: false, left: 0, blocked_until: s.blocked };
    if (p === s.pin) { s.fail = 0; return { ok: true, left: 5, blocked_until: null }; }
    s.fail++;
    if (s.fail >= 5) { s.fail = 0; s.blocked = '2026-10-06T01:15:00Z'; return { ok: false, left: 0, blocked_until: s.blocked }; }
    return { ok: false, left: 5 - s.fail, blocked_until: null };
  };
  s.install = async page => {
    await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const body = route.request().postDataJSON() || {};
      s.calls.push(name);
      const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
      if (name === 'app_lock_read') return json(read());
      if (name === 'app_lock_setup') {
        if (s.pin) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '22023', message: 'LOCK_PIN_EXISTS' }) });
        s.pin = body.p_pin; s.features = [...new Set(body.p_features)].sort(); s.relock = body.p_relock;
        return json({ ok: true, features: s.features, relock: s.relock });
      }
      if (name === 'app_lock_check') return json(tryPin(body.p_pin));
      if (name === 'app_lock_save') {
        const r = tryPin(body.p_pin); if (!r.ok) return json(r);
        s.features = [...new Set(body.p_features)].sort(); s.relock = body.p_relock;
        return json({ ...r, features: s.features, relock: s.relock });
      }
      if (name === 'app_lock_pin_change') { const r = tryPin(body.p_pin); if (r.ok) s.pin = body.p_new_pin; return json(r); }
      return route.fulfill({ status: 404, body: '' });
    });
    // 하루 기록 자료 읽기(app_notes kind=diary)를 센다 — 잠긴 동안 0이어야 한다.
    page.on('request', req => { const u = req.url(); if (u.startsWith(SB + '/rest/v1/app_notes') && /kind=eq\.diary/.test(u)) s.diaryReads++; });
  };
  return s;
}
const go = (page, view) => page.evaluate(v => window.KPTURouter.go(v, { source: 'delegated' }), view);
const keys = async (page, digits) => { for (const d of digits) await page.locator('#lockView [data-lk-key="' + d + '"]').click(); };
const pad = page => page.locator('#lockView .lk-pad');
const current = page => page.evaluate(() => window.KPTURouter.current);

test('켜기 → PIN 정하기 → 하루 기록 잠김(자료 안 읽음) → 맞는 PIN 풀림 → 5분 뒤 다시 잠김 → 새로고침도 잠김 (폰 412)', async ({ page }) => {
  const server = lockServer();
  await openHome(page, { beforeLoad: () => server.install(page) });
  await page.setViewportSize({ width: 412, height: 860 });
  await go(page, 'lock');
  await expect(page.locator('#lockView')).toBeVisible();
  const diarySwitch = page.locator('#lockView [data-lk-feature="diary"]');
  await expect(diarySwitch).not.toBeChecked();
  // 처음 켜면 PIN 정하기(두 번 입력).
  await diarySwitch.click();
  await expect(pad(page).locator('.lk-title')).toHaveText('PIN 정하기');
  await keys(page, '1234');
  await expect(pad(page).locator('.lk-title')).toHaveText('한 번 더 입력');
  await keys(page, '1243');
  await expect(page.locator('#lockView [data-lk-msg]')).toContainText('두 번 입력한 PIN이 달라요');
  await expect(pad(page).locator('.lk-title')).toHaveText('PIN 정하기');
  await keys(page, '1234'); await keys(page, '1234');
  await expect(page.locator('#lockView .lk-list')).toBeVisible();
  await expect(diarySwitch).toBeChecked();
  expect([server.pin, server.features, server.relock]).toEqual(['1234', ['diary'], '5m']);
  // 화면이 PIN·풀림 상태를 기기 저장소에 남기지 않는 것은 저장소 검사(browser-storage-audit)가 앱 코드 전체에서 본다. 아래 새로고침 = 다시 잠김.

  // 방금 PIN을 넣었으니 풀린 채 — 잠금 화면을 떠난 뒤 5분이 지나면 잠긴다.
  await go(page, 'home');
  await page.clock.setFixedTime(new Date(T0 + 6 * 60 * 1000));
  const readsBefore = server.diaryReads;
  await go(page, 'diary');
  await expect(pad(page)).toBeVisible();
  await expect(pad(page).locator('.lk-title')).toHaveText('하루 기록 잠김');
  await expect(page.locator('#diaryView')).toBeHidden();
  expect(await current(page)).toBe('lock');
  // 틀리면 흔들림 + 남은 횟수.
  await keys(page, '0000');
  await expect(page.locator('#lockView [data-lk-msg]')).toHaveText('PIN이 맞지 않아요 · 4번 남았어요');
  await expect(page.locator('#lockView [data-lk-dots]')).toHaveClass(/lk-shake/);
  expect(server.diaryReads).toBe(readsBefore);
  await keys(page, '1234');
  await expect(page.locator('#diaryView')).toBeVisible();
  expect(await current(page)).toBe('diary');
  await expect(page).toHaveURL(/view=diary/);

  // 4분 뒤에는 그대로 열리고, 떠난 뒤 5분이 지나면 다시 잠긴다.
  await go(page, 'home');
  await page.clock.setFixedTime(new Date(T0 + 10 * 60 * 1000));
  await go(page, 'diary');
  await expect(page.locator('#diaryView')).toBeVisible();
  await go(page, 'home');
  await page.clock.setFixedTime(new Date(T0 + 16 * 60 * 1000));
  await go(page, 'diary');
  await expect(pad(page).locator('.lk-title')).toHaveText('하루 기록 잠김');

  // 풀림은 화면 메모리에만: 풀고 새로고침하면 다시 잠긴다.
  await keys(page, '1234');
  await expect(page.locator('#diaryView')).toBeVisible();
  await page.reload();
  await expect(pad(page).locator('.lk-title')).toHaveText('하루 기록 잠김', { timeout: 20000 });
  await expect(page.locator('#diaryView')).toBeHidden();
});

test('틀린 PIN 5번이면 서버가 막고, 막힌 동안 맞는 PIN도 안 됨 · PC는 키보드 숫자 (PC 1280)', async ({ page }) => {
  const server = lockServer({ pin: '1234', features: ['diary'] });
  await page.setViewportSize({ width: 1280, height: 860 });
  await openHome(page, { beforeLoad: () => server.install(page), query: '?view=diary' });
  await expect(pad(page).locator('.lk-title')).toHaveText('하루 기록 잠김', { timeout: 20000 });
  await expect(page.locator('#diaryView')).toBeHidden();
  expect(server.diaryReads).toBe(0);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.type('0000');
    await expect(page.locator('#lockView [data-lk-msg]')).toHaveText(`PIN이 맞지 않아요 · ${4 - i}번 남았어요`);
  }
  await page.keyboard.type('0000');
  await expect(page.locator('#lockView [data-lk-msg]')).toContainText('여러 번 틀려 막혔어요 · 10:15에 다시 할 수 있어요');
  await page.keyboard.type('12');
  await page.keyboard.press('Backspace');
  await expect(page.locator('#lockView [data-lk-dots]')).toHaveAttribute('aria-label', '1자리 입력');
  await page.keyboard.type('234');
  await expect(page.locator('#lockView [data-lk-msg]')).toContainText('막혔어요');
  await expect(page.locator('#diaryView')).toBeHidden();
  expect(server.calls.filter(c => c === 'app_lock_check').length).toBe(6);
  expect(server.diaryReads).toBe(0);
});

test('끄기는 PIN 확인 뒤 · 계정 메뉴 [잠금] · 홈 오늘 사진은 잠기면 "잠김" 한 줄 (PC 1280)', async ({ page }) => {
  const server = lockServer({ pin: '1234', features: ['diary', 'photos'] });
  await page.setViewportSize({ width: 1280, height: 860 });
  await openHome(page, { beforeLoad: () => server.install(page) });
  await expect(page.locator('#homeView [data-journal-photos-locked]')).toBeVisible();
  expect(server.diaryReads).toBe(0);
  await page.locator('[data-account-open]:visible').first().click();
  await page.locator('.account-panel:visible [data-lock-open]').click();
  await expect(page.locator('#lockView .lk-list')).toBeVisible();
  await expect(page.locator('#lockView [data-lk-feature="photos"]')).toBeChecked();
  await page.locator('#lockView [data-lk-feature="diary"]').click();
  await expect(pad(page).locator('.lk-title')).toHaveText('PIN 확인');
  await keys(page, '9999');
  await expect(page.locator('#lockView [data-lk-msg]')).toHaveText('PIN이 맞지 않아요 · 4번 남았어요');
  expect(server.features).toEqual(['diary', 'photos']);
  await keys(page, '1234');
  await expect(page.locator('#lockView .lk-list')).toBeVisible();
  expect(server.features).toEqual(['photos']);
  await expect(page.locator('#lockView [data-lk-feature="diary"]')).not.toBeChecked();
  // 다시 잠그기 바꾸기도 PIN 확인 뒤.
  await page.locator('#lockView [data-lk-relock="30m"]').click();
  await keys(page, '1234');
  await expect(page.locator('#lockView [data-lk-relock="30m"]')).toHaveAttribute('aria-pressed', 'true');
  expect(server.relock).toBe('30m');
  // 꺼진 하루 기록은 바로 열린다.
  await go(page, 'diary');
  await expect(page.locator('#diaryView')).toBeVisible();
});
