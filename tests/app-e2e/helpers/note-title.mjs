import { expect } from '@playwright/test';
// UI-상단줄제목: with the PC top line (1024px~) the open note's title is in the top line's place ("노트 › 제목") and the note's head has
// no title line of its own; below that width the head keeps its title line. This checks whichever applies to the page's width.
export async function expectNoteTitle(page, text) {
  if ((page.viewportSize()?.width || 0) >= 1024) {
    await expect(page.locator('[data-topline-where] [aria-current="page"]')).toHaveText(text);
    await expect(page.locator('[data-note-read-title]')).toHaveCount(0);
  } else {
    await expect(page.locator('[data-note-read-title]')).toHaveText(text);
  }
}
