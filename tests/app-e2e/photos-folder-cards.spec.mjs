import { test, expect } from '@playwright/test';
import zlib from 'node:zlib';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// FOLD-넓은화면 C(S57-21, 요청함 11/06 01:18 ③ · 시안 docs/design/mockups/fold-wide-screens.html C): 사진 [폴더] 첫 화면은 폴드 펼침(600~1199px)에서
// 표지 그림 카드 4칸 — 표지 = 그 폴더 처음 사진, 꺼 둔 폴더는 흐리게(표지를 읽지 않음), 스위치는 카드 안, 마지막 칸 [+ 새 폴더].
// 카드는 공용 폴더 줄과 같은 이름표라 '폴더 누르기 한 규칙'(누르면 그 자리 펼침·접힘, 들어가지 않음) 그대로다. 펼친 폴더의 하위 폴더·처음 몇 장은 카드 줄 아래 폭 전체 줄.
// 접은 폰(600px 미만)은 줄 목록 그대로, PC(1200px~)는 왼쪽 나무 | 오른쪽 사진 그대로. 폴더·사진은 모두 가짜.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co', CDN = 'https://od-thumb.example.test';
function png(r, g, b, w = 8, h = 6) {
  const crc = buf => { let n = ~0; for (const x of buf) { let c = (n ^ x) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; n = (n >>> 8) ^ c; } return ~n >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const media = (id, parent, day) => ({ id, parent, name: id + '.jpg', day, taken_at: `${day}T03:00:00.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null });
const out = ({ parent, ...m }) => m;
// 맨 위 폴더 7개(켜짐 4 · 꺼짐 3) + '여행 사진' 아래 하위 폴더 2개. 서버가 주는 순서 그대로가 아니라 이름 가나다 순으로 보인다.
const FOLDERS = [
  { id: 'S1', name: '여행 사진', parent_id: 'T', enabled: true }, { id: 'S2', name: '가족 모임', parent_id: 'T', enabled: true }, { id: 'S3', name: '동영상', parent_id: 'T', enabled: true },
  { id: 'S4', name: '행사 기록', parent_id: 'T', enabled: true }, { id: 'S5', name: '화면 갈무리', parent_id: 'T', enabled: false }, { id: 'S6', name: '받은 그림', parent_id: 'T', enabled: false },
  { id: 'S7', name: '문서 찍은 것', parent_id: 'T', enabled: false }, { id: 'S11', name: '봄', parent_id: 'S1', enabled: true }, { id: 'S12', name: '가을', parent_id: 'S1', enabled: true },
];
const TOP = ['S2', 'S3', 'S7', 'S6', 'S1', 'S4', 'S5'];

async function fixture(page, width, height = 1000) {
  const state = { errors: [], library: [], toggles: [], folders: FOLDERS.map(f => ({ ...f })), all: [] };
  state.folders.forEach((f, fi) => { for (let i = 0; i < 2 + (fi % 3); i++) state.all.push(media(`${f.id}m${i}`, f.id, `2026-10-${String(5 + fi).padStart(2, '0')}`)); });
  state.all.push(media('T1', 'T', '2026-10-02'), media('T2', 'T', '2026-10-01'));
  const total = id => state.all.filter(m => m.parent === id).length + state.folders.filter(f => f.parent_id === id).reduce((n, f) => n + total(f.id), 0);
  page.on('pageerror', e => state.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) state.errors.push(m.text()); });
  await page.setViewportSize({ width, height });
  await openHome(page);
  await installViewPrefsServer(page);
  for (const path of ['app_diary_stars', 'app_photo_tag_items', 'app_photo_tags', 'app_folder_prefs']) await page.route(u => u.origin === SB && u.pathname === '/rest/v1/' + path, r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: png(150, 165, 140) }));
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '사진 보관' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': state.all.length }, total: state.all.length } });
    if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
    if (body.action === 'library') { state.library.push(body.folder_id || null); if (body.folder_id && body.folder_id === state.holdFolder) await state.hold; const list = body.folder_id ? state.all.filter(m => m.parent === body.folder_id) : state.all; return r.fulfill({ json: { items: list.slice(0, body.limit).map(out), next_cursor: null, indexing: false } }); }
    if (body.action === 'folders-tree') return r.fulfill({ json: { whole: true, top: { id: 'T', name: '사진 보관', count: 2, total: total('T'), enabled: true }, folders: state.folders.map(f => ({ ...f, count: state.all.filter(m => m.parent === f.id).length, total: total(f.id) })), indexing: false } });
    if (body.action === 'folder-toggle') { state.toggles.push({ id: body.folder_id, enabled: body.enabled }); const f = state.folders.find(x => x.id === body.folder_id); if (f) f.enabled = body.enabled; return r.fulfill({ json: { ok: true } }); }
    if (body.action === 'trash-list') return r.fulfill({ json: { items: [], purged: 0, truncated: false } });
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  return state;
}
const root = page => page.locator('#photosRoot');
async function openFolders(page) {
  await clickView(page, 'photos');
  await expect(page.locator('#photosView')).toBeVisible();
  await root(page).locator('[data-photos-view]').selectOption('folders');
  // 화면 모듈과 폴더 나무를 처음 읽는 시간까지 넉넉히 기다린다(바쁜 러너).
  await expect(root(page).locator('[data-photos-folder="S1"]').first()).toBeVisible({ timeout: 20000 });
}
const card = (page, id) => root(page).locator(`.photos-fx-card[data-photos-folder="${id}"]`);
const shape = page => root(page).locator('[data-photos-box="onedrive"] .ft-box-body').evaluate(body => {
  const b = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
  const cards = [...body.querySelectorAll(':scope > .photos-fx-card')].map(c => ({ id: c.dataset.photosFolder, ...b(c), off: c.classList.contains('ft-off'), open: c.classList.contains('ft-open'),
    cover: b(c.querySelector('.photos-fx-cover')), hasCover: !!c.querySelector('.photos-fx-cover > *'), sw: c.querySelector('[role="switch"]') ? { ...b(c.querySelector('[role="switch"]')), on: c.querySelector('[role="switch"]').getAttribute('aria-checked') } : null,
    more: b(c.querySelector('.nx-more')), dim: Number(getComputedStyle(c.querySelector('.ft-main')).opacity), offTag: !!c.querySelector('.ft-offtag') }));
  const add = body.querySelector(':scope > .photos-fx-newcard');
  return { box: b(body), cards, add: add ? b(add) : null, docW: document.documentElement.scrollWidth, vw: innerWidth };
});

for (const [width, height] of [[690, 1000], [750, 1000], [884, 1104], [1199, 900]]) {
  test(`폴드 펼침 ${width}: [폴더]는 표지 그림 카드 4칸 — 표지·카드 안 스위치·꺼 둔 폴더 흐리게·마지막 칸 [+ 새 폴더]`, async ({ page }) => {
    const s = await fixture(page, width, height);
    await openFolders(page);
    await expect(root(page).locator('.photos-fx-boxes.is-cards')).toHaveCount(1);
    await expect(root(page).locator('.photos-fx.is-wide')).toHaveCount(0);
    await expect(root(page).locator('[data-photos-box="onedrive"] .ft-box-body > .photos-fx-card')).toHaveCount(7);
    // 표지: 켜 둔 폴더 4개만 그 폴더 처음 사진을 읽는다(꺼 둔 폴더는 읽지 않음).
    for (const id of ['S1', 'S2', 'S3', 'S4']) await expect(card(page, id).locator('.photos-fx-cover > *')).toHaveCount(1);
    const m = await shape(page);
    expect(m.docW).toBeLessThanOrEqual(m.vw);
    expect(m.cards.map(c => c.id)).toEqual(TOP);
    // 4칸: 앞 네 장이 같은 줄, 다섯째가 다음 줄 첫 칸, 폭이 같고 상자 폭을 끝까지 쓴다.
    const [a, b, c, d, e, f, g] = m.cards;
    for (const x of [b, c, d]) expect(Math.abs(x.y - a.y)).toBeLessThanOrEqual(1);
    expect(b.x).toBeGreaterThan(a.right); expect(c.x).toBeGreaterThan(b.right); expect(d.x).toBeGreaterThan(c.right);
    expect(e.y).toBeGreaterThanOrEqual(a.bottom); expect(Math.abs(e.x - a.x)).toBeLessThanOrEqual(1);
    for (const x of m.cards) expect(Math.abs(x.w - a.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.x - (m.box.x + 8))).toBeLessThanOrEqual(2);
    expect(Math.abs(d.right - (m.box.right - 8))).toBeLessThanOrEqual(2);
    // 표지 칸은 카드 폭 전체 · 4:3.
    for (const x of m.cards) { expect(Math.abs(x.cover.w - x.w)).toBeLessThanOrEqual(2); expect(Math.abs(x.cover.h - x.cover.w * 3 / 4)).toBeLessThanOrEqual(2); }
    // 꺼 둔 폴더: 흐리게, 표지 그림 없음, 스위치 꺼짐. '끔' 글자는 없다(스위치가 상태).
    const off = m.cards.filter(x => x.off).map(x => x.id).sort();
    expect(off).toEqual(['S5', 'S6', 'S7']);
    for (const x of m.cards) {
      expect(x.hasCover, x.id).toBe(!x.off);
      expect(x.dim, x.id).toBe(x.off ? 0.45 : 1);
      expect(x.offTag, x.id).toBe(false);
      // 스위치·⋯는 카드 안.
      expect(x.sw.on, x.id).toBe(x.off ? 'false' : 'true');
      expect(x.sw.x).toBeGreaterThanOrEqual(x.x); expect(x.sw.right).toBeLessThanOrEqual(x.right); expect(x.sw.bottom).toBeLessThanOrEqual(x.bottom + 1); expect(x.sw.y).toBeGreaterThanOrEqual(x.cover.bottom - 1);
      expect(x.more.x).toBeGreaterThanOrEqual(x.x); expect(x.more.right).toBeLessThanOrEqual(x.right); expect(x.more.y).toBeGreaterThanOrEqual(x.y);
    }
    expect([...new Set(s.library.filter(Boolean))].sort()).toEqual(['S1', 'S2', 'S3', 'S4', 'T']);
    // 마지막 칸 [+ 새 폴더]: 마지막 카드 바로 다음 칸(같은 줄 오른쪽), 카드와 같은 폭.
    expect(Math.abs(m.add.y - g.y)).toBeLessThanOrEqual(1);
    expect(m.add.x).toBeGreaterThan(g.right);
    expect(Math.abs(m.add.w - a.w)).toBeLessThanOrEqual(1);
    await expect(root(page).locator('.photos-fx-newcard')).toHaveText('+ 새 폴더');
    // 점선 칸 안은 줄 목록과 같은 [+ 새 폴더] 단추 그대로이고, 칸 전체가 눌린다.
    const btn = await root(page).locator('.photos-fx-newcard > [data-photos-fx-new]').evaluate(el => { const r = el.getBoundingClientRect(), c = el.parentElement.getBoundingClientRect(); return { w: r.width / c.width, h: r.height / c.height, border: getComputedStyle(el.parentElement).borderTopStyle }; });
    expect(btn.w).toBeGreaterThan(0.95); expect(btn.h).toBeGreaterThan(0.95); expect(btn.border).toBe('dashed');

    // 폴더 누르기 한 규칙: 카드를 누르면 그 자리에서 펼침(들어가지 않음) — 하위 폴더 줄·처음 몇 장이 카드 줄 아래 폭 전체로, 카드 4칸은 그대로.
    const main = card(page, 'S1').locator('.ft-main');
    await expect(main).toHaveAttribute('aria-expanded', 'false');
    await main.click();
    await expect(main).toHaveAttribute('aria-expanded', 'true');
    await expect(root(page).locator('.ft-focus')).toHaveCount(0);
    await expect(root(page).locator('.photos-fx-boxes.is-cards')).toHaveCount(1);
    await expect(root(page).locator('[data-photos-folder="S11"]')).toBeVisible();
    await expect(root(page).locator('[data-photos-strip="o:S1"] [data-photos-inline]')).toHaveCount(2);
    const o = await shape(page);
    const kid = await root(page).locator('[data-photos-folder="S12"]').evaluate(el => { const r = el.getBoundingClientRect(); return { y: r.y, w: r.width, card: el.classList.contains('photos-fx-card') }; });
    const openCard = o.cards.find(x => x.id === 'S1');
    expect(openCard.open).toBe(true);
    expect(kid.card).toBe(false);
    expect(kid.y).toBeGreaterThanOrEqual(openCard.bottom - 1);
    expect(kid.w).toBeGreaterThan(openCard.w * 3);
    // 펼친 카드 뒤 카드들은 같은 줄에 그대로(빈 칸 없음).
    for (const x of o.cards) { const before = m.cards.find(y => y.id === x.id); expect(x.x, x.id).toBe(before.x); if (before.y === a.y || x.id === 'S1') expect(x.y, x.id).toBe(before.y); }
    expect(o.cards.find(x => x.id === 'S4').y).toBe(openCard.y);
    // 키보드: 카드에 초점 → Enter로 접힘·펼침.
    await main.focus();
    await page.keyboard.press('Enter');
    await expect(main).toHaveAttribute('aria-expanded', 'false');
    await expect(root(page).locator('[data-photos-folder="S11"]')).toHaveCount(0);
    expect((await shape(page)).cards.map(x => [x.id, x.x, x.y])).toEqual(m.cards.map(x => [x.id, x.x, x.y]));

    // 카드 안 스위치: 꺼 둔 폴더를 켜면 서버에 저장되고 카드가 또렷해지며 표지를 읽는다.
    // 표지 읽기가 스위치 저장보다 늦게 끝나도(저장이 끝나면 목록을 다시 읽어 화면을 새로 그린다) 표지는 채워진다 — 읽기를 붙잡아 그 순서를 만든다.
    let release; s.hold = new Promise(done => { release = done; }); s.holdFolder = 'S5';
    await card(page, 'S5').getByRole('switch').click();
    await expect.poll(() => s.toggles).toEqual([{ id: 'S5', enabled: true }]);
    await expect(card(page, 'S5')).not.toHaveClass(/ft-off/);
    await expect(card(page, 'S5').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(card(page, 'S5').getByRole('switch')).toBeEnabled();
    await expect.poll(() => s.library.includes('S5')).toBe(true);
    await expect(card(page, 'S5').locator('.photos-fx-cover > *')).toHaveCount(0);
    release();
    await expect(card(page, 'S5').locator('.photos-fx-cover > *')).toHaveCount(1);
    expect(s.errors).toEqual([]);
  });
}

test('접은 폰 412: [폴더]는 줄 목록 그대로(카드·표지 없음, 꺼 둔 폴더는 흐리게 + 끔)', async ({ page }) => {
  const s = await fixture(page, 412, 915);
  await openFolders(page);
  await expect(root(page).locator('.photos-fx-boxes')).toHaveCount(1);
  await expect(root(page).locator('.is-cards, .photos-fx-card, [data-photos-cover], .photos-fx-newcard')).toHaveCount(0);
  const rows = await root(page).locator('[data-photos-box="onedrive"] .ft-box-body > .ft-folder').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { id: e.dataset.photosFolder, x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), tag: e.querySelector('.ft-offtag')?.textContent || '' }; }));
  expect(rows.map(r => r.id)).toEqual(TOP);
  for (const r of rows) { expect(r.x).toBe(rows[0].x); expect(r.w).toBe(rows[0].w); expect(r.h).toBeLessThanOrEqual(48); expect(r.tag).toBe(['S5', 'S6', 'S7'].includes(r.id) ? '끔' : ''); }
  expect(rows[0].w).toBeGreaterThan(350);
  // 표지를 읽지 않는다(맨 위 폴더 사진 줄만).
  expect([...new Set(s.library.filter(Boolean))]).toEqual(['T']);
  expect(s.errors).toEqual([]);
});

for (const width of [1200, 1280]) test(`PC ${width}: [폴더]는 왼쪽 나무 | 오른쪽 사진 그대로(카드 없음)`, async ({ page }) => {
  const s = await fixture(page, width, 900);
  await openFolders(page);
  await expect(root(page).locator('.photos-fx.is-wide')).toHaveCount(1);
  await expect(root(page).locator('[data-photos-fx-tree]')).toBeVisible();
  await expect(root(page).locator('.is-cards, .photos-fx-card, [data-photos-cover], .photos-fx-newcard')).toHaveCount(0);
  const cols = await root(page).locator('.photos-fx.is-wide').evaluate(el => { const t = el.querySelector(':scope > .photos-fx-tree').getBoundingClientRect(), p = el.querySelector(':scope > .photos-fx-pane').getBoundingClientRect(); return { tree: t.right, pane: p.left, same: Math.abs(t.top - p.top) < 4 }; });
  expect(cols.pane).toBeGreaterThanOrEqual(cols.tree);
  expect(cols.same).toBe(true);
  expect(s.errors).toEqual([]);
});
