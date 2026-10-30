import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { toplineItem, expectProjectTitle } from './helpers/screen-title.mjs';
import { expectProjectDetail } from './helpers/project-detail.mjs';
import { showAllReportWeeks } from './helpers/report-week.mjs';
// UI-중복제목삭제: with the PC top line (761px~, UI-폴드PC틀) already naming the open item ("프로젝트 › 이름",
// "사업 보고 › 이름 차수", "일정 › 일기 › 10월 3일 토요일"), the screen body has no title line of its own for it - the element is not made
// (same way as the note, topline-note-title.spec.mjs). What carries other information stays: the week range, the project's summary line
// (with its colour dot), the meeting result's meta line (칸·시각), the ×/⋯ buttons. Below 761px (phone) there is no top line, so the body keeps its
// title line (390 phone), and crossing 760/761px with the screen open switches it without a reload. Synthetic data only.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const at = '2026-10-05T01:00:00Z';
const diaryRow = { id: 'd3', workspace_id: 'w', kind: 'diary', title: null, journal_day: '2026-10-03', raw_text: '합성 일기 본문', occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: false, attachments: [], metadata: {} };
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const q = new URL(r.request().url()).searchParams;
    if (r.request().method() !== 'GET') return r.fallback();
    if (q.get('metadata')) return r.fulfill({ json: [] });
    return r.fulfill({ json: q.get('kind') === 'eq.diary' ? [diaryRow] : [] });
  });
  return errors;
}
const go = (page, view) => page.evaluate(v => window.KPTURouter.go(v), view);
const openDiaryDay = async page => { await go(page, 'diary'); await page.locator('[data-diary-day="2026-10-03"]').click(); await expect(page.locator('[data-diary-detail]')).toBeVisible(); };

for (const width of [1280, 1440]) {
  test(`PC ${width}: 업무일지·일기·프로젝트·사업 보고 본문에 상단 줄과 같은 제목 줄이 없다`, async ({ page }) => {
    const errors = await fixture(page, width);
    // 업무일지 = 홈(HOME-업무일지홈): the chosen day is the body head's title (no second title line), the top line says only '홈'.
    await go(page, 'home');
    await expect(toplineItem(page)).toHaveText('홈');
    await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 6일 화요일');
    await expect(page.locator('#journalRoot [data-journal-day-title]')).toHaveCount(0);
    await expect(page.locator('#journalRoot [data-journal-day]')).toHaveAttribute('aria-label', '10월 6일 화요일');
    await expect(page.locator('#journalRoot [data-journal-day]')).not.toHaveAttribute('aria-labelledby', /.+/);
    await expect(page.locator('#journalRoot [data-journal-input]')).toBeVisible();
    // 일기: the open day is in the top line; the panel head keeps only the × (right end), the body text stays.
    await openDiaryDay(page);
    const detail = page.locator('[data-diary-detail]');
    await expect(toplineItem(page)).toHaveText('10월 3일 토요일');
    await expect(detail.locator('h3')).toHaveCount(0);
    await expect(detail).toHaveAttribute('aria-label', '10월 3일 토요일');
    await expect(detail.locator('[data-diary-text-view]')).toHaveText('합성 일기 본문');
    const close = await detail.locator('[data-diary-detail-close]').boundingBox(), box = await detail.boundingBox();
    expect(close.x + close.width).toBeGreaterThan(box.x + box.width - 24);
    // 프로젝트: docked on the right - the top line names it; the head keeps the summary line with the colour dot, no title.
    // MTG-프로젝트합치기 ①: 사업영역 관리는 사업 보고 위 창이라, 이름은 위쪽 줄 대신 창 머리줄 '사업영역 관리 › 이름'에 있다.
    await go(page, 'projects');
    await expectProjectDetail(page);
    await expect(page.locator('#areaWindow [data-area-window-item]')).toHaveText('테스트 프로젝트');
    await expect(page.locator('#ps3Title')).toHaveCount(0);
    await expect(page.locator('#ps3DetailModal')).toHaveAttribute('aria-label', '테스트 프로젝트');
    await expect(page.locator('#ps3Summary')).toContainText('할 일');
    await expect(page.locator('#ps3Summary > .ps3-color-dot')).toHaveCount(1);
    await expect(page.locator('#ps3Menu details.ps3-more')).toBeVisible();
    // 사업 보고: the result column's head has no name/round line; the meta line (칸) and ⋯ stay.
    await go(page, 'meetings');
    // MTG-프로젝트합치기 3단계: [목록]은 한 주씩이고, 홈 공용 가짜 보고(home-entry.mjs)는 일시가 없어 어느 주에도 들지 않는다. [전체]로 모든 주를 본다.
    await showAllReportWeeks(page);
    const result = page.locator('#meetingList #mcolResult');
    await expect(result).toHaveAttribute('data-meeting-result', /.+/);
    await expect(toplineItem(page)).toHaveText('테스트 회의 회차');
    await expect(result.locator('#mrdTitle')).toBeHidden();
    await expect(result.locator('#mrdMeta')).toContainText('칸');
    await expect(result.locator('#mrdMore')).toBeVisible();
    await expect(result).toHaveAttribute('aria-label', '사업 보고 결과');
    expect(errors).toEqual([]);
  });
}

// UI-폴드PC틀: 상단 줄이 없는 폭은 폰(≤760)뿐이다(761px~는 PC 틀).
for (const width of [390]) {
  test(`${width}: 상단 줄이 없는 폭에서는 본문에 제목 줄이 그대로 있다`, async ({ page }) => {
    const errors = await fixture(page, width);
    await expect(page.locator('.app-topline')).toBeHidden();
    await go(page, 'home');
    // HOME-업무일지홈: 폰도 머리줄 날짜 제목 하나(본문 하루 카드에 두 번째 제목 줄 없음, 이름은 aria-label).
    await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 6일 화요일');
    await expect(page.locator('#journalRoot [data-journal-day-title]')).toHaveCount(0);
    await expect(page.locator('#journalRoot [data-journal-day]')).toHaveAttribute('aria-label', '10월 6일 화요일');
    await go(page, 'diary');
    await page.locator('[data-diary-day="2026-10-03"]').click();
    await expect(page.locator('[data-diary-detail] h3')).toHaveText('10월 3일 토요일');
    await expect(page.locator('[data-diary-detail]')).toHaveAttribute('aria-labelledby', 'diaryDetailTitle');
    await go(page, 'projects');
    await page.locator('#projectGrid [data-ps3-project]').first().click();
    await expectProjectTitle(page, '테스트 프로젝트');
    await expect(page.locator('#ps3Title .ps3-color-dot')).toHaveCount(1);
    await expect(page.locator('#ps3Summary > .ps3-color-dot')).toHaveCount(0);
    await expect(page.locator('#ps3DetailModal')).toHaveAttribute('aria-labelledby', 'ps3Title');
    expect(errors).toEqual([]);
  });
}

test('760/761px를 넘나들면 열려 있는 화면의 제목 줄이 새로고침 없이 바뀐다 (업무일지·일기)', async ({ page }) => {
  const errors = await fixture(page, 1280);
  await go(page, 'home');
  await expect(page.locator('#journalRoot [data-journal-day-title]')).toHaveCount(0);
  // 업무일지(홈)는 어느 폭에서도 머리줄 날짜 제목 하나뿐이다.
  await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 6일 화요일');
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.locator('#journalRoot [data-journal-day-title]')).toHaveCount(0);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator('#journalRoot [data-journal-day-title]')).toHaveCount(0);
  await expect(page.locator('#journalRoot [data-journal-day]')).toHaveAttribute('aria-label', '10월 6일 화요일');
  await page.setViewportSize({ width: 1280, height: 900 });
  await openDiaryDay(page);
  await expect(page.locator('[data-diary-detail] h3')).toHaveCount(0);
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.locator('[data-diary-detail] h3')).toHaveText('10월 3일 토요일');
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator('[data-diary-detail] h3')).toHaveCount(0);
  await expect(page.locator('[data-diary-detail] [data-diary-text-view]')).toHaveText('합성 일기 본문');
  expect(errors).toEqual([]);
});

test('프로젝트: 760/761px를 넘나들면 붙인 상세(제목 줄 없음)와 창(제목 줄 있음)이 바뀐다', async ({ page }) => {
  const errors = await fixture(page, 900);
  await go(page, 'projects');
  await expectProjectDetail(page);
  await expect(page.locator('#ps3Title')).toHaveCount(0);
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.locator('#ps3Title')).toHaveText('테스트 프로젝트');
  await expect(page.locator('#ps3Summary > .ps3-color-dot')).toHaveCount(0);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator('#ps3Title')).toHaveCount(0);
  await expect(page.locator('#ps3Summary > .ps3-color-dot')).toHaveCount(1);
  expect(errors).toEqual([]);
});
