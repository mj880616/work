import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// NOTE-내용확대축소(S61-16 ③, 요청함 11/12 14:34): 노트 보기 머리 줄 [−] 100% [+] — 노트 글과 HTML 첨부 내용만 커지고 작아진다.
// 머리 줄·목록·메뉴(화면 틀)는 그대로. HTML은 칸막이 안 문서에 배율을 넣어 다시 그림(sandbox allow-scripts·CSP 맨 앞 그대로).
// 배율은 서버 view_prefs.note_zoom 하나(모든 기기·모든 노트 같음, 기기 저장 없음). DB 적용 전(400)이면 이번 접속만.
// [크게 보기] 안에서도 같은 단추·같은 배율. PC는 노트 칸 위에서만 Ctrl+휠·Ctrl+(+ − 0).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch: true});
const HTML = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>정리</title><style>body{margin:0;font:16px sans-serif}.card{height:400px;border:2px solid #2a6;padding:8px}</style></head>
<body><div class="card" id="card">GPT 카드</div></body></html>`;
const at = '2026-11-12T01:00:00Z';
async function fixture(page, width, prefs = null, opts = {}) {
  await page.setViewportSize({width, height: 900});
  const server = await installViewPrefsServer(page, prefs, opts);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const row = (id, title, raw_text, attachments) => ({id, workspace_id: 'w', kind: 'note', title, raw_text, occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments, metadata: {}});
  const rows = [
    row('n-both', '글과 HTML', '첫 줄 글입니다\n\n둘째 줄', [{drive_file_id: 'h1', file_name: 'a.html', mime_type: 'text/html', size_bytes: 300}]),
    row('n-text', '글만', '다른 노트 글', []),
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => { const q = new URL(r.request().url()).searchParams; if (r.request().method() !== 'GET') return r.fulfill({status: 500, json: {}}); if (q.get('metadata')) return r.fulfill({json: []}); return r.fulfill({json: rows.filter(x => !q.get('id') || 'eq.' + x.id === q.get('id'))}); });
  await page.route(SB + '/rest/v1/app_record_links?**', r => new URL(r.request().url()).searchParams.has('note_id') ? r.fulfill({json: []}) : r.fallback());
  await page.route(SB + '/functions/v1/document-actions', r => r.fulfill({json: {ok: true, file_name: 'a.html', html: HTML}}));
  await page.evaluate(() => window.KPTURouter.go('basket'));
  return {server, errors};
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
async function openNote(page, id, width) {
  await openKindMenu(page, 'note'); await press(page, basketKindButton(page, 'note'), width);
  await press(page, page.locator(`[data-note-row="${id}"]`).first(), width);
  const d = page.locator('[data-note-detail]');
  await expect(d.locator('[data-basket-read-text]')).toBeVisible();
  return d;
}
const head = d => d.locator('[data-note-head-main] [data-note-zoom]');
const textZoom = d => d.locator('[data-basket-read-text]').evaluate(el => getComputedStyle(el).zoom);
const frame = d => d.locator('[data-basket-html-view="h1"] iframe.html-frame-view');
const frameZoom = async d => { const s = await frame(d).getAttribute('srcdoc'); return /<style>html\{zoom:([0-9.]+)\}<\/style>/.exec(s)?.[1] || '1'; };
const frameSafe = async d => {
  await expect(frame(d)).toHaveAttribute('sandbox', 'allow-scripts');
  expect(await frame(d).getAttribute('srcdoc')).toMatch(/^<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
};

for (const width of [1280, 412]) test(`[+]·[−]·숫자: 노트 글과 HTML 내용만 바뀌고 머리 줄·메뉴는 그대로, 서버에 한 값 ${width}`, async ({page}) => {
  const {server, errors} = await fixture(page, width, {note_zoom: 110});
  const d = await openNote(page, 'n-both', width);
  const z = head(d);
  // NOTE-배율자리(S61-45): 폰 폭은 글 크기 아이콘을 눌러 펼친 뒤 묶음이 보인다.
  if (width < 600) await press(page, d.locator('[data-note-zoom-toggle]'), width);
  await expect(z.locator('[data-note-zoom-reset]')).toHaveText('110%');
  expect(await textZoom(d)).toBe('1.1');
  await expect(frame(d)).toHaveCount(1);
  expect(await frameZoom(d)).toBe('1.1');
  await frameSafe(d);
  const more = d.locator('[data-note-more]'), moreBox = await more.boundingBox();
  const h0 = await frame(d).evaluate(el => el.getBoundingClientRect().height);
  await press(page, z.locator('[data-note-zoom-in]'), width);
  await expect(z.locator('[data-note-zoom-reset]')).toHaveText('125%');
  expect(await textZoom(d)).toBe('1.25');
  await expect.poll(() => frameZoom(d)).toBe('1.25');
  await frameSafe(d);
  await expect(page.frameLocator('[data-basket-html-view="h1"] iframe').locator('#card')).toContainText('GPT 카드');
  // 칸막이 높이도 새 배율로(안 문서가 보낸 높이).
  await expect.poll(() => frame(d).evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(h0 + 20);
  // 화면 틀은 그대로: ⋯ 단추 크기·머리 줄 글자 크기.
  const moreAfter = await more.boundingBox();
  expect(Math.abs(moreAfter.height - moreBox.height)).toBeLessThan(1);
  expect(await d.locator('[data-note-head-main]').evaluate(el => getComputedStyle(el).zoom)).toBe('1');
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-zoom-125-${width}.png`});
  await press(page, z.locator('[data-note-zoom-in]'), width);
  await expect(z.locator('[data-note-zoom-reset]')).toHaveText('150%');
  await expect(z.locator('[data-note-zoom-in]')).toBeDisabled();
  await expect.poll(() => server.value?.note_zoom).toBe(150);
  // 가운데 숫자 = 100%: 서버 값은 지운다(기본), 칸막이 문서에 배율 없음.
  await press(page, z.locator('[data-note-zoom-reset]'), width);
  await expect(z.locator('[data-note-zoom-reset]')).toHaveText('100%');
  expect(await textZoom(d)).toBe('1');
  await expect.poll(() => frameZoom(d)).toBe('1');
  await expect.poll(() => server.value?.note_zoom ?? null).toBe(null);
  for (let i = 0; i < 2; i++) await press(page, z.locator('[data-note-zoom-out]'), width);
  await expect(z.locator('[data-note-zoom-reset]')).toHaveText('80%');
  await expect(z.locator('[data-note-zoom-out]')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('다른 기기(새로 열기)·다른 노트도 같은 배율 (1280)', async ({page}) => {
  const {server} = await fixture(page, 1280);
  let d = await openNote(page, 'n-both', 1280);
  await head(d).locator('[data-note-zoom-in]').click();
  await expect.poll(() => server.value?.note_zoom).toBe(110);
  await page.evaluate(() => window.KPTURouter.back?.());
  await page.reload();
  await page.waitForFunction(() => !!window.KPTURouter?.go);
  await page.evaluate(() => window.KPTURouter.go('basket'));
  // 새로 연 화면은 마지막 보기(노트 목록)로 돌아온다.
  const rowNext = page.locator('[data-note-row="n-text"]').first();
  if (!(await rowNext.isVisible().catch(() => false))) { await expect(basketKindButton(page, 'note')).toBeVisible(); await basketKindButton(page, 'note').click(); }
  await rowNext.click();
  d = page.locator('[data-note-detail]');
  await expect(d.locator('[data-basket-read-text]')).toBeVisible();
  await expect(head(d).locator('[data-note-zoom-reset]')).toHaveText('110%');
  expect(await textZoom(d)).toBe('1.1');
});

test('[크게 보기] 안에서도 같은 단추·같은 배율, 작은 보기에서는 칸 머리 줄에 두 번 보이지 않음 (1280)', async ({page}) => {
  const {errors} = await fixture(page, 1280, {note_zoom: 90});
  const d = await openNote(page, 'n-both', 1280);
  const box = d.locator('[data-basket-html-view="h1"] .html-frame');
  await expect(box.locator('.html-frame-zoom')).toBeHidden();
  await box.getByRole('button', {name: '크게 보기'}).click();
  await expect(box).toHaveClass(/html-frame-full/);
  const inBig = box.locator('.html-frame-zoom');
  await expect(inBig).toBeVisible();
  await expect(inBig.locator('[data-note-zoom-reset]')).toHaveText('90%');
  await inBig.locator('[data-note-zoom-in]').click();
  await expect(inBig.locator('[data-note-zoom-reset]')).toHaveText('100%');
  await expect.poll(() => frameZoom(d)).toBe('1');
  await inBig.locator('[data-note-zoom-in]').click();
  await expect.poll(() => frameZoom(d)).toBe('1.1');
  await frameSafe(d);
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-zoom-big-1280.png`});
  await page.keyboard.press('Escape');
  await expect(box).not.toHaveClass(/html-frame-full/);
  await expect(head(d).locator('[data-note-zoom-reset]')).toHaveText('110%');
  expect(errors).toEqual([]);
});

test('PC: 노트 칸 위 Ctrl+휠·Ctrl+(+ − 0)은 이 배율만 바꾼다 (1280)', async ({page}) => {
  await fixture(page, 1280);
  const d = await openNote(page, 'n-both', 1280);
  const text = d.locator('[data-basket-read-text]');
  const b = await text.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 10);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await expect(head(d).locator('[data-note-zoom-reset]')).toHaveText('110%');
  await text.focus();
  await page.keyboard.press('Control+Equal');
  await expect(head(d).locator('[data-note-zoom-reset]')).toHaveText('125%');
  await page.keyboard.press('Control+Minus');
  await expect(head(d).locator('[data-note-zoom-reset]')).toHaveText('110%');
  await page.keyboard.press('Control+Digit0');
  await expect(head(d).locator('[data-note-zoom-reset]')).toHaveText('100%');
  // 브라우저 확대는 그대로(화면 전체 배율 1).
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
});

test('DB 적용 전(서버가 note_zoom을 거절)에도 이번 접속은 고른 배율 그대로, 알림 없음 (1280)', async ({page}) => {
  const {server, errors} = await fixture(page, 1280, null, {denyKeys: ['note_zoom']});
  const d = await openNote(page, 'n-both', 1280);
  await head(d).locator('[data-note-zoom-in]').click();
  await expect(head(d).locator('[data-note-zoom-reset]')).toHaveText('110%');
  await page.waitForTimeout(1200); // 0.4초 모아 보내기 + 거절 답
  await expect(head(d).locator('[data-note-zoom-reset]')).toHaveText('110%');
  expect(await textZoom(d)).toBe('1.1');
  expect(server.value?.note_zoom).toBeUndefined();
  await expect(page.locator('#toast')).not.toContainText('저장');
  expect(errors).toEqual([]);
});

// NOTE-배율자리(S61-45, 시안 B, 명진 선택 11/14): 폰 폭 머리 줄은 글 크기 아이콘 한 칸 — 제목이 줄 폭 대부분을 쓴다.
// 누르면 아래로 [−] 100% [+]가 펼쳐지고, 다시 누르기·바깥 누르기면 접힌다. 폴드 펼침·PC는 묶음 그대로(아이콘 없음).
test('폰 412: 아이콘 한 칸, 누르면 펼침·배율 저장, 다시 누르기·바깥 누르기로 접힘', async ({page}) => {
  const {server, errors} = await fixture(page, 412);
  const d = await openNote(page, 'n-both', 412);
  const toggle = d.locator('[data-note-zoom-toggle]'), z = head(d);
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(z).toBeHidden();
  const title = d.locator('[data-note-read-title]'), main = d.locator('[data-note-head-main]');
  await expect(title).toBeVisible();
  const tw = (await title.boundingBox()).width, mw = (await main.boundingBox()).width;
  // 제목 옆에는 아이콘 세 칸(글 크기·복사·⋯)만 — 그 밖의 폭은 모두 제목 몫.
  const icons = await main.locator(':scope > button:visible, :scope > .nz-fold > button:visible').evaluateAll(els => els.reduce((s, el) => s + el.getBoundingClientRect().width, 0));
  expect(mw - tw - icons).toBeLessThan(16);
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-zoom-phone-412-closed.png`});
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(z).toBeVisible();
  // 세 단추 모두 펼친 칸 안에 온전히 보인다(좁은 아이콘 칸에 잘리지 않음).
  const pb = await z.boundingBox();
  for (const k of ['out', 'reset', 'in']) { const b = await z.locator(`[data-note-zoom-${k}]`).boundingBox(); expect(b.x).toBeGreaterThanOrEqual(pb.x - 0.5); expect(b.x + b.width).toBeLessThanOrEqual(pb.x + pb.width + 0.5); }
  // 펼쳐도 제목 폭은 그대로(머리 줄 아래로 뜬다).
  expect(Math.abs((await title.boundingBox()).width - tw)).toBeLessThan(1);
  await z.locator('[data-note-zoom-in]').tap();
  await expect(z.locator('[data-note-zoom-reset]')).toHaveText('110%');
  expect(await textZoom(d)).toBe('1.1');
  await expect.poll(() => server.value?.note_zoom).toBe(110);
  await expect(z).toBeVisible();
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-zoom-phone-412-open.png`});
  await toggle.tap();
  await expect(z).toBeHidden();
  await toggle.tap();
  await expect(z).toBeVisible();
  await d.locator('[data-basket-read-text]').tap();
  await expect(z).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // 키보드: Enter로 펼치고 Esc로 접으면 아이콘으로 돌아온다.
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(z).toBeVisible();
  await z.locator('[data-note-zoom-out]').focus(); await page.keyboard.press('Escape');
  await expect(z).toBeHidden();
  await expect(toggle).toBeFocused();
  expect(errors).toEqual([]);
});

for (const width of [700, 1280]) test(`폴드 펼침·PC ${width}: 아이콘 없이 묶음 그대로`, async ({page}) => {
  await fixture(page, width);
  const d = await openNote(page, 'n-both', width);
  await expect(d.locator('[data-note-zoom-toggle]')).toBeHidden();
  await expect(head(d)).toBeVisible();
  await expect(head(d).locator('[data-note-zoom-reset]')).toHaveText('100%');
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-zoom-${width < 1000 ? 'fold' : 'pc'}-${width}.png`});
});
