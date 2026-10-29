import { expect } from '@playwright/test';
import { projectDetailDocked } from './project-detail.mjs';
// UI-중복제목삭제: with the PC top line (1024px~) the open item's name is in the top line's place ("일정 › 업무일지 › 10월 6일 화요일") and the
// screen's body has no title line of its own for it; below that width the body keeps its title line. Each helper checks whichever applies to
// the page's width (프로젝트: to whether the detail is docked on the right, which is exactly when the top line names it).
// Same shape as note-title.mjs (UI-상단줄제목 1차, the note).
export const toplineShown = page => (page.viewportSize()?.width || 0) >= 1024;
export const toplineItem = page => page.locator('[data-topline-where] [aria-current="page"]');

async function expectTitle(page, text, { wide, bodyTitle, wideCount = 0 }) {
  if (wide) {
    await expect(toplineItem(page)).toHaveText(text);
    await expect(page.locator(bodyTitle)).toHaveCount(wideCount);
  } else {
    await expect(page.locator(bodyTitle)).toHaveText(text);
  }
}

// 업무일지: the chosen day. UI-화면정리 C: a phone (~760px) has no body title line either (the pressed day in the week row shows it);
// the day card is named by aria-label there.
export async function expectJournalDay(page, text) {
  const width = page.viewportSize()?.width || 0;
  if (width > 760 || toplineShown(page)) return expectTitle(page, text, { wide: toplineShown(page), bodyTitle: '#journalRoot [data-journal-day-title]' });
  await expect(page.locator('#journalRoot [data-journal-day-title]')).toHaveCount(0);
  await expect(page.locator('#journalRoot [data-journal-day]')).toHaveAttribute('aria-label', text);
}
// 일기: the open day.
export const expectDiaryDay = (page, text) => expectTitle(page, text, { wide: toplineShown(page), bodyTitle: '#diaryRoot [data-diary-detail] h3' });
// 프로젝트: the detail's name. Docked on the right (PC): the top line names it, the head keeps only the summary line (with the colour dot).
// Dialog: the head's own title.
export async function expectProjectTitle(page, text, { contains = false } = {}) {
  // The detail is placed (docked or dialog) when it is shown; before that the head is still the empty template.
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  if (await projectDetailDocked(page)) {
    // MTG-프로젝트합치기 ①: 사업영역 관리는 사업 보고 위 창이라, 오른쪽 칸에 연 이름은 위쪽 줄 대신 창 머리줄 '사업영역 관리 › 이름'에 있다.
    const item = page.locator('#areaWindow [data-area-window-item]');
    await (contains ? expect(item).toContainText(text) : expect(item).toHaveText(text));
    await expect(page.locator('#ps3Title')).toHaveCount(0);
  } else {
    await (contains ? expect(page.locator('#ps3Title')).toContainText(text) : expect(page.locator('#ps3Title')).toHaveText(text));
  }
}
// The project's colour dot: in the title when it is a dialog, on the head's summary line when docked.
export async function projectColorDot(page) {
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  return page.locator((await projectDetailDocked(page)) ? '#ps3Summary > .ps3-color-dot' : '#ps3Title .ps3-color-dot');
}
