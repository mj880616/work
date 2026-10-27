// 노트 읽기 화면에는 돌아가기 버튼이 없다(UI-노트돌아가기삭제). 사람이 하는 방식 그대로 키보드 Esc로 닫는다.
export const closeNote = page => page.locator('[data-note-detail] [data-basket-read-text]').press('Escape');
