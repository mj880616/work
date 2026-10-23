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

// 업무일지: the chosen day.
export const expectJournalDay = (page, text) => expectTitle(page, text, { wide: toplineShown(page), bodyTitle: '#journalRoot [data-journal-day-title]' });
// 일기: the open day.
export const expectDiaryDay = (page, text) => expectTitle(page, text, { wide: toplineShown(page), bodyTitle: '#diaryRoot [data-diary-detail] h3' });
// 프로젝트: the detail's name. Docked on the right (PC): the top line names it, the head keeps only the summary line (with the colour dot).
// Dialog: the head's own title.
export async function expectProjectTitle(page, text, { contains = false } = {}) {
  // The detail is placed (docked or dialog) when it is shown; before that the head is still the empty template.
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  if (await projectDetailDocked(page)) {
    await (contains ? expect(toplineItem(page)).toContainText(text) : expect(toplineItem(page)).toHaveText(text));
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
