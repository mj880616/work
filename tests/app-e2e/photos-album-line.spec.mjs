import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S47-26(요청함 11/01 12:44, 명진 '시안대로'). 지어낸 서버(onedrive-photos·gdrive-photos·app_photo_tags·app_my_features), 네트워크 없음.
// 1) [+ 새 앨범] = 위쪽 둘째 줄 바로 아래 한 줄 [입력칸(엷은 글자 '새 앨범 이름')][만들기][×]. 카드·제목·'(#태그)'·'사진을 길게 눌러…' 안내 없음.
//    열면 바로 입력칸에 커서, Enter = 만들기(목록에 바로 보임), × = 닫기, 뒤로가기 = 닫기(앨범 탭 그대로).
// 2) 앨범 목록 위 두 손가락 오므리기 = 한 단계 작게(큰 칸 → 작은 그림 목록 → 한 줄 목록), 펼치기 = 한 단계 크게. [－][＋]와 같은 서버 값(view_prefs.album_view).
//    손을 뗀 직후 누르기는 앨범 열기가 아니다(공용 핀치 지킴이).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const OD = [
  { id: 'O1', name: 'a.jpg', day: '2026-10-30', taken_at: '2026-10-30T03:00:00.000Z' },
  { id: 'O2', name: 'b.jpg', day: '2026-10-02', taken_at: '2026-10-02T03:00:00.000Z' },
].map(m => ({ ...m, approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: m.taken_at, size_bytes: 100 }));

async function fixture(page, width) {
  const errors = [], posts = [];
  const tags = [{ id: 't1', name: '제주', cover_key: null }, { id: 't2', name: '가족', cover_key: null }, { id: 't3', name: '회의', cover_key: null }];
  const links = [{ tag_id: 't1', source: 'onedrive', item_key: 'O1', taken_day: '2026-10-30' }, { tag_id: 't2', source: 'onedrive', item_key: 'O2', taken_day: '2026-10-02' }];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  const server = await installViewPrefsServer(page, { photo_sources: { onedrive: true } });
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => {
      const req = r.request();
      if (req.method() === 'POST') { const row = { id: 'tag-new', name: req.postDataJSON().name, cover_key: null }; posts.push(row.name); tags.push(row); return r.fulfill({ status: 201, json: [row] }); }
      return r.fulfill({ json: tags });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tag_items', r => r.fulfill({ json: links }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_my_features', r => r.fulfill({ json: ['calls'] }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true, whole: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'library') return r.fulfill({ json: { items: body.folder_id ? [] : OD, next_cursor: null, indexing: false } });
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': OD.length }, total: OD.length } });
      if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: OD.length, total: OD.length, enabled: true }, folders: [], indexing: false, whole: true } });
      if (body.action === 'trash-list') return r.fulfill({ json: { items: [], truncated: false } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
  } });
  return { errors, posts, server };
}
async function openAlbums(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
  await root(page).locator('[data-photos-tab="albums"]').click();
  await expect(root(page).locator('[data-photos-album]')).toHaveCount(3);
}
const root = page => page.locator('#photosRoot');

for (const width of [412, 1280]) {
  test(`새 앨범: 둘째 줄 바로 아래 한 줄 [입력칸][만들기][×], Enter로 만들기·×·뒤로가기로 닫기 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await openAlbums(page, width);
    const form = root(page).locator('[data-photos-name]'), input = root(page).locator('[data-photos-name-input]');
    await root(page).locator('[data-photos-al-new]').click();
    await expect(form).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('placeholder', '새 앨범 이름');
    await expect(input).toHaveAttribute('aria-label', '새 앨범 이름');
    await expect(form.locator('[data-photos-name-ok]')).toHaveText('만들기');
    await expect(form.locator('[data-photos-name-cancel]')).toHaveText('×');
    await expect(form.locator('label')).toHaveCount(0);
    await expect(root(page)).not.toContainText('#태그');
    await expect(root(page)).not.toContainText('길게 눌러');
    // 한 줄: 세 칸의 가운데가 같은 높이, 줄 높이는 입력칸 높이 그대로(카드 테두리·제목 줄 없음), 둘째 줄 바로 아래, 화면 안.
    const shape = await form.evaluate(el => {
      const r = el.getBoundingClientRect(), tools = el.closest('#photosRoot').querySelector('[data-photos-tools]').getBoundingClientRect();
      const kids = [...el.children].map(k => k.getBoundingClientRect()), mids = kids.map(k => k.top + k.height / 2);
      const s = getComputedStyle(el), inp = el.querySelector('input').getBoundingClientRect();
      return { h: r.height, inputH: inp.height, gap: r.top - tools.bottom, spread: Math.max(...mids) - Math.min(...mids), border: s.borderTopWidth, right: r.right, vw: innerWidth,
        okH: kids[1].height, xH: kids[2].height, align: s.textAlign };
    });
    expect(shape.spread).toBeLessThanOrEqual(2);
    expect(shape.h).toBeLessThanOrEqual(shape.inputH + 1);
    expect(shape.inputH).toBeLessThanOrEqual(36.5);
    expect(shape.okH).toBeLessThanOrEqual(32.5);
    expect(shape.border).toBe('0px');
    expect(shape.gap).toBeGreaterThanOrEqual(0);
    expect(shape.gap).toBeLessThanOrEqual(8);
    expect(shape.right).toBeLessThanOrEqual(shape.vw);
    // × = 닫기.
    await form.locator('[data-photos-name-cancel]').click();
    await expect(form).toBeHidden();
    await page.waitForTimeout(300); // 닫은 겹의 기록 되돌림이 끝난 뒤
    // 뒤로가기 = 닫기(앨범 탭 그대로).
    await root(page).locator('[data-photos-al-new]').click();
    await expect(input).toBeFocused();
    await page.goBack();
    await expect(form).toBeHidden();
    await expect(page.locator('#photosView')).toBeVisible();
    await expect(root(page).locator('[data-photos-tab="albums"]')).toHaveAttribute('aria-pressed', 'true');
    // Enter = 만들기 → 목록에 바로 보임.
    await root(page).locator('[data-photos-al-new]').click();
    await page.waitForTimeout(300);
    await input.fill('여행');
    await input.press('Enter');
    await expect(form).toBeHidden();
    await expect.poll(() => f.posts).toEqual(['여행']);
    await expect(root(page).locator('[data-photos-album="tag-new"] .photos-album-name')).toHaveText('#여행');
    expect(f.errors).toEqual([]);
  });

  test(`앨범 목록 핀치: 오므리기 = 한 단계 작게, 펼치기 = 한 단계 크게, [－][＋]와 같은 서버 값 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await openAlbums(page, width);
    const list = root(page).locator('[data-photos-albums]');
    await expect(list).toHaveAttribute('data-view', 'card');
    // 목록 첫 칸 가운데를 축으로 두 손가락(좌우 from px 떨어짐)을 대고 to px로 옮긴 뒤 모두 떼고 그 자리 누르기.
    const pinch = (from, to) => list.evaluate((el, [from, to]) => {
      const first = el.querySelector('[data-photos-album]').getBoundingClientRect();
      const cx = Math.min(first.left + first.width / 2, el.getBoundingClientRect().left + 140), cy = first.top + first.height / 2;
      const at = d => [{ x: cx - d, y: cy }, { x: cx + d, y: cy }];
      const p0 = at(from), target = document.elementFromPoint(p0[0].x, p0[0].y) || el;
      const P = (t, id, primary, p) => target.dispatchEvent(new PointerEvent(t, { pointerId: id, isPrimary: primary, pointerType: 'touch', clientX: p.x, clientY: p.y, bubbles: true, cancelable: true }));
      const T = (id, p) => new Touch({ identifier: id, target, clientX: p.x, clientY: p.y });
      const TE = (t, list, changed) => target.dispatchEvent(new TouchEvent(t, { touches: list, changedTouches: changed, bubbles: true, cancelable: true }));
      P('pointerdown', 1, true, p0[0]); TE('touchstart', [T(1, p0[0])], [T(1, p0[0])]);
      P('pointerdown', 2, false, p0[1]); TE('touchstart', [T(1, p0[0]), T(2, p0[1])], [T(2, p0[1])]);
      const p1 = at(to);
      TE('touchmove', [T(1, p1[0]), T(2, p1[1])], [T(1, p1[0]), T(2, p1[1])]);
      P('pointerup', 2, false, p1[1]); TE('touchend', [T(1, p1[0])], [T(2, p1[1])]);
      P('pointerup', 1, true, p1[0]); TE('touchend', [], [T(1, p1[0])]);
      target.click();
    }, [from, to]);
    await pinch(60, 20); // 오므리기
    await expect(root(page).locator('[data-photos-albums]')).toHaveAttribute('data-view', 'thumb');
    await expect.poll(() => f.server.value?.album_view).toBe('thumb');
    await expect(root(page).locator('[data-photos-al-back]')).toHaveCount(0); // 손 뗀 누르기는 앨범 열기가 아니다
    await expect(root(page).locator('[data-photos-albums] [data-photos-album="t1"] .photos-album-meta')).toBeVisible(); // 손을 떼면 그 보기로 다시 그림
    await page.waitForTimeout(450);
    await pinch(60, 20);
    await expect(root(page).locator('[data-photos-albums]')).toHaveAttribute('data-view', 'line');
    await expect.poll(() => f.server.value?.album_view).toBe('line');
    await expect(root(page).locator('[data-photo-size="-1"]')).toBeDisabled();
    await page.waitForTimeout(450);
    await pinch(30, 80); // 펼치기
    await expect(root(page).locator('[data-photos-albums]')).toHaveAttribute('data-view', 'thumb');
    await expect.poll(() => f.server.value?.album_view).toBe('thumb');
    // [＋]도 같은 값에서 한 단계.
    await page.waitForTimeout(450);
    await root(page).locator('[data-photo-size="1"]').click();
    await expect(root(page).locator('[data-photos-albums]')).toHaveAttribute('data-view', 'card');
    await expect.poll(() => f.server.value?.album_view).toBe('card');
    await expect(root(page).locator('[data-photos-al-back]')).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });
}
