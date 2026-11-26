// S69-86 BRIEF-밑줄노트(명진 11/25 00:50·00:53): 브리핑 룸 자료 보기에서
// ① 글을 선택하면 공용 선택 줄 [밑줄 저장][답글][노트로][복사] — 밑줄은 공용 밑줄 표(종류 brief), 다시 열면 칠해지고 메뉴로 삭제.
// ② [답글] = 고른 글 + 메모 → 새 노트. ③ 머리 [노트로 보관] = 브리핑 한 장 + 밑줄 → 새 노트(마크다운).
// ④ 셋 다 글을 복사해 넣고 브리핑·자료 id를 담지 않아, [브리핑만 삭제] 뒤에도 밑줄·노트가 남는다(노트 › 밑줄에서 열면 '원래 브리핑이 없어요' 한 줄만).
// ⑤ 글자 크기 [−][+](공용, 서버 값 view_prefs.news_font): 본문·목록 줄만 커지고, 새로고침 뒤에도 그대로.
// 자료 이름·문장은 모두 예시. 서버는 흉내(표 읽기는 owner RLS REST).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const D = n => `d0000000-0000-4000-8000-00000000000${n}`;
const NAME = '예시 도시철도 통합 연구';
const LINE1 = '예시 기관: 통합 운영 기준을 연내 마련';
const LINE2 = '예시 노선 운영 인력 재배치 계획 설명';
const brief3 = {
  v: 3, lead: '통합 운영 기준을 연내 마련하기로 함.',
  gist: ['통합 운영 기준을 연내 마련하기로 함.', '인력 재배치는 다음 회의에서 다시 봄.'],
  sections: [
    { title: '안건 1. 통합 운영', items: [{ text: LINE1, page: 12, ours: true }, { text: '예시 위원: 예산 재검토 요구', page: null }] },
    { title: '안건 2. 인력', items: [{ text: LINE2, page: 33 }] },
  ],
  quotes: [{ text: '연내에 기준을 마련하겠습니다.', speaker: '예시 국장', heading: '안건 1', page: 12 }],
};

async function open(page) {
  const s = {
    briefs: [{ id: 'b3', document_id: D(3), status: 'done', stage: 'done', step_no: 9, step_total: 9, page_count: 96, brief: brief3, error_code: null, created_at: '2026-11-24T00:00:00Z', updated_at: '2026-11-24T00:10:00Z', finished_at: '2026-11-24T00:10:00Z' }],
    hl: [], hlPosts: [], hlDeletes: 0, notes: [], noteDeletes: 0,
  };
  const docs = [{ id: D(3), title: NAME, file_name: '예시 연구.pdf', mime_type: 'application/pdf', file_id: 'FILE_cccccccccc', created_at: '2026-11-24T00:00:00Z' }];
  const home = await openHome(page, {
    beforeLoad: async () => {
      await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: s.briefs }));
      await page.route(SB + '/rest/v1/app_library_folders**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ id: 'f-brief' }] : [] }));
      await page.route(SB + '/rest/v1/app_library_folder_items**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ document_id: D(3) }] : [] }));
      await page.route(SB + '/rest/v1/app_documents?**', r => {
        if (r.request().method() !== 'GET') return r.fallback();
        return new URL(r.request().url()).searchParams.get('id')?.startsWith('in.') ? r.fulfill({ json: docs }) : r.fallback();
      });
      await page.route(SB + '/rest/v1/rpc/app_document_brief_delete', r => { s.briefs = s.briefs.filter(b => b.document_id !== r.request().postDataJSON().p_document_id); return r.fulfill({ json: null }); });
      await page.route(SB + '/rest/v1/app_news_highlights**', r => {
        const req = r.request(), m = req.method();
        if (m === 'POST') {
          const body = req.postDataJSON();
          const row = { ...body, id: `e0000000-0000-4000-8000-00000000000${s.hl.length + 1}`, created_at: '2026-11-25T00:00:00Z', updated_at: '2026-11-25T00:00:00Z' };
          s.hlPosts.push(body); s.hl.unshift(row);
          return r.fulfill({ status: 201, json: [row] });
        }
        if (m === 'DELETE') { s.hlDeletes++; const id = (new URL(req.url()).searchParams.get('id') || '').replace(/^eq\./, ''); s.hl = s.hl.filter(h => h.id !== id); return r.fulfill({ status: 204, body: '' }); }
        return r.fulfill({ json: s.hl });
      });
      await page.route(SB + '/rest/v1/app_notes**', r => {
        const req = r.request(), m = req.method();
        if (m === 'POST') { const body = req.postDataJSON(); const row = { id: `f0000000-0000-4000-8000-00000000000${s.notes.length + 1}`, kind: 'note', created_at: '2026-11-25T00:00:00Z', updated_at: '2026-11-25T00:00:00Z', ...body }; s.notes.push(row); return r.fulfill({ status: 201, json: [row] }); }
        if (m === 'DELETE') s.noteDeletes++;
        return r.fallback();
      });
    },
  });
  return { s, prefs: home.prefs };
}
const detail = page => page.locator('#briefView [data-br-detail]');
const body = page => detail(page).locator('[data-br-zone]');
async function openBrief(page) {
  await page.evaluate(() => window.KPTURouter.go('brief'));
  await expect(page.locator('#briefView .br-row')).toHaveCount(1);
  await page.locator('#briefView .br-row').first().click();
  await expect(body(page).locator('.br-items li').first()).toContainText(LINE1);
}
// 본문 글 하나를 선택(폰 길게 눌러 선택·PC 끌기와 같은 선택 범위). 텍스트 마디 안 글자만.
const pick = (page, text) => page.evaluate(t => {
  const zone = document.querySelector('#briefView [data-br-zone]');
  const w = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const i = n.data.indexOf(t);
    if (i < 0) continue;
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    return true;
  }
  return false;
}, text);
const fontPx = loc => loc.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
const bar = page => page.locator('div[data-hl-bar]');

for (const [label, width, height] of [['phone-390', 390, 844], ['pc-1280', 1280, 860]]) {
  test(`브리핑 밑줄·답글·노트로 보관, 브리핑 지운 뒤에도 남음 (${label})`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const { s } = await open(page);
    await openBrief(page);
    const head = detail(page).locator('.br-head');
    await expect(head.locator('.br-src')).toHaveText('원문 열기');
    await expect(head.locator('[data-text-size-ctl]')).toBeVisible();
    await expect(head.locator('[data-br-archive]')).toHaveText('노트로 보관');

    // ① 밑줄 저장: 공용 선택 줄에 [밑줄 저장][메모](S69-94 옛 [답글])[노트로][복사].
    expect(await pick(page, LINE1)).toBe(true);
    await expect(bar(page)).toBeVisible();
    for (const name of ['밑줄 저장', '메모', '노트로', '복사']) await expect(bar(page).getByRole('button', { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `docs/design/screens/s69-86/${label}-select.png`, fullPage: false });
    await bar(page).getByRole('button', { name: '밑줄 저장', exact: true }).click();
    await expect.poll(() => s.hlPosts.length).toBe(1);
    expect(s.hlPosts[0]).toMatchObject({ source_type: 'brief', source_id: D(3), quote: LINE1, source_title: NAME, source_media: '브리핑', source_url: null });
    await expect(body(page).locator('mark.hl-mark')).toHaveText(LINE1);

    // ② [메모](옛 답글): 고른 글 + 메모 → 새 노트(밑줄은 더 저장하지 않음).
    expect(await pick(page, LINE2)).toBe(true);
    await bar(page).getByRole('button', { name: '메모', exact: true }).click();
    const ask = page.locator('.kptu-ask-input');
    await expect(ask.locator('.kptu-ask-text')).toHaveText('메모 남기기');
    await ask.locator('input').fill('다음 회의 전에 인원 확인');
    await ask.getByRole('button', { name: '노트에 저장' }).click();
    await expect.poll(() => s.notes.length).toBe(1);
    expect(s.notes[0].title).toBe(`메모 · ${NAME}`);
    expect(s.notes[0].raw_text).toContain(`> ${LINE2}`);
    expect(s.notes[0].raw_text).toContain('메모: 다음 회의 전에 인원 확인');
    expect(s.notes[0].raw_text).toMatch(/출처: 브리핑 · 2026-11-24 · 예시 도시철도 통합 연구/);
    expect(s.hlPosts).toHaveLength(1);

    // ③ 노트로 보관: 요지·소제목 줄·원문 인용·밑줄을 마크다운 노트 한 장으로.
    await head.locator('[data-br-archive]').click();
    await expect.poll(() => s.notes.length).toBe(2);
    const kept = s.notes[1];
    expect(kept.title).toBe(`브리핑 · ${NAME}`);
    expect(kept.metadata?.markdown).toBe(true);
    for (const part of ['## 요지', '통합 운영 기준을 연내 마련하기로 함.', '## 안건 1. 통합 운영', `- ${LINE1} (우리 관련) · 12쪽`, '## 안건 2. 인력', '## 원문 인용', '> “연내에 기준을 마련하겠습니다.”', '— 예시 국장 · 12쪽 · 안건 1', '## 밑줄 1', `> ${LINE1}`]) expect(kept.raw_text).toContain(part);
    // ④ 노트·밑줄에는 브리핑·자료를 가리키는 연결이 없다(글 복사만) — 노트 본문·속성에 자료 id·Drive 주소 없음.
    for (const n of s.notes) { expect(JSON.stringify(n)).not.toContain(D(3)); expect(JSON.stringify(n)).not.toContain('drive.google.com'); }

    // [브리핑만 삭제] → 밑줄·노트 지우는 요청 없음. 노트 › 밑줄 [원문에서 보기] 길만 꺼진다.
    if (width <= 760) await page.locator('#briefView [data-br-back]').click();
    await page.locator(`#briefView [data-br-more="${D(3)}"]`).click();
    await page.locator('#brRowMenu [data-br-act="brief"]').click();
    await page.locator('.kptu-ask .kptu-ask-actions button', { hasText: '삭제' }).click();
    await expect.poll(() => s.briefs.length).toBe(0);
    expect(s.hlDeletes).toBe(0);
    expect(s.noteDeletes).toBe(0);
    expect(s.hl).toHaveLength(1);
    expect(s.notes).toHaveLength(2);
    await page.evaluate(([id, h]) => { window.KPTUBriefOpen = { id, highlight: h }; window.KPTURouter.go('home'); window.KPTURouter.go('brief'); }, [D(3), s.hl[0].id]);
    await expect(page.locator('body')).toContainText('원래 브리핑이 없어요');
    expect(errors).toEqual([]);
  });

  test(`브리핑 글자 크기 [−][+]: 본문·목록 줄만, 새로고침 뒤 유지 (${label})`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height });
    const { prefs } = await open(page);
    await page.evaluate(() => window.KPTURouter.go('brief'));
    await expect(page.locator('#briefView .br-row')).toHaveCount(1);
    // 목록만 보일 때(폰): 목록 머리 줄 끝에 하나. S70-84: 두 칸 폭(600px~)은 맨 위 다 된 브리핑이 오른쪽에 바로 열려 보기 머리 줄에 하나.
    const listCtl = page.locator('#briefView [data-br-list] .br-head [data-text-size-ctl]');
    if (width < 600) await expect(listCtl).toBeVisible();
    else await expect(listCtl).toHaveCount(0);
    await page.locator('#briefView .br-row').first().click();
    await expect(body(page).locator('.br-items li').first()).toContainText(LINE1);
    // 보기가 열리면 글자 크기 단추는 보기 머리 줄 하나뿐.
    await expect(page.locator('#briefView [data-text-size-ctl]:visible')).toHaveCount(1);
    const items = body(page).locator('.br-items').first(), title = detail(page).locator('.br-doc');
    const base = await fontPx(items), titleBase = await fontPx(title);
    const bigger = detail(page).getByRole('button', { name: '글자 크게' });
    await bigger.click(); await bigger.click();
    await expect(body(page)).toHaveAttribute('data-text-size', 'xl');
    await expect.poll(() => fontPx(items)).toBeCloseTo(base * 1.375, 1);
    expect(await fontPx(title)).toBe(titleBase);
    await expect.poll(() => prefs.value?.news_font).toBe('xl');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `docs/design/screens/s69-86/${label}-big.png`, fullPage: false });
    // 새로고침 뒤에도 서버 값 그대로(기기 저장 없음) — 목록 줄도 같은 크기.
    await page.reload();
    await page.waitForFunction(() => window.KPTURouter?.go);
    await page.evaluate(() => window.KPTURouter.go('brief'));
    await expect(page.locator('#briefView .br-row')).toHaveCount(1);
    await expect(page.locator('#briefView .br-rows')).toHaveAttribute('data-text-size', 'xl');
    await page.locator('#briefView .br-row').first().click();
    await expect(body(page)).toHaveAttribute('data-text-size', 'xl');
    await expect.poll(() => fontPx(body(page).locator('.br-items').first())).toBeCloseTo(base * 1.375, 1);
    await detail(page).getByRole('button', { name: '글자 작게' }).click();
    await expect.poll(() => prefs.value?.news_font).toBe('l');
  });
}
