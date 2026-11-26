// BRIEF-자료실에서고르기(S64-10, 명진 11/17 09:31 "브리핑룸 이미 자료실에 있는 파일도 가능하게"):
// 브리핑 룸 [자료실에서 고르기] → 공용 고르기 창(여러 개) → '브리핑 요청함' 폴더에 연결 줄만 넣는다(파일 다시 올리기 없음, 받기는 부르지 않음).
// 다른 폴더에 든 자료는 옮기지 않고 목록에만 보인다. 자료 이름·문장은 모두 예시. 서버는 흉내(owner RLS REST).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { briefAdd, briefAddMenu } from './helpers/brief-head.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const D = n => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const lib = [
  { id: D(1), title: '예시 인력 운영 계획', file_name: '예시 계획.pdf', mime_type: 'application/pdf', created_at: '2026-10-06T00:50:00Z' },
  { id: D(2), title: '예시 연구 용역 최종 보고서', file_name: '예시 보고서.hwp', created_at: '2026-10-05T00:00:00Z' },
  { id: D(3), title: '예시 경영평가 편람 개정안', file_name: '예시 편람.pdf', mime_type: 'application/pdf', created_at: '2026-10-04T00:00:00Z' },
  { id: D(4), title: '예시 임금 교섭 자료', file_name: '예시 교섭.docx', created_at: '2026-10-03T00:00:00Z' },
  { id: D(5), title: '예시 회의 녹음 요약', file_name: '예시 요약.txt', created_at: '2026-10-02T00:00:00Z' },
];

async function open(page) {
  const posted = [], starts = [];
  const items = new Map([[D(1), 'f-brief'], [D(4), 'f-other']]); // D(1)은 이미 브리핑 요청함, D(4)는 다른 폴더
  await openHome(page, {
    beforeLoad: async () => {
      await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: [] }));
      await page.route(SB + '/rest/v1/app_library_folders**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ id: 'f-brief', sort_order: 1 }] : [] }));
      await page.route(SB + '/rest/v1/app_library_folder_items**', r => {
        const req = r.request(), u = new URL(req.url());
        if (req.method() === 'POST') {
          const body = [req.postDataJSON()].flat();
          posted.push(...body);
          for (const b of body) items.set(b.document_id, b.folder_id);
          return r.fulfill({ status: 201, body: '' });
        }
        const inList = u.searchParams.get('document_id');
        if (inList?.startsWith('in.(')) {
          const ids = inList.slice(4, -1).split(',');
          return r.fulfill({ json: ids.filter(id => items.has(id)).map(id => ({ document_id: id, folder_id: items.get(id) })) });
        }
        const folder = (u.searchParams.get('folder_id') || '').replace('eq.', '');
        return r.fulfill({ json: [...items].filter(([, f]) => !folder || f === folder).map(([document_id]) => ({ document_id })) });
      });
      await page.route(SB + '/rest/v1/app_documents?**', r => {
        const u = new URL(r.request().url());
        if (r.request().method() !== 'GET') return r.fallback();
        const want = u.searchParams.get('id');
        const rows = want?.startsWith('in.(') ? lib.filter(d => want.slice(4, -1).split(',').includes(d.id)) : lib;
        return r.fulfill({ json: rows.map(d => ({ workspace_id: 'w', category: '기타', visibility: 'private', ...d })) });
      });
      await page.route(SB + '/functions/v1/document-actions', r => { starts.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); });
    },
  });
  return { posted, starts };
}

for (const [label, width, height] of [['phone-412', 412, 915], ['fold-880', 880, 900], ['pc-1440', 1440, 900]]) {
  test(`브리핑 룸 [자료실에서 고르기]: 여러 개 골라 연결만 (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const { posted, starts } = await open(page);
    await page.evaluate(() => window.KPTURouter.go('brief'));
    const list = page.locator('#briefView [data-br-list]');
    await expect(list.locator('.br-row')).toHaveCount(1);
    // S71-30: [자료실에서 선택]은 머리 [+] 작은 메뉴 첫 줄.
    await briefAdd(page).click();
    await expect(briefAddMenu(page).getByRole('button')).toHaveText(['자료실에서 선택', '파일 업로드']);
    await briefAddMenu(page).locator('[data-br-add-act="lib"]').click();
    const picker = page.locator('#brLibPicker');
    await expect(picker).toBeVisible();
    await expect(picker.locator('.lu-move-sec')).toHaveText('최근 자료');
    await expect(picker.locator('.lu-move-item')).toHaveCount(5);
    // 이미 브리핑 룸에 있는 자료는 흐리게 '이미 있음'.
    const already = picker.locator(`[data-lu-move-folder="${D(1)}"]`);
    await expect(already).toHaveAttribute('aria-disabled', 'true');
    await expect(already).toContainText('이미 있음');
    const done = picker.locator('[data-lu-move-done]');
    await expect(done).toBeDisabled();
    await picker.locator(`[data-lu-move-folder="${D(2)}"]`).click();
    await expect(picker).toBeVisible(); // 고르는 동안 창은 열려 있다
    await expect(picker.locator(`[data-lu-move-folder="${D(2)}"]`)).toHaveAttribute('aria-pressed', 'true');
    // 찾기 → 고르기, 찾는 말을 바꿔도 고른 것은 남는다.
    await picker.locator('.lu-move-find').fill('편람');
    await expect(picker.locator('.lu-move-sec')).toHaveText('찾은 자료');
    await expect(picker.locator('.lu-move-item')).toHaveCount(1);
    await picker.locator(`[data-lu-move-folder="${D(3)}"]`).click();
    await picker.locator('.lu-move-find').fill('');
    await picker.locator(`[data-lu-move-folder="${D(4)}"]`).click();
    await expect(done).toHaveText('넣기 3개');
    await page.screenshot({ path: `docs/design/screens/s64-10/${label}-pick.png`, fullPage: false });
    await done.click();
    await expect(picker).toBeHidden();
    // 폴더 밖 자료 두 개만 '브리핑 요청함'에 연결, 다른 폴더(D4)는 옮기지 않고 목록에만.
    await expect.poll(() => posted.map(p => [p.document_id, p.folder_id]).sort()).toEqual([[D(2), 'f-brief'], [D(3), 'f-brief']]);
    await expect(list.locator('.br-row')).toHaveCount(4);
    for (const n of [2, 3, 4]) await expect(list.locator(`.br-row[data-br-open="${D(n)}"] [data-br-start]`)).toHaveText('브리핑 받기');
    await expect(page.locator('body')).toContainText('3개 넣었어요 · 1개는 원래 폴더에 그대로 두었어요');
    expect(starts).toHaveLength(0); // 넣기만, 받기는 줄의 단추로
    await page.screenshot({ path: `docs/design/screens/s64-10/${label}-after.png`, fullPage: false });
  });
}
