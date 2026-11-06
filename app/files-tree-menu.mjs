// S51-22 [파일] 폰 나무 줄 ⋯ 메뉴 항목(순수 함수, node --test로 시험). 화면은 바뀌지 않고 그 자리 메뉴(row-menu.js)로 연다.
// 항목은 예전 '⋯ → 폴더 안으로 들어가 고르기 줄'에 있던 기능 그대로다(빼지 않음):
//  클라우드(원드라이브·구글): 파일 = 열기·복사·옮기기·이름 바꾸기·별표·휴지통 / 폴더 = 이 폴더만 보기·새 폴더·올리기·복사·옮기기·이름 바꾸기·색·위로·아래로·별표·휴지통
//  이 폰: 파일 = 열기·클라우드에 복사·이름 바꾸기·휴지통(폰에 쓸 수 있을 때) / 폴더 = 이 폴더만 보기·새 폴더·클라우드에 복사·이름 바꾸기(폰 폴더는 지우지 않음)
//  내 PC: 보기·열기만(파일 = 열기, 폴더 = 이 폴더만 보기).
// 휴지통은 맨 아래 한 줄(last, 빨강 없음 — 한 번 묻기는 trashRows).
export const TREE_MENU_LABEL = Object.freeze({
  open: '열기', only: '이 폴더만 보기', mkdir: '새 폴더', upload: '올리기', copy: '복사', move: '옮기기', tocloud: '클라우드에 복사',
  rename: '이름 바꾸기', color: '색', up: '위로', down: '아래로', star: '별표', unstar: '별표 빼기', trash: '휴지통'
});
const CLOUD = ['od', 'gd'];
// row: 나무 줄의 원래 줄(source·is_folder·starred), opt: phoneWrite(폰에 쓸 수 있나), sibIndex·sibCount(같은 부모 안 폴더 순서, 모르면 -1·0).
export function treeMenuItems(row, {phoneWrite = false, sibIndex = -1, sibCount = 0} = {}) {
  if (!row || !row.source) return [];
  const folder = !!row.is_folder, ids = [];
  if (row.source === 'pc') ids.push(folder ? 'only' : 'open');
  else if (row.source === 'ph') {
    if (folder) ids.push('only', ...(phoneWrite ? ['mkdir'] : []), 'tocloud', ...(phoneWrite ? ['rename'] : []));
    else ids.push('open', 'tocloud', ...(phoneWrite ? ['rename', 'trash'] : []));
  } else if (CLOUD.includes(row.source)) {
    if (folder) {
      ids.push('only', 'mkdir', 'upload', 'copy', 'move', 'rename', 'color');
      if (sibIndex > 0) ids.push('up');
      if (sibIndex >= 0 && sibIndex < sibCount - 1) ids.push('down');
    } else ids.push('open', 'copy', 'move', 'rename');
    ids.push(row.starred ? 'unstar' : 'star', 'trash');
  }
  return ids.map(id => ({id, label: TREE_MENU_LABEL[id], ...(id === 'trash' ? {last: true} : {}), ...(id === 'color' ? {popup: true} : {})}));
}
