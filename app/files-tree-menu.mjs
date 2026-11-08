// S51-22 [파일] 폰 나무 줄 ⋯ 메뉴 항목(순수 함수, node --test로 시험). 화면은 바뀌지 않고 그 자리 메뉴(row-menu.js)로 연다.
// 항목은 예전 '⋯ → 폴더 안으로 들어가 고르기 줄'에 있던 기능 그대로다(빼지 않음):
//  클라우드(원드라이브·구글): 파일 = 열기·복사·옮기기·이름 바꾸기·별표·휴지통 / 폴더 = 이 폴더만 보기·새 폴더·올리기·복사·옮기기·이름 바꾸기·색·위로·아래로·별표·휴지통
//  이 폰: 파일 = 열기·클라우드에 복사·(S52-43 ②) 옮기기·이름 바꾸기·휴지통(폰에 쓸 수 있을 때) / 폴더 = 이 폴더만 보기·새 폴더·클라우드에 복사·이름 바꾸기(폰 폴더는 지우지 않음)
//  내 PC: 파일 = 열기(+ 바구니 PC 앱 0.4.0+면 클라우드로 복사·옮기기, S52-41 FILES-내PC클라우드옮기기), 폴더 = 이 폴더만 보기.
//   FILES-내PC쓰기(S52-43 ①, 0.5.0+ 문 pcEdit): 클라우드와 같은 항목 — 파일 = 열기·복사·옮기기·이름 바꾸기·휴지통,
//   폴더 = 이 폴더만 보기·새 폴더·옮기기·이름 바꾸기·휴지통(드라이브 줄은 이 폴더만 보기·새 폴더). 폴더째 복사는 다음 PR(저장소사이).
// FILES-자료실로보내기(S52-26): 파일(폴더 아님)은 [자료실로 보내기] — 구글 드라이브 파일이 이미 자료실에 있으면 그 자리가 [자료실에서 보기].
//   내 PC 파일은 아직 다리가 바이트를 읽지 못해(보기·열기만) 넣지 않는다. 폴더째 보내기는 이번엔 없다.
// S51-31 UI-⋯작은메뉴(요청함 11/06 23:28): 세 묶음으로 나눠 보인다 — 열기·올리기·복사·옮기기·이름 바꾸기 | 별표·색·위로·아래로 | 휴지통.
// 휴지통은 맨 아래 한 줄(last, 빨강 — 한 번 묻기는 trashRows). 둘째 묶음 첫 항목에 sep(가는 선).
export const TREE_MENU_LABEL = Object.freeze({
  open: '열기', only: '이 폴더만 보기', mkdir: '새 폴더', upload: '올리기', copy: '복사', move: '옮기기', tocloud: '클라우드에 복사',
  rename: '이름 바꾸기', color: '색', up: '위로', down: '아래로', star: '별표', unstar: '별표 빼기', trash: '휴지통',
  tolib: '자료실로 보내기', libview: '자료실에서 보기', pin: '위에 고정', unpin: '고정 풀기', path: '경로 복사', zip: '여러 개 받기'
});
const CLOUD = ['od', 'gd'];
const SECOND = ['pin', 'unpin', 'star', 'unstar', 'color', 'up', 'down']; // 둘째 묶음은 이 순서(요청함 원문 '별표·색·위로·아래로', S52-41 고정이 맨 앞)
// row: 나무 줄의 원래 줄(source·is_folder·starred), opt: phoneWrite(폰에 쓸 수 있나)·pcWrite(내 PC 문이 복사·옮기기를 앎), sibIndex·sibCount(같은 부모 안 폴더 순서, 모르면 -1·0).
// pinned(S52-41 FILES-폴더고정): 폴더를 고정할 수 있으면 true(고정됨)·false(안 됨), 고정할 수 없는 곳이면 null(항목 없음).
// zip(S52-44 ⑤): 이 줄을 포함해 파일을 여러 개 골랐으면 첫 묶음 끝에 [여러 개 받기](고른 파일을 zip 하나로, files-zip-model.mjs).
// copyPath(S52-43 ③ FILES-관리자마무리): 화면이 클립보드에 위치를 넣을 수 있으면 첫 묶음 끝에 [경로 복사](내 PC는 실제 경로, 그 밖은 '원드라이브 › 문서 › 이름').
export function treeMenuItems(row, {phoneWrite = false, pcWrite = false, pcEdit = false, sibIndex = -1, sibCount = 0, pinned = null, copyPath = false, zip = false} = {}) {
  if (!row || !row.source) return [];
  const folder = !!row.is_folder, ids = [];
  if (row.source === 'pc' && pcEdit) {
    // 드라이브 줄(C:\ 처럼 부모가 없는 줄)은 옮기기·이름·휴지통이 없다.
    const drive = folder && !row.parent_id;
    if (folder) ids.push('only', 'mkdir', ...(drive ? [] : ['move', 'rename', 'trash']));
    else ids.push('open', 'copy', 'move', 'rename', 'trash');
  } else if (row.source === 'pc') ids.push(...(folder ? ['only'] : ['open', ...(pcWrite ? ['copy', 'move'] : [])]));
  else if (row.source === 'ph') {
    if (folder) ids.push('only', ...(phoneWrite ? ['mkdir'] : []), 'tocloud', ...(phoneWrite ? ['rename'] : []));
    else ids.push('open', 'tolib', 'tocloud', ...(phoneWrite ? ['move', 'rename', 'trash'] : []));
  } else if (CLOUD.includes(row.source)) {
    if (folder) {
      ids.push('only', 'mkdir', 'upload', 'copy', 'move', 'rename', 'color');
      if (sibIndex > 0) ids.push('up');
      if (sibIndex >= 0 && sibIndex < sibCount - 1) ids.push('down');
    } else ids.push('open', row.library_doc_id && row.source === 'gd' ? 'libview' : 'tolib', 'copy', 'move', 'rename');
    ids.push(row.starred ? 'unstar' : 'star', 'trash');
  }
  if (folder && typeof pinned === 'boolean') ids.push(pinned ? 'unpin' : 'pin');
  if (copyPath) ids.push('path');
  if (zip) ids.push('zip');
  const group = id => (SECOND.includes(id) ? 2 : id === 'trash' ? 3 : 1);
  const rank = (id, i) => (group(id) === 2 ? SECOND.indexOf(id) : i);
  const sorted = ids.map((id, i) => ({id, i})).sort((a, b) => group(a.id) - group(b.id) || rank(a.id, a.i) - rank(b.id, b.i)).map(x => x.id);
  return sorted.map((id, i) => ({id, label: TREE_MENU_LABEL[id], ...(id === 'trash' ? {last: true} : {}), ...(id === 'color' ? {popup: true} : {}),
    ...(i && group(id) === 2 && group(sorted[i - 1]) !== 2 ? {sep: true} : {})}));
}
