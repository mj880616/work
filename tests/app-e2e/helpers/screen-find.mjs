// UI-검색창하나로(S70-54, docs/design/one-search-bar.md): 화면 안 검색 칸은 없고 맨 위 칸이 지금 화면 찾기를 겸한다.
// PC 틀(761px~)은 상단 줄 #gsTopInput, 폰 틀은 앱 머리 줄 #gsScreenInput(600px 미만은 돋보기를 눌러 펼친다).
// 화면 시험은 이 칸으로 찾는다(옛 [data-note-search]·[data-nw-find]·#documentSearch 자리).
import {expect} from '@playwright/test';
export function screenFindLocator(page) {
  return page.locator((page.viewportSize()?.width || 1280) > 760 ? '#gsTopInput' : '#gsScreenInput');
}
export async function screenFind(page) {
  const width = page.viewportSize()?.width || 1280;
  const box = screenFindLocator(page);
  await expect(box).toHaveAttribute('data-screen-find', /.+/);
  if (width < 600 && !(await box.isVisible())) {
    await page.locator('.mobile-shell-header .sf-open').click();
    await expect(box).toBeVisible();
  }
  return box;
}
// 맨 위 줄로 옮겨 온 단추(지금 화면 상자 안).
export const screenTools = page => page.locator(`[data-screen-tools="${(page.viewportSize()?.width || 1280) > 760 ? 'top' : 'head'}"]`);
// (S70-53 공용 자리: 조직 관리 #soTeamTools는 screen-tools.js, 노트·읽을 거리·자료실 상자는 screen-find.js가 같은 칸에 둔다)
