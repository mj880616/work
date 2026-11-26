import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { routeMemos } from './helpers/memo-server.mjs';
import {screenFind} from './helpers/screen-find.mjs';

// S69-94 NOTE-메모통일(사용자 11/25 03:14~03:17 "생각 질문 인용 구분은 불필요 / 걍 다 메모로 통일 / 남기는 형식은 댓글인데 부르는 명칭은 메모 남기기 /
// 메모를 모아두는 화면에서는 메모도 보이지만 그 메모를 남긴 원문 기록으로 연결도 되어야"):
// - 노트·저장한 글(읽을 거리 글은 now-detail.spec·news-clipping-star.spec)이 같은 메모 칸(memo-thread.js): 시간순 줄 · [수정] · ✕ · [메모 남기기]. 생각·질문·인용 칩 없음.
// - 노트 보기 탭 [메모](옛 [댓글]) = 모든 메모 모아 보기: 출처 칩(전체·노트·저장한 글…), 줄 = 메모 + 출처 꼬리표 + 원문 제목.
//   줄을 누르면 그 원문이 열리고 그 메모로 내려가 잠깐 칠해진다. 원문이 지워졌으면 메모는 남고 '원래 기록이 없어요'(링크만 꺼짐).
// - 폴더 목록 '밑줄' 아래 '메모' 한 줄 = 같은 [메모] 보기. 본문 #낱말 → [태그] 모아 보기는 그대로. 새 표가 없으면(DB 적용 전) 옛 댓글을 메모로 읽음.
// 폰 390·PC 1280. 이름·글은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const N1 = 'e1000000-0000-4000-8000-000000000001', N2 = 'e1000000-0000-4000-8000-000000000002', N3 = 'e1000000-0000-4000-8000-000000000003', NGONE = 'e1000000-0000-4000-8000-000000000009';
const R1 = 'e2000000-0000-4000-8000-000000000001', RGONE = 'e2000000-0000-4000-8000-000000000009';
const M = n => `e3000000-0000-4000-8000-00000000000${n}`;
const memo = (n, type, id, body, at, extra = {}) => ({ id: M(n), workspace_id: 'w', target_type: type, target_id: id, target_title: null, body, quote: null, kind: null, created_at: at, updated_at: at, ...extra });

async function fixture(page, width, { table = true } = {}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const row = (id, title, raw_text, updated_at) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text, occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} });
  const notes = [
    row(N1, '바다 책', '바다는 넓고 깊다.\n#읽기 #바다', '2026-10-16T01:00:00Z'),
    row(N2, '회의 메모', '안건 정리 #회의 #읽기', '2026-10-12T01:00:00Z'),
    row(N3, '태그 없는 노트', '그냥 글 # 제목 아님', '2026-10-10T01:00:00Z'),
  ];
  const items = [{ id: R1, url: 'https://example.com/col', title: '가상 칼럼', site: 'example.com', saved_at: '2026-11-22T01:00:00Z', read_at: '2026-11-22T02:00:00Z', body_state: 'ok', body_at: '2026-11-22T01:00:10Z', business_area_id: null, updated_at: '2026-11-22T01:00:10Z', news_article_id: null, outside_article_id: null, body: '칼럼 첫 문단.\n\n칼럼 둘째 문단.' }];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => {
    const q = new URL(r.request().url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    return r.request().method() === 'GET' ? r.fulfill({ json: notes.filter(pick).slice(Number(q.get('offset') || 0)) }) : r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_reading_items', r => {
    const q = new URL(r.request().url()).searchParams, id = (q.get('id') || '').replace(/^eq\./, '');
    if (r.request().method() !== 'GET' || q.get('select') === 'id') return r.fallback();
    if (q.get('news_article_id') || q.get('outside_article_id')) return r.fulfill({ json: [] });
    const cut = x => { const { body, ...rest } = x; return (q.get('select') || '').includes('body') ? { ...rest, body } : rest; };
    return r.fulfill({ json: (id ? items.filter(x => x.id === id) : items).map(cut) });
  });
  // 옛 노트 댓글 표: 새 표가 있으면 읽지 않는다(새 표가 없을 때만 메모로 읽음).
  const old = [{ id: 'c1', workspace_id: 'w', note_id: N2, kind: 'question', quote: null, body: '옛 댓글 질문?', created_at: '2026-10-13T01:00:00Z' }];
  const oldReads = [];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_comments', r => { oldReads.push(r.request().method()); return r.request().method() === 'GET' ? r.fulfill({ json: old }) : r.fulfill({ status: 201, json: [{ ...r.request().postDataJSON(), id: 'c2', created_at: '2026-11-25T00:00:00Z' }] }); });
  const memos = await routeMemos(page, { missing: !table, gone: [RGONE], memos: [
    memo(1, 'note', N2, '옛 댓글 질문?', '2026-10-13T01:00:00Z', { kind: 'question', target_title: '회의 메모' }),
    memo(2, 'note', N1, '인용 달린 옛 메모', '2026-10-17T01:00:00Z', { kind: 'quote', quote: '바다는 넓고 깊다.', target_title: '바다 책' }),
    memo(3, 'note', NGONE, '지운 노트에 단 메모', '2026-10-18T01:00:00Z', { target_title: '지운 가상 노트' }),
    memo(4, 'reading', RGONE, '삭제한 저장 글 메모', '2026-10-19T01:00:00Z', { target_title: '지운 가상 칼럼' }),
  ] });
  return { errors, memos, oldReads };
}
const tap = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const view = page => page.locator('.nv-switch [data-note-view="comment"]');
async function notes(page) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
}
const line = (page, text) => page.locator('#noteRows [data-memo-line]').filter({ hasText: text });

for (const width of [390, 1280]) {
  test(`저장한 글에 메모 남기기 → 노트 [메모]에 출처·제목 → 누르면 그 글 그 메모로, 노트 메모도 같은 길, 지운 원문은 링크만 꺼짐 (${width})`, async ({ page }) => {
    const { errors, memos, oldReads } = await fixture(page, width);
    // 저장한 글 하나를 열면 글 아래 메모 칸(종류 칩 없음, [메모 남기기]).
    await page.evaluate(id => window.KPTUReading ? window.KPTUReading.open(id) : (window.KPTUReadingOpen = { id }, window.KPTURouter.go('reading')), R1);
    await expect(page.locator('#readingView')).toBeVisible();
    const th = page.locator('#readingView [data-rd-memos]');
    await expect(th.locator('[data-cm-count]')).toHaveText('메모 0');
    await expect(th.locator('.ds-seg, [data-cm-kind], .note-cm-kind')).toHaveCount(0);
    await th.locator('[data-cm-text]').fill('칼럼에 남긴 메모');
    await tap(page, th.getByRole('button', { name: '메모 남기기', exact: true }), width);
    await expect(th.locator('[data-cm-count]')).toHaveText('메모 1');
    expect(memos.posts).toEqual([{ workspace_id: 'w', target_type: 'reading', target_id: R1, target_title: '가상 칼럼', body: '칼럼에 남긴 메모' }]);
    await expect(th.locator('[data-cm-text]')).toHaveValue('');
    // 저장한 글 [메모] 탭: 이 화면 글에 남긴 메모만(지운 글 메모는 링크 꺼짐).
    if (width < 761) await page.locator('#readingView [data-rd-back]').click();
    const memoTab = page.locator('#readingView .rd-switch [data-filter-value="memos"]');
    await expect(memoTab).toHaveText('메모 2');
    await memoTab.click();
    await expect(page.locator('#readingView [data-rd-memo-list] [data-memo-line]')).toHaveCount(2);
    await expect(page.locator('#readingView [data-rd-memo-list] .memo-line-off')).toContainText('원래 기록이 없어요');

    // 노트 › [메모] 보기(옛 [댓글]): 탭 이름 '메모', 생각·질문·인용 칩 없음, 출처 칩.
    await notes(page);
    await expect(view(page)).toHaveText('메모');
    await expect(page.locator('.nv-switch')).not.toContainText('댓글');
    await tap(page, view(page), width);
    await expect(page.locator('[data-memo-group]')).toHaveText(['전체', '노트', '저장한 글']);
    await expect(page.locator('#basketView')).not.toContainText('생각');
    await expect(page.locator('[data-nt-kind]')).toHaveCount(0);
    const rows = page.locator('#noteRows [data-memo-line]');
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText('칼럼에 남긴 메모');
    await expect(rows.first().locator('.memo-src')).toHaveText('저장한 글');
    await expect(rows.first().locator('.memo-title')).toContainText('가상 칼럼');
    // 옛 인용 글은 메모 앞에 작게 그대로(종류 칩은 없음).
    await expect(line(page, '인용 달린 옛 메모').locator('q')).toHaveText('바다는 넓고 깊다.');
    // 원문이 지워진 메모: 메모·제목 사본은 남고 '원래 기록이 없어요', 누를 단추 없음.
    for (const text of ['지운 노트에 단 메모', '삭제한 저장 글 메모']) {
      await expect(line(page, text)).toContainText('원래 기록이 없어요');
      await expect(line(page, text).locator('button')).toHaveCount(0);
    }
    await expect(line(page, '지운 노트에 단 메모').locator('.memo-title')).toContainText('지운 가상 노트');
    // 출처 칩으로 거르기.
    await tap(page, page.locator('[data-memo-group="reading"]'), width);
    await expect(rows).toHaveCount(2);
    await tap(page, page.locator('[data-memo-group=""]'), width);
    await expect(rows).toHaveCount(5);
    // 저장한 글 메모 줄 → 저장한 글 화면에서 그 글이 열리고 그 메모로 내려가 칠해진다.
    await tap(page, line(page, '칼럼에 남긴 메모').locator('[data-memo-open]'), width);
    await expect(page.locator('#readingView')).toBeVisible();
    const flash = page.locator('#readingView [data-rd-memos] .memo-th-row.memo-th-flash');
    await expect(flash).toContainText('칼럼에 남긴 메모');
    await expect(flash).toBeInViewport();
    await expect(page.locator('#readingView .rd-doc')).toHaveText('가상 칼럼');

    // 노트 메모 줄 → 그 노트가 열리고 그 메모로.
    await notes(page);
    await tap(page, view(page), width);
    await tap(page, line(page, '옛 댓글 질문?').locator('[data-memo-open]'), width);
    await expect(page.locator('[data-note-detail]')).toBeVisible();
    const noteFlash = page.locator('[data-note-comments] .memo-th-row.memo-th-flash');
    await expect(noteFlash).toContainText('옛 댓글 질문?');
    await expect(page.locator('[data-note-comments] [data-cm-count]')).toHaveText('메모 1');
    // 노트 메모 칸: [수정]은 그 줄이 쓰기 칸 → 저장하면 글만 고침. 남기기·지우기(되돌리기).
    const nth = page.locator('[data-note-comments]');
    await tap(page, nth.getByRole('button', { name: '메모 수정' }), width);
    await nth.locator('[data-cm-edit-text]').fill('고친 질문?');
    await tap(page, nth.locator('[data-cm-edit-save]'), width);
    await expect(nth.locator('.memo-th-row')).toContainText('고친 질문?');
    expect(memos.patches.map(p => [p.id, p.body.body])).toEqual([[M(1), '고친 질문?']]);
    expect(Object.keys(memos.patches[0].body).sort()).toEqual(['body', 'updated_at']);
    await nth.locator('[data-cm-text]').fill('지울 메모');
    await tap(page, nth.getByRole('button', { name: '메모 남기기', exact: true }), width);
    await expect(nth.locator('[data-cm-count]')).toHaveText('메모 2');
    expect(memos.posts[1]).toEqual({ workspace_id: 'w', target_type: 'note', target_id: N2, target_title: '회의 메모', body: '지울 메모' });
    await tap(page, nth.locator('.memo-th-row').filter({ hasText: '지울 메모' }).getByRole('button', { name: '메모 삭제' }), width);
    await expect(nth.locator('[data-cm-count]')).toHaveText('메모 1');
    expect(memos.deletes).toEqual([memos.posts.length ? 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002' : '']);
    // 검색은 노트 메모 글도 찾는다(목록 보기).
    // 노트 머리의 #회의 → [태그] 보기(노트를 닫는다) → [목록] 보기.
    await tap(page, page.locator('[data-note-meta-tags] [data-note-tag="회의"]'), width);
    await expect(page.locator('[data-note-detail]')).toBeHidden();
    await tap(page, page.locator('.nv-switch [data-note-view="list"]'), width);
    await (await screenFind(page)).fill('고친 질문');
    await expect(page.locator('#noteRows .basket-title-text')).toHaveText(['회의 메모']);
    await (await screenFind(page)).fill('');
    expect(oldReads).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('폴더 목록 밑줄 아래 메모 줄 = [메모] 보기, [태그] 모아 보기는 그대로 (390)', async ({ page }) => {
  const { errors } = await fixture(page, 390);
  await notes(page);
  const memoRow = page.locator('#noteRows [data-nx-memo-item]');
  await expect(memoRow).toContainText('메모');
  await expect(memoRow.locator('.ft-num')).toHaveText('4');
  await memoRow.locator('[data-nx-memos]').tap();
  await expect(view(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#noteRows [data-memo-line]')).toHaveCount(4);
  await page.locator('.nv-switch [data-note-view="tag"]').tap();
  await expect(page.locator('[data-nt-tag]')).toHaveText(['#읽기2', '#바다1', '#회의1']);
  expect(errors).toEqual([]);
});

test('새 메모 표가 아직 없으면(DB 적용 전) 옛 댓글을 메모로 읽고 노트 메모만 남김, 저장한 글 메모 칸은 준비 중 (390)', async ({ page }) => {
  const { errors, oldReads } = await fixture(page, 390, { table: false });
  await notes(page);
  await page.locator('#noteRows [data-note-row="' + N2 + '"]').tap();
  const nth = page.locator('[data-note-comments]');
  await expect(nth.locator('[data-cm-count]')).toHaveText('메모 1');
  await expect(nth.locator('.memo-th-row')).toContainText('옛 댓글 질문?');
  await expect(nth.getByRole('button', { name: '메모 수정' })).toHaveCount(0);
  await nth.locator('[data-cm-text]').fill('옛 표에 남김');
  await nth.getByRole('button', { name: '메모 남기기', exact: true }).tap();
  await expect(nth.locator('[data-cm-count]')).toHaveText('메모 2');
  expect(oldReads).toContain('POST');
  await page.evaluate(id => { window.KPTUReadingOpen = { id }; window.KPTURouter.go('reading'); }, R1);
  await expect(page.locator('#readingView [data-rd-memos] [data-cm-wait]')).toHaveText('메모는 준비 중이에요.');
  await expect(page.locator('#readingView [data-rd-memos] [data-cm-text]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// S70-06 MEMO-입력칸작게(사용자 11/25 09:33 "메모가 없으면 메모칸은 일반적인 댓글창 수준으로"): 공용 메모 칸(memo-thread.js) 쓰기 칸은
// 처음 한 줄 + 같은 줄 오른쪽 작은 [남기기](공용 작은 버튼). 글만큼 늘고(5줄 뒤 칸 안 스크롤) 남긴 뒤 다시 한 줄. 크기 손잡이 없음. 빈 칸이면 [남기기] 꺼짐.
for (const width of [390, 1280]) {
  test(`메모 0개 노트: 메모 쓰기 칸은 한 줄 + 옆 작은 [남기기], 글만큼 늘고 남기면 다시 한 줄 (${width})`, async ({ page }) => {
    const { errors, memos } = await fixture(page, width);
    await notes(page);
    await tap(page, page.locator(`#noteRows [data-note-row="${N3}"]`), width);
    const nth = page.locator('[data-note-comments]');
    await expect(nth.locator('[data-cm-count]')).toHaveText('메모 0');
    const ta = nth.locator('[data-cm-text]');
    const save = nth.getByRole('button', { name: '메모 남기기', exact: true });
    await expect(ta).toBeVisible();
    const size = async () => ({ ta: await ta.evaluate(el => el.getBoundingClientRect().height), btn: await save.evaluate(el => el.getBoundingClientRect().height) });
    const first = await size();
    expect(first.ta).toBeLessThanOrEqual(first.btn + 0.5);
    expect(first.btn).toBeLessThanOrEqual(32);
    // 같은 줄 오른쪽.
    const [tb, bb] = [await ta.boundingBox(), await save.boundingBox()];
    expect(bb.x).toBeGreaterThan(tb.x + tb.width - 1);
    expect(Math.abs((bb.y + bb.height / 2) - (tb.y + tb.height / 2))).toBeLessThan(tb.height / 2 + 1);
    expect(await ta.evaluate(el => getComputedStyle(el).resize)).toBe('none');
    await expect(save).toHaveText('남기기');
    await expect(save).toHaveClass(/\bsecondary\b/);
    await expect(save).toBeDisabled();
    await ta.fill('   ');
    await expect(save).toBeDisabled();
    await ta.fill('첫 줄\n둘째 줄\n셋째 줄');
    await expect(save).toBeEnabled();
    await expect.poll(async () => (await size()).ta).toBeGreaterThan(first.ta * 2);
    await ta.fill('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12');
    const tall = (await size()).ta;
    expect(tall).toBeLessThan(first.ta * 6);
    expect(await ta.evaluate(el => getComputedStyle(el).overflowY)).toBe('auto');
    await ta.fill('세 줄\n메모\n남김');
    await tap(page, save, width);
    await expect(nth.locator('[data-cm-count]')).toHaveText('메모 1');
    expect(memos.posts.at(-1)).toMatchObject({ target_type: 'note', target_id: N3, body: '세 줄\n메모\n남김' });
    await expect(ta).toHaveValue('');
    await expect.poll(async () => (await size()).ta).toBeLessThanOrEqual(first.ta + 0.5);
    await expect(save).toBeDisabled();
    expect(errors).toEqual([]);
  });
}
