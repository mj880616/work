// UI-동그란더하기삭제: 공유 페이지 첫 줄의 추가 버튼. PC(761px~)는 글자 버튼 [+ 새 공유 페이지]·[+ HTML]이고,
// 폰(760px 이하)은 네모 작은 + 하나를 누르면 작은 메뉴 [새 공유 페이지][HTML 올리기]가 열린다. 두 길이 같은 창을 연다.
const phone = page => (page.viewportSize()?.width || 1280) <= 760;
async function pick(page, label, pcName) {
  if (phone(page)) {
    await page.locator('#pagesView').getByRole('button', {name:'공유 페이지 추가', exact:true}).click();
    await page.locator('#spAddMenu').getByRole('button', {name:label, exact:true}).click();
  } else await page.locator('#pagesView').getByRole('button', {name:pcName, exact:true}).click();
}
export const pressNewSharePage = page => pick(page, '새 공유 페이지', '새 공유 페이지');
export const pressNewHtmlPage = page => pick(page, 'HTML 올리기', '새 HTML 공유 페이지');
