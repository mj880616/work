import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// NOTE-글폭(S61-21, 요청함 11/13 10:40·11:04): 노트 글 줄 기본 폭 = 한 줄 약 40자(40em), 남는 자리는 비움(왼쪽 맞춤).
// 글 오른쪽 끝 손잡이(.col-grip 모양)를 끌면 폭이 바뀌고, 두 번 누르면 40자로, 키보드 ←/→·Home.
// 폭은 서버 view_prefs.col_widths.doc.line[_f](em×10, 화면 종류별 PC·폴드 펼침 따로) — 다른 노트·새로 열기에도 같은 폭. 기기 저장 없음.
// 표·사진은 그 폭을 넘어도 된다. 폰(600px 미만)은 손잡이도 묶음도 없음(창 폭).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch: true});
const at = '2026-11-13T01:00:00Z';
const LONG = '노동조합 활동은 조합원의 생활을 지키는 일입니다. '.repeat(12);
const doc = {doc: {type: 'doc', content: [
  {type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text: LONG}]},
  {type: 'table', content: [{type: 'table_row', content: Array.from({length: 8}, (_, i) => ({type: 'table_header', content: [{type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text: `머리 칸 ${i + 1} 넓은 표`}]}]}))}]},
  {type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text: '끝 문단'}]},
]}, v: 'ed1'};
async function fixture(page, width, prefs = null) {
  await page.setViewportSize({width, height: 900});
  const server = await installViewPrefsServer(page, prefs);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const row = (id, title, raw_text, metadata = {}, extra = {}) => ({id, workspace_id: 'w', kind: 'note', title, raw_text, occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata, ...extra});
  const rows = [row('n-doc', '표 있는 노트', LONG, {}, {doc}), row('n-plain', '그냥 글', LONG, {markdown: false})];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => { const q = new URL(r.request().url()).searchParams; if (r.request().method() !== 'GET') return r.fulfill({status: 500, json: {}}); if (q.get('metadata')) return r.fulfill({json: []}); return r.fulfill({json: rows.filter(x => !q.get('id') || 'eq.' + x.id === q.get('id'))}); });
  await page.route(SB + '/rest/v1/app_record_links?**', r => new URL(r.request().url()).searchParams.has('note_id') ? r.fulfill({json: []}) : r.fallback());
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
// 첫 글 문단의 폭(px)과 그 글자 크기 대비 em.
const firstLine = d => d.locator('[data-basket-read-text] .ed-doc > p, [data-basket-read-text] .ed-doc > .ed-p').first().evaluate(el => {
  const r = el.getBoundingClientRect(), fs = parseFloat(getComputedStyle(el.closest('.ed-doc')).fontSize);
  return {w: r.width, em: r.width / fs, right: r.right};
});
const grip = d => d.locator('[data-note-read] > [data-line-grip]');

for (const width of [1280, 900]) test(`노트 보기: 글 줄은 한 줄 약 40자, 표는 넘어도 됨, 손잡이는 글 끝에 ${width}`, async ({page}) => {
  const {errors} = await fixture(page, width);
  const d = await openNote(page, 'n-doc', width);
  await expect.poll(async () => Math.round((await firstLine(d)).em)).toBe(40);
  // 표는 글 폭보다 넓을 수 있다(잘리지 않음).
  const table = await d.locator('[data-basket-read-text] table').evaluate(el => el.getBoundingClientRect().width);
  expect(table).toBeGreaterThan((await firstLine(d)).w);
  // 손잡이는 글 줄 오른쪽 끝(±2px).
  await expect(grip(d)).toBeVisible();
  const g = await grip(d).boundingBox(), line = await firstLine(d);
  expect(Math.abs(g.x + g.width / 2 - line.right)).toBeLessThan(3);
  await expect(grip(d)).toHaveAttribute('role', 'separator');
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-width-read-${width}.png`});
  expect(errors).toEqual([]);
});

test('끌면 폭이 바뀌고 서버에 화면 종류별로, 다른 노트·새로 열기에도 같은 폭, 두 번 누르면 40자 (1280)', async ({page}) => {
  const {server, errors} = await fixture(page, 1280);
  let d = await openNote(page, 'n-doc', 1280);
  await expect.poll(async () => Math.round((await firstLine(d)).em)).toBe(40);
  const before = await firstLine(d), g = await grip(d).boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + 40);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 - 75, g.y + 40, {steps: 6});
  await page.mouse.up();
  await expect.poll(async () => (await firstLine(d)).w).toBeLessThan(before.w - 60);
  await expect.poll(() => server.value?.col_widths?.doc?.line).toBe(350);
  expect(server.value?.col_widths?.doc?.line_f).toBeUndefined();
  // 키보드: → 1자 넓게, Home = 기본.
  await grip(d).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => server.value?.col_widths?.doc?.line).toBe(360);
  // 다른 노트(그냥 글)도 같은 폭: 글 칸 오른쪽 여백으로 묶는다.
  await page.evaluate(() => window.KPTURouter.back?.());
  d = await openNote(page, 'n-plain', 1280);
  await expect.poll(() => d.locator('[data-basket-read-text]').evaluate(el => { const cs = getComputedStyle(el); return Math.round((el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / parseFloat(cs.fontSize)); })).toBe(36);
  // 새로 열기(다른 PC처럼 서버 값만 남음).
  await page.reload();
  await page.waitForFunction(() => !!window.KPTURouter?.go);
  await page.evaluate(() => window.KPTURouter.go('basket'));
  const rowNext = page.locator('[data-note-row="n-doc"]').first();
  if (!(await rowNext.isVisible().catch(() => false))) { await basketKindButton(page, 'note').click(); }
  await rowNext.click();
  d = page.locator('[data-note-detail]');
  await expect.poll(async () => Math.round((await firstLine(d)).em)).toBe(36);
  // 두 번 누르기 = 기본 40자(서버 값은 지움).
  await grip(d).dblclick();
  await expect.poll(async () => Math.round((await firstLine(d)).em)).toBe(40);
  await expect.poll(() => server.value?.col_widths?.doc?.line ?? null).toBe(null);
  expect(errors).toEqual([]);
});

test('폴드 펼침(900)은 PC와 따로 기억 (900)', async ({page}) => {
  const {server} = await fixture(page, 900, {col_widths: {doc: {line: 600}}});
  const d = await openNote(page, 'n-doc', 900);
  // PC 값(60자)은 쓰지 않고 기본 40자(또는 창 폭).
  const room = await d.locator('[data-basket-read-text] .ed-doc').evaluate(el => el.clientWidth / parseFloat(getComputedStyle(el).fontSize));
  await expect.poll(async () => Math.round((await firstLine(d)).em)).toBe(Math.round(Math.min(40, room)));
  await grip(d).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => server.value?.col_widths?.doc?.line_f).toBe(Math.round(Math.min(40, Math.round(room)) - 1) * 10);
  expect(server.value?.col_widths?.doc?.line).toBe(600);
});

test('노트 고치기: 편집 칸도 같은 폭·같은 손잡이 (1280)', async ({page}) => {
  const {errors} = await fixture(page, 1280, {col_widths: {doc: {line: 300}}});
  const d = await openNote(page, 'n-doc', 1280);
  await d.locator('[data-note-more]').click();
  await page.locator('#noteDocMenu').getByRole('button', {name: /수정/}).first().click();
  const p = d.locator('.ed-input > p').first();
  await expect(p).toBeVisible();
  await expect.poll(() => p.evaluate(el => Math.round(el.getBoundingClientRect().width / parseFloat(getComputedStyle(el.closest('.ed-doc')).fontSize)))).toBe(30);
  const eg = d.locator('.ed-box > [data-line-grip]');
  await expect(eg).toBeVisible();
  const g = await eg.boundingBox(), right = await p.evaluate(el => el.getBoundingClientRect().right);
  expect(Math.abs(g.x + g.width / 2 - right)).toBeLessThan(3);
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-width-edit-1280.png`});
  // 큰 창에서 수정: 같은 폭·같은 손잡이.
  await d.locator('[data-note-big-write]').click();
  const wp = page.locator('.ed-window-body .ed-input > p').first();
  await expect(wp).toBeVisible();
  await expect.poll(() => wp.evaluate(el => Math.round(el.getBoundingClientRect().width / parseFloat(getComputedStyle(el.closest('.ed-doc')).fontSize)))).toBe(30);
  await expect(page.locator('.ed-window-body .ed-box > [data-line-grip]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('폰(412)은 손잡이 없음, 글은 창 폭 그대로', async ({page}) => {
  const {errors} = await fixture(page, 412, {col_widths: {doc: {line: 300, line_p: 300}}});
  const d = await openNote(page, 'n-doc', 412);
  await expect(grip(d)).toBeHidden();
  const {w} = await firstLine(d), room = await d.locator('[data-basket-read-text] .ed-doc').evaluate(el => el.clientWidth);
  expect(Math.abs(w - room)).toBeLessThan(2);
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-width-read-412.png`});
  expect(errors).toEqual([]);
});
