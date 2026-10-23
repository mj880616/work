// MD-서식줄묶음: on a phone (760px 이하) the big editor's format buttons sit in group lists ([글자 ▾] [문단 ▾] [넣기 ▾]); wider than that they are on the row.
// These helpers open the group that holds a button first (when the button is not visible), so one test body serves both widths.
export const MD_GROUP = {
  '기울임': 'g-text', '코드': 'g-text',
  '글머리 목록': 'g-para', '번호 목록': 'g-para', '체크 목록': 'g-para', '인용': 'g-para', '구분선': 'g-para',
  '표 틀 넣기': 'g-insert', '강조 상자 종류 고르기': 'g-insert', 'Mermaid 도식 틀 고르기': 'g-insert', '파일 첨부': 'g-insert',
};
// Returns the button's locator, with its group list opened on a phone when needed.
export async function openMdTool(editor, name) {
  const target = editor.getByRole('button', {name, exact: true});
  const group = MD_GROUP[name];
  if (group && !(await target.isVisible())) await editor.locator(`[data-md-action="${group}"]`).click();
  return target;
}
// The choices a 제목·강조 상자·도식 button opens: under the button on a phone (a popover), the row under the format row when wider.
export const mdChoices = (editor, groupName, width) => (width < 761 ? editor.getByRole('group', {name: groupName}).getByRole('button') : editor.locator('.md-editor-menu button'));
