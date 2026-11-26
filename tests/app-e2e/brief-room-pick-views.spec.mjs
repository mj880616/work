// S67-41(명진 11/20 18:10 "자료를 눌러도 눌러지지도않음", "폴더도 보여야할 것같고 먼가 찾기쉽게"): 브리핑 룸 [자료실에서 선택] 고르기 창.
// 찾기 칸 + [최근]·[폴더] 두 보기, 줄마다 형식 꼬리표(PDF·HWP·사진)·이름 한 줄·올린 날짜, 숫자뿐인 사진 이름은 '사진 · 날짜',
// 이미 넣은 자료는 '이미 있음', 여러 개 고르기와 [넣기 n개]. 폰 412는 아래에서 올라오는 판, PC는 단추 아래 창. 자료 이름은 모두 예시.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { openBriefLibPick } from './helpers/brief-head.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const D = n => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const F = n => `f0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const lib = [
  { id: D(1), title: '예시 인력 운영 계획', file_name: '예시 계획.pdf', mime_type: 'application/pdf', created_at: '2026-10-06T00:50:00Z' },
  { id: D(2), title: '예시 연구 용역 최종 보고서', file_name: '예시 보고서.hwp', created_at: '2026-10-05T00:00:00Z' },
  { id: D(3), title: '20261004_093015.jpg', file_name: '20261004_093015.jpg', mime_type: 'image/jpeg', created_at: '2026-10-04T00:00:00Z' },
  { id: D(4), title: '예시 임금 교섭 자료', file_name: '예시 교섭.hwpx', created_at: '2026-10-03T00:00:00Z' },
];
const folders = [
  { id: F(1), name: '브리핑 요청함', parent_id: null, sort_order: 1, created_at: '2026-10-01T00:00:00Z' },
  { id: F(2), name: '예시 교섭', parent_id: null, sort_order: 2, created_at: '2026-10-01T00:00:00Z' },
  { id: F(3), name: '예시 임금', parent_id: F(2), sort_order: 1, created_at: '2026-10-01T00:00:00Z' },
];

async function open(page) {
  const posted = [];
  const items = new Map([[D(1), F(1)], [D(4), F(3)]]);
  await openHome(page, {
    query: '?view=brief',
    beforeLoad: async () => {
      await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: [] }));
      await page.route(SB + '/rest/v1/app_library_folders**', r => {
        const u = new URL(r.request().url());
        if (r.request().method() !== 'GET') return r.fulfill({ json: [] });
        if ((u.searchParams.get('name') || '').startsWith('eq.')) return r.fulfill({ json: [{ id: F(1), sort_order: 1 }] });
        return r.fulfill({ json: folders });
      });
      await page.route(SB + '/rest/v1/app_library_folder_items**', r => {
        const req = r.request(), u = new URL(req.url());
        if (req.method() === 'POST') { const body = [req.postDataJSON()].flat(); posted.push(...body); for (const b of body) items.set(b.document_id, b.folder_id); return r.fulfill({ status: 201, body: '' }); }
        const inList = u.searchParams.get('document_id');
        if (inList?.startsWith('in.(')) { const ids = inList.slice(4, -1).split(','); return r.fulfill({ json: ids.filter(id => items.has(id)).map(id => ({ document_id: id, folder_id: items.get(id) })) }); }
        const folder = (u.searchParams.get('folder_id') || '').replace('eq.', '');
        return r.fulfill({ json: [...items].filter(([, f]) => !folder || f === folder).map(([document_id, folder_id]) => ({ document_id, folder_id })) });
      });
      await page.route(SB + '/rest/v1/app_documents?**', r => {
        if (r.request().method() !== 'GET') return r.fallback();
        const want = new URL(r.request().url()).searchParams.get('id');
        const rows = want?.startsWith('in.(') ? lib.filter(d => want.slice(4, -1).split(',').includes(d.id)) : lib;
        return r.fulfill({ json: rows.map(d => ({ workspace_id: 'w', category: '기타', visibility: 'private', ...d })) });
      });
    },
  });
  return { posted };
}

for (const [label, width, height] of [['phone-412', 412, 915], ['pc-1280', 1280, 900]]) {
  test(`브리핑 룸 자료실 고르기: [최근]·[폴더], 꼬리표·날짜, 여러 개 넣기 (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const { posted } = await open(page);
    const opener = await openBriefLibPick(page); // S71-30: 머리 [+] → [자료실에서 선택]
    const picker = page.locator('#brLibPicker');
    await expect(picker).toBeVisible();
    // 자리: 폰은 아래 판(하단바 위), PC는 단추 바로 아래.
    const [box, btn] = [await picker.boundingBox(), await opener.boundingBox()];
    if (width <= 760) {
      await expect(picker).toHaveClass(/lu-move-sheet/);
      const tab = await page.locator('.mobile-bottom-nav, #mobileTabs, nav.mobile-tabs').first().boundingBox().catch(() => null);
      expect(box.y + box.height).toBeLessThanOrEqual((tab ? tab.y : height) + 1);
      expect(box.width).toBeGreaterThan(width - 40);
    } else {
      expect(box.y).toBeGreaterThanOrEqual(btn.y + btn.height - 1);
      expect(box.width).toBeLessThanOrEqual(341);
    }
    const tabs = picker.locator('.lu-move-tabs .ds-seg-btn');
    await expect(tabs).toHaveText(['최근', '폴더']);
    await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true');
    const row = n => picker.locator(`[data-lu-move-folder="${D(n)}"]`);
    await expect(row(1).locator('.lu-move-kind')).toHaveText('PDF');
    await expect(row(2).locator('.lu-move-kind')).toHaveText('HWP');
    await expect(row(3).locator('.lu-move-kind')).toHaveText('사진');
    await expect(row(3).locator('.lu-move-name')).toHaveText('사진 · 10/4');
    await expect(row(2).locator('.lu-move-meta')).toHaveText('10/5');
    await expect(row(1)).toContainText('이미 있음');
    await expect(row(1)).toHaveAttribute('aria-disabled', 'true');
    // 이름은 한 줄(줄바꿈 없이 말줄임).
    expect(await row(2).locator('.lu-move-name').evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
    await row(2).click();
    await page.screenshot({ path: `docs/design/screens/s67-41/${label}-pick-recent.png` });
    // [폴더]: 맨 위 폴더 → 들어가서 하위 폴더 → 그 안 자료를 고른다(고른 것은 보기를 바꿔도 남음).
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(picker.locator('.lu-move-sec')).toHaveText('자료실');
    await expect(picker.locator('.lu-move-nav .lu-move-name')).toHaveText(['브리핑 요청함', '예시 교섭']);
    await expect(row(2)).toHaveAttribute('aria-pressed', 'true'); // 폴더 밖 자료, 앞에서 고른 것
    await picker.locator(`[data-lu-move-nav="${F(2)}"]`).click();
    await expect(picker.locator('.lu-move-sec')).toHaveText('예시 교섭');
    await picker.locator(`[data-lu-move-nav="${F(3)}"]`).click();
    await expect(picker.locator('.lu-move-sec')).toHaveText('예시 임금');
    await row(4).click();
    await page.screenshot({ path: `docs/design/screens/s67-41/${label}-pick-folder.png` });
    await picker.locator('.lu-move-back').click();
    await expect(picker.locator('.lu-move-sec')).toHaveText('예시 교섭');
    // 찾기는 어느 보기에서나 이름으로.
    await picker.locator('.lu-move-find').fill('사진');
    await expect(picker.locator('.lu-move-item')).toHaveCount(1);
    await picker.locator('.lu-move-find').fill('');
    const done = picker.locator('[data-lu-move-done]');
    await expect(done).toHaveText('넣기 2개');
    await done.click();
    await expect(picker).toBeHidden();
    await expect.poll(() => posted.map(p => p.document_id).sort()).toEqual([D(2)].sort());
  });
}
