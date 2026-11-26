// S71-76 NAV-뒤로가기직전화면 화면 표(docs/design/standard-interactions.md B1): 한 화면의 줄이 다른 화면 항목을 여는 길.
// 줄마다: boot(가짜 서버 + 그 목록까지), row(누를 줄 — 목록 아래쪽, 스크롤해야 보이는 줄), arrived(다른 화면에 그 항목이 열림),
// list(돌아왔을 때 보여야 할 직전 목록). 시험(standard-interactions.spec.mjs B1)은 열기 → 뒤로가기 한 번 → 직전 화면·같은 줄 같은 자리만 본다.
// 새 길을 고치거나 만들면 여기에 한 줄 더한다.
import { expect } from '@playwright/test';
import { notesNewsFixture, noteNewsRow, noteNewsBox, SAVED_COUNT } from './notes-news.mjs';

const press = async (loc, width) => { await loc.scrollIntoViewIfNeeded(); if (width < 761) await loc.tap(); else await loc.click(); };
const newsOpen = async page => {
  await expect.poll(() => page.evaluate(() => window.KPTURouter.current)).toBe('outside');
  await expect(page.locator('#outsideRoot')).toHaveAttribute('data-detail', 'open');
};

export const BACK_PATHS = [
  {
    id: 'note-saved', name: '노트 › 저장한 글 → 글(읽을 거리 글 보기)', widths: [390, 1280], view: 'basket',
    async boot(page, width) {
      const s = await notesNewsFixture(page, width);
      await press(noteNewsRow(page, 'news-saved', width), width);
      await expect(noteNewsBox(page).locator('.nnm-sv')).toHaveCount(SAVED_COUNT);
      return s;
    },
    row: page => noteNewsBox(page).locator('.nnm-sv').nth(SAVED_COUNT - 3).locator('[data-nnm-saved]'),
    list: page => noteNewsBox(page).locator('.nnm-sv').first(),
    arrived: newsOpen,
  },
  {
    id: 'note-mark', name: '노트 › 밑줄 → 원문 글(읽을 거리 글 보기)', widths: [390, 1280], view: 'basket',
    async boot(page, width) {
      const s = await notesNewsFixture(page, width);
      await press(noteNewsRow(page, 'news-hl', width), width);
      await expect(noteNewsBox(page).locator('.nh-row')).toHaveCount(2);
      return s;
    },
    row: page => noteNewsBox(page).locator('.nh-row').nth(1).locator('[data-nh-open]'),
    list: page => noteNewsBox(page).locator('.nh-row').first(),
    arrived: newsOpen,
  },
];
export { press as backPress };
